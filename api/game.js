import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from 'firebase-admin';

// --- 初始化 (保持不变) ---
if (!admin.apps.length) {
    try {
        const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
        const dbUrl = process.env.FIREBASE_DB_URL;
        if (serviceAccountStr && dbUrl) {
            let serviceAccount = JSON.parse(serviceAccountStr);
            if (serviceAccount.private_key) {
                serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
            }
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: dbUrl
            });
        }
    } catch (e) { console.error("Firebase Init Error", e); }
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

export default async function handler(req, res) {
    if (!admin.apps.length) return res.status(500).json({ error: "Database Connection Failed" });
    
    const db = admin.database();
    const { action, roomId, userId, choiceText } = req.body;

    try {
        // 1. 创建房间
        if (action === 'CREATE_ROOM') {
            const newRoomId = Math.floor(1000 + Math.random() * 9000).toString();
            await db.ref('rooms/' + newRoomId).set({
                created_at: admin.database.ServerValue.TIMESTAMP,
                status: 'WAITING',
                players: {}
            });
            return res.status(200).json({ roomId: newRoomId });
        }

        // 2. 加入房间
        if (action === 'JOIN_ROOM') {
            const roomRef = db.ref('rooms/' + roomId);
            const snapshot = await roomRef.once('value');
            if (!snapshot.exists()) return res.status(404).json({ error: "Room not found" });
            await roomRef.child('players/' + userId).update({ joined: true, choice: null });
            return res.status(200).json({ success: true });
        }

        // 3. ★★★ 新增：强制开始游戏 (特权通道) ★★★
        if (action === 'START_GAME') {
            const roomRef = db.ref('rooms/' + roomId);
            
            // 直接调用 AI 生成第一章，不检查投票
            const prompt = "GAME START. Generate the first scene of a cyberpunk story.";
            const aiJson = await generateStory(prompt);

            // 写入数据库
            await roomRef.child('current_scene').set(aiJson);
            await roomRef.update({ status: 'PLAYING' });
            
            // 记录历史
            await roomRef.child('history').set([`[开场] ${aiJson.stage_1_env}`]);

            return res.status(200).json({ status: "STARTED" });
        }

        // 4. 玩家常规行动 (投票检查)
        if (action === 'MAKE_MOVE') {
            const roomRef = db.ref('rooms/' + roomId);
            await roomRef.child(`players/${userId}`).update({ choice: choiceText });
            
            const snapshot = await roomRef.once('value');
            const players = snapshot.val().players || {};
            const allReady = Object.values(players).every(p => p.choice);

            if (!allReady) return res.status(200).json({ status: "WAITING" });

            // 所有人就位，生成下一章
            const historySnap = await roomRef.child('history').once('value');
            const historyList = historySnap.val() || [];
            
            // 汇总动作
            let summary = "";
            Object.keys(players).forEach(pid => {
                summary += `Player(${pid.slice(0,4)}) chose: ${players[pid].choice}; `;
            });

            const prompt = `[History]: ${historyList.slice(-3).join("\n")}\n[Actions]: ${summary}\nContinue story.`;
            const aiJson = await generateStory(prompt);

            await roomRef.child('current_scene').set(aiJson);
            await roomRef.child('history').push(`[事件] ${aiJson.stage_2_event}`);
            
            // 清空投票
            const updates = {};
            Object.keys(players).forEach(pid => updates[`players/${pid}/choice`] = null);
            await roomRef.update(updates);

            return res.status(200).json({ status: "NEW_TURN" });
        }

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
}

// 辅助函数：调用 AI
async function generateStory(prompt) {
    const sysPrompt = `
    ROLE: Cyberpunk Game Master. 
    LANG: Chinese (Simplified). 
    FORMAT: JSON ONLY.
    Structure: { "image_keyword": "noun", "stage_1_env": "100 words", "stage_2_event": "80 words", "stage_3_analysis": "50 words", "choices": [{"text":"A"},{"text":"B"}] }
    `;
    
    const result = await model.generateContent(sysPrompt + "\n" + prompt);
    const txt = result.response.text().replace(/```json|```/g, "").trim();
    return JSON.parse(txt);
}
