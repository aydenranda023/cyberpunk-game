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
        // 1. 创建
        if (action === 'CREATE_ROOM') {
            const newRoomId = Math.floor(1000 + Math.random() * 9000).toString();
            await db.ref('rooms/' + newRoomId).set({
                created_at: admin.database.ServerValue.TIMESTAMP,
                status: 'SOLO', turn: 0, players: {},
                host_info: userProfile || { name: '未知', role: 'Ghost' }
            });
            return res.status(200).json({ roomId: newRoomId });
        }

        // 2. 加入
        if (action === 'JOIN_ROOM') {
            const roomRef = db.ref('rooms/' + roomId);
            const snapshot = await roomRef.once('value');
            if (!snapshot.exists()) return res.status(404).json({ error: "房间不存在" });
            await roomRef.child('players/' + userId).update({ joined: true, choice: null, profile: userProfile });
            return res.status(200).json({ success: true });
        }

        // 3. 生成剧情 (核心)
        if (action === 'START_GAME' || action === 'MAKE_MOVE') {
            const roomRef = db.ref('rooms/' + roomId);
            
            if (action === 'MAKE_MOVE') {
                await roomRef.child(`players/${userId}`).update({ choice: choiceText });
            }

            const snapshot = await roomRef.once('value');
            const roomData = snapshot.val();
            const players = roomData.players || {};
            const playerIds = Object.keys(players);

            if (action === 'MAKE_MOVE') {
                const allReady = playerIds.every(pid => players[pid].choice);
                if (!allReady) return res.status(200).json({ status: "WAITING" });
            }

            // 准备 Prompt
            const historySnap = await roomRef.child('history').once('value');
            let historyList = historySnap.val() || [];
            if (typeof historyList === 'object') historyList = Object.values(historyList);
            
            let playerContext = "";
            playerIds.forEach((pid, idx) => {
                const p = players[pid];
                const choice = p.choice || "进入游戏";
                const role = p.profile?.role || "未知";
                const name = p.profile?.name || "V";
                // 关键：明确告诉 AI 玩家的顺序索引
                playerContext += `Player_Index_${idx} (Real_ID: ${pid}): [${role}] ${name}. Action: ${choice}\n`;
            });

            const sysPrompt = `
            你是一个赛博朋克文字游戏主持人。
            
            【绝对规则】
            1. **必须使用中文 (简体)**。
            2. 必须返回一个包含所有玩家视角的数组 (Array)。数组顺序必须与输入的 Player_Index 严格对应。
            
            【输入信息】
            [历史]: ${historyList.slice(-3).join("\n")}
            [玩家列表]:
            ${playerContext}

            【输出格式 JSON】
            {
                "global_summary": "一句话概括(中文)",
                "views_array": [
                    {
                        "image_keyword": "english noun",
                        "stage_1_env": "环境描写(中文)",
                        "stage_2_event": "突发事件(中文)",
                        "stage_3_analysis": "分析(中文)",
                        "choices": [{"text":"A中文"},{"text":"B中文"}]
                    },
                    { ...下一个玩家的视角... }
                ]
            }
            `;

            const result = await model.generateContent(sysPrompt);
            const txt = result.response.text().replace(/```json|```/g, "").trim();
            const aiJson = JSON.parse(txt);

            // --- 数组映射回 UID ---
            const finalSceneData = {};
            // 确保 views_array 存在且长度匹配
            const views = aiJson.views_array || [];
            
            playerIds.forEach((realPid, index) => {
                // 如果 AI 生成的数组不够长，就复用第一个，防止报错
                const view = views[index] || views[0];
                if (view) {
                    finalSceneData[realPid] = view;
                }
            });

            await roomRef.child('current_scene').set(finalSceneData);
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
