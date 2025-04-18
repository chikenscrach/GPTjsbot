const OpenAI = require("openai");
const dotenv = require("dotenv");

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function getChatResponse(userMessage, model = "gpt-3.5-turbo") {
  try {
    const completion = await openai.chat.completions.create({
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
    console.error("OpenAI 回應錯誤：", error);
    return "抱歉，請求出錯了！";
  }
}

module.exports = { getChatResponse };
