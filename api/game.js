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
        if (action === 'CREATE_ROOM') {
            const newRoomId = Math.floor(1000 + Math.random() * 9000).toString();
            await db.ref('rooms/' + newRoomId).set({
                created_at: admin.database.ServerValue.TIMESTAMP,
                status: 'SOLO', turn: 0, players: {},
                host_info: userProfile || { name: '未知', role: 'Ghost' }
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

        if (action === 'START_GAME' || action === 'MAKE_MOVE') {
            const roomRef = db.ref('rooms/' + roomId);
            
            if (action === 'MAKE_MOVE') await roomRef.child(`players/${userId}`).update({ choice: choiceText });

            const snapshot = await roomRef.once('value');
            const roomData = snapshot.val();
            const players = roomData.players || {};
            const playerIds = Object.keys(players);

            if (action === 'MAKE_MOVE') {
                const allReady = playerIds.every(pid => players[pid].choice);
                if (!allReady) return res.status(200).json({ status: "WAITING" });
            }

            const historySnap = await roomRef.child('history').once('value');
            let historyList = historySnap.val() || [];
            if (typeof historyList === 'object') historyList = Object.values(historyList);
            
            let playerContext = "";
            playerIds.forEach((pid, idx) => {
                const p = players[pid];
                playerContext += `Index_${idx}: ${p.profile?.name}(${p.profile?.role}) Action:${p.choice || "Start"}\n`;
            });

            // --- Prompt 简化与强化 ---
            const sysPrompt = `
            ROLE: Cyberpunk GM. LANG: Chinese (Simplified).
            
            INPUT:
            [History]: ${historyList.slice(-3).join("\n")}
            [Players]: ${playerContext}

            OUTPUT JSON FORMAT (Strict Array):
            {
                "global_summary": "summary string",
                "views_array": [
                    {
                        "image_keyword": "english_noun",
                        "txt_1": "Environment Description (100 words)",
                        "txt_2": "Event Description (80 words)",
                        "txt_3": "Analysis (50 words)",
                        "choices": [{"text":"A"},{"text":"B"}]
                    }
                ]
            }
            IMPORTANT: "views_array" must have an object for EACH player index.
            `;

            const result = await model.generateContent(sysPrompt);
            const txt = result.response.text().replace(/```json|```/g, "").trim();
            const aiJson = JSON.parse(txt);

            // --- ★★★ 数据清洗与映射 (The Sanitizer) ★★★ ---
            const finalSceneData = {};
            const rawViews = aiJson.views_array || aiJson.views || [];
            const viewList = Array.isArray(rawViews) ? rawViews : Object.values(rawViews);

            playerIds.forEach((realPid, index) => {
                // 获取原始数据
                let rawView = viewList[index] || viewList[0] || {};
                
                // 强制标准化键名 (防止 AI 瞎写 Key)
                // 无论 AI 返回 stage_1_env, txt_1, 还是 environment，都映射到标准 Key
                const cleanView = {
                    image_keyword: rawView.image_keyword || rawView.keyword || "cyberpunk",
                    // 尝试所有可能的键名
                    stage_1_env: rawView.txt_1 || rawView.stage_1_env || rawView.env || "数据流干扰...无法解析环境数据。",
                    stage_2_event: rawView.txt_2 || rawView.stage_2_event || rawView.event || "...",
                    stage_3_analysis: rawView.txt_3 || rawView.stage_3_analysis || rawView.analysis || "...",
                    choices: rawView.choices || [{"text":"继续"},{"text":"观察"}]
                };

                finalSceneData[realPid] = cleanView;
            });
            // -------------------------------------------------

            await roomRef.child('current_scene').set(finalSceneData);
            await roomRef.child('history').push(`[Event] ${aiJson.global_summary || "未知事件"}`);
            
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
