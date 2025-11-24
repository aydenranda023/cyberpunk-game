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
    
    // 注意：增加了 userProfile 参数
    const { action, roomId, userId, choiceText, userProfile } = req.body;

    try {
        // --- 1. 创建房间 (改为单人模式启动) ---
        if (action === 'CREATE_ROOM') {
            const newRoomId = Math.floor(1000 + Math.random() * 9000).toString();
            
            await db.ref('rooms/' + newRoomId).set({
                created_at: admin.database.ServerValue.TIMESTAMP,
                status: 'SOLO', // 默认为单人模式，等待别人加入
                turn: 0,
                players: {}, // 稍后通过 JOIN 填入
                host_info: userProfile // 把房主信息存在这里，供大厅列表展示
            });
            
            return res.status(200).json({ roomId: newRoomId });
        }

        // --- 2. 加入房间 (带上身份) ---
        if (action === 'JOIN_ROOM') {
            const roomRef = db.ref('rooms/' + roomId);
            const snapshot = await roomRef.once('value');
            if (!snapshot.exists()) return res.status(404).json({ error: "位面信号已消失" });
            
            // 将玩家档案写入房间的 players 列表
            await roomRef.child('players/' + userId).update({
                joined: true,
                choice: null,
                profile: userProfile // 记录身份
            });
            
            return res.status(200).json({ success: true });
        }

        // --- 3. 开始游戏 (单人开场) ---
        if (action === 'START_GAME') {
            const roomRef = db.ref('rooms/' + roomId);
            // 获取玩家职业，影响开场
            const pSnap = await roomRef.child(`players/${userId}/profile`).once('value');
            const role = pSnap.val()?.role || "流浪者";

            const prompt = `GAME START. Player is a ${role}. Generate the first scene.`;
            const aiJson = await generateStory(prompt);

            await roomRef.child('current_scene').set(aiJson);
            await roomRef.update({ status: 'PLAYING' }); // 标记为正在玩
            await roomRef.child('history').set([`[开场] ${aiJson.stage_1_env}`]);

            return res.status(200).json({ status: "STARTED" });
        }

        // --- 4. 玩家行动 (兼容多人与单人) ---
        if (action === 'MAKE_MOVE') {
            const roomRef = db.ref('rooms/' + roomId);
            await roomRef.child(`players/${userId}`).update({ choice: choiceText });
            
            const snapshot = await roomRef.once('value');
            const roomData = snapshot.val();
            const players = roomData.players || {};
            const playerIds = Object.keys(players);
            
            // 检查所有人是否都选了
            const allReady = playerIds.every(pid => players[pid].choice);

            if (!allReady) return res.status(200).json({ status: "WAITING" });

            // 生成
            const historySnap = await roomRef.child('history').once('value');
            const historyList = historySnap.val() || [];
            
            // 汇总动作 + 身份
            let summary = "";
            playerIds.forEach(pid => {
                const p = players[pid];
                summary += `[${p.profile.role} ${p.profile.name}] 选择了: ${p.choice}; `;
            });

            const prompt = `[History]: ${historyList.slice(-3).join("\n")}\n[Actions]: ${summary}\nContinue story.`;
            const aiJson = await generateStory(prompt);

            await roomRef.child('current_scene').set(aiJson);
            
            // 处理历史记录格式兼容性
            let newHistory = historyList;
            if (typeof newHistory === 'object') newHistory = Object.values(newHistory);
            newHistory.push(`[事件] ${aiJson.stage_2_event}`);
            // 截断历史防止过长
            if(newHistory.length > 10) newHistory = newHistory.slice(-10);
            await roomRef.child('history').set(newHistory);
            
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
