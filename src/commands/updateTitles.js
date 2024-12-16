const fs = require('fs').promises;
const path = require('path');
const { DATA_DIR } = require('../config');

async function updateAllTitles() {
  try {
    const { titleCase } = await import('title-case');
    const novelsDir = path.join(DATA_DIR, 'data', 'novels');
    const novelSlugs = await fs.readdir(novelsDir);

    console.log('Starting to update titles...');

    for (const slug of novelSlugs) {
      const novelDir = path.join(novelsDir, slug);

      // Update novel_detail.json
      const detailPath = path.join(novelDir, 'novel_detail.json');
      try {
        const detailData = JSON.parse(await fs.readFile(detailPath, 'utf8'));
        detailData.title = titleCase(detailData.title);
        await fs.writeFile(detailPath, JSON.stringify(detailData, null, 2));
      } catch (error) {
        console.error(`Error updating novel_detail.json for ${slug}:`, error.message);
      }

      // Update chapter_lists.json
      const listPath = path.join(novelDir, 'chapter_lists.json');
      try {
        const listData = JSON.parse(await fs.readFile(listPath, 'utf8'));
        const updatedList = listData.map(chapter => ({
          ...chapter,
          title_chapter: titleCase(chapter.title_chapter)
        }));
        await fs.writeFile(listPath, JSON.stringify(updatedList, null, 2));
      } catch (error) {
        console.error(`Error updating chapter_lists.json for ${slug}:`, error.message);
      }

      // Update individual chapter files
      const chaptersDir = path.join(novelDir, 'chapters');
      try {
        const chapterFiles = await fs.readdir(chaptersDir);
        for (const file of chapterFiles) {
          if (!file.endsWith('.json')) continue;

          const chapterPath = path.join(chaptersDir, file);
          const chapterData = JSON.parse(await fs.readFile(chapterPath, 'utf8'));
          chapterData.chapter_title = titleCase(chapterData.chapter_title);
          await fs.writeFile(chapterPath, JSON.stringify(chapterData, null, 2));
        }
      } catch (error) {
        console.error(`Error updating chapters for ${slug}:`, error.message);
      }
    }

    console.log('Title update completed!');
  } catch (error) {
    console.error('Error updating titles:', error);
  }
}

if (require.main === module) {
  updateAllTitles();
}

module.exports = updateAllTitles;
