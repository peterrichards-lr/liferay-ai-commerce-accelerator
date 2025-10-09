const fs = require('fs');
const path = require('path');
const util = require('util');

const { env } = require('./constants.cjs');

const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

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
    this.loggingLevel = this.determineLoggingLevel(env.LOGGER_LEVEL);
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
        return 0; // Success and error will continue to be loggedd
    }
  }

  _nowIso() {
    return new Date().toISOString();
  }

  _normalizeMessage(message, spacer = ' ') {
    let normalized = message
      .replace(/\"/g, "'")
      .replace(/\r\n/g, '\n')
      .replace(/\n\s*/g, spacer)
      .trim();
      
    return spacer === '\n' ? spacer + normalized : normalized;
  }

  _asJsonLine(level, message, timestamp, meta = {}) {
    const correlationId = meta.correlationId || 'system';
    const userId = meta.userId || null;
    const operation = meta.operation || null;

    // Remove special items
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
      message: message ? this._normalizeMessage(message) : '',
      correlationId,
      userId,
      operation,
      environment: env.NODE_ENV,
      service: env.SERVICE_NAME,
      version: env.SERVICE_VERSION,
      ...meta,
    };

    // Remove null/undefined values for cleaner logs
    Object.keys(logEntry).forEach((key) => {
      if (logEntry[key] === null || logEntry[key] === undefined) {
        delete logEntry[key];
      }
    });

    return JSON.stringify(logEntry);
  }

  _asPretty(level, message, timestamp, meta = {}) {
    const color = COLORS[level] || '';
    const reset = COLORS.RESET;

    const head = `${color}${timestamp} ${level}${reset}`;
    const core =
      typeof message === 'string'
        ? this._normalizeMessage(message, '\n')
        : util.inspect(message, { depth: 4, colors: true });

    const tailMeta =
      meta && Object.keys(meta).length
        ? `\n${color}meta:${reset} ${util.inspect(meta, {
            depth: 2,
            colors: true,
          })}`
        : '';

    return `${head} ${core}${tailMeta}`;
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
    if (env.LOG_PRETTY) {
      out.write(this._asPretty(level, message, timestamp, meta) + '\n');
    } else {
      out.write(jsonLine + '\n');
    }
  }

  isLogEnabled = () => isTraceEnabled();

  isTraceEnabled = () => this.loggingLevel >= 4;

  isDebugEnabled = () => this.loggingLevel >= 3;

  isInfoEnabled = () => this.loggingLevel >= 2;

  isWarnEnabled = () => this.loggingLevel >= 1;

  isErrorEnabled = () => true;

  isSuccessEnabled = () => true;

  // Same as trace
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
}

// Create singleton instance
const logger = new Logger();

module.exports = { logger };
