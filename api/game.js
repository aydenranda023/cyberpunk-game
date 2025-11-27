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
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

export default async function handler(req, res) {
    if (!admin.apps.length) return res.status(500).json({ error: "DB Connect Fail" });
    const db = admin.database();
    const { action, roomId, userId, choiceText, userProfile, oldRoomId } = req.body;

    try {
        // 1. 创建房间
        if (action === 'CREATE_ROOM') {
            const newRoomId = Math.floor(1000 + Math.random() * 9000).toString();
            await db.ref('rooms/' + newRoomId).set({
                created_at: admin.database.ServerValue.TIMESTAMP,
                status: 'SOLO', turn: 0, last_scene_change: 0, last_hp_change: 0, players: {},
                host_info: userProfile || { name: '未知', role: 'Ghost' }
            });
            return res.status(200).json({ roomId: newRoomId });
        }

        // 2. 加入房间
        if (action === 'JOIN_ROOM') {
            const roomRef = db.ref('rooms/' + roomId);
            const snapshot = await roomRef.once('value');
            if (!snapshot.exists()) return res.status(404).json({ error: "房间不存在" });

            // Update User Location
            await db.ref(`users/${userId}/current_room`).set(roomId);

            await roomRef.child('players/' + userId).update({ joined: true, choice: null, profile: userProfile });

            // Cleanup Old Room
            if (oldRoomId && oldRoomId !== roomId) {
                checkAndCleanRoom(db, oldRoomId);
            }

            return res.status(200).json({ success: true });
        }

        // 3. 预加载 (PRELOAD)
        if (action === 'PRELOAD_TURN') {
            const roomRef = db.ref('rooms/' + roomId);
            const snapshot = await roomRef.once('value');
            const roomData = snapshot.val();
            if (!roomData || !roomData.current_scene) return res.status(200).json({ msg: "No scene to preload from" });

            const myView = roomData.current_scene[userId];
            if (!myView || !myView.choices) return res.status(200).json({ msg: "No choices found" });

            const choices = myView.choices;

            const generateForChoice = async (cText) => {
                return await runGameLogic(db, roomId, userId, cText, true); // true = isPreload
            };

            const [resA, resB] = await Promise.all([
                generateForChoice(choices[0].text),
                generateForChoice(choices[1].text)
            ]);

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
                    await roomRef.child('current_scene').set(preData.views);
                    await roomRef.child('history').push(`[事件] ${preData.global_summary}`);
                    await roomRef.child(`players/${userId}`).update({ choice: null });
                    await roomRef.child(`prebuffer/${userId}`).remove();

                    // Update Turn
                    await roomRef.child('turn').transaction(t => (t || 0) + 1);

                    // Update Flags from Preload if stored? 
                    // Preload doesn't store flags in DB, so we might miss updating last_scene_change/last_hp_change.
                    // Ideally Preload result should include flags and we update DB here.
                    if (preData._isSceneChange) await roomRef.child('last_scene_change').transaction(t => (t || 0) + 1); // Approximation or set to current turn?
                    // Actually, Preload is based on "Next Turn". So if we use it, we should update flags based on what Preload decided.
                    // For simplicity, let's assume Preload data includes flags.
                    const currentTurn = (await roomRef.child('turn').once('value')).val();
                    if (preData._isSceneChange) await roomRef.child('last_scene_change').set(currentTurn);
                    if (preData._isHpEvent) await roomRef.child('last_hp_change').set(currentTurn);

                    return res.status(200).json({ status: "NEW_TURN" });
                }

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

            await roomRef.child('current_scene').set(aiJson.views);
            await roomRef.child('history').push(`[事件] ${aiJson.global_summary}`);

            const updates = {};
            const updates2 = {};

            for (const pid of playerIds) {
                updates[`players/${pid}/choice`] = null;

                const view = aiJson.views[pid];
                if (view && typeof view.hp_change === 'number') {
                    const currentHp = players[pid].profile.public.hp || 100;
                    let newHp = currentHp + view.hp_change;
                    if (newHp < 0) newHp = 0;

                    updates2[`players/${pid}/profile/public/hp`] = newHp;

                    if (newHp <= 0) {
                        updates2[`players/${pid}/dead`] = true;
                        aiJson.views[pid].is_dead = true;
                        await roomRef.child(`current_scene/${pid}/is_dead`).set(true);
                    }
                }
            }

            await roomRef.update(updates);
            if (Object.keys(updates2).length > 0) await roomRef.update(updates2);

            const newTurn = (roomData.turn || 0) + 1;
            const updates3 = { turn: newTurn };

            if (aiJson._isSceneChange) updates3.last_scene_change = newTurn;
            if (aiJson._isHpEvent) updates3.last_hp_change = newTurn;

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

async function checkAndCleanRoom(db, roomId) {
    const roomRef = db.ref('rooms/' + roomId);
    const snap = await roomRef.once('value');
    if (!snap.exists()) return;

    const roomData = snap.val();
    const players = roomData.players || {};
    const playerIds = Object.keys(players);

    if (playerIds.length === 0) {
        await roomRef.remove();
        return;
    }

    let allLeft = true;
    for (const pid of playerIds) {
        const userLocSnap = await db.ref(`users/${pid}/current_room`).once('value');
        const currentRoom = userLocSnap.val();
        if (currentRoom === roomId) {
            allLeft = false;
            break;
        }
    }

    if (allLeft) {
        console.log(`Cleaning up empty room ${roomId}`);
        await roomRef.remove();
    }
}

async function runGameLogic(db, roomId, userId, simulatedChoice, isPreload) {
    const roomRef = db.ref('rooms/' + roomId);
    const snapshot = await roomRef.once('value');
    const roomData = snapshot.val();
    const players = roomData.players || {};
    const playerIds = Object.keys(players);

    const turn = roomData.turn || 0;
    const lastChange = roomData.last_scene_change || 0;
    const diff = turn - lastChange;

    let isSceneChange = false;
    if (diff < 3) isSceneChange = false;
    else if (diff >= 6) isSceneChange = true;
    else isSceneChange = (Math.random() < 0.3);

    const lastHpChange = roomData.last_hp_change || 0;
    const diffHp = turn - lastHpChange;

    let isHpEvent = false;
    if (diffHp < 3) isHpEvent = false;
    else if (diffHp >= 6) isHpEvent = true;
    else isHpEvent = (Math.random() < 0.3);

    const historySnap = await roomRef.child('history').once('value');
    let historyList = historySnap.val() || [];
    if (typeof historyList === 'object') historyList = Object.values(historyList);

    let playerContext = "";
    playerIds.forEach(pid => {
        const p = players[pid];
        const choice = (isPreload && pid === userId) ? simulatedChoice : (p.choice || "进入游戏");
        const pub = JSON.stringify(p.profile?.public || {});
        const priv = JSON.stringify(p.profile?.private || {});
        playerContext += `玩家ID(${pid}): ${p.profile?.name}[${p.profile?.role}]。\n状态:${pub}\n秘密:${priv}\n本轮行动:${choice}\n\n`;
    });

    const sysPrompt = GAME_MASTER_PROMPT
        .replace('{{HISTORY}}', historyList.slice(-3).join("\n"))
        .replace('{{IS_SCENE_CHANGE}}', isSceneChange.toString())
        .replace('{{IS_HP_EVENT}}', isHpEvent.toString())
        .replace('{{PLAYER_CONTEXT}}', playerContext)
        .replace(/{{PREV_CHOICE}}/g, simulatedChoice || "上轮行动");

    const result = await model.generateContent(sysPrompt);
    const txt = result.response.text();

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
        return {
            global_summary: "系统错误",
            views: { [userId]: { stage_2_event: "数据链路中断...", choices: [{ text: "重试" }, { text: "等待" }] } }
        };
    }

    if (aiJson) {
        aiJson._isSceneChange = isSceneChange;
        aiJson._isHpEvent = isHpEvent;
    }

    return aiJson;
}
