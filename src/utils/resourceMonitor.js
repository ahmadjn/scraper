const os = require('os');
const { errorHandler } = require('./errorHandler');
const telegramNotifier = require('./telegramNotifier');
const logManager = require('./logManager');

class ResourceMonitor {
  constructor(options = {}) {
    this.options = {
      cpuThreshold: 80, // CPU warning threshold (%)
      memoryThreshold: 80, // Memory warning threshold (%)
      interval: 30000, // Check every 30 seconds
      ...options
    };

    this.metrics = {
      cpu: [],
      memory: [],
      timestamp: []
    };

    this.isMonitoring = false;
  }

  async getSystemMetrics() {
    try {
      // CPU Usage
      const cpus = os.cpus();
      const cpuUsage = cpus.reduce((acc, cpu) => {
        const total = Object.values(cpu.times).reduce((a, b) => a + b);
        const idle = cpu.times.idle;
        return acc + ((total - idle) / total) * 100;
      }, 0) / cpus.length;

      // Memory Usage
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memoryUsage = (usedMem / totalMem) * 100;

      // Process specific metrics
      const processMemory = process.memoryUsage();

      return {
        cpu: cpuUsage.toFixed(2),
        memory: memoryUsage.toFixed(2),
        heapUsed: processMemory.heapUsed,
        heapTotal: processMemory.heapTotal,
        external: processMemory.external,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      errorHandler('Error getting system metrics:', error);
      return null;
    }
  }

  async checkThresholds(metrics) {
    if (!metrics) return;

    const warnings = [];

    if (parseFloat(metrics.cpu) > this.options.cpuThreshold) {
      warnings.push(`High CPU usage: ${metrics.cpu}%`);
    }

    if (parseFloat(metrics.memory) > this.options.memoryThreshold) {
      warnings.push(`High memory usage: ${metrics.memory}%`);
    }

    if (warnings.length > 0) {
      const message = `⚠️ Resource Warning:\n${warnings.join('\n')}`;
      await telegramNotifier.sendMessage(message, 'warning');
      await logManager.appendLog('resource', { warnings, metrics });
    }
  }

  // Calculate optimal concurrency based on system resources
  calculateOptimalConcurrency() {
    const cpus = os.cpus().length;
    const freeMem = os.freemem();
    const memoryPerRequest = 100 * 1024 * 1024; // Assume 100MB per request

    const cpuBased = cpus * 2; // 2 requests per CPU core
    const memoryBased = Math.floor(freeMem / memoryPerRequest);

    // Take the lower value to be safe
    return Math.min(cpuBased, memoryBased, 15); // Max 15 concurrent requests
  }

  // Start monitoring
  start() {
    if (this.isMonitoring) return;
    this.isMonitoring = true;

    this.monitoringInterval = setInterval(async () => {
      const metrics = await this.getSystemMetrics();
      if (metrics) {
        // Store metrics for trending
        this.metrics.cpu.push(parseFloat(metrics.cpu));
        this.metrics.memory.push(parseFloat(metrics.memory));
        this.metrics.timestamp.push(metrics.timestamp);

        // Keep last hour of data
        const maxDataPoints = Math.floor(3600000 / this.options.interval);
        if (this.metrics.cpu.length > maxDataPoints) {
          this.metrics.cpu.shift();
          this.metrics.memory.shift();
          this.metrics.timestamp.shift();
        }

        await this.checkThresholds(metrics);
      }
    }, this.options.interval);
  }

  // Stop monitoring
  stop() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.isMonitoring = false;
    }
  }

  // Get current metrics with trends
  async getCurrentMetrics() {
    const current = await this.getSystemMetrics();
    if (!current) return null;

    // Calculate trends
    const cpuTrend = this.calculateTrend(this.metrics.cpu);
    const memoryTrend = this.calculateTrend(this.metrics.memory);

    return {
      ...current,
      trends: {
        cpu: cpuTrend,
        memory: memoryTrend
      }
    };
  }

  // Calculate trend (positive means increasing)
  calculateTrend(data) {
    if (data.length < 2) return 0;
    const recent = data.slice(-5); // Last 5 data points
    return recent[recent.length - 1] - recent[0];
  }
}

const resourceMonitor = new ResourceMonitor();
module.exports = resourceMonitor;
