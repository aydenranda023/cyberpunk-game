import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from 'firebase-admin';

// 1. Firebase 初始化 (防崩溃单例模式)
if (!admin.apps.length) {
    try {
        const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
        const dbUrl = process.env.FIREBASE_DB_URL;
        if (serviceAccountStr && dbUrl) {
            let serviceAccount = JSON.parse(serviceAccountStr);
            // 修复私钥换行符
            if (serviceAccount.private_key) {
                serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
            }
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: dbUrl
            });
        }
    } catch (e) { console.error("Firebase Init Error:", e); }
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

export default async function handler(req, res) {
    if (!admin.apps.length) return res.status(500).json({ error: "Database Disconnected" });
    
    const db = admin.database();
    const { action, roomId, userId, choiceText, userProfile } = req.body;

    try {
        // --- 房间管理 ---
        if (action === 'CREATE_ROOM') {
            const newRoomId = Math.floor(1000 + Math.random() * 9000).toString();
            await db.ref('rooms/' + newRoomId).set({
                created_at: admin.database.ServerValue.TIMESTAMP,
                status: 'SOLO', players: {},
                host_info: userProfile || { name: 'Unknown' }
            });
            return res.status(200).json({ roomId: newRoomId });
        }

        if (action === 'JOIN_ROOM') {
            const roomRef = db.ref('rooms/' + roomId);
            const snapshot = await roomRef.once('value');
            if (!snapshot.exists()) return res.status(404).json({ error: "房间不存在" });
            await roomRef.child('players/' + userId).update({ joined: true, choice: null, profile: userProfile });
            return res.status(200).json({ success: true });
        }

        // --- 剧情生成 (START & MOVE) ---
        if (action === 'START_GAME' || action === 'MAKE_MOVE') {
            const roomRef = db.ref('rooms/' + roomId);
            
            if (action === 'MAKE_MOVE') await roomRef.child(`players/${userId}`).update({ choice: choiceText });

            const snapshot = await roomRef.once('value');
            const roomData = snapshot.val();
            const players = roomData.players || {};
            const playerIds = Object.keys(players);

            // 投票检查
            if (action === 'MAKE_MOVE') {
                const allReady = playerIds.every(pid => players[pid].choice);
                if (!allReady) return res.status(200).json({ status: "WAITING" });
            }

            // 构建 Prompt
            const historySnap = await roomRef.child('history').once('value');
            let historyList = historySnap.val() || [];
            if (typeof historyList === 'object') historyList = Object.values(historyList);
            
            let playerContext = "";
            playerIds.forEach((pid, idx) => {
                const p = players[pid];
                playerContext += `P${idx} [${p.profile?.role}]: Action=${p.choice||"Start"}\n`;
            });

            const sysPrompt = `
            ROLE: Cyberpunk GM. LANG: Chinese Simplified.
            INPUT: [History]: ${historyList.slice(-3).join("\n")} [Players]: ${playerContext}
            
            OUTPUT JSON FORMAT (Strict):
            {
                "global_summary": "Summary of event",
                "views_array": [
                    {
                        "image_keyword": "noun",
                        "stage_1_env": "环境描写(100字)",
                        "stage_2_event": "事件(80字)",
                        "stage_3_analysis": "分析(50字)",
                        "choices": [{"text":"A"},{"text":"B"}]
                    }
                ]
            }
            IMPORTANT: Provide one view object for EACH player in the input list.
            `;

            const result = await model.generateContent(sysPrompt);
            const txt = result.response.text().replace(/```json|```/g, "").trim();
            const aiJson = JSON.parse(txt);

            // --- ★★★ 数据清洗 (The Cleaner) ★★★ ---
            const finalSceneData = {};
            const rawViews = aiJson.views_array || aiJson.views || [];
            const viewList = Array.isArray(rawViews) ? rawViews : Object.values(rawViews);

            playerIds.forEach((realPid, index) => {
                // 容错：如果 AI 生成的数组不够长，复用第一个
                let v = viewList[index] || viewList[0] || {};
                
                finalSceneData[realPid] = {
                    image_keyword: v.image_keyword || "cyberpunk",
                    // 强力映射：尝试所有可能的键名
                    stage_1_env: v.stage_1_env || v.txt_1 || v.env || "数据连接中...",
                    stage_2_event: v.stage_2_event || v.txt_2 || v.event || "...",
                    stage_3_analysis: v.stage_3_analysis || v.txt_3 || v.analysis || "...",
                    choices: v.choices || [{"text":"继续"},{"text":"观察"}]
                };
            });

            await roomRef.child('current_scene').set(finalSceneData);
            await roomRef.child('history').push(`[Event] ${aiJson.global_summary || "..."}`);
            
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
