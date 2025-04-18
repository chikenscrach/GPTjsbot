const db = require('./db');

let clientRef = null;

function startScheduler(client) {
	clientRef = client;
	setInterval(() => {
		const now = Date.now();
		const expired = db.prepare('SELECT * FROM reminders WHERE remind_at <= ?').all(now);

		for (const reminder of expired) {
			const { user_id, message, method, channel_id } = reminder;
			const notify = async () => {
				try {
					const user = await clientRef.users.fetch(user_id);
					const content = `⏰ 提醒：${message || `<@${user_id}>`}`;

					if (method === 'dm') {
						await user.send(content);
					} else {
						const channel = await clientRef.channels.fetch(channel_id);
						if (channel && channel.isTextBased()) {
							await channel.send(content);
						}
					}
				} catch (err) {
					console.error(`提醒失敗 (ID: ${reminder.id})`, err);
				} finally {
					db.prepare('DELETE FROM reminders WHERE id = ?').run(reminder.id);
				}
			};
			notify();
		}
	}, 1000);
}

module.exports = { startScheduler };
