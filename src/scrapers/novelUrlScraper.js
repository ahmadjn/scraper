const axiosInstance = require('../utils/axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const { BASE_URL, NOVEL_LIST_URL, DATA_DIR } = require('../config');
const { CONCURRENT_LIMIT, CHUNK_DELAY, delay } = require('../config');
const { errorHandler } = require('../utils/errorHandler');
const progressManager = require('../utils/progressBar');
const statsCollector = require('../utils/statsCollector');

const DATA_DIR_PATH = path.join(DATA_DIR, 'data');
const NOVELS_FILE = path.join(DATA_DIR_PATH, 'novels_list.json');

// Helper untuk membagi array ke chunks
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR_PATH);
  } catch {
    await fs.mkdir(DATA_DIR_PATH, { recursive: true });
  }
}

async function loadExistingData() {
  try {
    await ensureDataDir();
    const data = await fs.readFile(NOVELS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { novels: [], total: 0 };
  }
}

async function getNovelUrlsFromPage(page) {
  try {
    const response = await axiosInstance.get(`${NOVEL_LIST_URL}?orderBy=reader&page=${page}`);
    const $ = cheerio.load(response.data);

    const novels = [];
    $('.serie-item').each((_, element) => {
      const $element = $(element);
      const titleElement = $element.find('.title');

      // Get status from first detail-item
      const status = $element.find('.detail-item span').first().text().trim().toLowerCase();

      // Get chapter count
      const chapterCount = $element.find('.detail-item span').eq(1).text().replace(' Chapters', '');

      const novel = {
        url: `${BASE_URL}${titleElement.attr('href')}`,
        totalChapters: parseInt(chapterCount) || 0,
        status: status || 'unknown',
        updated: true
      };

      novels.push(novel);
    });

    return novels;
  } catch (error) {
    errorHandler(`Error fetching page ${page}:`, error);
    return [];
  }
}

async function checkNovelScrapingStatus(novelSlug, totalChapters) {
  try {
    const novelDetailPath = path.join(DATA_DIR, 'data', 'novels', novelSlug, 'novel_detail.json');

    // Check if novel_detail.json exists
    try {
      await fs.access(novelDetailPath);
    } catch {
      // File tidak ada, perlu di scrape
      return true;
    }

    // Baca novel_detail.json
    const novelDetail = JSON.parse(await fs.readFile(novelDetailPath, 'utf8'));

    // Cek apakah semua chapter sudah di scrape
    return novelDetail.scraped_chapters !== totalChapters;
  } catch (error) {
    errorHandler('Error checking novel scraping status:', error);
    // Jika ada error, set true untuk safety
    return true;
  }
}

async function getAllNovelUrls() {
  try {
    const startTime = Date.now();
    const existingData = await loadExistingData();
    const isFirstScrape = existingData.novels.length === 0;
    const allNovels = existingData.novels;
    let emptyPagesCount = 0;

    // Setup progress bar
    progressManager.createBar('urls', 10000, 'url');
    let processedPages = 0;

    // Process pages in chunks
    const chunks = chunkArray(Array.from({ length: 10000 }, (_, i) => i + 1), CONCURRENT_LIMIT);

    for (const chunk of chunks) {
      // Process chunk concurrently
      const promises = chunk.map(page => getNovelUrlsFromPage(page));
      const results = await Promise.all(promises);

      // Update progress
      processedPages += chunk.length;
      progressManager.updateBar(processedPages);

      // Check if chunk is empty
      const hasData = results.some(novels => novels && novels.length > 0);
      if (!hasData) {
        emptyPagesCount += chunk.length;
        if (emptyPagesCount >= 100) {
          console.log('\nNo more novels found after 100 empty pages, stopping...');
          break;
        }
      } else {
        emptyPagesCount = 0;
      }

      // Process results
      for (const novels of results) {
        if (novels && novels.length > 0) {
          // Track successful page scrape
          await statsCollector.updateStats('url_success', {
            count: novels.length,
            time: Date.now() - startTime
          });

          for (const newNovel of novels) {
            const existingNovelIndex = allNovels.findIndex(n => n.url === newNovel.url);

            if (existingNovelIndex === -1) {
              allNovels.push({
                ...newNovel,
                updated: true
              });
            } else {
              const existingNovel = allNovels[existingNovelIndex];
              const chaptersChanged = existingNovel.totalChapters !== newNovel.totalChapters;

              // Extract novelSlug from URL
              const novelSlug = newNovel.url.match(/serie-\d+/)[0];

              // Check if novel needs updating
              const needsUpdate = chaptersChanged ||
                await checkNovelScrapingStatus(novelSlug, newNovel.totalChapters);

              allNovels[existingNovelIndex] = {
                ...existingNovel,
                totalChapters: newNovel.totalChapters,
                status: newNovel.status,
                updated: isFirstScrape ? true : needsUpdate
              };
            }
          }
        }
      }

      // Save progress after each chunk
      await fs.writeFile(
        NOVELS_FILE,
        JSON.stringify({
          total: allNovels.length,
          novels: allNovels,
          lastUpdated: new Date().toISOString(),
          lastProcessedPage: processedPages
        }, null, 2)
      );

      await delay(CHUNK_DELAY);
    }

    progressManager.stop();
    return allNovels;
  } catch (error) {
    errorHandler('Error getting all novel URLs:', error);
    progressManager.stop();
    return [];
  }
}

module.exports = {
  getAllNovelUrls
};
