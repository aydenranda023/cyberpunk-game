// api/generate.js
import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  // 1. 从 Vercel 的环境变量里拿 Key (非常安全)
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    return res.status(500).json({ error: "Server Error: API Key not configured." });
  }

  // 2. 获取前端发来的历史记录
  const { history, prompt } = req.body;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // 或者 gemini-2.5-flash-lite

    // 3. 组装对话
    const chat = model.startChat({
      history: history || [],
    });

    // 4. 发送请求
    const result = await chat.sendMessage(prompt);
    const response = await result.response;
    const text = response.text();

    // 5. 把结果发回给前端
    res.status(200).json({ text: text });
    
  } catch (error) {
    console.error("Gemini API Error:", error);
    res.status(500).json({ error: "Failed to generate content." });
  }
}