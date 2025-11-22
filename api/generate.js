import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API Key 没填对" });
  }

  const { history, prompt } = req.body;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // 修正：确保这里用的是 2.5-flash-lite
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" }); 

    const chat = model.startChat({
      history: history || [],
    });

    const result = await chat.sendMessage(prompt);
    const response = await result.response;
    const text = response.text();

    res.status(200).json({ text: text });
    
  } catch (error) {
    console.error("Google API 报错:", error);
    // 将错误信息转为字符串返回，方便排查
    res.status(500).json({ error: error.message || "Unknown Model Error" });
  }
}
