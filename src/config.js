const path = require('path');
const BASE_URL = 'https://wtr-lab.com';
const NOVEL_LIST_URL = `${BASE_URL}/en/novel-list`;
const DATA_DIR = process.cwd();
const LOG_DIR = path.join(DATA_DIR, 'data', 'logs');
const RETRY_COUNT = 3;
const RETRY_DELAY = 1000;
const CONCURRENT_LIMIT = 100;
const CHUNK_DELAY = 2000;

// Telegram config
const TELEGRAM_TOKEN = '8137568652:AAHsnv56gsaGs7CecjoD6qFz5lhmp8ibo7A';
const TELEGRAM_CHAT_ID = '651689625';
const TELEGRAM_ENABLED = true; // Flag untuk enable/disable notifikasi

// Utility function to delay between requests to avoid rate limiting
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
  BASE_URL,
  NOVEL_LIST_URL,
  DATA_DIR,
  LOG_DIR,
  RETRY_COUNT,
  RETRY_DELAY,
  CONCURRENT_LIMIT,
  CHUNK_DELAY,
  TELEGRAM_TOKEN,
  TELEGRAM_CHAT_ID,
  TELEGRAM_ENABLED,
  delay
};
