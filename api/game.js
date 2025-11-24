import { GoogleGenerativeAI } from "@google/generative-ai";
import { getDb, ServerValue } from './lib/fire_admin.js';
import { getSystemPrompt } from './lib/prompt_bank.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

export default async function handler(req, res) {
    try {
        const db = getDb(); 
        const { action, roomId, userId, choiceText, userProfile } = req.body;

        // --- 1. CREATE ---
        if (action === 'CREATE_ROOM') {
            const newRoomId = Math.floor(1000 + Math.random() * 9000).toString();
            await db.ref('rooms/' + newRoomId).set({
                created_at: ServerValue.TIMESTAMP,
                status: 'SOLO', turn: 0, players: {},
                host_info: userProfile || { name: 'Unknown' }
            });
            return res.status(200).json({ roomId: newRoomId });
        }

        // --- 2. JOIN ---
        if (action === 'JOIN_ROOM') {
            const roomRef = db.ref('rooms/' + roomId);
            const snapshot = await roomRef.once('value');
            if (!snapshot.exists()) return res.status(404).json({ error: "房间不存在" });
            await roomRef.child('players/' + userId).update({ joined: true, choice: null, profile: userProfile });
            return res.status(200).json({ success: true });
        }

        // --- 3. GENERATE (START & MOVE) ---
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

            // Prepare Context
            const historySnap = await roomRef.child('history').once('value');
            let historyList = historySnap.val() || [];
            if (typeof historyList === 'object') historyList = Object.values(historyList);
            
            let playerContext = "";
            playerIds.forEach(pid => {
                const p = players[pid];
                // 关键：把真实的 PID 传给 AI，要求 AI 返回时用这个做 Key
                playerContext += `ID: "${pid}" (Name:${p.profile?.name}, Role:${p.profile?.role}, Action:${p.choice || "Start"})\n`;
            });

            // Call AI
            const prompt = getSystemPrompt(historyList.slice(-3).join("\n"), playerContext);
            const result = await model.generateContent(prompt);
            const txt = result.response.text().replace(/```json|```/g, "").trim();
            const aiJson = JSON.parse(txt);

            // --- ★★★ 数据清洗与重映射 (The Cleaner) ★★★ ---
            // 这是为了防止 AI 返回错误的 Key 导致前端无文字
            const finalSceneData = {};
            const views = aiJson.views || {};
            
            // 我们遍历真实的玩家列表，为每个人找数据
            playerIds.forEach((realPid) => {
                // 1. 尝试直接获取
                let view = views[realPid];
                
                // 2. 如果找不到，尝试拿第一个 view 当作保底 (防止白屏)
                if (!view) view = Object.values(views)[0];
                
                // 3. 数据标准化 (防止 AI 用 txt_1 代替 stage_1_env)
                if (view) {
                    finalSceneData[realPid] = {
                        image_keyword: view.image_keyword || "cyberpunk",
                        stage_1_env: view.stage_1_env || view.env || "环境数据连接中...",
                        stage_2_event: view.stage_2_event || view.event || "...",
                        stage_3_analysis: view.stage_3_analysis || view.analysis || "...",
                        choices: view.choices || [{"text":"继续"},{"text":"观察"}]
                    };
                }
            });
            // --------------------------------------------------

            await roomRef.child('current_scene').set(finalSceneData);
            await roomRef.child('history').push(`[Event] ${aiJson.global_summary || "未知"}`);
            
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
