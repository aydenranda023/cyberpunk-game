import { GoogleGenerativeAI } from "@google/generative-ai";
import { getDb, ServerValue } from './lib/fire_admin.js';
import { getMultiViewPrompt, getStartPrompt } from './lib/prompt_bank.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

export default async function handler(req, res) {
    try {
        const db = getDb(); // 获取数据库连接
        const { action, roomId, userId, choiceText, userProfile } = req.body;

        // --- 1. 创建房间 ---
        if (action === 'CREATE_ROOM') {
            const newRoomId = Math.floor(1000 + Math.random() * 9000).toString();
            await db.ref('rooms/' + newRoomId).set({
                created_at: ServerValue.TIMESTAMP,
                status: 'SOLO', turn: 0, players: {},
                host_info: userProfile || { name: 'Unknown' }
            });
            return res.status(200).json({ roomId: newRoomId });
        }

        // --- 2. 加入房间 ---
        if (action === 'JOIN_ROOM') {
            const roomRef = db.ref('rooms/' + roomId);
            const snapshot = await roomRef.once('value');
            if (!snapshot.exists()) return res.status(404).json({ error: "房间不存在" });
            await roomRef.child('players/' + userId).update({ joined: true, choice: null, profile: userProfile });
            return res.status(200).json({ success: true });
        }

        // --- 3. 游戏逻辑 (Start & Move) ---
        if (action === 'START_GAME' || action === 'MAKE_MOVE') {
            const roomRef = db.ref('rooms/' + roomId);
            
            if (action === 'MAKE_MOVE') {
                await roomRef.child(`players/${userId}`).update({ choice: choiceText });
            }

            const snapshot = await roomRef.once('value');
            const roomData = snapshot.val();
            const players = roomData.players || {};
            const playerIds = Object.keys(players);

            // 检查投票
            if (action === 'MAKE_MOVE') {
                const allReady = playerIds.every(pid => players[pid].choice);
                if (!allReady) return res.status(200).json({ status: "WAITING" });
            }

            // 准备上下文
            let prompt = "";
            if (action === 'START_GAME') {
                // 单人开场逻辑
                const p = await roomRef.child(`players/${userId}/profile`).once('value');
                prompt = getStartPrompt(p.val()?.role, p.val()?.name);
            } else {
                // 多人/单人回合逻辑
                const historySnap = await roomRef.child('history').once('value');
                let historyList = historySnap.val() || [];
                if (typeof historyList === 'object') historyList = Object.values(historyList);
                
                let playerContext = "";
                playerIds.forEach(pid => {
                    const p = players[pid];
                    const pub = JSON.stringify(p.profile?.public || {});
                    const priv = JSON.stringify(p.profile?.private || {});
                    playerContext += `ID(${pid}): ${p.profile?.name}[${p.profile?.role}]\nState:${pub}\nSecret:${priv}\nAction:${p.choice}\n\n`;
                });
                
                prompt = getMultiViewPrompt(historyList.slice(-3).join("\n"), playerContext);
            }

            // 调用 AI
            const result = await model.generateContent(prompt);
            const txt = result.response.text().replace(/```json|```/g, "").trim();
            const aiJson = JSON.parse(txt);

            // 写入结果
            // 兼容处理：如果 AI 返回的是 views 结构（我们期望的），直接存；如果是老结构，包一层
            const sceneData = aiJson.views ? aiJson.views : { [userId]: aiJson };
            
            await roomRef.child('current_scene').set(sceneData);
            
            if (aiJson.global_summary) {
                await roomRef.child('history').push(`[Event] ${aiJson.global_summary}`);
            } else if (aiJson.stage_2_event) {
                await roomRef.child('history').push(`[Event] ${aiJson.stage_2_event}`); // 兼容旧格式
            }
            
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
