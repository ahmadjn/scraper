const fs = require('fs').promises;
const path = require('path');
const { DATA_DIR } = require('../config');
const telegramNotifier = require('./telegramNotifier');
const logManager = require('./logManager');

let isCleaningUp = false;

// List of error messages that should not be sent to telegram
const IGNORED_ERRORS = [
  'Cannot read properties of undefined (reading \'matchAll\')',
  'Cannot read properties of undefined (reading \'match\')',
  'getaddrinfo ENOTFOUND',
  'DNS lookup failed',
  'timeout of 10000ms exceeded'
];

async function cleanup() {
  if (isCleaningUp) return;
  isCleaningUp = true;

  console.log('\nPerforming cleanup before exit...');
  try {
    // Log status terakhir
    const status = {
      type: 'cleanup',
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };

    await logError(new Error('Process terminated'), status);
    await telegramNotifier.sendMessage('Scraper process terminated', 'warning');

    // Tunggu sebentar untuk memastikan semua log tertulis
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('Cleanup completed');
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

async function ensureLogDir() {
  const logDir = path.join(DATA_DIR, 'data');
  try {
    await fs.access(logDir);
  } catch {
    await fs.mkdir(logDir, { recursive: true });
  }

  // Pastikan file error.log ada
  const errorLogPath = path.join(logDir, 'error.log');
  try {
    await fs.access(errorLogPath);
  } catch {
    await fs.writeFile(errorLogPath, '');
  }
}

// Log errors ke file
async function logError(error, context = '') {
  try {
    const errorLog = {
      error: error.message,
      stack: error.stack,
      context
    };

    await logManager.appendLog('error', errorLog);
  } catch (err) {
    console.error('Failed to log error:', err);
  }
}

// Fungsi helper untuk error handling
async function errorHandler(context, error) {
  const timestamp = new Date().toISOString();
  const errorMessage = error.message || error;

  // Check if error should be ignored for telegram
  const shouldNotify = !IGNORED_ERRORS.some(msg => errorMessage.includes(msg));

  // Log to console
  console.error(`Context: ${context}\nError: ${errorMessage}\nTimestamp: ${timestamp}`);

  // Only send to telegram if error is not ignored
  if (shouldNotify) {
    await telegramNotifier.sendMessage({
      context,
      error: errorMessage,
      timestamp
    }, 'error');
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', error);
  await logError(error, 'uncaughtException');
  await cleanup();
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (error) => {
  console.error('Unhandled Rejection:', error);
  await logError(error, 'unhandledRejection');
});

// Handle cleanup before exit
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM');
  await cleanup();
  process.exit(0);
});

// Handle Ctrl+C
process.on('SIGINT', async () => {
  console.log('Received SIGINT (Ctrl+C)');
  await cleanup();
  process.exit(0);
});

// Handle process exit
process.on('exit', (code) => {
  console.log(`Process exiting with code: ${code}`);
});

module.exports = {
  logError,
  errorHandler
};
