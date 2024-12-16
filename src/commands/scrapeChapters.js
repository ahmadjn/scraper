const fs = require('fs').promises;
const path = require('path');
const { DATA_DIR } = require('../config');
const { scrapeChapter, processChunkConcurrent } = require('../scrapers/chapterScraper');
const { errorHandler } = require('../utils/errorHandler');
const { logMemoryUsage } = require('../utils/memoryMonitor');
const telegramNotifier = require('../utils/telegramNotifier');
const progressManager = require('../utils/progressBar');
const { CONCURRENT_LIMIT, CHUNK_DELAY, delay } = require('../config');

// Helper untuk membagi array ke chunks
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Lock untuk mencegah race condition
const fileLocks = new Map();

async function acquireLock(filePath) {
  while (fileLocks.get(filePath)) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  fileLocks.set(filePath, true);
}

async function releaseLock(filePath) {
  fileLocks.delete(filePath);
}

async function updateNovelScrapedChapters(novelSlug, count) {
  try {
    const novelDetailPath = path.join(DATA_DIR, 'data', 'novels', novelSlug, 'novel_detail.json');
    // Acquire lock before file operation
    await acquireLock(novelDetailPath);

    // Read file with error handling
    let novelData;
    try {
      const fileContent = await fs.readFile(novelDetailPath, 'utf8');
      try {
        novelData = JSON.parse(fileContent);
      } catch (parseError) {
        errorHandler(`Invalid JSON in novel detail file for ${novelSlug}:`, parseError);
        releaseLock(novelDetailPath);
        return;
      }
    } catch (readError) {
      errorHandler(`Error reading novel detail file for ${novelSlug}:`, readError);
      releaseLock(novelDetailPath);
      return;
    }

    // Update data
    const updatedData = {
      ...novelData,
      scraped_chapters: count,
      last_updated: new Date().toISOString()
    };

    // Write file with error handling
    try {
      const jsonString = JSON.stringify(updatedData, null, 2);
      await fs.writeFile(novelDetailPath, jsonString, 'utf8');
    } catch (writeError) {
      errorHandler(`Error writing novel detail file for ${novelSlug}:`, writeError);
      releaseLock(novelDetailPath);
      return;
    }

    // Release lock after successful operation
    releaseLock(novelDetailPath);
  } catch (error) {
    errorHandler(`Error updating scraped chapters for ${novelSlug}:`, error);
    releaseLock(novelDetailPath);
    return;
  }
}

async function checkNovelDetailExists(novelSlug) {
  try {
    const novelDetailPath = path.join(process.cwd(), 'data', 'novels', novelSlug, 'novel_detail.json');
    await fs.access(novelDetailPath);
    return true;
  } catch {
    return false;
  }
}

async function scrapeNovelChapters(novelSlug) {
  try {
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

    // Generate chapter URLs for remaining chapters
    const baseUrl = novelData.url_source;
    const chapterUrls = [];
    for (let i = novelData.scraped_chapters + 1; i <= novelData.total_chapters; i++) {
      chapterUrls.push(`${baseUrl}/chapter-${i}`);
    }

    console.log(`Starting to scrape ${chapterUrls.length} remaining chapters for ${novelSlug}`);
    progressManager.createBar(novelSlug, novelData.total_chapters, 'chapter');
    progressManager.updateBar(novelData.scraped_chapters);

    let successCount = novelData.scraped_chapters;
    const chunks = chunkArray(chapterUrls, CONCURRENT_LIMIT);

    for (const chunk of chunks) {
      try {
        const results = await processChunkConcurrent(chunk, novelSlug);

        // Check if we need to skip this novel (due to parsing error or skip flag)
        const hasParsingError = results.some(r =>
          r?.error?.message?.includes('Cannot read properties of undefined')
        );
        const hasSkipFlag = results.some(r => r?.skip);

        if (hasParsingError || hasSkipFlag) {
          console.log(`\nSkipping ${novelSlug} due to parsing issues`);
          break;
        }

        // Process results
        const writePromises = [];
        for (let i = 0; i < chunk.length; i++) {
          const result = results[i];
          // Only process valid results (not null and not skip)
          if (result && !result.skip) {
            successCount++;
            writePromises.push(updateNovelScrapedChapters(novelSlug, successCount));
          }
          progressManager.updateBar(successCount);
        }
        await Promise.all(writePromises);

        await delay(CHUNK_DELAY);
      } catch (error) {
        // Only log to console, don't send to telegram
        console.error(`Error processing chunk for ${novelSlug}:`, error.message);
        continue;
      }
    }

    console.log(`\nCompleted scraping chapters for ${novelSlug}`);
    console.log(`Final progress: ${successCount}/${novelData.total_chapters}`);
    progressManager.stop();

    await logMemoryUsage(`end_scraping_${novelSlug}`);
  } catch (error) {
    // Only log to console, don't send to telegram
    console.error(`Error scraping chapters for ${novelSlug}:`, error.message);
    progressManager.stop();
  }
}

