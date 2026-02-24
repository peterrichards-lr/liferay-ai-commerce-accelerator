const Database = require('better-sqlite3');
const { Cache } = require('memory-cache');

class PersistenceService {
  constructor(dbPath = './data/workflows.db') {
    this.db = new Database(dbPath);
    this.cache = new Cache();
    this._initSchema();
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_sessions (
        session_id TEXT PRIMARY KEY,
        flow_type TEXT NOT NULL,
        status TEXT NOT NULL,
        current_steps TEXT,
        context_json TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_batches (
        erc TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        step_key TEXT NOT NULL,
        status TEXT NOT NULL,
        downstream_batch_id INTEGER,
        processed_count INTEGER,
        total_count INTEGER,
        error_count INTEGER,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        FOREIGN KEY (session_id) REFERENCES workflow_sessions (session_id)
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        session_id TEXT,
        batch_id TEXT,
        status TEXT,
        message TEXT,
        details TEXT
      )
    `);
  }

  createSession({ sessionId, flowType, status, context, currentSteps }) {
    const contextJson = JSON.stringify(context);
    const currentStepsJson = JSON.stringify(currentSteps || []);

    const stmt = this.db.prepare(
      'INSERT INTO workflow_sessions (session_id, flow_type, status, context_json, current_steps) VALUES (?, ?, ?, ?, ?)'
    );

    stmt.run(sessionId, flowType, status, contextJson, currentStepsJson);

    return this.getSession(sessionId);
  }

  getSession(sessionId) {
    const cachedSession = this.cache.get(sessionId);
    if (cachedSession) {
      return cachedSession;
    }

    const stmt = this.db.prepare('SELECT * FROM workflow_sessions WHERE session_id = ?');
    const session = stmt.get(sessionId);

    if (session) {
      session.context = JSON.parse(session.context_json);
      session.currentSteps = JSON.parse(session.current_steps);
      delete session.context_json;
      delete session.current_steps;
      this.cache.put(sessionId, session);
    }

    return session;
  }

  getAllSessions() {
    const stmt = this.db.prepare('SELECT * FROM workflow_sessions ORDER BY created_at DESC');
    const sessions = stmt.all();

    return sessions.map(session => {
      session.context = JSON.parse(session.context_json);
      session.currentSteps = JSON.parse(session.current_steps);
      delete session.context_json;
      delete session.current_steps;
      return session;
    });
  }

  updateSessionStatus(sessionId, status) {
    const stmt = this.db.prepare(
      "UPDATE workflow_sessions SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE session_id = ?"
    );

    stmt.run(status, sessionId);
    this.cache.del(sessionId);

    return this.getSession(sessionId);
  }
  
  updateSessionCurrentSteps(sessionId, currentSteps) {
    const currentStepsJson = JSON.stringify(currentSteps);
    const stmt = this.db.prepare(
      "UPDATE workflow_sessions SET current_steps = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE session_id = ?"
    );
    stmt.run(currentStepsJson, sessionId);
    this.cache.del(sessionId);
    return this.getSession(sessionId);
  }

  updateSessionContext(sessionId, context) {
    const contextJson = JSON.stringify(context);

    const stmt = this.db.prepare(
      "UPDATE workflow_sessions SET context_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE session_id = ?"
    );

    stmt.run(contextJson, sessionId);
    this.cache.del(sessionId);

    return this.getSession(sessionId);
  }

  updateSession(sessionId, { status, context, currentSteps }) {
    const updates = [];
    const params = [];

    if (status) {
      updates.push('status = ?');
      params.push(status);
    }

    if (context) {
      updates.push('context_json = ?');
      params.push(JSON.stringify(context));
    }
    
    if (currentSteps) {
      updates.push('current_steps = ?');
      params.push(JSON.stringify(currentSteps));
    }

    if (updates.length === 0) {
      return this.getSession(sessionId);
    }

    updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");

    const sql = `UPDATE workflow_sessions SET ${updates.join(', ')} WHERE session_id = ?`;
    params.push(sessionId);

    const stmt = this.db.prepare(sql);
    stmt.run(params);

    this.cache.del(sessionId);

    return this.getSession(sessionId);
  }

  tryFinalizeSession(sessionId) {
    const stmt = this.db.prepare(
      "UPDATE workflow_sessions SET status = 'COMPLETED', current_steps = '[]', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE session_id = ? AND status NOT IN ('COMPLETED', 'FAILED')"
    );

    const info = stmt.run(sessionId);
    if (info.changes > 0) {
      this.cache.del(sessionId);
      return true;
    }
    return false;
  }

  tryFailSession(sessionId) {
    const stmt = this.db.prepare(
      "UPDATE workflow_sessions SET status = 'FAILED', current_steps = '[]', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE session_id = ? AND status NOT IN ('COMPLETED', 'FAILED')"
    );

    const info = stmt.run(sessionId);
    if (info.changes > 0) {
      this.cache.del(sessionId);
      return true;
    }
    return false;
  }

  createBatch({ erc, sessionId, stepKey, step_key, status }) {
    const key = stepKey || step_key;
    const stmt = this.db.prepare(
      'INSERT INTO workflow_batches (erc, session_id, step_key, status) VALUES (?, ?, ?, ?)'
    );

    stmt.run(erc, sessionId, key, status);
    return this.getBatch(erc);
  }

  getBatch(erc) {
    const cacheKey = `batch-${erc}`;
    const cachedBatch = this.cache.get(cacheKey);

    if (cachedBatch) {
      return cachedBatch;
    }

    const stmt = this.db.prepare('SELECT * FROM workflow_batches WHERE erc = ?');
    const batch = stmt.get(erc);

    if (batch) {
      this.cache.put(cacheKey, batch);
    }

    return batch;
  }

  getBatchesForSession(sessionId) {
    const stmt = this.db.prepare('SELECT * FROM workflow_batches WHERE session_id = ?');
    return stmt.all(sessionId);
  }

  updateBatch(erc, { status, downstreamBatchId, processedCount, totalCount, errorCount }) {
    const updates = [];
    const params = [];

    if (status) {
      updates.push('status = ?');
      params.push(status);
    }
    if (downstreamBatchId) {
      updates.push('downstream_batch_id = ?');
      params.push(downstreamBatchId);
    }
    if (processedCount !== undefined) {
      updates.push('processed_count = ?');
      params.push(processedCount);
    }
    if (totalCount !== undefined) {
      updates.push('total_count = ?');
      params.push(totalCount);
    }
    if (errorCount !== undefined) {
      updates.push('error_count = ?');
      params.push(errorCount);
    }

    if (updates.length === 0) {
      return this.getBatch(erc);
    }

    updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");

    const sql = `UPDATE workflow_batches SET ${updates.join(', ')} WHERE erc = ?`;
    params.push(erc);
    
    const stmt = this.db.prepare(sql);
    stmt.run(params);

    const cacheKey = `batch-${erc}`;
    this.cache.del(cacheKey);

    return this.getBatch(erc);
  }

  logWorkflowEvent({ sessionId, batchId, status, message, details }) {
    const detailsJson = details ? JSON.stringify(details) : null;
    const stmt = this.db.prepare(
      'INSERT INTO workflow_events (session_id, batch_id, status, message, details) VALUES (?, ?, ?, ?, ?)'
    );
    stmt.run(sessionId, batchId, status, message, detailsJson);
  }
}

module.exports = PersistenceService;
