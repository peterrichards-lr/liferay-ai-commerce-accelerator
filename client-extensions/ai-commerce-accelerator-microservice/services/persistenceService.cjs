const Database = require('better-sqlite3');
const { Cache } = require('memory-cache');
const path = require('path');

class PersistenceService {
  constructor(dbPath = path.join(__dirname, '..', 'data', 'workflows.db')) {
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
        correlation_id TEXT,
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

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_batches_session_id ON workflow_batches (session_id);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_events_session_id ON workflow_events (session_id);`);
  }

  createSession({ sessionId, flowType, status, context, currentSteps, correlationId }) {
    const contextJson = JSON.stringify(context);
    const currentStepsJson = JSON.stringify(currentSteps || []);

    const stmt = this.db.prepare(
      'INSERT INTO workflow_sessions (session_id, flow_type, status, context_json, current_steps, correlation_id) VALUES (?, ?, ?, ?, ?, ?)'
    );

    stmt.run(sessionId, flowType, status, contextJson, currentStepsJson, correlationId);

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
      session.correlationId = session.correlation_id;
      delete session.context_json;
      delete session.current_steps;
      delete session.correlation_id;
      this.cache.put(sessionId, session);
    }

    return session;
  }

  getAllSessions() {
    const stmt = this.db.prepare(
      'SELECT session_id, flow_type, status, current_steps, correlation_id, version, created_at, updated_at FROM workflow_sessions ORDER BY created_at DESC'
    );
    const sessions = stmt.all();

    return sessions.map((session) => {
      session.currentSteps = JSON.parse(session.current_steps);
      session.correlationId = session.correlation_id;
      delete session.current_steps;
      delete session.correlation_id;
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

  updateSession(sessionId, { status, context, currentSteps, correlationId }) {
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

    if (correlationId) {
      updates.push('correlation_id = ?');
      params.push(correlationId);
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

  close() {
    if (this.db) {
      this.db.close();
    }
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
    
    // Invalidate session batches cache
    this.cache.del(`batches-${sessionId}`);
    
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
    const cacheKey = `batches-${sessionId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const stmt = this.db.prepare('SELECT * FROM workflow_batches WHERE session_id = ?');
    const batches = stmt.all(sessionId);
    
    if (batches) {
      this.cache.put(cacheKey, batches);
    }
    
    return batches;
  }

  getEventsForSession(sessionId) {
    const stmt = this.db.prepare('SELECT * FROM workflow_events WHERE session_id = ? ORDER BY timestamp ASC');
    const events = stmt.all(sessionId);

    return events.map(event => {
      if (event.details) {
        try {
          event.details = JSON.parse(event.details);
        } catch (_) {
          // Keep as string if parsing fails
        }
      }
      return event;
    });
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

    const batch = this.getBatch(erc);
    if (batch) {
      // Invalidate session batches cache
      this.cache.del(`batches-${batch.session_id}`);
    }

    const cacheKey = `batch-${erc}`;
    this.cache.del(cacheKey);

    return batch;
  }

  getBatchByDownstreamId(downstreamBatchId) {
    const stmt = this.db.prepare('SELECT * FROM workflow_batches WHERE downstream_batch_id = ?');
    return stmt.get(downstreamBatchId);
  }

  clearAll() {
    this.db.prepare('DELETE FROM workflow_events').run();
    this.db.prepare('DELETE FROM workflow_batches').run();
    this.db.prepare('DELETE FROM workflow_sessions').run();
    this.cache.clear();
  }

  cleanup(cutoffTimestamp) {
    this.db.prepare('DELETE FROM workflow_events WHERE timestamp < ?').run(cutoffTimestamp);
    this.db.prepare('DELETE FROM workflow_batches WHERE created_at < ?').run(cutoffTimestamp);
    this.db.prepare('DELETE FROM workflow_sessions WHERE created_at < ?').run(cutoffTimestamp);
    this.cache.clear();
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
