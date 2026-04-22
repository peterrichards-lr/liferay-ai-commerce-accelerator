const Database = require('better-sqlite3');
const { Cache } = require('memory-cache');
const path = require('path');
const fs = require('fs');

const { ENV } = require('../utils/constants.cjs');

class PersistenceService {
  constructor(dbPath) {
    const defaultPath = path.resolve(
      __dirname,
      '..',
      ENV.PERSISTENCE_DB_PATH || './data/workflows.db'
    );
    const finalPath = dbPath || defaultPath;

    // We can't use this.logger yet as ctx hasn't been passed to constructor in bootstrap.cjs
    // Wait, let's check bootstrap.cjs again.

    try {
      const dbDir = path.dirname(finalPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      this.db = new Database(finalPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');

      this.cache = new Cache();
      this._initSchema();

      console.log(
        `[PersistenceService] SUCCESS: Initialized SQLite database at: ${finalPath}`
      );
      console.log(`[PersistenceService] Working directory: ${process.cwd()}`);
    } catch (err) {
      console.error(
        `[PersistenceService] FATAL ERROR during initialization: ${err.message}`
      );
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
        version INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflow_batches (
        erc TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        step_key TEXT NOT NULL,
        status TEXT NOT NULL,
        downstream_batch_id TEXT,
        processed_count INTEGER DEFAULT 0,
        total_count INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES workflow_sessions(session_id) ON DELETE CASCADE
      );

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
    `);
  }

  createSession({
    sessionId,
    flowType,
    status,
    context,
    currentSteps,
    correlationId,
  }) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO workflow_sessions (
        session_id, flow_type, status, context_json, current_steps_json, correlation_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      sessionId,
      flowType,
      status,
      JSON.stringify(context || {}),
      JSON.stringify(currentSteps || []),
      correlationId || null,
      now,
      now
    );

    this.cache.del(sessionId);
    return this.getSession(sessionId);
  }

  getSession(sessionId) {
    const cachedSession = this.cache.get(sessionId);
    if (cachedSession) return cachedSession;

    const row = this.db
      .prepare('SELECT * FROM workflow_sessions WHERE session_id = ?')
      .get(sessionId);

    if (row) {
      const session = {
        session_id: row.session_id,
        flow_type: row.flow_type,
        status: row.status,
        context: JSON.parse(row.context_json),
        currentSteps: JSON.parse(row.current_steps_json),
        correlationId: row.correlation_id,
        version: row.version,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
      this.cache.put(sessionId, session, 60000); // 1 minute cache
      return session;
    }

    return null;
  }

  getAllSessions() {
    const rows = this.db
      .prepare('SELECT * FROM workflow_sessions ORDER BY created_at DESC')
      .all();
    return rows.map((row) => ({
      session_id: row.session_id,
      flow_type: row.flow_type,
      status: row.status,
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

  updateSessionContext(sessionId, context) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE workflow_sessions SET context_json = ?, updated_at = ? WHERE session_id = ?'
      )
      .run(JSON.stringify(context), now, sessionId);
    this.cache.del(sessionId);
    return this.getSession(sessionId);
  }

  updateSession(sessionId, { status, context, currentSteps, correlationId }) {
    const now = new Date().toISOString();
    const sets = ['updated_at = ?'];
    const params = [now];

    if (status) {
      sets.push('status = ?');
      params.push(status);
    }
    if (context) {
      sets.push('context_json = ?');
      params.push(JSON.stringify(context));
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

  tryFailSession(sessionId) {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `
      UPDATE workflow_sessions 
      SET status = 'FAILED', current_steps_json = '[]', updated_at = ?
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
    { status, downstreamBatchId, processedCount, totalCount, errorCount }
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

  clearAll() {
    this.db.prepare('DELETE FROM workflow_events').run();
    this.db.prepare('DELETE FROM workflow_batches').run();
    this.db.prepare('DELETE FROM workflow_sessions').run();
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
    this.cache.clear();
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

module.exports = PersistenceService;