async function scrapeAllNovelsChapters() {
  try {
    console.log('\nStarting chapter scraping...\n');
    // Baca novels_list.json untuk mendapatkan urutan novel
    const novelsListPath = path.join(process.cwd(), 'data', 'novels_list.json');
    const novelsList = JSON.parse(await fs.readFile(novelsListPath, 'utf8'));

    // Array untuk menyimpan novel yang sudah lengkap
    const completedNovels = [];

    // Proses setiap novel sesuai urutan di novels_list.json
    for (const novel of novelsList.novels) {
      const novelSlug = novel.url.match(/serie-\d+/)[0];
      console.log(`Processing ${novelSlug} from novels_list.json`);

      // Check if novel_detail.json exists
      const hasNovelDetail = await checkNovelDetailExists(novelSlug);
      if (!hasNovelDetail) {
        console.log(`Skipping ${novelSlug}: novel_detail.json not found`);
        continue;
      }

      // Load novel details untuk cek status
      const novelDetailPath = path.join(process.cwd(), 'data', 'novels', novelSlug, 'novel_detail.json');
      const novelDetail = JSON.parse(await fs.readFile(novelDetailPath, 'utf8'));

      if (novelDetail.scraped_chapters === novelDetail.total_chapters) {
        completedNovels.push({
          slug: novelSlug,
          title: novelDetail.title,
          chapters: `${novelDetail.scraped_chapters}/${novelDetail.total_chapters}`
        });
        console.log(`Skipping ${novelSlug}: All chapters already scraped`);
        continue;
      }

      await scrapeNovelChapters(novelSlug);
    }

    // Tampilkan ringkasan novel yang sudah lengkap
    if (completedNovels.length > 0) {
      // Calculate total chapters
      const totalChapters = completedNovels.reduce((sum, n) => {
        const [scraped, total] = n.chapters.split('/').map(Number);
        return sum + scraped;
      }, 0);

      console.log('\n=== Chapter Scraping Summary ===');
      const summary = [
        '📖 Chapter Scraping Summary:',
        `Total novels processed: ${novelsList.novels.length}`,
        `Completed novels: ${completedNovels.length}`,
        `Skipped novels: ${novelsList.novels.length - completedNovels.length}`,
        '',
        `Total chapters scraped: ${totalChapters}`,
        `Average chapters per novel: ${Math.round(totalChapters / completedNovels.length)}`,
        '',
        'Completed Novels:',
        ...completedNovels.map(n => {
          const [scraped, total] = n.chapters.split('/').map(Number);
          const percent = ((scraped / total) * 100).toFixed(1);
          return `- ${n.title} (${n.slug}): ${n.chapters} (${percent}%)`;
        })
      ].join('\n');

      console.log(summary);
      await telegramNotifier.sendMessage(summary, 'info');
    }

    progressManager.stop();
  } catch (error) {
    console.error('Error scraping all novels chapters:', error);
    progressManager.stop();
  }
}

if (require.main === module) {
  scrapeAllNovelsChapters();
}

module.exports = {
  scrapeNovelChapters,
  scrapeAllNovelsChapters
};
