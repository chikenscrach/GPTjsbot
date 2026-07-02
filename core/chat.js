const Groq = require("groq-sdk");
const dotenv = require("dotenv");

dotenv.config();

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const defaultSystemPrompt = 
  "你是一位專業且親切的 Discord 智慧助手。\n" +
  "請遵守以下規則進行回覆：\n" +
  "1. 格式：請使用繁體中文（台灣習慣用語）進行對答，語氣友善、活潑、並適度使用 Discord 的 Markdown 語法（如粗體、列表、程式碼區塊等）與表情符號使版面美觀好讀。\n" +
  "2. 內容：不需刻意限制字數，請盡可能提供完整、精確且有幫助的回答。若回答較長，請多利用條列式（Bullet points）或標題進行結構化排版。\n" +
  "3. 程式碼：提供程式碼時，請務必使用對應語言的 Markdown 程式碼區塊（如 ```javascript ），並加上簡單的中文註解說明。\n" +
  "4. 身分：你是由開發者部署在 Discord 伺服器中的 AI 小助手，融入社群聊天的氛圍中。";

async function getChatResponse(userMessage, model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile") {
  try {
    const systemPrompt = process.env.GROQ_SYSTEM_PROMPT || defaultSystemPrompt;
    const completion = await groq.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    return completion.choices[0]?.message?.content || "我沒有回應喔。";
  } catch (error) {
    console.error("Groq 回應錯誤：", error);
    return "抱歉，請求出錯了！";
  }
}

module.exports = { getChatResponse };
