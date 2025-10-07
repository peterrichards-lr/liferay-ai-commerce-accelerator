const fs = require('fs');
const path = require('path');

const {env} = require('./constants.cjs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

class Logger {
  constructor() {
    this.logFile = path.join(
      logsDir,
      `app-${new Date().toISOString().split('T')[0]}.log`
    );
  }

  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const correlationId = meta.correlationId || 'system';
    const userId = meta.userId || null;
    const operation = meta.operation || null;

    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      correlationId,
      userId,
      operation,
      environment: env.NODE_ENV,
      service: 'liferay-ai-data-microservice',
      version: '1.0.0',
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

  writeToFile(logEntry) {
    try {
      fs.appendFileSync(this.logFile, logEntry + '\n');
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }

  log(level, message, meta = {}) {
    const formattedMessage = this.formatMessage(level, message, meta);

    // Write to console with color coding
    const colors = {
      info: '\x1b[36m', // Cyan
      warn: '\x1b[33m', // Yellow
      error: '\x1b[31m', // Red
      debug: '\x1b[35m', // Magenta
      success: '\x1b[32m', // Green
      reset: '\x1b[0m', // Reset
    };

    console.log(`${colors[level] || ''}${formattedMessage}${colors.reset}`);

    // Write to file
    this.writeToFile(formattedMessage);
  }

  info(message, meta = {}) {
    this.log('info', message, meta);
  }

  warn(message, meta = {}) {
    this.log('warn', message, meta);
  }

  error(message, meta = {}) {
    this.log('error', message, meta);
  }

  debug(message, meta = {}) {
    if (
      env.NODE_ENV === 'development' ||
      env.DEBUG === true
    ) {
      this.log('debug', message, meta);
    }
  }

  success(message, meta = {}) {
    this.log('success', message, meta);
  }

  // HTTP request logging
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

    const level = res.statusCode >= 400 ? 'warn' : 'info';
    this.log(level, `HTTP Request completed`, meta);
  }

  // AI operation logging
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

  // Data generation logging
  dataGeneration(type, count, batchSize, meta = {}) {
    this.info(`Data generation: ${type}`, {
      ...meta,
      operation: `generate-${type}`,
      dataType: type,
      dataCount: count,
      batchSize,
    });
  }

  // Error with stack trace
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
