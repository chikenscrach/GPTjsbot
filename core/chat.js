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
