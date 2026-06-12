const Database = require('better-sqlite3');
const { Cache } = require('memory-cache');
const path = require('path');
const fs = require('fs');

const { ENV } = require('../utils/constants.cjs');

class PersistenceService {
  constructor(ctx, dbPath) {
    this.ctx = ctx;
    this.logger = ctx?.logger;

    const rawPath = dbPath || ENV.PERSISTENCE_DB_PATH || './data/workflows.db';
    const isMemory = rawPath === ':memory:';
    const finalPath = isMemory
      ? ':memory:'
      : path.resolve(__dirname, '..', rawPath);

    try {
      if (!isMemory) {
        const dbDir = path.dirname(finalPath);
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
        }
      }

      this.db = new Database(finalPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');

      this.cache = new Cache();
      this._initSchema();

      this.logger?.info(
        `[PersistenceService] SUCCESS: Initialized SQLite database at: ${finalPath}`
      );
    } catch (err) {
      if (this.logger) {
        this.logger.error(
          `[PersistenceService] FATAL ERROR during initialization: ${err.message}`
        );
      } else {
        console.error(
          `[PersistenceService] FATAL ERROR during initialization: ${err.message}`
        );
      }
      throw err;
    }
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_sessions (
        session_id TEXT PRIMARY KEY,
        flow_type TEXT NOT NULL,
        status TEXT NOT NULL,
        context_json TEXT NOT NULL,
        current_steps_json TEXT NOT NULL,
        correlation_id TEXT,
        session_name TEXT,
        version INTEGER DEFAULT 1,
        error_message TEXT,
        error_reference_code TEXT,
        error_stack TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Migrations for existing databases
    const columns = this.db
      .prepare('PRAGMA table_info(workflow_sessions)')
      .all();

    if (!columns.find((c) => c.name === 'error_stack')) {
      try {
        this.db.exec(
          'ALTER TABLE workflow_sessions ADD COLUMN error_stack TEXT;'
        );
      } catch (err) {
        if (!err.message.includes('duplicate column name')) throw err;
      }
    }

    if (!columns.find((c) => c.name === 'error_reference_code')) {
      try {
        this.db.exec(
          'ALTER TABLE workflow_sessions ADD COLUMN error_reference_code TEXT;'
        );
      } catch (err) {
        if (!err.message.includes('duplicate column name')) throw err;
      }
    }

    if (!columns.find((c) => c.name === 'correlation_id')) {
      try {
        this.db.exec(
          'ALTER TABLE workflow_sessions ADD COLUMN correlation_id TEXT;'
        );
      } catch (err) {
        if (!err.message.includes('duplicate column name')) throw err;
      }
    }

    if (!columns.find((c) => c.name === 'session_name')) {
      try {
        this.db.exec(
          'ALTER TABLE workflow_sessions ADD COLUMN session_name TEXT;'
        );
      } catch (err) {
        if (!err.message.includes('duplicate column name')) throw err;
      }
    }

    if (!columns.find((c) => c.name === 'error_message')) {
      try {
        this.db.exec(
          'ALTER TABLE workflow_sessions ADD COLUMN error_message TEXT;'
        );
      } catch (err) {
        if (!err.message.includes('duplicate column name')) throw err;
      }
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_batches (
        erc TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        step_key TEXT NOT NULL,
        status TEXT NOT NULL,
        downstream_batch_id TEXT,
        processed_count INTEGER DEFAULT 0,
        total_count INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES workflow_sessions(session_id) ON DELETE CASCADE
      );
    `);

    // Migration for workflow_batches
    const batchColumns = this.db
      .prepare('PRAGMA table_info(workflow_batches)')
      .all();

    if (!batchColumns.find((c) => c.name === 'error_message')) {
      try {
        this.db.exec(
          'ALTER TABLE workflow_batches ADD COLUMN error_message TEXT;'
        );
      } catch (err) {
        if (!err.message.includes('duplicate column name')) throw err;
      }
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        session_id TEXT NOT NULL,
        batch_id TEXT,
        status TEXT NOT NULL,
        message TEXT,
        details_json TEXT,
        FOREIGN KEY (session_id) REFERENCES workflow_sessions(session_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_batches_session ON workflow_batches(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_session ON workflow_events(session_id);

      CREATE TABLE IF NOT EXISTS system_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS queue_jobs (
        job_id TEXT PRIMARY KEY,
        queue_name TEXT NOT NULL,
        job_type TEXT NOT NULL,
        data_json TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        run_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        result_json TEXT,
        error_message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_queue_jobs_status ON queue_jobs(status, run_at);
    `);
  }

  // --- Queue Job Management ---

  saveQueueJob(job) {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO queue_jobs (
        job_id, queue_name, job_type, data_json, status, priority, 
        attempts, max_attempts, run_at, created_at, updated_at, 
        result_json, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        job.id,
        job.queue,
        job.type,
        JSON.stringify(job.data),
        job.status,
        job.priority,
        job.attempts,
        job.maxAttempts,
        job.runAt ? job.runAt.toISOString() : null,
        job.createdAt.toISOString(),
        job.updatedAt.toISOString(),
        job.result ? JSON.stringify(job.result) : null,
        job.error
      );
  }

  getPendingQueueJobs() {
    const rows = this.db
      .prepare(
        "SELECT * FROM queue_jobs WHERE status = 'waiting' AND (run_at IS NULL OR run_at <= CURRENT_TIMESTAMP) ORDER BY priority DESC, created_at ASC"
      )
      .all();

    return rows.map((row) => ({
      id: row.job_id,
      queue: row.queue_name,
      type: row.job_type,
      data: JSON.parse(row.data_json),
      status: row.status,
      priority: row.priority,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      runAt: row.run_at ? new Date(row.run_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      result: row.result_json ? JSON.parse(row.result_json) : null,
      error: row.error_message,
    }));
  }

  deleteQueueJob(jobId) {
    this.db.prepare('DELETE FROM queue_jobs WHERE job_id = ?').run(jobId);
  }

  getSystemSetting(key) {
    const row = this.db
      .prepare(
        'SELECT setting_value FROM system_settings WHERE setting_key = ?'
      )
      .get(key);
    return row ? row.setting_value : null;
  }

  saveSystemSetting(key, value) {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
      )
      .run(key, value);
  }

  createSession({
    sessionId,
    flowType,
    status,
    context,
    currentSteps,
    correlationId,
    sessionName,
  }) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO workflow_sessions (
        session_id, flow_type, status, context_json, current_steps_json, correlation_id, session_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      sessionId,
      flowType,
      status,
      JSON.stringify(context || {}),
      JSON.stringify(currentSteps || []),
      correlationId || null,
      sessionName || null,
      now,
      now
    );

    this.cache.del(sessionId);
    return this.getSession(sessionId);
  }

