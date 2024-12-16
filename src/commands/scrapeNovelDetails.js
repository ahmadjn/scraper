const fs = require('fs').promises;
const path = require('path');
const { scrapeDetailsInParallel } = require('../scrapers/novelDetailsScraper');
const { errorHandler } = require('../utils/errorHandler');
const { logMemoryUsage } = require('../utils/memoryMonitor');
const progressManager = require('../utils/progressBar');
const telegramNotifier = require('../utils/telegramNotifier');
const { CHUNK_DELAY, delay } = require('../config');

async function scrapeAllNovelDetails() {
  try {
    await logMemoryUsage('start_scraping_details');
    console.log('Starting to scrape novel details...');

    // Load novels list
    const novelsListPath = path.join(process.cwd(), 'data', 'novels_list.json');
    const novelsList = JSON.parse(await fs.readFile(novelsListPath, 'utf8'));
    const novels = novelsList.novels.filter(n => n.updated);

    // Scrape details concurrently
    const details = await scrapeDetailsInParallel(novels);

    // Calculate chapter stats
    const totalChapters = details.reduce((sum, n) => sum + n.total_chapters, 0);

    console.log('\n=== Details Scraping Summary ===');
    const summary = [
      '📚 Details Scraping Summary:',
      `Total processed: ${novels.length} novels`,
      `Successfully scraped: ${details.length}`,
      `Failed: ${novels.length - details.length}`,
      `Success rate: ${((details.length / novels.length) * 100).toFixed(2)}%`,
      '',
      `Total chapters to scrape: ${totalChapters}`,
      `Average chapters per novel: ${Math.round(totalChapters / details.length)}`
    ].join('\n');

    console.log(summary);
    await telegramNotifier.sendMessage(summary, 'info');

    await logMemoryUsage('end_scraping_details');
  } catch (error) {
    errorHandler('Error scraping novel details:', error);
  }
}

if (require.main === module) {
  scrapeAllNovelDetails();
}

module.exports = scrapeAllNovelDetails;
