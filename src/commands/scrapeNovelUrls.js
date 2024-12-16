const fs = require('fs').promises;
const path = require('path');
const { getAllNovelUrls } = require('../scrapers/novelUrlScraper');
const { errorHandler } = require('../utils/errorHandler');
const { logMemoryUsage } = require('../utils/memoryMonitor');
const progressManager = require('../utils/progressBar');
const telegramNotifier = require('../utils/telegramNotifier');

async function scrapeNovelUrls() {
  try {
    await logMemoryUsage('start_scraping_urls');
    console.log('Starting to scrape novel URLs...');
    progressManager.createBar('urls', 10000, 'url');
    let page = 1;

    const novels = await getAllNovelUrls();

    // Save results ke folder data
    const novelsListPath = path.join(process.cwd(), 'data', 'novels_list.json');
    await fs.writeFile(
      novelsListPath,
      JSON.stringify({
        total: novels.length,
        novels: novels,
        scrapedAt: new Date().toISOString()
      }, null, 2)
    );

    progressManager.stop();
    console.log('\n=== URL Scraping Summary ===');

    // Calculate status counts
    const byStatus = novels.reduce((acc, n) => {
      acc[n.status] = (acc[n.status] || 0) + 1;
      return acc;
    }, {});

    const summary = [
      '📊 URL Scraping Summary:',
      `Total novels found: ${novels.length}`,
      `New novels: ${novels.filter(n => n.updated).length}`,
      `Updated novels: ${novels.filter(n => !n.updated).length}`,
      '\nBy status:',
      ...Object.entries(byStatus).map(([status, count]) => `- ${status}: ${count} novels`)
    ].join('\n');

    console.log(summary);
    await telegramNotifier.sendMessage(summary, 'info');

    await logMemoryUsage('end_scraping_urls');
    return novels;
  } catch (error) {
    errorHandler('Failed to scrape novel URLs:', error);
    progressManager.stop();
    return [];
  }
}

if (require.main === module) {
  scrapeNovelUrls();
}

module.exports = scrapeNovelUrls;
