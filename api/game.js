import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from 'firebase-admin';

// 1. 初始化 Firebase Admin (带私钥格式清洗)
if (!admin.apps.length) {
  try {
    // 尝试获取环境变量
    const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
    const dbUrl = process.env.FIREBASE_DB_URL;

    if (!serviceAccountRaw || !dbUrl) {
      throw new Error("环境变量缺失: 请检查 FIREBASE_SERVICE_ACCOUNT 和 FIREBASE_DB_URL");
    }

    // --- 关键修复：处理私钥中的换行符 ---
    const serviceAccount = JSON.parse(serviceAccountRaw);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    // ----------------------------------

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: dbUrl
    });
    console.log("Firebase Admin 初始化成功");

  } catch (e) {
    console.error("Firebase 初始化严重错误:", e);
    // 这里不抛出错误，让 handler 里的 try-catch 捕获并返回给前端
  }
}

const db = admin.database();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

export default async function handler(req, res) {
  // 检查 Firebase 是否活著
  if (!admin.apps.length) {
    return res.status(500).json({ error: "Server Config Error: Firebase 连接失败，请查看 Vercel Logs" });
  }

  const { action, roomId, userId, choiceText } = req.body;

  try {
    if (action === 'CREATE_ROOM') {
      const newRoomId = Math.floor(1000 + Math.random() * 9000).toString();
      await db.ref('rooms/' + newRoomId).set({
        created_at: admin.database.ServerValue.TIMESTAMP,
        status: 'WAITING',
        turn: 0,
        history: [],
        players: {}
      });
      return res.status(200).json({ roomId: newRoomId });
    }

    if (action === 'JOIN_ROOM') {
      const roomRef = db.ref('rooms/' + roomId);
      const snapshot = await roomRef.once('value');
      if (!snapshot.exists()) return res.status(404).json({ error: "房间不存在" });
      
      await roomRef.child('players/' + userId).update({
        joined: true,
        status: 'READY',
        choice: null
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'MAKE_MOVE') {
      const roomRef = db.ref('rooms/' + roomId);
      await roomRef.child(`players/${userId}`).update({ choice: choiceText });

      const snapshot = await roomRef.once('value');
      const roomData = snapshot.val();
      const players = roomData.players || {};
      const playerIds = Object.keys(players);
      
      const allReady = playerIds.length > 0 && playerIds.every(pid => players[pid].choice);

      if (!allReady) {
        return res.status(200).json({ status: 'WAITING_OTHERS' });
      }

      // 结算逻辑
      let actionsSummary = "";
      playerIds.forEach(pid => {
        actionsSummary += `玩家(${pid})选择了: ${players[pid].choice}; `;
      });

      const historyText = (roomData.history || []).slice(-3).join("\n");
      const prompt = `
        [历史剧情]: ${historyText}
        [玩家行动]: ${actionsSummary}
        请继续生成剧情。JSON格式: { "stage_1_env": "...", "stage_2_event": "...", "stage_3_analysis": "...", "image_keyword": "...", "choices": [{"text":"A"}, {"text":"B"}] }
      `;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text().replace(/```json|```/g, "").trim();
      const aiJson = JSON.parse(responseText);

      await roomRef.child('current_scene').set(aiJson);
      
      let newHistoryList = roomData.history || [];
      newHistoryList.push(`[事件]${aiJson.stage_2_event}`);
      await roomRef.child('history').set(newHistoryList);

      const resetUpdates = {};
      playerIds.forEach(pid => resetUpdates[`players/${pid}/choice`] = null);
      await roomRef.update(resetUpdates);

      return res.status(200).json({ status: 'NEW_TURN_GENERATED' });
    }

    return res.status(400).json({ error: "Unknown Action" });

  } catch (error) {
    console.error("API 处理错误:", error);
    res.status(500).json({ error: error.message });
  }
}
