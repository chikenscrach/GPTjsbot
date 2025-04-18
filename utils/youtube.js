// utils/youtube.js

function extractYouTubeIdFromUrl(url) {
  try {
    const parsedUrl = new URL(url);

    // 處理 attribution_link → 解析 `u` 參數中的影片連結
    if (parsedUrl.pathname.startsWith('/attribution_link')) {
      const u = parsedUrl.searchParams.get('u');
      if (u) return extractYouTubeIdFromUrl(`https://youtube.com${decodeURIComponent(u)}`);
    }

    // 處理 oembed → 解析 `url` 參數中的影片連結
    if (parsedUrl.pathname.startsWith('/oembed')) {
      const u = parsedUrl.searchParams.get('url');
      if (u) return extractYouTubeIdFromUrl(decodeURIComponent(u));
    }

    // 處理標準網址與嵌入式網址
    const normalizedUrl = decodeURIComponent(url);

    const regex = /(?:youtube(?:-nocookie)?\.com\/(?:(?:watch\?.*?v=)|(?:embed|v|e|shorts|live|watch)\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = normalizedUrl.match(regex);

    return match ? `https://youtu.be/${match[1]}` : null;
  } catch (e) {
    return null;
  }
}

module.exports = { extractYouTubeIdFromUrl };