  getCompletedSessions() {
    const rows = this.db
      .prepare(
        "SELECT * FROM workflow_sessions WHERE status = 'COMPLETED' AND flow_type != 'delete' ORDER BY created_at DESC"
      )
      .all();
    return rows.map((row) => this._parseSession(row));
  }

  getIncompleteSessions() {
    const rows = this.db
      .prepare(
        "SELECT * FROM workflow_sessions WHERE status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED') ORDER BY created_at DESC"
      )
      .all();
    return rows.map((row) => this._parseSession(row));
  }

  getSession(sessionId) {
    const cachedSession = this.cache.get(sessionId);
    if (cachedSession) return cachedSession;

    const row = this.db
      .prepare('SELECT * FROM workflow_sessions WHERE session_id = ?')
      .get(sessionId);

    return row ? this._parseSession(row) : null;
  }

  getLatestSession() {
    const row = this.db
      .prepare(
        'SELECT * FROM workflow_sessions ORDER BY created_at DESC LIMIT 1'
      )
      .get();

    return row ? this._parseSession(row) : null;
  }

  getLatestCompletedSession() {
    const row = this.db
      .prepare(
        "SELECT * FROM workflow_sessions WHERE status = 'COMPLETED' ORDER BY created_at DESC LIMIT 1"
      )
      .get();

    return row ? this._parseSession(row) : null;
  }

