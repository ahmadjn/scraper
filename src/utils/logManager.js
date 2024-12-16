const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { DATA_DIR } = require('../config');

const gzip = promisify(zlib.gzip);
const { LOG_DIR } = require('../config');
const MAX_LOG_AGE_DAYS = 7; // Simpan log selama 7 hari
const MAX_LOG_SIZE_MB = 10; // Rotasi jika ukuran > 10MB

class LogManager {
  constructor() {
    this.logTypes = {
      error: 'error.log',
      memory: 'memory.log'
    };
  }

  async ensureLogDir() {
    try {
      await fs.access(LOG_DIR);
    } catch {
      await fs.mkdir(LOG_DIR, { recursive: true });
    }
  }

  getLogPath(type) {
    return path.join(LOG_DIR, this.logTypes[type]);
  }

  async appendLog(type, content) {
    await this.ensureLogDir();
    const logPath = this.getLogPath(type);

    // Tambahkan timestamp ke content
    const logEntry = {
      timestamp: new Date().toISOString(),
      ...content
    };

    await fs.appendFile(
      logPath,
      JSON.stringify(logEntry, null, 2) + '\n'
    );

    // Check ukuran file setelah append
    await this.checkRotation(type);
  }

  async checkRotation(type) {
    const logPath = this.getLogPath(type);
    try {
      const stats = await fs.stat(logPath);
      const sizeMB = stats.size / (1024 * 1024);

      if (sizeMB >= MAX_LOG_SIZE_MB) {
        await this.rotateLog(type);
      }
    } catch (error) {
      console.error(`Error checking log size: ${error.message}`);
    }
  }

  async rotateLog(type) {
    const logPath = this.getLogPath(type);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = path.join(LOG_DIR, `${type}_${timestamp}.log.gz`);

    try {
      // Baca file log
      const content = await fs.readFile(logPath);

      // Compress dengan gzip
      const compressed = await gzip(content);

      // Simpan file terkompresi
      await fs.writeFile(archivePath, compressed);

      // Kosongkan file log
      await fs.writeFile(logPath, '');

      console.log(`Rotated ${type} log to ${archivePath}`);

      // Cleanup log lama
      await this.cleanupOldLogs();
    } catch (error) {
      console.error(`Error rotating log: ${error.message}`);
    }
  }

  async cleanupOldLogs() {
    try {
      const files = await fs.readdir(LOG_DIR);
      const now = new Date();

      for (const file of files) {
        if (!file.endsWith('.gz')) continue;

        const filePath = path.join(LOG_DIR, file);
        const stats = await fs.stat(filePath);
        const ageInDays = (now - stats.mtime) / (1000 * 60 * 60 * 24);

        if (ageInDays > MAX_LOG_AGE_DAYS) {
          await fs.unlink(filePath);
          console.log(`Deleted old log: ${file}`);
        }
      }
    } catch (error) {
      console.error(`Error cleaning up logs: ${error.message}`);
    }
  }
}

const logManager = new LogManager();
module.exports = logManager;
