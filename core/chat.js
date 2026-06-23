const Groq = require("groq-sdk");
const dotenv = require("dotenv");

dotenv.config();

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

async function getChatResponse(userMessage, model = "groq/compound") {
  try {
    const completion = await groq.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "你是一個 Discord 聊天機器人。請用繁體中文回覆，回覆務必簡潔明瞭，嚴格控制在 2000 個字元以內。若內容較多，請摘要重點，不要截斷語句。"
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    let reply = completion.choices[0]?.message?.content || "我沒有回應喔。";
    if (reply.length > 2000) {
      reply = reply.substring(0, 1997) + "...";
    }
    return reply;
  } catch (error) {
    console.error("Groq 回應錯誤：", error);
    return "抱歉，請求出錯了！";
  }
}

module.exports = { getChatResponse };
