const { parentPort, workerData } = require('node:worker_threads');
const Database = require('better-sqlite3');

/**
 * Minimal worker thread for queue management.
 * Its job is to poll the database for pending jobs and notify the main thread.
 * This ensures that even if the main thread is busy with long-running tasks,
 * the queue state is still monitored and prioritized.
 */

const { dbPath, pollInterval = 2000 } = workerData;

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

function poll() {
  try {
    const pendingCount = db
      .prepare(
        "SELECT COUNT(*) as count FROM queue_jobs WHERE status = 'waiting' AND (run_at IS NULL OR run_at <= CURRENT_TIMESTAMP)"
      )
      .get().count;

    if (pendingCount > 0) {
      parentPort.postMessage({ type: 'PENDING_JOBS', count: pendingCount });
    }
  } catch (err) {
    parentPort.postMessage({ type: 'ERROR', error: err.message });
  }

  setTimeout(poll, pollInterval);
}

parentPort.on('message', (msg) => {
  if (msg.type === 'STOP') {
    process.exit(0);
  }
});

poll();
