const fs = require('fs').promises;
const path = require('path');
const scrapeNovelUrls = require('./scrapeNovelUrls');
const scrapeNovelDetails = require('./scrapeNovelDetails');
const { scrapeAllNovelsChapters } = require('./scrapeChapters');
const { errorHandler } = require('../utils/errorHandler');
const { logMemoryUsage } = require('../utils/memoryMonitor');
const telegramNotifier = require('../utils/telegramNotifier');
const statsCollector = require('../utils/statsCollector');
const { DATA_DIR, delay } = require('../config');

const LOCK_FILE = path.join(process.cwd(), 'data', 'scraper.lock');
const DATA_PATH = path.join(DATA_DIR, 'data');
const SIX_HOURS = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

async function releaseLock() {
  try {
    await fs.unlink(LOCK_FILE);
  } catch (error) {
    errorHandler('Error releasing lock:', error);
  }
}

async function acquireLock() {
  try {
    // Ensure data directory exists
    try {
      await fs.access(DATA_PATH);
    } catch {
      await fs.mkdir(DATA_PATH, { recursive: true });
    }

    // Check if lock exists
    try {
      await fs.access(LOCK_FILE);
      // Check if lock is stale (older than 1 hour)
      const lockData = await fs.readFile(LOCK_FILE, 'utf8');
      const lockTime = new Date(lockData);
      const now = new Date();
      if (now - lockTime > 60 * 60 * 1000) { // 1 hour
        console.log('Found stale lock file, removing...');
        await fs.unlink(LOCK_FILE);
      } else {
        throw new Error('Scraper is already running');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    // Create lock file
    await fs.writeFile(LOCK_FILE, new Date().toISOString());
    return true;
  } catch (error) {
    throw new Error(`Error acquiring lock: ${error.message}`);
  }
}

async function runScraperCycle() {
  try {
    if (!await acquireLock()) {
      console.error('Another scraper process is running');
      return;
    }

    await logMemoryUsage('start_scraping_all');
    await telegramNotifier.sendMessage('Starting scraper process...', 'info');

    // Step 1: URLs with cleanup
    console.log('Step 1: Scraping novel URLs...');
    await scrapeNovelUrls();
    console.log('\nCleaning up after URL scraping...');
    await delay(5000); // 5 seconds cooldown
    await statsCollector.saveStats();
    await logMemoryUsage('urls_done');

    // Step 2: Details with cleanup
    console.log('Step 2: Scraping novel details...');
    await scrapeNovelDetails();
    console.log('\nCleaning up after details scraping...');
    await delay(5000); // 5 seconds cooldown
    await statsCollector.saveStats();
    await logMemoryUsage('details_done');

    // Step 3: Chapters with cleanup
    console.log('Step 3: Scraping chapters...');
    await scrapeAllNovelsChapters();
    console.log('\nCleaning up after chapter scraping...');
    await delay(5000); // 5 seconds cooldown
    await statsCollector.saveStats();

    console.log('\nAll scraping completed successfully!');
    await telegramNotifier.notifySuccess('All scraping tasks completed successfully! 🎉');
    const report = await statsCollector.generateReport();
    await telegramNotifier.sendMessage(report, 'info');
    await logMemoryUsage('end_scraping_all');

    // Final cleanup
    console.log('\nPerforming final cleanup...');
    try {
      // Compact stats file
      const stats = await statsCollector.loadStats();
      await statsCollector.saveStats(stats);

      // Clean memory
      global.gc && global.gc();
    } catch (error) {
      errorHandler('Error during final cleanup:', error);
    }

    await releaseLock();
  } catch (error) {
    errorHandler('Scraping failed:', error);
    await releaseLock();
  }
}

async function scrapeAll() {
  console.log('Starting continuous scraping process...');

  try {
    while (true) {
      const startTime = new Date();
      console.log(`\nStarting new scraping cycle at: ${startTime.toLocaleString()}`);

      await runScraperCycle();

      const endTime = new Date();
      const nextRunTime = new Date(endTime.getTime() + SIX_HOURS);
      const cycleSummary = [
        '🔄 Scraping Cycle Completed',
        `Started at: ${startTime.toLocaleString()}`,
        `Completed at: ${endTime.toLocaleString()}`,
        `Duration: ${((endTime - startTime) / 1000 / 60).toFixed(2)} minutes`,
        '',
        `Next cycle will start at: ${nextRunTime.toLocaleString()}`
      ].join('\n');

      console.log(cycleSummary);
      await telegramNotifier.sendMessage(cycleSummary, 'info');
      console.log(`Waiting for ${SIX_HOURS / 1000 / 60 / 60} hours...\n`);

      await delay(SIX_HOURS);
    }
  } catch (error) {
    errorHandler('Continuous scraping failed:', error);
    process.exit(1);
  }
}

// Handle force exit
async function cleanup() {
  console.log('\nReceived termination signal. Cleaning up...');
  try {
    // Check if lock exists before trying to remove
    try {
      await fs.access(LOCK_FILE);
      await fs.unlink(LOCK_FILE);
      console.log('Lock file removed.');
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.error('Error removing lock file:', e);
      }
    }

    // Save any pending stats
    await statsCollector.saveStats();
    console.log('Stats saved.');
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
  process.exit(0);
}

// Register cleanup handlers
process.on('SIGINT', cleanup);  // Ctrl+C
process.on('SIGTERM', cleanup); // Kill
process.on('SIGUSR2', cleanup); // Nodemon restart

if (require.main === module) {
  scrapeAll();
}

module.exports = scrapeAll;
