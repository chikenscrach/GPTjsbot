const db = require('./db');

// 提醒時間粒度為分鐘（XdXhXm），30 秒輪詢一次已足夠
const POLL_INTERVAL_MS = 30 * 1000;

// SQL 語句只需準備一次，重複使用以省去每次輪詢的解析成本
const selectExpired = db.prepare('SELECT * FROM reminders WHERE remind_at <= ?');
const deleteById = db.prepare('DELETE FROM reminders WHERE id = ?');

// 在同一個交易中「取出並刪除」到期提醒，之後才發送訊息，
// 避免發送耗時超過輪詢間隔時，下一次輪詢重複撈到同一筆而重複發送
const claimExpired = db.transaction((now) => {
	const expired = selectExpired.all(now);
	for (const reminder of expired) {
		deleteById.run(reminder.id);
	}
	return expired;
});

async function notify(client, reminder) {
	const { user_id, message, method, channel_id } = reminder;
	try {
		const content = `⏰ 提醒：${message || `<@${user_id}>`}`;

		if (method === 'dm') {
			const user = await client.users.fetch(user_id);
			await user.send(content);
		} else {
			const channel = await client.channels.fetch(channel_id);
			if (channel && channel.isTextBased()) {
				await channel.send(content);
			}
		}
	} catch (err) {
		console.error(`提醒失敗 (ID: ${reminder.id})`, err);
	}
}

function startScheduler(client) {
	setInterval(() => {
		try {
			const expired = claimExpired(Date.now());
			for (const reminder of expired) {
				notify(client, reminder);
			}
		} catch (err) {
			console.error('排程器執行錯誤：', err);
		}
	}, POLL_INTERVAL_MS);
}

module.exports = { startScheduler };
