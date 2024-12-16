const fs = require('fs').promises;
const path = require('path');
const { DATA_DIR } = require('../config');
const { errorHandler } = require('../utils/errorHandler');
const progressManager = require('../utils/progressBar');
const { scrapeChapter } = require('../scrapers/chapterScraper');
const { CHUNK_DELAY, delay } = require('../config');

async function updateScrapedCount(novelSlug, actualCount) {
  try {
    const detailPath = path.join(DATA_DIR, 'data', 'novels', novelSlug, 'novel_detail.json');
    const detailData = JSON.parse(await fs.readFile(detailPath, 'utf8'));

    detailData.scraped_chapters = actualCount;
    detailData.last_updated = new Date().toISOString();

    await fs.writeFile(detailPath, JSON.stringify(detailData, null, 2));
    console.log(`Updated ${novelSlug} scraped_chapters to ${actualCount}`);
  } catch (error) {
    errorHandler(`Error updating scraped count for ${novelSlug}:`, error);
  }
}

async function findMissingChapters(files, totalChapters) {
  const chapterNumbers = files
    .filter(f => f.startsWith('chapter_') && f.endsWith('.json'))
    .map(f => parseInt(f.match(/chapter_(\d+)\.json/)[1]));

  const missing = [];
  for (let i = 1; i <= totalChapters; i++) {
    if (!chapterNumbers.includes(i)) {
      missing.push(i);
    }
  }
  return missing;
}

async function fixMissingChapters(novelSlug, missingChapters) {
  try {
    const detailPath = path.join(DATA_DIR, 'data', 'novels', novelSlug, 'novel_detail.json');
    const detailData = JSON.parse(await fs.readFile(detailPath, 'utf8'));

    console.log(`\nAttempting to fix ${missingChapters.length} missing chapters for ${novelSlug}`);
    progressManager.createBar('fix', missingChapters.length, 'chapter');

    let fixedCount = 0;
    let currentScrapedCount = detailData.scraped_chapters;

    for (const chapterNum of missingChapters) {
      try {
        const chapterUrl = `${detailData.url_source}/chapter-${chapterNum}`;
        const result = await scrapeChapter(chapterUrl, novelSlug);

        if (result && !result.skip) {
          fixedCount++;
          currentScrapedCount++;
          await updateScrapedCount(novelSlug, currentScrapedCount);
        }

        progressManager.updateBar(fixedCount);
        await delay(CHUNK_DELAY);
      } catch (error) {
        console.log(`Failed to fix chapter ${chapterNum}: ${error.message}`);
      }
    }

    progressManager.stop();

    console.log(`Fixed ${fixedCount}/${missingChapters.length} chapters for ${novelSlug}`);
  } catch (error) {
    errorHandler(`Error fixing chapters for ${novelSlug}:`, error);
  }
}

async function verifyData() {
  try {
    console.log('Starting data verification...');

    // Load novels list
    const novelsListPath = path.join(DATA_DIR, 'data', 'novels_list.json');
    const novelsList = JSON.parse(await fs.readFile(novelsListPath, 'utf8'));

    progressManager.createBar('verify', novelsList.novels.length, 'novel');
    let processedCount = 0;
    const issues = [];

    for (const novel of novelsList.novels) {
      const novelSlug = novel.url.match(/serie-\d+/)[0];
      const novelDir = path.join(DATA_DIR, 'data', 'novels', novelSlug);

      try {
        // Check novel_detail.json
        const detailPath = path.join(novelDir, 'novel_detail.json');
        const chapterListPath = path.join(novelDir, 'chapter_lists.json');
        const chaptersDir = path.join(novelDir, 'chapters');

        try {
          const detailData = JSON.parse(await fs.readFile(detailPath, 'utf8'));
          const chapterList = JSON.parse(await fs.readFile(chapterListPath, 'utf8'));

          // Verify chapter files vs scraped_chapters count
          const files = await fs.readdir(chaptersDir);
          const chapterFiles = files.filter(f => f.startsWith('chapter_') && f.endsWith('.json'));
          const actualChapterCount = chapterFiles.length;

          if (detailData.scraped_chapters !== actualChapterCount) {
            // Fix scraped count mismatch
            await updateScrapedCount(novelSlug, actualChapterCount);

            issues.push({
              novelSlug,
              type: 'chapter_count_mismatch',
              detail: `Fixed: Updated from ${detailData.scraped_chapters} to ${actualChapterCount}`,
              fix: 'fixed'
            });
          }

          // Check for missing chapters in sequence
          const missingChapters = await findMissingChapters(files, detailData.total_chapters);
          if (missingChapters.length > 0) {
            console.log(`Found ${missingChapters.length} missing chapters in ${novelSlug}`);
            await fixMissingChapters(novelSlug, missingChapters);

            issues.push({
              novelSlug,
              type: 'missing_chapters',
              detail: `Missing chapters: ${missingChapters.join(', ')}`,
              fix: 'attempted_fix'
            });
          }

          // Verify chapter_lists.json exists and has content
          if (!chapterList || chapterList.length === 0) {
            issues.push({
              novelSlug,
              type: 'empty_chapter_list',
              detail: 'Chapter list is empty or invalid',
              fix: 'rescrape_details'
            });
          }

          // Verify title_case in chapter titles
          const hasInvalidTitles = chapterList.some(ch =>
            ch.title_chapter &&
            ch.title_chapter === ch.title_chapter.toUpperCase()
          );

          if (hasInvalidTitles) {
            issues.push({
              novelSlug,
              type: 'invalid_title_case',
              detail: 'Some chapter titles need title case conversion',
              fix: 'update_title_case'
            });
          }

        } catch (error) {
          issues.push({
            novelSlug,
            type: 'file_error',
            detail: error.message,
            fix: 'check_files'
          });
        }

      } catch (error) {
        issues.push({
          novelSlug,
          type: 'directory_error',
          detail: error.message,
          fix: 'check_directory'
        });
      }

      processedCount++;
      progressManager.updateBar(processedCount);
    }

    progressManager.stop();

    // Report findings
    console.log('\n=== Data Verification Report ===');
    console.log(`Total novels checked: ${novelsList.novels.length}`);
    console.log(`Issues found: ${issues.length}`);

    if (issues.length > 0) {
      console.log('\nIssues by type:');
      const byType = issues.reduce((acc, issue) => {
        acc[issue.type] = (acc[issue.type] || 0) + 1;
        return acc;
      }, {});

      Object.entries(byType).forEach(([type, count]) => {
        console.log(`- ${type}: ${count}`);
      });

      console.log('\nDetailed issues:');
      issues.forEach(issue => {
        console.log(`\n${issue.novelSlug}:`);
        console.log(`  Type: ${issue.type}`);
        console.log(`  Detail: ${issue.detail}`);
        console.log(`  Fix: ${issue.fix}`);
      });
    }

  } catch (error) {
    errorHandler('Error verifying data:', error);
  }
}

if (require.main === module) {
  verifyData();
}

module.exports = verifyData;
