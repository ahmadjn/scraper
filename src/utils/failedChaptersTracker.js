const fs = require('fs').promises;
const path = require('path');
const { DATA_DIR } = require('../config');

class FailedChaptersTracker {
  constructor(novelSlug) {
    this.novelSlug = novelSlug;
    this.failedPath = path.join(DATA_DIR, 'data', 'novels', novelSlug, 'failed_chapters.json');
  }

  async addFailedChapter(chapterNumber, error) {
    try {
      let failedChapters = [];
      try {
        failedChapters = JSON.parse(await fs.readFile(this.failedPath, 'utf8'));
      } catch {
        // File belum ada, mulai dengan array kosong
      }

      failedChapters.push({
        chapter: chapterNumber,
        error: error.message,
        timestamp: new Date().toISOString()
      });

      await fs.writeFile(this.failedPath, JSON.stringify(failedChapters, null, 2));
    } catch (error) {
      console.error('Error tracking failed chapter:', error);
    }
  }

  async getFailedChapters() {
    try {
      return JSON.parse(await fs.readFile(this.failedPath, 'utf8'));
    } catch {
      return [];
    }
  }

  async clearFailedChapters() {
    try {
      await fs.writeFile(this.failedPath, JSON.stringify([], null, 2));
    } catch (error) {
      console.error('Error clearing failed chapters:', error);
    }
  }
}

module.exports = FailedChaptersTracker;
