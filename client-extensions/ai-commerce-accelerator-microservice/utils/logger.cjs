const fs = require('fs');
const path = require('path');
const util = require('util');

const { ENV } = require('./constants.cjs');

const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Handle EPIPE errors on stdout/stderr to avoid uncaught exceptions during shutdown
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') return;
  console.error('stdout error:', err);
});

process.stderr.on('error', (err) => {
  if (err.code === 'EPIPE') return;
  console.error('stderr error:', err);
});

const COLORS = {
  TRACE: '\x1b[30m', // Black
  DEBUG: '\x1b[35m', // Magenta
  INFO: '\x1b[36m', // Cyan
  WARN: '\x1b[33m', // Yellow
  ERROR: '\x1b[31m', // Red
  SUCCESS: '\x1b[32m', // Green
  RESET: '\x1b[0m', // Reset
};

class Logger {
  constructor() {
    this.logFile = path.join(
      logsDir,
      `app-${new Date().toISOString().split('T')[0]}.log`
    );
    this.loggingLevel = this.determineLoggingLevel(ENV.LOGGER_LEVEL);
  }

  determineLoggingLevel(loggingLevel) {
    switch (loggingLevel) {
      case 'trace':
        return 4;
      case 'debug':
        return 3;
      case 'info':
        return 2;
      case 'warn':
        return 1;
      default:
        return 0;
    }
  }

  _nowIso() {
    return new Date().toISOString();
  }

  _normalizeMessage(message, spacer = ' ') {
    let normalized = message
      .replace(/"/g, "'")
      .replace(/\r\n/g, '\n')
      .replace(/\n\s*/g, spacer)
      .trim();

    return spacer === '\n' ? spacer + normalized : normalized;
  }

  _asJsonLine(level, message, timestamp, meta = {}) {
    const correlationId = meta.correlationId || 'system';
    const userId = meta.userId || null;
    const operation = meta.operation || null;

    Object.keys(meta).forEach((key) => {
      if (
        key.toLowerCase() === 'correlationId' ||
        key.toLowerCase() === 'userId' ||
        key.toLowerCase() === 'operation'
      ) {
        delete meta[key];
      }
    });

    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message: message ? message : '',
      correlationId,
      userId,
      operation,
      environment: ENV.NODE_ENV,
      service: ENV.SERVICE_NAME,
      version: ENV.SERVICE_VERSION,
      ...meta,
    };

    Object.keys(logEntry).forEach((key) => {
      if (logEntry[key] === null || logEntry[key] === undefined) {
        delete logEntry[key];
      }
    });

    let json = JSON.stringify(logEntry, null, 2);

    // If we have a queryForGraphiQL field, we want to make it literal in the logs
    // so it can be copy-pasted without escaped newlines or quotes around internal strings
    if (logEntry.queryForGraphiQL) {
      const escaped = JSON.stringify(logEntry.queryForGraphiQL);
      // Remove surrounding quotes and replace escaped newlines with actual newlines
      const literal = logEntry.queryForGraphiQL;
      json = json.replace(escaped, '`' + literal.replace(/`/g, "'") + '`');
    }

    return json;
  }

  _asPretty(level, message, timestamp, meta = {}) {
    const color = COLORS[level] || '';
    const reset = COLORS.RESET;

    const head = `${color}${timestamp} ${level}${reset}`;
    const core =
      typeof message === 'string'
        ? this._normalizeMessage(message, '\n')
        : util.inspect(message, { depth: 4, colors: true });

    // Extract queryForGraphiQL to print it raw instead of letting util.inspect escape it
    const { queryForGraphiQL, ...otherMeta } = meta;

    const tailMeta =
      otherMeta && Object.keys(otherMeta).length
        ? `\n${color}meta:${reset} ${util.inspect(otherMeta, {
            depth: null,
            colors: true,
          })}`
        : '';

    const graphiQL = queryForGraphiQL
      ? `\n${color}queryForGraphiQL:${reset}\n${queryForGraphiQL}`
      : '';

    return `${head} ${core}${tailMeta}${graphiQL}`;
  }

  _writeToFile(logEntry) {
    try {
      fs.appendFileSync(this.logFile, logEntry + '\n');
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }

  _log(level, message, meta = {}) {
    const timestamp = this._nowIso();
    const jsonLine = this._asJsonLine(level, message, timestamp, meta);
    this._writeToFile(jsonLine);

    const out =
      level === 'ERROR' || level === 'WARN' ? process.stderr : process.stdout;

    if (out.writable) {
      try {
        if (ENV.LOGGER_PRETTY) {
          out.write(this._asPretty(level, message, timestamp, meta) + '\n');
        } else {
          out.write(jsonLine + '\n');
        }
      } catch (err) {
        if (err.code !== 'EPIPE') {
          console.error('Logger write error:', err.message);
        }
      }
    }
  }

  isLogEnabled() {
    return this.isTraceEnabled();
  }

  isTraceEnabled() {
    return this.loggingLevel >= 4;
  }

  isDebugEnabled() {
    return this.loggingLevel >= 3;
  }

  isInfoEnabled() {
    return this.loggingLevel >= 2;
  }

  isWarnEnabled() {
    return this.loggingLevel >= 1;
  }

  isErrorEnabled() {
    return true;
  }
  isSuccessEnabled = () => true;

  log(message, meta = {}) {
    this.trace(message, meta);
  }

  trace(message, meta = {}) {
    if (this.isTraceEnabled()) {
      this._log('TRACE', message, meta);
    }
  }

  debug(message, meta = {}) {
    if (this.isDebugEnabled()) {
      this._log('DEBUG', message, meta);
    }
  }

  info(message, meta = {}) {
    if (this.isInfoEnabled()) {
      this._log('INFO', message, meta);
    }
  }

  warn(message, meta = {}) {
    if (this.isWarnEnabled()) {
      this._log('WARN', message, meta);
    }
  }

  error(message, meta = {}) {
    this._log('ERROR', message, meta);
  }

  success(message, meta = {}) {
    this._log('SUCCESS', message, meta);
  }

  httpRequest(req, res, duration) {
    const meta = {
      correlationId: req.correlationId,
      userId: req.user?.claims?.sub,
      operation: `${req.method} ${req.path}`,
      httpMethod: req.method,
      httpPath: req.path,
      httpStatusCode: res.statusCode,
      httpDuration: duration,
      httpUserAgent: req.get('User-Agent'),
      httpRemoteAddr: req.ip || req.connection.remoteAddress,
    };

    if (res.statusCode >= 400) {
      this.warn('HTTP Request completed', meta);
    } else {
      this.trace('HTTP Request completed', meta);
    }
  }

  aiOperation(operation, model, tokens, cost, meta = {}) {
    this.info(`AI operation completed: ${operation}`, {
      ...meta,
      operation,
      aiModel: model,
      aiTokens: tokens,
      aiCost: cost,
      aiProvider: 'openai',
    });
  }

  errorWithStack(error, meta = {}) {
    this.error(error.message, {
      ...meta,
      errorName: error.name,
      errorStack: error.stack,
      errorCode: error.code,
    });
  }

  async close() {
    // Current implementation is synchronous, but we provide this for graceful shutdown
    // and potential future async transitions.
    return Promise.resolve();
  }
}

const logger = new Logger();

module.exports = { logger };
