const cliProgress = require('cli-progress');
const colors = require('ansi-colors');

class ProgressManager {
  constructor() {
    this.bar = null;
  }

  createBar(context, total, type = 'chapter') {
    // Tentukan label berdasarkan type
    const labels = {
      'url': 'Page',
      'detail': 'Novel',
      'chapter': 'Chapter'
    };
    const label = labels[type] || 'Item';

    this.bar = new cliProgress.SingleBar({
      format: `${colors.cyan('{bar}')} | ${colors.yellow('{percentage}%')} | ${label} {value}/{total}`,
      hideCursor: true,
      clearOnComplete: false,
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591'
    });

    this.bar.start(total, 0);
  }

  updateBar(value) {
    this.bar.update(value);
  }

  stop() {
    this.bar.stop();
  }
}

const progressManager = new ProgressManager();
module.exports = progressManager;
