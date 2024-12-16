const fs = require('fs').promises;
const path = require('path');
const { DATA_DIR } = require('../config');

class StatsCollector {
  constructor() {
    this.statsPath = path.join(DATA_DIR, 'data', 'stats.json');
    this.currentSession = {
      startTime: new Date().toISOString(),
      endTime: null,
      totalNovels: 0,
      scrapedUrls: 0,
      scrapedDetails: 0,
      totalChapters: 0,
      successfulChapters: 0,
      failedChapters: 0,
      averageTimePerChapter: 0,
      averageTimePerDetail: 0,
      resourceUsage: {
        maxCpu: 0,
        maxMemory: 0,
        averageCpu: 0,
        averageMemory: 0
      },
      errors: []
    };
  }

  async updateStats(type, data) {
    try {
      switch (type) {
        case 'novel_count':
          this.currentSession.totalNovels = data;
          break;
        case 'chapter_success':
          this.currentSession.successfulChapters++;
          this.updateAverageTime(data.time);
          break;
        case 'chapter_fail':
          this.currentSession.failedChapters++;
          this.currentSession.errors.push({
            timestamp: new Date().toISOString(),
            error: data.error,
            context: data.context
          });
          break;
        case 'resource_usage':
          this.updateResourceStats(data);
          break;
        case 'url_success':
          this.currentSession.scrapedUrls += data.count;
          break;
        case 'detail_success':
          this.currentSession.scrapedDetails++;
          this.updateAverageDetailTime(data.time);
          break;
      }

      await this.saveStats();
    } catch (error) {
      console.error('Error updating stats:', error);
    }
  }

  updateAverageTime(time) {
    const total = this.currentSession.successfulChapters;
    const currentAvg = this.currentSession.averageTimePerChapter;
    this.currentSession.averageTimePerChapter =
      (currentAvg * (total - 1) + time) / total;
  }

  updateResourceStats(metrics) {
    const { cpu, memory } = metrics;
    this.currentSession.resourceUsage.maxCpu =
      Math.max(this.currentSession.resourceUsage.maxCpu, cpu);
    this.currentSession.resourceUsage.maxMemory =
      Math.max(this.currentSession.resourceUsage.maxMemory, memory);

    // Update running averages
    const count = this.currentSession.resourceUsage.count || 0;
    this.currentSession.resourceUsage.averageCpu =
      (this.currentSession.resourceUsage.averageCpu * count + cpu) / (count + 1);
    this.currentSession.resourceUsage.averageMemory =
      (this.currentSession.resourceUsage.averageMemory * count + memory) / (count + 1);
    this.currentSession.resourceUsage.count = count + 1;
  }

  updateAverageDetailTime(time) {
    const total = this.currentSession.scrapedDetails;
    const currentAvg = this.currentSession.averageTimePerDetail;
    this.currentSession.averageTimePerDetail =
      (currentAvg * (total - 1) + time) / total;
  }

  async saveStats() {
    try {
      let allStats = [];
      try {
        const data = await fs.readFile(this.statsPath, 'utf8');
        allStats = JSON.parse(data);
      } catch {
        // File doesn't exist yet
      }

      // Update current session
      this.currentSession.endTime = new Date().toISOString();

      // Keep last 10 sessions
      allStats = [this.currentSession, ...allStats].slice(0, 10);

      await fs.writeFile(this.statsPath, JSON.stringify(allStats, null, 2));
    } catch (error) {
      console.error('Error saving stats:', error);
    }
  }

  async getStats() {
    try {
      const data = await fs.readFile(this.statsPath, 'utf8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  async generateReport() {
    const stats = await this.getStats();
    if (stats.length === 0) return 'No statistics available';

    const current = stats[0];
    const duration = new Date(current.endTime) - new Date(current.startTime);
    const durationHours = duration / (1000 * 60 * 60);

    return `
📊 Scraping Session Report

⏱️ Duration: ${durationHours.toFixed(2)} hours

URLs & Details:
  📚 Total Novels Found: ${current.totalNovels}
  🔍 URLs Scraped: ${current.scrapedUrls}
  📖 Details Scraped: ${current.scrapedDetails}
  ⚡ Avg Time/Detail: ${current.averageTimePerDetail.toFixed(2)}ms

Chapters:
  📝 Total Chapters: ${current.totalChapters}
  ✅ Successfully Scraped: ${current.successfulChapters}
  ❌ Failed: ${current.failedChapters}
  📈 Success Rate: ${((current.successfulChapters / (current.successfulChapters + current.failedChapters)) * 100).toFixed(2)}%
  ⚡ Avg Time/Chapter: ${current.averageTimePerChapter.toFixed(2)}ms

Resource Usage:
  🖥️ CPU:
    Peak: ${current.resourceUsage.maxCpu}%
    Average: ${current.resourceUsage.averageCpu.toFixed(2)}%
  💾 Memory:
    Peak: ${current.resourceUsage.maxMemory}%
    Average: ${current.resourceUsage.averageMemory.toFixed(2)}%

${current.errors.length > 0 ? `\n⚠️ Last 5 Errors:
${current.errors.slice(-5).map(e => `- ${e.error} (${e.context})`).join('\n')}` : ''}

🔄 Process completed at: ${new Date(current.endTime).toLocaleString()}
    `.trim();
  }
}

const statsCollector = new StatsCollector();
module.exports = statsCollector;
