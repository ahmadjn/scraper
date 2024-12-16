const fs = require('fs').promises;
const path = require('path');
const { DATA_DIR } = require('../config');

class CheckpointManager {
  constructor() {
    this.checkpointPath = path.join(DATA_DIR, 'data', 'checkpoint.json');
    this.lockPath = path.join(DATA_DIR, 'data', 'scraper.lock');
  }

  async saveCheckpoint(state) {
    try {
      const checkpoint = {
        ...state,
        timestamp: new Date().toISOString(),
        pid: process.pid
      };
      await fs.writeFile(this.checkpointPath, JSON.stringify(checkpoint, null, 2));
    } catch (error) {
      console.error('Error saving checkpoint:', error);
    }
  }

  async loadCheckpoint() {
    try {
      const data = await fs.readFile(this.checkpointPath, 'utf8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async acquireLock() {
    try {
      // Check if lock exists and is stale
      try {
        const lockData = JSON.parse(await fs.readFile(this.lockPath, 'utf8'));

        // Check if process is still running
        try {
          process.kill(lockData.pid, 0);
          // Process is still running
          return false;
        } catch {
          // Process is not running, lock is stale
          console.log('Found stale lock, removing...');
        }
      } catch {
        // Lock doesn't exist
      }

      // Create new lock
      await fs.writeFile(this.lockPath, JSON.stringify({
        pid: process.pid,
        timestamp: new Date().toISOString()
      }));
      return true;
    } catch (error) {
      console.error('Error acquiring lock:', error);
      return false;
    }
  }

  async releaseLock() {
    try {
      await fs.unlink(this.lockPath);
    } catch {
      // Ignore error if lock doesn't exist
    }
  }

  async clearCheckpoint() {
    try {
      await fs.unlink(this.checkpointPath);
    } catch {
      // Ignore error if checkpoint doesn't exist
    }
  }
}

const checkpointManager = new CheckpointManager();
module.exports = checkpointManager;
