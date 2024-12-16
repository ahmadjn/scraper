const fs = require('fs').promises;
const path = require('path');
const { DATA_DIR } = require('../config');
const { errorHandler } = require('./errorHandler');
const telegramNotifier = require('./telegramNotifier');
const logManager = require('./logManager');

function formatBytes(bytes) {
  return `${Math.round(bytes / 1024 / 1024 * 100) / 100} MB`;
}

async function logMemoryUsage(context = '') {
  try {
    const used = process.memoryUsage();
    const memoryLog = {
      context,
      heapUsed: formatBytes(used.heapUsed),
      heapTotal: formatBytes(used.heapTotal),
      rss: formatBytes(used.rss),
      external: formatBytes(used.external)
    };

    await logManager.appendLog('memory', memoryLog);

    // Warning jika memory usage tinggi
    if (used.heapUsed > 500 * 1024 * 1024) { // > 500MB
      errorHandler('High memory usage', new Error(JSON.stringify(memoryLog)));
      await telegramNotifier.notifyHighMemory(memoryLog);
    }
  } catch (error) {
    errorHandler('Error logging memory usage:', error);
  }
}

// Monitor memory setiap 5 menit
const FIVE_MINUTES = 5 * 60 * 1000;
setInterval(() => logMemoryUsage('periodic_check'), FIVE_MINUTES);

module.exports = {
  logMemoryUsage
};
