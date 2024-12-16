const axios = require('axios');
const {
  TELEGRAM_TOKEN,
  TELEGRAM_CHAT_ID,
  TELEGRAM_ENABLED
} = require('../config');

class TelegramNotifier {
  constructor() {
    this.baseUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
  }

  async sendMessage(message, level = 'info') {
    if (!TELEGRAM_ENABLED) return;

    try {
      const emoji = this.getEmoji(level);
      const formattedMessage = `${emoji} *Scraper Notification*\n\n${message}`;

      await axios.post(`${this.baseUrl}/sendMessage`, {
        chat_id: TELEGRAM_CHAT_ID,
        text: formattedMessage,
        parse_mode: 'Markdown'
      });
    } catch (error) {
      console.error('Failed to send Telegram notification:', error.message);
    }
  }

  getEmoji(level) {
    switch (level.toLowerCase()) {
      case 'error':
        return '🚨';
      case 'warning':
        return '⚠️';
      case 'success':
        return '✅';
      default:
        return 'ℹ️';
    }
  }

  // Notifikasi untuk error
  async notifyError(error, context) {
    const message = `*ERROR*\n\nContext: ${context}\nError: ${error.message}\nTimestamp: ${new Date().toISOString()}`;
    await this.sendMessage(message, 'error');
  }

  // Notifikasi untuk memory warning
  async notifyHighMemory(memoryUsage) {
    const message = `*High Memory Usage*\n\nHeap Used: ${memoryUsage.heapUsed}\nHeap Total: ${memoryUsage.heapTotal}\nRSS: ${memoryUsage.rss}\nTimestamp: ${memoryUsage.timestamp}`;
    await this.sendMessage(message, 'warning');
  }

  // Notifikasi untuk progress
  async notifyProgress(current, total, context) {
    const percentage = ((current / total) * 100).toFixed(2);
    const message = `*Progress Update*\n\nContext: ${context}\nProgress: ${current}/${total} (${percentage}%)\nTimestamp: ${new Date().toISOString()}`;
    await this.sendMessage(message, 'info');
  }

  // Notifikasi untuk success
  async notifySuccess(message) {
    await this.sendMessage(message, 'success');
  }
}

const telegramNotifier = new TelegramNotifier();
module.exports = telegramNotifier;
