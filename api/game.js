import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from 'firebase-admin';

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
    const { action, roomId, userId, choiceText, userProfile } = req.body;

    try {
        // 1. 创建房间
        if (action === 'CREATE_ROOM') {
            const newRoomId = Math.floor(1000 + Math.random() * 9000).toString();
            await db.ref('rooms/' + newRoomId).set({
                created_at: admin.database.ServerValue.TIMESTAMP,
                status: 'SOLO', turn: 0, players: {},
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

        // 3. 生成剧情 (START 或 MAKE_MOVE)
        if (action === 'START_GAME' || action === 'MAKE_MOVE') {
            const roomRef = db.ref('rooms/' + roomId);
            
            if (action === 'MAKE_MOVE') {
                await roomRef.child(`players/${userId}`).update({ choice: choiceText });
            }

            const snapshot = await roomRef.once('value');
            const roomData = snapshot.val();
            const players = roomData.players || {};
            const playerIds = Object.keys(players);

            // 检查投票 (START_GAME 特权除外)
            if (action === 'MAKE_MOVE') {
                const allReady = playerIds.every(pid => players[pid].choice);
                if (!allReady) return res.status(200).json({ status: "WAITING" });
            }

            // --- 准备 Prompt 数据 ---
            const historySnap = await roomRef.child('history').once('value');
            let historyList = historySnap.val() || [];
            if (typeof historyList === 'object') historyList = Object.values(historyList);
            
            let context = "";
            playerIds.forEach(pid => {
                const p = players[pid];
                const choice = p.choice || "进入游戏";
                // 把玩家的表/里设定传给 AI
                const publicInfo = JSON.stringify(p.profile?.public || {});
                const privateInfo = JSON.stringify(p.profile?.private || {});
                context += `玩家ID(${pid}): 角色[${p.profile?.name}], 职业[${p.profile?.role}]。\n【公开状态】:${publicInfo}\n【秘密状态】:${privateInfo}\n【本轮行动】:${choice}\n\n`;
            });

            const sysPrompt = `
            你是一个赛博朋克文字游戏的主持人 (Game Master)。
            
            【绝对规则】
            1. **必须使用中文 (简体) 输出**。严禁使用英文描述剧情。
            2. 这是一个多视角游戏。你需要为每个玩家分别生成一段属于他视角的剧情（第二人称“你”）。
            3. 剧情要黑暗、紧张、高科技低生活。
            
            【输入信息】
            [历史剧情]: ${historyList.slice(-3).join("\n")}
            [当前玩家状态与行动]:
            ${context}

            【输出要求 JSON】
            请返回一个 JSON 对象，不要包含 Markdown 标记。
            结构如下：
            {
                "global_summary": "一句话概括发生了什么（存入历史）",
                "views": {
                    "玩家ID_1": {
                        "image_keyword": "提取一个具体的英文名词(noun)用于生成图片",
                        "stage_1_env": "环境描写(中文, 80字)",
                        "stage_2_event": "突发事件/遭遇(中文, 80字)",
                        "stage_3_analysis": "危机分析/心理活动(中文, 50字)",
                        "choices": [{"text":"选项A(中文)"},{"text":"选项B(中文)"}]
                    },
                    "玩家ID_2": { ...同上... }
                }
            }
            `;

            const result = await model.generateContent(sysPrompt);
            const txt = result.response.text().replace(/```json|```/g, "").trim();
            const aiJson = JSON.parse(txt);

            await roomRef.child('current_scene').set(aiJson.views);
            await roomRef.child('history').push(`[事件] ${aiJson.global_summary}`);
            
            const updates = {};
            playerIds.forEach(pid => updates[`players/${pid}/choice`] = null);
            await roomRef.update(updates);
            
            if (action === 'START_GAME') await roomRef.update({ status: 'PLAYING' });

            return res.status(200).json({ status: "NEW_TURN" });
        }

        return res.status(400).json({ error: "Unknown Action" });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
}
