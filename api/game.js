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
                status: 'SOLO', turn: 0, players: {},
                host_info: userProfile || { name: '未知', role: 'Ghost' }
            });
            return res.status(200).json({ roomId: newRoomId });
        }

        // 2. 加入房间 (带身份)
        if (action === 'JOIN_ROOM') {
            const roomRef = db.ref('rooms/' + roomId);
            const snapshot = await roomRef.once('value');
            if (!snapshot.exists()) return res.status(404).json({ error: "房间不存在" });
            await roomRef.child('players/' + userId).update({ joined: true, choice: null, profile: userProfile });
            return res.status(200).json({ success: true });
        }

        // 3. 生成剧情 (核心逻辑)
        if (action === 'START_GAME' || action === 'MAKE_MOVE') {
            const roomRef = db.ref('rooms/' + roomId);

            // 记录选择
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

            // --- 准备 Prompt ---
            const historySnap = await roomRef.child('history').once('value');
            let historyList = historySnap.val() || [];
            if (typeof historyList === 'object') historyList = Object.values(historyList);

            let playerContext = "";
            playerIds.forEach(pid => {
                const p = players[pid];
                const choice = p.choice || "进入游戏";
                const pub = JSON.stringify(p.profile?.public || {});
                const priv = JSON.stringify(p.profile?.private || {});
                playerContext += `玩家ID(${pid}): ${p.profile?.name}[${p.profile?.role}]。\n状态:${pub}\n秘密:${priv}\n本轮行动:${choice}\n\n`;
            });

            // Replace placeholders in the prompt template
            const sysPrompt = GAME_MASTER_PROMPT
                .replace('{{HISTORY}}', historyList.slice(-3).join("\n"))
                .replace('{{PLAYER_CONTEXT}}', playerContext);

            const result = await model.generateContent(sysPrompt);
            const txt = result.response.text();

            console.log("AI Raw Output:", txt); // For debugging logs

            // Robust JSON parsing
            let aiJson;
            try {
                // Attempt to find the first '{' and last '}' to extract JSON
                const jsonMatch = txt.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    aiJson = JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error("No JSON found in response");
                }
            } catch (e) {
                console.error("JSON Parse Error:", e);
                console.error("Original Text:", txt);
                // Fallback or error response
                return res.status(500).json({ error: "AI Response Error", details: txt });
            }

            // 写入数据库：views 包含所有人的独立剧本
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

