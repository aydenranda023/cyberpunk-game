import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from 'firebase-admin';
import { GAME_MASTER_PROMPT } from './lib/prompt_bank.js';

// 初始化防炸逻辑
if (!admin.apps.length) {
    try {
        const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
        const dbUrl = process.env.FIREBASE_DB_URL;
        if (serviceAccountStr && dbUrl) {
            let serviceAccount = JSON.parse(serviceAccountStr);
            if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
            admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: dbUrl });
        }
    } catch (e) { console.error("Firebase Init Error", e); }
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Ensure we use a model that supports JSON mode well, or instruct it clearly.
// flash-lite is fast but might need strict prompting.
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

export default async function handler(req, res) {
    if (!admin.apps.length) return res.status(500).json({ error: "DB Connect Fail" });
    const db = admin.database();
    const { action, roomId, userId, choiceText, userProfile } = req.body;

    try {
        // 1. 创建房间
        if (action === 'CREATE_ROOM') {
            const newRoomId = Math.floor(1000 + Math.random() * 9000).toString();
            await db.ref('rooms/' + newRoomId).set({
                created_at: admin.database.ServerValue.TIMESTAMP,
                status: 'SOLO', turn: 0, last_scene_change: 0, players: {},
                host_info: userProfile || { name: '未知', role: 'Ghost' }
            });
            return res.status(200).json({ roomId: newRoomId });
        }

        // 2. 加入房间
        if (action === 'JOIN_ROOM') {
            const roomRef = db.ref('rooms/' + roomId);
            const snapshot = await roomRef.once('value');
            if (!snapshot.exists()) return res.status(404).json({ error: "房间不存在" });
            await roomRef.child('players/' + userId).update({ joined: true, choice: null, profile: userProfile });
            return res.status(200).json({ success: true });
        }

        // 3. 预加载 (PRELOAD)
        if (action === 'PRELOAD_TURN') {
            // 仅在单人或特定策略下有效。这里简单实现：为当前玩家的两个潜在选择预生成。
            // 这是一个后台触发，不阻塞前台。
            // 为了简化，我们只生成一个“通用”的下一章，或者针对 A/B 分别生成。
            // 考虑到 API 成本和速度，我们先尝试生成针对 "A" 的预演，如果玩家选 B，则实时生成 (或者并行生成 A 和 B)。
            // 更好的策略：Preload 不带 choice，让 AI 构思“无论选什么都会发生的推进”，或者根据当前 context 预测。
            // 但用户要求“不要选择后再生成”。
            // 让我们并行生成 A 和 B 的结果存入 prebuffer。

            const roomRef = db.ref('rooms/' + roomId);
            const snapshot = await roomRef.once('value');
            const roomData = snapshot.val();
            if (!roomData || !roomData.current_scene) return res.status(200).json({ msg: "No scene to preload from" });

            const myView = roomData.current_scene[userId];
            if (!myView || !myView.choices) return res.status(200).json({ msg: "No choices found" });

            const choices = myView.choices; // [{text: "Aggressive"}, {text: "Conservative"}]

            // 异步触发生成，不等待? Vercel 函数会杀掉未完成的 promise。必须等待。
            // 这意味着 PRELOAD 请求会持续几秒。前端 `fetch` 不 await 即可。

            const generateForChoice = async (cText) => {
                return await runGameLogic(db, roomId, userId, cText, true); // true = isPreload
            };

            const [resA, resB] = await Promise.all([
                generateForChoice(choices[0].text),
                generateForChoice(choices[1].text)
            ]);

            // 存入 prebuffer
            await roomRef.child(`prebuffer/${userId}`).set({
                [choices[0].text]: resA,
                [choices[1].text]: resB
            });

            return res.status(200).json({ status: "PRELOADED" });
        }

        // 4. 生成剧情 (核心逻辑)
        if (action === 'START_GAME' || action === 'MAKE_MOVE') {
            const roomRef = db.ref('rooms/' + roomId);

            if (action === 'MAKE_MOVE') {
                // 检查 Prebuffer
                const preSnap = await roomRef.child(`prebuffer/${userId}/${choiceText}`).once('value');
                if (preSnap.exists()) {
                    const preData = preSnap.val();
                    // 应用预加载的数据
                    await roomRef.child('current_scene').set(preData.views);
                    await roomRef.child('history').push(`[事件] ${preData.global_summary}`);
                    await roomRef.child(`players/${userId}`).update({ choice: null });
                    // 清空 buffer
                    await roomRef.child(`prebuffer/${userId}`).remove();

                    // 更新回合数 (Preload 生成时没更新 DB 的 turn，现在更新)
                    // 注意：Preload 生成的内容是基于“当前 turn”生成的“下一 turn 内容”。
                    // 所以应用时，turn 应该 +1。
                    await roomRef.child('turn').transaction(t => (t || 0) + 1);

                    return res.status(200).json({ status: "NEW_TURN" });
                }

                // 无 Prebuffer，正常流程
                await roomRef.child(`players/${userId}`).update({ choice: choiceText });
            }

            const snapshot = await roomRef.once('value');
            const roomData = snapshot.val();
            const players = roomData.players || {};
            const playerIds = Object.keys(players);

            if (action === 'MAKE_MOVE') {
                const allReady = playerIds.every(pid => players[pid].choice);
                if (!allReady) return res.status(200).json({ status: "WAITING" });
            }

            // 运行生成逻辑
            const aiJson = await runGameLogic(db, roomId, userId, null, false);

            // 写入 Scene & History
            await roomRef.child('current_scene').set(aiJson.views);
            await roomRef.child('history').push(`[事件] ${aiJson.global_summary}`);

            const updates = {};
            const updates2 = {}; // For HP and Death

            // Process HP and Death
            for (const pid of playerIds) {
                updates[`players/${pid}/choice`] = null;

                const view = aiJson.views[pid];
                if (view && typeof view.hp_change === 'number') {
                    const currentHp = players[pid].profile.public.hp || 100;
                    let newHp = currentHp + view.hp_change;
                    if (newHp < 0) newHp = 0;
                    // Optional: Cap max HP? For now, let's just keep it simple or cap at 150?
                    // Let's just clamp min 0.

                    updates2[`players/${pid}/profile/public/hp`] = newHp;

                    if (newHp <= 0) {
                        updates2[`players/${pid}/dead`] = true;
                        // Inject death flag into the view for frontend to react
                        aiJson.views[pid].is_dead = true;
                        // Update the view in DB as well so frontend listener gets it
                        await roomRef.child(`current_scene/${pid}/is_dead`).set(true);
                    }
                }
            }

            await roomRef.update(updates);
            if (Object.keys(updates2).length > 0) await roomRef.update(updates2);

            // 更新 Turn 和 SceneChange 计数
            const newTurn = (roomData.turn || 0) + 1;
            const lastChange = roomData.last_scene_change || 0;
            const updates3 = { turn: newTurn };

            const sampleView = Object.values(aiJson.views)[0];
            if (sampleView && sampleView.stage_1_env) {
                updates3.last_scene_change = newTurn;
            }

            await roomRef.update(updates3);

            if (action === 'START_GAME') await roomRef.update({ status: 'PLAYING' });

            return res.status(200).json({ status: "NEW_TURN" });
        }

        return res.status(400).json({ error: "Unknown Action" });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
}

// 抽取核心生成逻辑，以便 Preload 复用
async function runGameLogic(db, roomId, userId, simulatedChoice, isPreload) {
    const roomRef = db.ref('rooms/' + roomId);
    const snapshot = await roomRef.once('value');
    const roomData = snapshot.val();
    const players = roomData.players || {};
    const playerIds = Object.keys(players);

    // 场景更换逻辑
    const turn = roomData.turn || 0;
    const lastChange = roomData.last_scene_change || 0;
    const diff = turn - lastChange;
    // 随机 3-6 回合
    const threshold = 3 + Math.floor(Math.random() * 4);
    const isSceneChange = (diff >= threshold) || (turn === 0);

    const historySnap = await roomRef.child('history').once('value');
    let historyList = historySnap.val() || [];
    if (typeof historyList === 'object') historyList = Object.values(historyList);

    let playerContext = "";
    playerIds.forEach(pid => {
        const p = players[pid];
        // 如果是 Preload，使用模拟的 choice
        const choice = (isPreload && pid === userId) ? simulatedChoice : (p.choice || "进入游戏");
        const pub = JSON.stringify(p.profile?.public || {});
        const priv = JSON.stringify(p.profile?.private || {});
        playerContext += `玩家ID(${pid}): ${p.profile?.name}[${p.profile?.role}]。\n状态:${pub}\n秘密:${priv}\n本轮行动:${choice}\n\n`;
    });

    const sysPrompt = GAME_MASTER_PROMPT
        .replace('{{HISTORY}}', historyList.slice(-3).join("\n"))
        .replace('{{IS_SCENE_CHANGE}}', isSceneChange.toString())
        .replace('{{PLAYER_CONTEXT}}', playerContext)
        .replace(/{{PREV_CHOICE}}/g, simulatedChoice || "上轮行动"); // 简单替换

    const result = await model.generateContent(sysPrompt);
    const txt = result.response.text();

    // Robust JSON parsing
    let aiJson;
    try {
        const jsonMatch = txt.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            aiJson = JSON.parse(jsonMatch[0]);
        } else {
            throw new Error("No JSON found");
        }
    } catch (e) {
        console.error("JSON Parse Error", e);
        // Fallback
        return {
            global_summary: "系统错误",
            views: { [userId]: { stage_2_event: "数据链路中断...", choices: [{ text: "重试" }, { text: "等待" }] } }
        };
    }
    return aiJson;
}
