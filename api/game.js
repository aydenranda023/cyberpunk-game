import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from 'firebase-admin';

if (!admin.apps.length) {
    try {
        是单人，也要返回 views: { "P0": {...} }。
            
            【输入信息】
            [历史]: ${historyList.slice(-3).join("\n")}
            [玩家]:
            ${playerContext}

const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
        const dbUrl = process.env.FIREBASE_DB_URL;
        if (serviceAccountStr && dbUrl) {
            let serviceAccount = JSON.parse(serviceAccountStr);
            if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
            admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: dbUrl });
        }            【输出要求 JSON】
            {
                "global_summary": "一句话概括(中文)",
                "views": {
                    "P0": {
                        "image_keyword": "english noun",
                        "stage_1_env": "环境(中文 100字)",
                        "stage_2_event": "事件(中文 80字)",
                        "stage_3_analysis": "分析(中文 50字)",
                        "choices": [{"text":"A中文"},{"text":"B中文"}]
                    },
                    "P1": { ... }
                }
            }
            `;

            const result = await model.generateContent(sysPrompt);
            const txt = result.response.text().replace(/```json|```/g
    } catch (e) { console.error("Firebase Init Error", e); }
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

export default async function handler(req, res) {
    if (!admin.apps.length) return res.status, "").trim();
            const aiJson = JSON.parse(txt);

            // ★★★ 关键修复：键名映射 (Remap Keys) ★★★
            // AI 返回的是 P0, P1... 我们要把它们映射回真实的 userId
            const remappedViews = {};
            
            // 如果 AI 偶尔没按 P0 返回，而是(500).json({ error: "DB Connect Fail" });
    const db = admin.database();
    const { action, roomId, userId, choiceText, userProfile } = req.body;

    try {
        if (action === 'CREATE_ROOM') {
            const newRoomId = Math.floor(1000 + Math.random() * 9000).toString();
            await db.ref('rooms/' + newRoomId).set({
                created_at: admin.database.ServerValue.TIMESTAMP直接返回了 views: { ... }，做个容错
            const viewKeys = Object.keys(ai,
                status: 'SOLO', turn: 0, players: {},
                host_info: userJson.views);
            
            playerIds.forEach((realPid, index) => {
                // 尝试找Profile || { name: '未知', role: 'Ghost' }
            });
            return res.status(200).json({ roomId: newRoomId });
        }

        if (action === 'JOIN_ROOM') {
            const roomRef = db.ref('rooms/' + roomId);
            const snapshot = await P0, P1，如果找不到，就按顺序硬塞
                const aiKey = `P${index}`;
                const view roomRef.once('value');
            if (!snapshot.exists()) return res.status(404).json({ error: "房间不存在" });
            await roomRef.child('players/' + userId).update({ joined: true, choice: null, profile: userProfile });
            return res.status(200).json({ success: true });
        }

        if (action === 'START_GAME' || action === 'MAKE_MOVE') {
Data = aiJson.views[aiKey] || aiJson.views[viewKeys[index]];
                
                if (viewData) {
                    remappedViews[realPid] = viewData;
                } else {
                    // 极端保底：复制第一份数据，防止白屏
                    remappedViews[realPid] = aiJson.views[viewKeys[0]];
                }
            });

            // 写入数据库
            await roomRef.child('current_scene').set(remappedViews);
            await roomRef.child('history').push(`[事件] ${aiJson            const roomRef = db.ref('rooms/' + roomId);
            
            if (action === 'MAKE_MOVE') {
                await roomRef.child(`players/${userId}`).update({ choice: choiceText });
            }

            const snapshot = await roomRef.once('value');
            const roomData = snapshot.val();
            const players = roomData.players || {};
            const playerIds = Object.keys(players); // 真实的 UID 列表

            if (action.global_summary}`);
            
            const updates = {};
            playerIds.forEach(pid => updates[ === 'MAKE_MOVE') {
                const allReady = playerIds.every(pid => players[pid].`players/${pid}/choice`] = null);
            await roomRef.update(updates);
            
            ifchoice);
                if (!allReady) return res.status(200).json({ status: "WAIT (action === 'START_GAME') await roomRef.update({ status: 'PLAYING' });

            return res.status(200).json({ status: "NEW_TURN" });
        }

        returnING" });
            }

            // --- 映射逻辑构建 ---
            const historySnap = await roomRef.child('history').once('value');
            let historyList = historySnap.val() || [];
            if (typeof historyList === 'object') historyList = Object.values(historyList);
            
            let playerContext = "";
            // 使用索引 0, 1, 2 来代替复杂的 UID 发给 AI
            playerIds.forEach res.status(400).json({ error: "Unknown Action" });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
}
