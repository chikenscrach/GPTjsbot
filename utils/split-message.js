// utils/split-message.js
// 將過長的訊息安全地拆分成多個區塊，避免破壞 line-breaks。
// 若斷點落在 ``` 程式碼區塊內，會自動補上閉合並在下一段重新開啟，維持排版。
//
// 原本放在 commands/chat.js，因 /summarize 也需要而抽出。
// commands/chat.js 仍會 re-export 以維持既有引用。

function splitMessage(text, maxLength = 1950) {
  const chunks = [];
  let currentChunk = "";
  let openFence = null; // 目前尚未閉合的 ``` 標記（含語言）

  const pushChunk = () => {
    const chunk = openFence ? currentChunk + "\n```" : currentChunk;
    if (chunk.trim()) chunks.push(chunk);
    currentChunk = openFence ? `${openFence}\n` : "";
  };

  for (const line of text.split("\n")) {
    const fence = line.match(/^\s*(```[^\s`]*)/);

    // 目前區塊放不下這一行時，先送出累積的內容（+5 預留閉合標記空間）
    if (currentChunk.length + line.length + 5 > maxLength) {
      pushChunk();
    }

    if (currentChunk.length + line.length + 5 > maxLength) {
      // 單行內容就超過 maxLength 的極端情況：硬切成多段
      let rest = line;
      while (currentChunk.length + rest.length + 5 > maxLength) {
        const available = maxLength - currentChunk.length - 5;
        currentChunk += rest.slice(0, available);
        rest = rest.slice(available);
        pushChunk();
      }
      currentChunk += rest + "\n";
    } else {
      currentChunk += line + "\n";
    }

    if (fence) {
      openFence = openFence ? null : fence[1];
    }
  }

  if (currentChunk.trim()) {
    pushChunk();
  }

  return chunks;
}

module.exports = { splitMessage };