  _parseSession(row) {
    const session = {
      session_id: row.session_id,
      flow_type: row.flow_type,
      status: row.status,
      session_name: row.session_name,
      error_message: row.error_message,
      error_stack: row.error_stack,
      errorReferenceCode: row.error_reference_code,
      context: JSON.parse(row.context_json),
      currentSteps: JSON.parse(row.current_steps_json),
      correlationId: row.correlation_id,
      version: row.version,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
    this.cache.put(session.session_id, session, 60000); // 1 minute cache
    return session;
  }

  getAllSessions() {
    const rows = this.db
      .prepare('SELECT * FROM workflow_sessions ORDER BY created_at DESC')
      .all();
    return rows.map((row) => ({
      session_id: row.session_id,
      flow_type: row.flow_type,
      status: row.status,
      session_name: row.session_name,
      error_message: row.error_message,
      error_stack: row.error_stack,
      errorReferenceCode: row.error_reference_code,
      context: JSON.parse(row.context_json),
      currentSteps: JSON.parse(row.current_steps_json),
      correlationId: row.correlation_id,
      version: row.version,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  updateSessionStatus(sessionId, status) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE workflow_sessions SET status = ?, updated_at = ? WHERE session_id = ?'
      )
      .run(status, now, sessionId);
    this.cache.del(sessionId);
    return this.getSession(sessionId);
  }

  updateSessionCurrentSteps(sessionId, currentSteps) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE workflow_sessions SET current_steps_json = ?, updated_at = ? WHERE session_id = ?'
      )
      .run(JSON.stringify(currentSteps), now, sessionId);
    this.cache.del(sessionId);
    return this.getSession(sessionId);
  }

  updateSessionContext(sessionId, newContext) {
    const now = new Date().toISOString();
    const session = this.getSession(sessionId);
    if (!session) return null;

    const mergedContext = { ...session.context, ...newContext };

    this.db
      .prepare(
        'UPDATE workflow_sessions SET context_json = ?, updated_at = ? WHERE session_id = ?'
      )
      .run(JSON.stringify(mergedContext), now, sessionId);
    this.cache.del(sessionId);
    return this.getSession(sessionId);
  }

  updateSession(sessionId, { status, context, currentSteps, correlationId }) {
    const now = new Date().toISOString();
    const sets = ['updated_at = ?'];
    const params = [now];

    const currentSession = this.getSession(sessionId);
    if (!currentSession) return null;

    if (status) {
      sets.push('status = ?');
      params.push(status);
    }
    if (context) {
      const mergedContext = { ...currentSession.context, ...context };
      sets.push('context_json = ?');
      params.push(JSON.stringify(mergedContext));
    }
    if (currentSteps) {
      sets.push('current_steps_json = ?');
      params.push(JSON.stringify(currentSteps));
    }
    if (correlationId) {
      sets.push('correlation_id = ?');
      params.push(correlationId);
    }

    params.push(sessionId);
    this.db
      .prepare(
        `UPDATE workflow_sessions SET ${sets.join(', ')} WHERE session_id = ?`
      )
      .run(...params);
    this.cache.del(sessionId);
    return this.getSession(sessionId);
  }

  async verifyDependencyReady(sessionId, dependencyStepKey) {
    const batches = this.getBatchesForSession(sessionId);
    if (!batches || batches.length === 0) return false;

    const dependencyBatches = batches.filter(
      (b) => b.step_key === dependencyStepKey
    );
    if (dependencyBatches.length === 0) return false;

    return dependencyBatches.every((b) =>
      ['COMPLETED', 'BYPASSED', 'SYNCHRONOUS'].includes(b.status)
    );
  }

  tryFinalizeSession(sessionId) {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `
      UPDATE workflow_sessions 
      SET status = 'COMPLETED', current_steps_json = '[]', updated_at = ?
      WHERE session_id = ? AND status NOT IN ('COMPLETED', 'FAILED')
    `
      )
      .run(now, sessionId);

    if (result.changes > 0) {
      this.cache.del(sessionId);
      return true;
    }
    return false;
  }

  tryFailSession(
    sessionId,
    errorMessage = null,
    errorReferenceCode = null,
    errorStack = null
  ) {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `
      UPDATE workflow_sessions 
      SET status = 'FAILED', error_message = ?, error_reference_code = ?, error_stack = ?, current_steps_json = '[]', updated_at = ?
      WHERE session_id = ? AND status NOT IN ('COMPLETED', 'FAILED')
    `
      )
      .run(errorMessage, errorReferenceCode, errorStack, now, sessionId);

