import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from 'firebase-admin';

// 1. 初始化 Firebase Admin (单例模式，防止重复初始化报错)
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DB_URL
    });
  } catch (e) {
    console.error("Firebase Init Error:", e);
  }
}
const db = admin.database();

// 2. 初始化 AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" }); // 确保模型名正确

export default async function handler(req, res) {
  const { action, roomId, userId, choiceText, userContext } = req.body;

  try {
    // --- 分支 A: 创建房间 (Create Room) ---
    if (action === 'CREATE_ROOM') {
      const newRoomId = Math.floor(1000 + Math.random() * 9000).toString();
      await db.ref('rooms/' + newRoomId).set({
        created_at: admin.database.ServerValue.TIMESTAMP,
        status: 'WAITING',
        turn: 0,
        history: [], // 存储剧情历史
        players: {}  // 玩家列表
      });
      return res.status(200).json({ roomId: newRoomId });
    }

    // --- 分支 B: 加入房间 (Join Room) ---
    if (action === 'JOIN_ROOM') {
      const roomRef = db.ref('rooms/' + roomId);
      const snapshot = await roomRef.once('value');
      if (!snapshot.exists()) return res.status(404).json({ error: "房间不存在" });
      
      // 注册玩家
      await roomRef.child('players/' + userId).update({
        joined: true,
        status: 'READY',
        choice: null // 初始未选择
      });
      return res.status(200).json({ success: true });
    }

    // --- 分支 C: 玩家行动 (Make Move) ---
    if (action === 'MAKE_MOVE') {
      const roomRef = db.ref('rooms/' + roomId);
      
      // 1. 记录当前玩家的选择
      await roomRef.child(`players/${userId}`).update({
        choice: choiceText
      });

      // 2. 检查：是不是所有人都选完了？
      const snapshot = await roomRef.once('value');
      const roomData = snapshot.val();
      const players = roomData.players || {};
      const playerIds = Object.keys(players);
      
      // 只要有一个人的 choice 是 null 或 undefined，就还得等
      const allReady = playerIds.every(pid => players[pid].choice);

      if (!allReady) {
        return res.status(200).json({ status: 'WAITING_OTHERS' });
      }

      // --- 所有人已就位，触发 AI 结算 ---
      
      // 3. 收集所有人的选择
      let actionsSummary = "";
      playerIds.forEach(pid => {
        actionsSummary += `玩家(${pid})选择了: ${players[pid].choice}; `;
      });

      // 4. 构建 Prompt
      const historyText = (roomData.history || []).slice(-3).join("\n"); // 取最近3段历史
      const prompt = `
        [历史剧情]: ${historyText}
        [当前玩家行动]: ${actionsSummary}
        
        请继续生成下一章剧情。
        要求：
        1. 综合考虑所有玩家的选择。如果是冲突的选择，描述冲突带来的后果。
        2. 字数 100-150 字。
        3. 提取一个英文单词作为画面关键词。
        4. JSON 格式返回: { "stage_1_env": "...", "stage_2_event": "...", "stage_3_analysis": "...", "image_keyword": "...", "choices": [{"text":"A"}, {"text":"B"}] }
      `;

      // 5. 调用 AI
      const result = await model.generateContent(prompt);
      const responseText = result.response.text().replace(/```json|```/g, "").trim();
      const aiJson = JSON.parse(responseText);

      // 6. 更新数据库 (这就是同步的关键！)
      // 写入新剧情
      await roomRef.child('current_scene').set(aiJson);
      
      // 记录历史
      const newHistoryEntry = `[环境]${aiJson.stage_1_env} [事件]${aiJson.stage_2_event}`;
      // Firebase 数组追加比较麻烦，这里简化处理，只存最新的用于下一次 Context
      // 实际生产中应该 push 到 history 列表
      let newHistoryList = roomData.history || [];
      newHistoryList.push(newHistoryEntry);
      await roomRef.child('history').set(newHistoryList);

      // 清空所有人的选择，准备下一回合
      const resetUpdates = {};
      playerIds.forEach(pid => {
        resetUpdates[`players/${pid}/choice`] = null;
      });
      await roomRef.update(resetUpdates);

      return res.status(200).json({ status: 'NEW_TURN_GENERATED' });
    }

    return res.status(400).json({ error: "Unknown Action" });

  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({ error: error.message });
  }
}
