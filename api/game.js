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
        // 创建 & 加入 (保持不变)
        if (action === 'CREATE_ROOM') {
            const newRoomId = Math.floor(1000 + Math.random() * 9000).toString();
            await db.ref('rooms/' + newRoomId).set({
                created_at: admin.database.ServerValue.TIMESTAMP,
                status: 'SOLO', turn: 0, players: {},
                host_info: userProfile || { name: 'Unknown', role: 'Ghost' }
            });
            return res.status(200).json({ roomId: newRoomId });
        }

        if (action === 'JOIN_ROOM') {
            const roomRef = db.ref('rooms/' + roomId);
            const snapshot = await roomRef.once('value');
            if (!snapshot.exists()) return res.status(404).json({ error: "Room not found" });
            await roomRef.child('players/' + userId).update({ joined: true, choice: null, profile: userProfile });
            return res.status(200).json({ success: true });
        }

        // --- 核心修改：生成逻辑 ---
        if (action === 'START_GAME' || action === 'MAKE_MOVE') {
            const roomRef = db.ref('rooms/' + roomId);
            
            // 如果是玩家行动，先记录
            if (action === 'MAKE_MOVE') {
                await roomRef.child(`players/${userId}`).update({ choice: choiceText });
            }

            // 获取房间所有数据
            const snapshot = await roomRef.once('value');
            const roomData = snapshot.val();
            const players = roomData.players || {};
            const playerIds = Object.keys(players);

            // 检查投票 (START_GAME 特权除外)
            if (action === 'MAKE_MOVE') {
                const allReady = playerIds.every(pid => players[pid].choice);
                if (!allReady) return res.status(200).json({ status: "WAITING" });
            }

            // --- 构建“罗生门” Prompt ---
            const historySnap = await roomRef.child('history').once('value');
            let historyList = historySnap.val() || [];
            if (typeof historyList === 'object') historyList = Object.values(historyList);
            const historyText = historyList.slice(-3).join("\n");

            // 描述每个玩家及其行动
            let playerContext = "";
            playerIds.forEach(pid => {
                const p = players[pid];
                const choice = p.choice || "GAME_START";
                playerContext += `Player ID "${pid}": Role=${p.profile.role}, Name=${p.profile.name}, Action=${choice}.\n`;
            });

            const prompt = `
            [History]: ${historyText}
            [Players & Actions]:
            ${playerContext}

            GENERATE NEXT SCENE.
            
            【CRITICAL REQUIREMENT】: You must generate a SEPARATE JSON object for EACH player ID listed above.
            Each player sees the story from their own 2nd person perspective ("You...").
            Their choices must be relevant to their own role and situation.

            OUTPUT JSON FORMAT:
            {
                "global_event_summary": "One sentence summary of what happened (for history)",
                "views": {
                    "PLAYER_ID_GOES_HERE": {
                        "image_keyword": "noun",
                        "stage_1_env": "...",
                        "stage_2_event": "...",
                        "stage_3_analysis": "...",
                        "choices": [{"text":"A"},{"text":"B"}]
                    },
                    "ANOTHER_PLAYER_ID": { ... }
                }
            }
            `;

            const aiRes = await model.generateContent(prompt);
            const txt = aiRes.response.text().replace(/```json|```/g, "").trim();
            const aiJson = JSON.parse(txt);

            // 写入数据库
            // 注意：现在 current_scene 是一个包含多个 uid key 的对象
            await roomRef.child('current_scene').set(aiJson.views);
            
            // 记录历史 (用 AI 生成的全局总结)
            await roomRef.child('history').push(`[Event] ${aiJson.global_event_summary}`);
            
            // 清空投票
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
