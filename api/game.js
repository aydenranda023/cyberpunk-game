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
                status: 'SOLO', turn: 0, last_scene_change: 0, players: {},
                host_info: userProfile || { name: '未知', role: 'Ghost' }
            });
            return res.status(200).json({ roomId: newRoomId });
        }

        // 2. 加入房间
        if (action === 'JOIN_ROOM') {
            const roomRef = db.ref('rooms/' + roomId);
            const snapshot = await roomRef.once('value');
            if (!snapshot.exists()) return res.status(404).json({ error: "房间不存在" });

            // Update User Location
            await db.ref(`users/${userId}/current_room`).set(roomId);

            await roomRef.child('players/' + userId).update({ joined: true, choice: null, profile: userProfile });

            // Cleanup Old Room
            const { oldRoomId } = req.body;
            if (oldRoomId && oldRoomId !== roomId) {
                // Async cleanup check
                checkAndCleanRoom(db, oldRoomId);
            }

            return res.status(200).json({ success: true });
        }

        // ... (PRELOAD_TURN logic remains) ...

        // ...

        // Helper for Room Cleanup
        async function checkAndCleanRoom(db, roomId) {
            const roomRef = db.ref('rooms/' + roomId);
            const snap = await roomRef.once('value');
            if (!snap.exists()) return;

            const roomData = snap.val();
            const players = roomData.players || {};
            const playerIds = Object.keys(players);

            if (playerIds.length === 0) {
                await roomRef.remove();
                return;
            }

            // Check if ALL players have moved to a different room
            let allLeft = true;
            for (const pid of playerIds) {
                const userLocSnap = await db.ref(`users/${pid}/current_room`).once('value');
                const currentRoom = userLocSnap.val();
                // If user is still in this room (according to their record), or has no record (anomaly), assume they are here?
                // Actually, if currentRoom IS this roomId, they are here.
                if (currentRoom === roomId) {
                    allLeft = false;
                    break;
                }
            }

            if (allLeft) {
                console.log(`Cleaning up empty room ${roomId}`);
                await roomRef.remove();
            }
        }

        // 抽取核心生成逻辑，以便 Preload 复用
        async function runGameLogic(db, roomId, userId, simulatedChoice, isPreload) {
            const roomRef = db.ref('rooms/' + roomId);
            const snapshot = await roomRef.once('value');
            const roomData = snapshot.val();
            const players = roomData.players || {};
            const playerIds = Object.keys(players);

            // 更新 Turn 和 SceneChange 计数
            const newTurn = (roomData.turn || 0) + 1;
            const updates3 = { turn: newTurn };

            if (aiJson._isSceneChange) {
                updates3.last_scene_change = newTurn;
            }
            if (aiJson._isHpEvent) {
                updates3.last_hp_change = newTurn;
            }

            await roomRef.update(updates3); // 30% chance

            // 场景更换逻辑 (Random 3-6)
            const turn = roomData.turn || 0;
            const lastChange = roomData.last_scene_change || 0;
            const diff = turn - lastChange;

            let isSceneChange = false;
            if (diff < 3) isSceneChange = false;
            else if (diff >= 6) isSceneChange = true;
            else isSceneChange = (Math.random() < 0.3); // 30% chance

            // HP Event Logic (Random 3-6)
            const lastHpChange = roomData.last_hp_change || 0;
            const diffHp = turn - lastHpChange;

            let isHpEvent = false;
            if (diffHp < 3) isHpEvent = false;
            else if (diffHp >= 6) isHpEvent = true;
            else isHpEvent = (Math.random() < 0.3);

            const historySnap = await roomRef.child('history').once('value');
            let historyList = historySnap.val() || [];
            if (typeof historyList === 'object') historyList = Object.values(historyList);

            let playerContext = "";
            playerIds.forEach(pid => {
                const p = players[pid];
                // 如果是 Preload，使用模拟的 choice
                const choice = (isPreload && pid === userId) ? simulatedChoice : (p.choice || "进入游戏");
                const pub = JSON.stringify(p.profile?.public || {});
                const priv = JSON.stringify(p.profile?.private || {});
                playerContext += `玩家ID(${pid}): ${p.profile?.name}[${p.profile?.role}]。\n状态:${pub}\n秘密:${priv}\n本轮行动:${choice}\n\n`;
            });

            const sysPrompt = GAME_MASTER_PROMPT
                .replace('{{HISTORY}}', historyList.slice(-3).join("\n"))
                .replace('{{IS_SCENE_CHANGE}}', isSceneChange.toString())
                .replace('{{IS_HP_EVENT}}', isHpEvent.toString())
                .replace('{{PLAYER_CONTEXT}}', playerContext)
                .replace(/{{PREV_CHOICE}}/g, simulatedChoice || "上轮行动"); // 简单替换

            const result = await model.generateContent(sysPrompt);
            const txt = result.response.text();

            // ... (JSON parsing remains) ...

            // Return extra flags for DB update
            if (aiJson) {
                aiJson._isSceneChange = isSceneChange;
                aiJson._isHpEvent = isHpEvent;
            }

            return aiJson;
        }
