import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from 'firebase-admin';

// --- 初始化 (防炸逻辑) ---
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
    // 注意：这里解构出了 userProfile
    const { action, roomId, userId, choiceText, userProfile } = req.body;

    try {
        // --- 1. 创建房间 (带房主档案) ---
        if (action === 'CREATE_ROOM') {
            const newRoomId = Math.floor(1000 + Math.random() * 9000).toString();
            
            await db.ref('rooms/' + newRoomId).set({
                created_at: admin.database.ServerValue.TIMESTAMP,
                status: 'SOLO', 
                turn: 0,
                players: {},
                // 关键：把房主信息存这就行，稍后 JOIN 会存更详细的
                host_info: userProfile || { name: 'Unknown', role: 'Ghost' }
            });
            
            return res.status(200).json({ roomId: newRoomId });
        }

        // --- 2. 加入房间 (带玩家档案) ---
        if (action === 'JOIN_ROOM') {
            const roomRef = db.ref('rooms/' + roomId);
            const snapshot = await roomRef.once('value');
            if (!snapshot.exists()) return res.status(404).json({ error: "房间不存在" });
            
            // 关键：把前端发来的 userProfile 存入数据库
            await roomRef.child('players/' + userId).update({
                joined: true,
                status: 'READY',
                choice: null,
                profile: userProfile // <--- 这里存入了你的黑匣子数据
            });
            
            return res.status(200).json({ success: true });
        }

        // --- 3. 开始游戏 (第一章) ---
        if (action === 'START_GAME') {
            const roomRef = db.ref('rooms/' + roomId);
            
            // 读取房主职业，定制开场
            const pSnap = await roomRef.child(`players/${userId}/profile`).once('value');
            const role = pSnap.val()?.role || "流浪者";
            const name = pSnap.val()?.name || "V";

            const prompt = `GAME START. Player is a ${role} named ${name}. Generate the first scene.`;
            const aiJson = await generateStory(prompt);

            await roomRef.child('current_scene').set(aiJson);
            await roomRef.update({ status: 'PLAYING' });
            await roomRef.child('history').set([`[开场] ${aiJson.stage_1_env}`]);

            return res.status(200).json({ status: "STARTED" });
        }

        // --- 4. 玩家行动 (带身份叙事) ---
        if (action === 'MAKE_MOVE') {
            const roomRef = db.ref('rooms/' + roomId);
            await roomRef.child(`players/${userId}`).update({ choice: choiceText });
            
            const snapshot = await roomRef.once('value');
            const roomData = snapshot.val();
            const players = roomData.players || {};
            const playerIds = Object.keys(players);
            
            const allReady = playerIds.every(pid => players[pid].choice);

            if (!allReady) return res.status(200).json({ status: "WAITING" });

            // 收集动作 + 身份信息
            let summary = "";
            playerIds.forEach(pid => {
                const p = players[pid];
                // AI 会看到：[黑客 Neo] 选择了: 攻击
                summary += `[${p.profile?.role || 'Unknown'} ${p.profile?.name || 'Player'}] 选择了: ${p.choice}; `;
            });

            const historySnap = await roomRef.child('history').once('value');
            const historyList = historySnap.val() || [];
            // 兼容性处理：把对象转数组
            let cleanHistory = Array.isArray(historyList) ? historyList : Object.values(historyList);

            const prompt = `[History]: ${cleanHistory.slice(-3).join("\n")}\n[Actions]: ${summary}\nContinue story.`;
            const aiJson = await generateStory(prompt);

            await roomRef.child('current_scene').set(aiJson);
            await roomRef.child('history').push(`[事件] ${aiJson.stage_2_event}`);
            
            const updates = {};
            playerIds.forEach(pid => updates[`players/${pid}/choice`] = null);
            await roomRef.update(updates);

            return res.status(200).json({ status: "NEW_TURN" });
        }

        return res.status(400).json({ error: "Unknown Action" });

    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({ error: error.message });
    }
}

async function generateStory(prompt) {
    const sysPrompt = `
    ROLE: Cyberpunk Game Master. LANG: Chinese (Simplified). 
    FORMAT: JSON ONLY.
    Structure: { "image_keyword": "noun", "stage_1_env": "100 words", "stage_2_event": "80 words", "stage_3_analysis": "50 words", "choices": [{"text":"A"},{"text":"B"}] }
    `;
    try {
        const result = await model.generateContent(sysPrompt + "\n" + prompt);
        const txt = result.response.text().replace(/```json|```/g, "").trim();
        return JSON.parse(txt);
    } catch (e) { throw new Error("AI生成失败: " + e.message); }
}
