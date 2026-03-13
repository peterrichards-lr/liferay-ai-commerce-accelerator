const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const { Cache } = require('memory-cache');
const path = require('path');
const _ = require('lodash');

const { ENV } = require('../utils/constants.cjs');

class PersistenceService {
  constructor(dbPath = path.resolve(process.cwd(), ENV.PERSISTENCE_DB_PATH)) {
    const adapter = new FileSync(dbPath);
    this.db = low(adapter);
    this.cache = new Cache();
    this._initSchema();
  }

  _initSchema() {
    this.db
      .defaults({
        sessions: [],
        batches: [],
        events: [],
      })
      .write();
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
    const session = {
      session_id: sessionId,
      flow_type: flowType,
      status,
      context,
      currentSteps: currentSteps || [],
      correlationId,
      version: 1,
      created_at: now,
      updated_at: now,
    };

    this.db.get('sessions').push(session).write();

    this.cache.del(sessionId);
    return this.getSession(sessionId);
  }

  getSession(sessionId) {
    const cachedSession = this.cache.get(sessionId);
    if (cachedSession) {
      return cachedSession;
    }

    const session = this.db.get('sessions').find({ session_id: sessionId }).value();

    if (session) {
      const result = _.cloneDeep(session);
      // Map properties to match expected output if necessary
      // In this new implementation we store them more naturally
      this.cache.put(sessionId, result);
      return result;
    }

    return null;
  }

  getAllSessions() {
    return this.db
      .get('sessions')
      .orderBy(['created_at'], ['desc'])
      .map((session) => _.cloneDeep(session))
      .value();
  }

  updateSessionStatus(sessionId, status) {
    this.db
      .get('sessions')
      .find({ session_id: sessionId })
      .assign({ status, updated_at: new Date().toISOString() })
      .write();

    this.cache.del(sessionId);
    return this.getSession(sessionId);
  }

  updateSessionCurrentSteps(sessionId, currentSteps) {
    this.db
      .get('sessions')
      .find({ session_id: sessionId })
      .assign({ currentSteps, updated_at: new Date().toISOString() })
      .write();

    this.cache.del(sessionId);
    return this.getSession(sessionId);
  }

  updateSessionContext(sessionId, context) {
    this.db
      .get('sessions')
      .find({ session_id: sessionId })
      .assign({ context, updated_at: new Date().toISOString() })
      .write();

    this.cache.del(sessionId);
    return this.getSession(sessionId);
  }

  updateSession(sessionId, { status, context, currentSteps, correlationId }) {
    const updates = { updated_at: new Date().toISOString() };

    if (status) updates.status = status;
    if (context) updates.context = context;
    if (currentSteps) updates.currentSteps = currentSteps;
    if (correlationId) updates.correlationId = correlationId;

    this.db.get('sessions').find({ session_id: sessionId }).assign(updates).write();

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

    return dependencyBatches.every(
      (b) =>
        b.status === 'COMPLETED' ||
        b.status === 'BYPASSED' ||
        b.status === 'SYNCHRONOUS'
    );
  }

  close() {
    // lowdb FileSync doesn't need explicit close
  }

  tryFinalizeSession(sessionId) {
    const session = this.db.get('sessions').find({ session_id: sessionId }).value();

    if (session && session.status !== 'COMPLETED' && session.status !== 'FAILED') {
      this.db
        .get('sessions')
        .find({ session_id: sessionId })
        .assign({
          status: 'COMPLETED',
          currentSteps: [],
          updated_at: new Date().toISOString(),
        })
        .write();

      this.cache.del(sessionId);
      return true;
    }
    return false;
  }

  tryFailSession(sessionId) {
    const session = this.db.get('sessions').find({ session_id: sessionId }).value();

    if (session && session.status !== 'COMPLETED' && session.status !== 'FAILED') {
      this.db
        .get('sessions')
        .find({ session_id: sessionId })
        .assign({
          status: 'FAILED',
          currentSteps: [],
          updated_at: new Date().toISOString(),
        })
        .write();

      this.cache.del(sessionId);
      return true;
    }
    return false;
  }

  createBatch({ erc, sessionId, stepKey, step_key, status, totalCount }) {
    const key = stepKey || step_key;
    const now = new Date().toISOString();
    const batch = {
      erc,
      session_id: sessionId,
      step_key: key,
      status,
      downstream_batch_id: null,
      processed_count: 0,
      total_count: totalCount || 0,
      error_count: 0,
      created_at: now,
      updated_at: now,
    };

    this.db.get('batches').push(batch).write();

    this.cache.del(`batches-${sessionId}`);
    this.cache.put(`batch-${erc}`, _.cloneDeep(batch));

    return batch;
  }

  getBatch(erc) {
    const cacheKey = `batch-${erc}`;
    const cachedBatch = this.cache.get(cacheKey);

    if (cachedBatch) {
      return cachedBatch;
    }

    const batch = this.db.get('batches').find({ erc }).value();

    if (batch) {
      const result = _.cloneDeep(batch);
      this.cache.put(cacheKey, result);
      return result;
    }

    return null;
  }

  getBatchesForSession(sessionId) {
    const cacheKey = `batches-${sessionId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const batches = this.db.get('batches').filter({ session_id: sessionId }).value();

    if (batches) {
      const result = _.cloneDeep(batches);
      this.cache.put(cacheKey, result);
      return result;
    }

    return [];
  }

  getEventsForSession(sessionId) {
    const events = this.db
      .get('events')
      .filter({ session_id: sessionId })
      .orderBy(['timestamp'], ['asc'])
      .value();

    return _.cloneDeep(events);
  }

  updateBatch(
    erc,
    { status, downstreamBatchId, processedCount, totalCount, errorCount }
  ) {
    const updates = { updated_at: new Date().toISOString() };

    if (status) updates.status = status;
    if (downstreamBatchId !== undefined) updates.downstream_batch_id = downstreamBatchId;
    if (processedCount !== undefined) updates.processed_count = processedCount;
    if (totalCount !== undefined) updates.total_count = totalCount;
    if (errorCount !== undefined) updates.error_count = errorCount;

    this.db.get('batches').find({ erc }).assign(updates).write();

    const batch = this.db.get('batches').find({ erc }).value();
    if (batch) {
      this.cache.del(`batches-${batch.session_id}`);
    }

    this.cache.del(`batch-${erc}`);

    return batch ? _.cloneDeep(batch) : null;
  }

  getBatchByDownstreamId(downstreamBatchId) {
    const batch = this.db
      .get('batches')
      .find({ downstream_batch_id: downstreamBatchId })
      .value();
    return batch ? _.cloneDeep(batch) : null;
  }

  clearAll() {
    this.db.set('events', []).set('batches', []).set('sessions', []).write();
    this.cache.clear();
  }

  cleanup(cutoffTimestamp) {
    this.db
      .get('events')
      .remove((e) => e.timestamp < cutoffTimestamp)
      .write();
    this.db
      .get('batches')
      .remove((b) => b.created_at < cutoffTimestamp)
      .write();
    this.db
      .get('sessions')
      .remove((s) => s.created_at < cutoffTimestamp)
      .write();
    this.cache.clear();
  }

  logWorkflowEvent({ sessionId, batchId, status, message, details }) {
    const event = {
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      batch_id: batchId,
      status,
      message,
      details,
    };
    this.db.get('events').push(event).write();
  }
}

module.exports = PersistenceService;
