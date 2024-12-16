const benchmarkConcurrency = require('../utils/benchmarkConcurrency');

async function runBenchmark() {
  try {
    // Pilih novel dengan chapter yang cukup untuk sample
    const novelSlug = 'serie-7168';
    const optimalConcurrency = await benchmarkConcurrency(novelSlug);

    console.log(`\nYou should set CONCURRENT_LIMIT to ${optimalConcurrency} in config.js`);
  } catch (error) {
    console.error('Benchmark failed:', error);
  }
}

if (require.main === module) {
  runBenchmark();
}
