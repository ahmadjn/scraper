const fs = require('fs').promises;
const path = require('path');
const { DATA_DIR } = require('../config');
const { scrapeChapter } = require('../scrapers/chapterScraper');
const FailedChaptersTracker = require('../utils/failedChaptersTracker');
const { errorHandler } = require('../utils/errorHandler');
const { logMemoryUsage } = require('../utils/memoryMonitor');

async function retryFailedChapters(novelSlug = null) {
  try {
    // Jika tidak ada novelSlug, cek semua novel
    if (!novelSlug) {
      const novelsDir = path.join(DATA_DIR, 'data', 'novels');
      const novelSlugs = await fs.readdir(novelsDir);

      console.log('Checking all novels for failed chapters...');

      let totalFailed = 0;
      let totalSuccess = 0;

      for (const slug of novelSlugs) {
        const failedTracker = new FailedChaptersTracker(slug);
        const failedChapters = await failedTracker.getFailedChapters();

        if (failedChapters.length > 0) {
          console.log(`\nFound ${failedChapters.length} failed chapters in ${slug}`);
          totalFailed += failedChapters.length;

          const result = await retryNovelChapters(slug, failedChapters);
          totalSuccess += result;
        }
      }

      if (totalFailed === 0) {
        console.log('No failed chapters found in any novel');
      } else {
        console.log(`\nRetry Summary:`);
        console.log(`Total failed chapters: ${totalFailed}`);
        console.log(`Successfully re-scraped: ${totalSuccess}`);
        console.log(`Remaining failed: ${totalFailed - totalSuccess}`);
      }
      return;
    }

    // Jika ada novelSlug spesifik
    await retryNovelChapters(novelSlug);

  } catch (error) {
    errorHandler('Error retrying failed chapters:', error);
  }
}

async function retryNovelChapters(novelSlug, failedChapters = null) {
  try {
    const failedTracker = new FailedChaptersTracker(novelSlug);
    failedChapters = failedChapters || await failedTracker.getFailedChapters();

    if (failedChapters.length === 0) {
      console.log(`No failed chapters to retry for ${novelSlug}`);
      return 0;
    }

    console.log(`Retrying ${failedChapters.length} failed chapters for ${novelSlug}`);

    const novelDetailPath = path.join(DATA_DIR, 'data', 'novels', novelSlug, 'novel_detail.json');
    const novelData = JSON.parse(await fs.readFile(novelDetailPath, 'utf8'));
    const baseUrl = novelData.url_source;

    let successCount = 0;
    for (const failed of failedChapters) {
      const chapterUrl = `${baseUrl}/chapter-${failed.chapter}`;
      const result = await scrapeChapter(chapterUrl, novelSlug);

      if (result) {
        successCount++;
        console.log(`Successfully re-scraped chapter ${failed.chapter}`);
      }
    }

    if (successCount === failedChapters.length) {
      await failedTracker.clearFailedChapters();
      console.log(`All failed chapters successfully re-scraped for ${novelSlug}`);
    } else {
      console.log(`Re-scraped ${successCount}/${failedChapters.length} chapters for ${novelSlug}`);
    }

    return successCount;
  } catch (error) {
    errorHandler(`Error retrying chapters for ${novelSlug}:`, error);
    return 0;
  }
}

if (require.main === module) {
  const novelSlug = process.argv[2]; // optional parameter
  retryFailedChapters(novelSlug);
}

module.exports = retryFailedChapters;
