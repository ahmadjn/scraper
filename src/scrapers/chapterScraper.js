const axiosInstance = require('../utils/axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const { DATA_DIR, RETRY_COUNT, RETRY_DELAY, CHUNK_DELAY, delay } = require('../config');
const { errorHandler } = require('../utils/errorHandler');
const { withRetry } = require('../utils/retryStrategy');
const FailedChaptersTracker = require('../utils/failedChaptersTracker');
const resourceMonitor = require('../utils/resourceMonitor');
const statsCollector = require('../utils/statsCollector');

async function ensureChapterDir(novelSlug) {
  const chapterDir = path.join(DATA_DIR, 'data', 'novels', novelSlug, 'chapters');
  try {
    await fs.access(chapterDir);
  } catch {
    await fs.mkdir(chapterDir, { recursive: true });
  }
  return chapterDir;
}

async function formatContentToHtml(content) {
  if (!Array.isArray(content)) return { skip: true };

  // Format setiap paragraf dengan tag <p>
  return content.map(paragraph => {
    // Skip jika paragraf kosong
    if (!paragraph.trim()) return '';

    // Bungkus teks dengan tag <p>
    return `<p>${paragraph}</p>`;
  }).join('\n');
}

async function scrapeChapter(chapterUrl, novelSlug) {
  try {
    // Pastikan URL menggunakan default=true
    const url = chapterUrl.includes('?') ?
      `${chapterUrl}&default=true` :
      `${chapterUrl}?default=true`;

    const startTime = Date.now();
    const { titleCase } = await import('title-case');
    const response = await withRetry(
      () => axiosInstance.get(url),
      { url, novelSlug }
    );

    const $ = cheerio.load(response.data);
    const scriptContent = $('#__NEXT_DATA__').html();

    if (!scriptContent) {
      return { skip: true };
    }

    let jsonData;
    try {
      jsonData = await withRetry(
        () => JSON.parse(scriptContent),
        { url, context: 'JSON parsing' }
      );
    } catch (e) {
      return { skip: true };
    }

    // Verifikasi struktur data
    if (!jsonData?.props?.pageProps?.serie?.chapter_data?.data) {
      return { skip: true };
    }

    const chapterData = jsonData.props.pageProps.serie.chapter_data;
    const title = chapterData.data.title;
    const formattedContent = await formatContentToHtml(chapterData.data.body);

    // Check if content needs to be skipped
    if (formattedContent.skip) {
      return { skip: true };
    }

    const chapterNumber = parseInt(url.match(/chapter-(\d+)/)?.[1] || 0);
    if (!chapterNumber) {
      return { skip: true };
    }

    const formattedChapter = {
      chapter_title: titleCase(title),
      chapter_content: formattedContent
    };

    // Save files in parallel
    const chapterDir = await ensureChapterDir(novelSlug);
    const chapterPath = path.join(chapterDir, `chapter_${chapterNumber}.json`);

    await fs.writeFile(chapterPath, JSON.stringify(formattedChapter, null, 2));

    // Track successful scrape
    await statsCollector.updateStats('chapter_success', {
      time: Date.now() - startTime
    });

    return formattedChapter;

  } catch (error) {
    errorHandler(`Error scraping chapter ${chapterUrl}:`, error);
    // Track failed scrape
    await statsCollector.updateStats('chapter_fail', {
      error: error.message,
      context: `${novelSlug} - ${chapterUrl}`
    });
    return { skip: true };
  }
}

// Helper untuk process chunk dengan concurrent
async function processChunkConcurrent(urls, novelSlug) {
  const promises = urls.map(url => scrapeChapter(url, novelSlug));
  return Promise.all(promises);
}

async function scrapeNovelChapters(novelSlug) {
  try {
    // Start resource monitoring
    resourceMonitor.start();

    await logMemoryUsage(`start_scraping_${novelSlug}`);
    // Check if novel_detail.json exists
    const hasNovelDetail = await checkNovelDetailExists(novelSlug);
    if (!hasNovelDetail) {
      console.log(`Skipping ${novelSlug}: novel_detail.json not found`);
      return;
    }

    // Load novel details
    const novelDetailPath = path.join(process.cwd(), 'data', 'novels', novelSlug, 'novel_detail.json');
    const novelData = JSON.parse(await fs.readFile(novelDetailPath, 'utf8'));

    // Check if scraping is already complete
    if (novelData.scraped_chapters === novelData.total_chapters) {
      console.log(`Skipping ${novelSlug}: All chapters already scraped`);
      return;
    }

    // Generate chapter URLs
    const baseUrl = novelData.url_source;
    const chapterUrls = [];
    for (let i = novelData.scraped_chapters + 1; i <= novelData.total_chapters; i++) {
      chapterUrls.push(`${baseUrl}/chapter-${i}`);
    }

    console.log(`Starting to scrape ${chapterUrls.length} remaining chapters for ${novelSlug}`);
    progressManager.createBar(novelSlug, novelData.total_chapters);
    progressManager.updateBar(novelData.scraped_chapters);

    let successCount = novelData.scraped_chapters;
    // Get optimal concurrency based on system resources
    const optimalConcurrency = resourceMonitor.calculateOptimalConcurrency();
    let currentConcurrency = optimalConcurrency;
    const chunks = chunkArray(chapterUrls, currentConcurrency);

    const failedTracker = new FailedChaptersTracker(novelSlug);

    // Update total chapters count
    await statsCollector.updateStats('novel_count', novelData.total_chapters);

    for (const chunk of chunks) {
      // Check resources and adjust concurrency
      const metrics = await resourceMonitor.getCurrentMetrics();
      if (metrics.trends.cpu > 80 || metrics.trends.memory > 80) {
        currentConcurrency = Math.max(2, Math.floor(currentConcurrency * 0.7));
        await delay(CHUNK_DELAY * 2);
      } else if (metrics.trends.cpu < 50 && metrics.trends.memory < 50) {
        currentConcurrency = Math.min(optimalConcurrency, currentConcurrency + 1);
      }

      // Use current concurrency
      const currentChunk = chunk.slice(0, currentConcurrency);
      try {
        // Process chunk concurrently
        const results = await processChunkConcurrent(currentChunk, novelSlug);

        // Handle results
        const writePromises = [];
        for (let i = 0; i < currentChunk.length; i++) {
          const url = currentChunk[i];
          const result = results[i];
          const chapterNumber = parseInt(url.match(/chapter-(\d+)/)[1]);

          if (result) {
            successCount++;
            writePromises.push(updateNovelScrapedChapters(novelSlug, successCount));
          } else {
            writePromises.push(failedTracker.addFailedChapter(chapterNumber, new Error('Scraping failed')));
          }
          progressManager.updateBar(successCount);
        }
        await Promise.all(writePromises);

        // Delay between chunks
        await delay(CHUNK_DELAY);
      } catch (error) {
        errorHandler(`Error processing chunk for ${novelSlug}:`, error);
        continue;
      }
    }

    // Check failed chapters di akhir
    const failedChapters = await failedTracker.getFailedChapters();
    if (failedChapters.length > 0) {
      await telegramNotifier.sendMessage(
        `Warning: ${failedChapters.length} chapters failed for ${novelSlug}\n` +
        `Failed chapters: ${failedChapters.map(f => f.chapter).join(', ')}`,
        'warning'
      );
    }

    console.log(`\nCompleted scraping chapters for ${novelSlug}`);
    console.log(`Final progress: ${successCount}/${novelData.total_chapters}`);
    progressManager.stop();

    await logMemoryUsage(`end_scraping_${novelSlug}`);

    // Stop monitoring
    resourceMonitor.stop();
  } catch (error) {
    errorHandler(`Error scraping chapters for ${novelSlug}:`, error);
    progressManager.stop();
    resourceMonitor.stop();
  }
}

module.exports = {
  scrapeChapter,
  scrapeNovelChapters,
  processChunkConcurrent
};