    if (result.changes > 0) {
      this.cache.del(sessionId);
      return true;
    }
    return false;
  }

  tryCancelSession(sessionId) {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `
      UPDATE workflow_sessions 
      SET status = 'CANCELLED', current_steps_json = '[]', updated_at = ?
      WHERE session_id = ? AND status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
    `
      )
      .run(now, sessionId);

    if (result.changes > 0) {
      this.cache.del(sessionId);
      return true;
    }
    return false;
  }

  createBatch({ erc, sessionId, stepKey, status, totalCount }) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO workflow_batches (
        erc, session_id, step_key, status, processed_count, total_count, error_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(erc, sessionId, stepKey, status, 0, totalCount || 0, 0, now, now);

    this.cache.del(`batches-${sessionId}`);
    return this.getBatch(erc);
  }

  getBatch(erc) {
    const cacheKey = `batch-${erc}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const row = this.db
      .prepare('SELECT * FROM workflow_batches WHERE erc = ?')
      .get(erc);
    if (row) {
      this.cache.put(cacheKey, row, 60000);
      return row;
    }
    return null;
  }

  getBatchesForSession(sessionId) {
    const cacheKey = `batches-${sessionId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const rows = this.db
      .prepare('SELECT * FROM workflow_batches WHERE session_id = ?')
      .all(sessionId);
    this.cache.put(cacheKey, rows, 30000);
    return rows;
  }

  updateBatch(
    erc,
    {
      status,
      downstreamBatchId,
      processedCount,
      totalCount,
      errorCount,
      errorMessage,
    }
  ) {
    const now = new Date().toISOString();
    const sets = ['updated_at = ?'];
    const params = [now];

    if (status) {
      sets.push('status = ?');
      params.push(status);
    }
    if (downstreamBatchId !== undefined) {
      sets.push('downstream_batch_id = ?');
      params.push(downstreamBatchId);
    }
    if (processedCount !== undefined) {
      sets.push('processed_count = ?');
      params.push(processedCount);
    }
    if (totalCount !== undefined) {
      sets.push('total_count = ?');
      params.push(totalCount);
    }
    if (errorCount !== undefined) {
      sets.push('error_count = ?');
      params.push(errorCount);
    }
    if (errorMessage !== undefined) {
      sets.push('error_message = ?');
      params.push(errorMessage);
    }

    params.push(erc);
    this.db
      .prepare(`UPDATE workflow_batches SET ${sets.join(', ')} WHERE erc = ?`)
      .run(...params);

    const batch = this.getBatch(erc);
    if (batch) {
      this.cache.del(`batches-${batch.session_id}`);
      this.cache.del(`batch-${erc}`);
    }
    return this.getBatch(erc);
  }

  getBatchByDownstreamId(downstreamBatchId) {
    return this.db
      .prepare('SELECT * FROM workflow_batches WHERE downstream_batch_id = ?')
      .get(downstreamBatchId);
  }

  getEventsForSession(sessionId) {
    const rows = this.db
      .prepare(
        'SELECT * FROM workflow_events WHERE session_id = ? ORDER BY timestamp ASC'
      )
      .all(sessionId);
    return rows.map((row) => ({
      ...row,
      details: row.details_json ? JSON.parse(row.details_json) : null,
    }));
  }

  logWorkflowEvent({ sessionId, batchId, status, message, details }) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO workflow_events (timestamp, session_id, batch_id, status, message, details_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      now,
      sessionId,
      batchId || null,
      status,
      message,
      JSON.stringify(details || {})
    );
  }

  getWorkflowKPIs() {
    const totalSessions = this.db
      .prepare('SELECT COUNT(*) as count FROM workflow_sessions')
      .get().count;
    const completedSessions = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM workflow_sessions WHERE status = 'COMPLETED'"
      )
      .get().count;
    const failedSessions = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM workflow_sessions WHERE status = 'FAILED'"
      )
      .get().count;
    const cancelledSessions = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM workflow_sessions WHERE status = 'CANCELLED'"
      )
      .get().count;

    return {
      totalSessions,
      completedSessions,
      failedSessions,
      cancelledSessions,
      successRate:
        totalSessions > 0 ? (completedSessions / totalSessions) * 100 : 0,
    };
  }

  clearAll() {
    this.db.prepare('DELETE FROM workflow_events').run();
    this.db.prepare('DELETE FROM workflow_batches').run();
    this.db.prepare('DELETE FROM workflow_sessions').run();
    this.db.prepare('DELETE FROM queue_jobs').run();
    this.cache.clear();
  }

  cleanup(cutoffTimestamp) {
    this.db
      .prepare('DELETE FROM workflow_events WHERE timestamp < ?')
      .run(cutoffTimestamp);
    this.db
      .prepare('DELETE FROM workflow_batches WHERE created_at < ?')
      .run(cutoffTimestamp);
    this.db
      .prepare('DELETE FROM workflow_sessions WHERE created_at < ?')
      .run(cutoffTimestamp);
    this.db
      .prepare('DELETE FROM queue_jobs WHERE created_at < ?')
      .run(cutoffTimestamp);
    this.cache.clear();
  }

  ping() {
    if (!this.db) return false;
    try {
      this.db.prepare('SELECT 1').get();
      return true;
    } catch (err) {
      this.logger?.error(
        `[PersistenceService] Database ping failed: ${err.message}`
      );
      return false;
    }
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

module.exports = PersistenceService;
