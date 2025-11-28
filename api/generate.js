import { GoogleGenerativeAI } from "@google/generative-ai";
export default async function handler(req, res) {
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "No Key" });
    try {
        const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ model: "gemini-2.5-flash-lite" });
        const txt = (await model.startChat({ history: req.body.history || [] }).sendMessage(req.body.prompt)).response.text();
        res.json({ text: txt });
    } catch (e) { res.status(500).json({ error: e.message }); }
}
