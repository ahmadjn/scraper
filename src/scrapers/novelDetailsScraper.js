const axiosInstance = require('../utils/axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const { DATA_DIR, CONCURRENT_LIMIT, CHUNK_DELAY, delay } = require('../config');
const { errorHandler } = require('../utils/errorHandler');
const statsCollector = require('../utils/statsCollector');
const progressManager = require('../utils/progressBar');

const NOVELS_DIR = path.join(DATA_DIR, 'data', 'novels');
const NOVELS_LIST_FILE = path.join(DATA_DIR, 'data', 'novels_list.json');

// Helper untuk membagi array ke chunks
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function ensureNovelDir(slug) {
  const novelDir = path.join(NOVELS_DIR, slug);
  try {
    await fs.access(novelDir);
  } catch {
    await fs.mkdir(novelDir, { recursive: true });
  }
  return novelDir;
}

function getSlugFromUrl(url) {
  const matches = url.match(/\/serie-(\d+)\//);
  return matches ? `serie-${matches[1]}` : '';
}

function convertDateToISOString(dateStr) {
  try {
    // Format input: "December 4, 2024"
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return new Date().toISOString(); // Fallback ke waktu sekarang jika parsing gagal
    }
    return date.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

async function getLastScrapedChapter(novelDir) {
  try {
    const chaptersDir = path.join(novelDir, 'chapters');
    const files = await fs.readdir(chaptersDir);

    // Filter hanya file chapter_*.json dan ambil nomor chapter tertinggi
    const chapterNumbers = files
      .filter(f => f.startsWith('chapter_') && f.endsWith('.json'))
      .map(f => parseInt(f.match(/chapter_(\d+)\.json/)[1]));

    return Math.max(...chapterNumbers) || 0;
  } catch {
    return 0;
  }
}

async function updateNovelDetails(novelSlug, totalChapters) {
  try {
    const novelDir = path.join(NOVELS_DIR, novelSlug);
    const detailPath = path.join(novelDir, 'novel_detail.json');

    // Baca file detail yang ada
    const detailData = JSON.parse(await fs.readFile(detailPath, 'utf8'));

    // Dapatkan jumlah chapter yang sudah di-scrape
    const lastScrapedChapter = await getLastScrapedChapter(novelDir);

    // Update data
    detailData.total_chapters = totalChapters;
    detailData.scraped_chapters = lastScrapedChapter;
    detailData.last_updated = new Date().toISOString();

    // Simpan kembali
    await fs.writeFile(detailPath, JSON.stringify(detailData, null, 2));

    return true;
  } catch (error) {
    errorHandler(`Error updating novel details for ${novelSlug}:`, error);
    return false;
  }
}

async function shouldScrapeNovel(novelUrl) {
  try {
    // Baca novels_list.json
    const novelsList = JSON.parse(await fs.readFile(NOVELS_LIST_FILE, 'utf8'));
    const novel = novelsList.novels.find(n => n.url === novelUrl);

    if (!novel) {
      return false;
    }

    if (!novel.updated) {
      return false;
    }

    const novelSlug = getSlugFromUrl(novelUrl);
    const detailPath = path.join(NOVELS_DIR, novelSlug, 'novel_detail.json');
    const chapterListPath = path.join(NOVELS_DIR, novelSlug, 'chapter_lists.json');

    // Quick check if both files exist
    try {
      await Promise.all([
        fs.access(detailPath),
        fs.access(chapterListPath)
      ]);
      return false; // Skip if both files exist
    } catch {
      return true; // Scrape if any file missing
    }

  } catch (error) {
    errorHandler('Error checking novel status:', error);
    return false;
  }
}

async function getExistingChapterCount(novelSlug) {
  try {
    const chaptersDir = path.join(NOVELS_DIR, novelSlug, 'chapters');
    const files = await fs.readdir(chaptersDir);
    return files.filter(f => f.startsWith('chapter_') && f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

async function scrapeNovelDetails(novelUrl) {
  try {
    const startTime = Date.now();
    const response = await axiosInstance.get(novelUrl);
    const $ = cheerio.load(response.data);

    // Get script content first to fail fast
    const scriptContent = $('#__NEXT_DATA__').html();
    if (!scriptContent) {
      return null;
    }

    let jsonData;
    try {
      jsonData = JSON.parse(scriptContent);
    } catch {
      return null;
    }

    const { titleCase } = await import('title-case');

    // Extract chapter lists early
    const chapters = jsonData.props.pageProps.serie.chapters || [];
    if (!chapters.length) {
      return null;
    }

    // Check if login required
    const loginAlert = $('.alert-warning').text();
    if (loginAlert.includes('You need to login')) {
      return null;
    }

    // Get basic info
    const title = $('h1').text().trim();
    const originalTitle = $('h1').next('h3').text().trim();
    const status = $('.detail-item span').first().text().trim();
    const totalChapters = parseInt($('.detail-item span').eq(1).text().replace(' Chapters', '')) || 0;
    const summary = $('.lead').text().trim();
    const imageUrl = $('.img-wrap img').attr('src') || '';

    // Get author(s)
    const authors = [];
    $('.custom-table tr').each((_, row) => {
      const label = $(row).find('td').first().text().trim();
      if (label === 'Author') {
        $(row).find('td').last().find('a').each((_, authorLink) => {
          authors.push($(authorLink).text().trim());
        });
      }
    });

    // Get genres
    let genres = [];
    $('.custom-table tr').each((_, row) => {
      const label = $(row).find('td').first().text().trim();
      if (label === 'Genre') {
        genres = $(row).find('.genre').map((_, el) => $(el).text().replace(',', '').trim()).get();
      }
    });
    if (genres.length === 0) genres = ['Fantasy'];

    // Get tags
    let tags = [];
    $('.custom-table tr').each((_, row) => {
      const label = $(row).find('td').first().text().trim();
      if (label === 'Tags') {
        tags = $(row).find('.tag').map((_, el) => $(el).text().replace(',', '').trim().toLowerCase()).get();
      }
    });
    if (tags.length === 0) tags = ['fantasy'];

    // Get addition date
    let additionDate = new Date().toISOString(); // default value
    $('.custom-table tr').each((_, row) => {
      const label = $(row).find('td').first().text().trim();
      if (label === 'Addition Date') {
        const dateStr = $(row).find('td').last().text().trim();
        additionDate = convertDateToISOString(dateStr);
      }
    });

    const slug = getSlugFromUrl(novelUrl);
    const chapterList = chapters.map(chapter => ({
      chapter_number: chapter.order,
      title_chapter: titleCase(chapter.title)
    })).sort((a, b) => a.chapter_number - b.chapter_number);

    const novelData = {
      slug,
      title: titleCase(title),
      original_title: originalTitle,
      status: status.toLowerCase(),
      total_chapters: totalChapters,
      scraped_chapters: await getExistingChapterCount(slug),
      summary,
      author: authors.join(', '),
      genre: genres,
      tags,
      addition_date: additionDate,
      image_url: imageUrl,
      url_source: novelUrl,
      last_updated: new Date().toISOString()
    };

    // Save to file
    const novelDir = await ensureNovelDir(slug);
    const filePath = path.join(novelDir, 'novel_detail.json');
    const chapterListPath = path.join(novelDir, 'chapter_lists.json');

    // Ensure we have chapter list data
    if (!chapterList || chapterList.length === 0) {
      errorHandler(`No chapter list data for ${novelUrl}`);
      return null;
    }

    // Save files sequentially to avoid race condition
    try {
      await fs.writeFile(filePath, JSON.stringify(novelData, null, 2));
      await fs.writeFile(chapterListPath, JSON.stringify(chapterList, null, 2));

      // Double check after save to ensure accuracy
      const actualCount = await getExistingChapterCount(slug);
      if (actualCount !== novelData.scraped_chapters) {
        novelData.scraped_chapters = actualCount;
        await fs.writeFile(filePath, JSON.stringify(novelData, null, 2));
      }
    } catch (error) {
      errorHandler(`Error saving files for ${novelUrl}:`, error);
      return null;
    }

    // Track successful detail scrape
    await statsCollector.updateStats('detail_success', {
      novelSlug: slug,
      totalChapters: totalChapters,
      time: Date.now() - startTime
    });

    return novelData;
  } catch (error) {
    errorHandler(`Error scraping novel details for ${novelUrl}:`, error);
    // Track failed detail scrape
    await statsCollector.updateStats('detail_fail', {
      error: error.message,
      context: novelUrl
    });
    return null;
  }
}

async function scrapeDetailsInParallel(novels) {
  try {
    // Use 1/5 of CONCURRENT_LIMIT for details scraping
    const detailsConcurrency = Math.max(1, Math.floor(CONCURRENT_LIMIT / 5));
    console.log(`Using concurrency: ${detailsConcurrency} (1/5 of ${CONCURRENT_LIMIT})`);
    const chunks = chunkArray(novels, detailsConcurrency);
    let allDetails = [];
    let processedCount = 0;

    // Setup progress bar
    progressManager.createBar('details', novels.length, 'detail');

    for (const chunk of chunks) {
      // Process chunk concurrently
      const promises = chunk.map(novel => scrapeNovelDetails(novel.url));
      const results = await Promise.all(promises);

      // Update progress
      processedCount += chunk.length;
      progressManager.updateBar(processedCount);

      // Add successful results
      allDetails = allDetails.concat(results.filter(Boolean));

      // Delay between chunks
      await delay(CHUNK_DELAY * 2); // Double delay for safety
    }

    progressManager.stop();
    return allDetails;
  } catch (error) {
    errorHandler('Error in parallel details scraping:', error);
    progressManager.stop();
    return [];
  }
}

module.exports = {
  scrapeNovelDetails,
  getSlugFromUrl,
  scrapeDetailsInParallel
};
