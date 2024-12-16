const fs = require('fs').promises;
const path = require('path');
const { scrapeChapter } = require('../scrapers/chapterScraper');
const { delay } = require('../config');

async function benchmarkConcurrency(novelSlug, sampleSize = 20) {
  // Load novel details untuk testing
  const novelDetailPath = path.join(process.cwd(), 'data', 'novels', novelSlug, 'novel_detail.json');
  const novelData = JSON.parse(await fs.readFile(novelDetailPath, 'utf8'));

  // Generate sample URLs
  const baseUrl = novelData.url_source;
  const sampleUrls = Array.from({ length: sampleSize }, (_, i) =>
    `${baseUrl}/chapter-${i + 1}`
  );

  // Test berbagai level concurrency
  const concurrencyLevels = [1, 3, 5, 8, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
  const results = [];

  for (const concurrency of concurrencyLevels) {
    console.log(`\nTesting concurrency level: ${concurrency}`);

    const startTime = Date.now();
    const chunks = [];

    // Bagi URLs ke chunks
    for (let i = 0; i < sampleUrls.length; i += concurrency) {
      chunks.push(sampleUrls.slice(i, i + concurrency));
    }

    let successCount = 0;
    let errorCount = 0;
    let totalTime = 0;

    // Process each chunk
    for (const chunk of chunks) {
      const chunkStart = Date.now();

      try {
        const promises = chunk.map(url => scrapeChapter(url, novelSlug));
        const results = await Promise.all(promises);

        successCount += results.filter(Boolean).length;
        errorCount += results.filter(r => !r).length;
      } catch (error) {
        errorCount += chunk.length;
      }

      totalTime += Date.now() - chunkStart;
      await delay(2000); // Delay antar chunk
    }

    const avgTimePerRequest = totalTime / sampleSize;
    const totalElapsed = Date.now() - startTime;

    results.push({
      concurrency,
      totalTime: totalElapsed,
      avgTimePerRequest,
      successRate: (successCount / sampleSize) * 100,
      errorRate: (errorCount / sampleSize) * 100
    });

    console.log(`Results for concurrency ${concurrency}:`);
    console.log(`- Average time per request: ${avgTimePerRequest.toFixed(2)}ms`);
    console.log(`- Success rate: ${((successCount / sampleSize) * 100).toFixed(2)}%`);
    console.log(`- Total time: ${totalElapsed}ms`);
  }

  // Find optimal concurrency
  const optimal = results.reduce((best, current) => {
    const score = (current.successRate - current.errorRate) / current.avgTimePerRequest;
    const bestScore = (best.successRate - best.errorRate) / best.avgTimePerRequest;
    return score > bestScore ? current : best;
  });

  console.log('\nBenchmark Summary:');
  console.table(results);
  console.log(`\nRecommended concurrency: ${optimal.concurrency}`);
  console.log(`- Best balance of speed and reliability`);
  console.log(`- Success rate: ${optimal.successRate.toFixed(2)}%`);
  console.log(`- Average time per request: ${optimal.avgTimePerRequest.toFixed(2)}ms`);

  return optimal.concurrency;
}

// Export untuk digunakan
module.exports = benchmarkConcurrency;
