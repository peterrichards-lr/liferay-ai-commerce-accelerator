const logger = require('./logger.cjs');

class ErrorHandler {
  static handleError(error, req, res, _) {
    logger.error('Error occurred:', error);

    let status = 500;
    let message = 'Internal server error';
    let details = null;

    if (error.response) {
      status = error.response.status || 500;
      message =
        error.response.data?.title || error.response.statusText || message;
      details = error.response.data;
    } else if (error.message) {
      message = error.message;
      if (error.status) {
        status = error.status;
      }
    }

    // Default to logging all errors in the SDK
    logger.error('Error details:', {
      status,
      message,
      details,
      url: req.url,
      method: req.method,
      timestamp: new Date().toISOString(),
      stack: error.stack,
    });

    res.status(status).json({
      success: false,
      error: message,
      details: details,
      timestamp: new Date().toISOString(),
    });
  }

  static createError(message, status = 500, details = null) {
    const error = new Error(message);
    error.status = status;
    error.details = details;
    return error;
  }

  static handleLiferayError(error, operation = 'unknown', requestBody = null) {
    logger.error(`Liferay ${operation} error:`, error);

    if (error.response) {
      const { status, data } = error.response;

      switch (status) {
        case 400:
          if (requestBody) {
            logger.error(`Request body that caused 400 BAD REQUEST:`, {
              payload: requestBody,
            });
          }
          return this.createError(
            `Bad request: ${data?.title || 'Invalid data provided'}`,
            400,
            data
          );
        case 401:
          return this.createError(
            'Authentication failed. Please check your credentials.',
            401,
            data
          );
        case 403:
          return this.createError(
            'Access denied. Insufficient permissions.',
            403,
            data
          );
        case 404:
          return this.createError(
            `Resource not found: ${
              data?.title || 'The requested resource does not exist'
            }`,
            404,
            data
          );
        case 409:
          return this.createError(
            `Conflict: ${
              data?.title ||
              'Resource already exists or conflicts with existing data'
            }`,
            409,
            data
          );
        case 422:
          return this.createError(
            `Validation error: ${data?.title || 'Invalid data format'}`,
            422,
            data
          );
        case 429:
          return this.createError(
            'Rate limit exceeded. Please try again later.',
            429,
            data
          );
        case 500:
          return this.createError(
            `Liferay server error: ${data?.title || 'Internal server error'}`,
            500,
            data
          );
        default:
          return this.createError(
            `Liferay API error (${status}): ${data?.title || error.message}`,
            status,
            data
          );
      }
    }

    if (error.code === 'ECONNREFUSED') {
      return this.createError(
        'Connection refused. Please check if Liferay is running and accessible.',
        503
      );
    }

    if (error.code === 'ETIMEDOUT') {
      return this.createError(
        'Request timeout. Liferay server may be slow or unresponsive.',
        504
      );
    }

    return this.createError(`${operation} failed: ${error.message}`, 500);
  }

  static handleBatchErrors(errors, operation = 'batch operation') {
    const errorSummary = {
      total: errors.length,
      byType: {},
      messages: [],
    };

    errors.forEach((error) => {
      const type = error.status || 'unknown';
      errorSummary.byType[type] = (errorSummary.byType[type] || 0) + 1;
      errorSummary.messages.push(error.message || error.toString());
    });

    logger.error(
      `Batch ${operation} completed with ${errors.length} errors:`,
      errorSummary
    );

    return errorSummary;
  }

  static isRetryableError(error) {
    if (!error.response) return true;

    const status = error.response.status;

    return status >= 500 || status === 429;
  }

  static shouldStopBatch(errors, maxErrors = 50) {
    return errors.length >= maxErrors;
  }
}

const errorMiddleware = (error, req, res, next) => {
  ErrorHandler.handleError(error, req, res, next);
};

ErrorHandler.handleError = (error, req, res, _) => {
  let statusCode = 500;
  if (error.statusCode) {
    statusCode = error.statusCode;
  } else if (
    error.message?.includes('404') ||
    error.message?.includes('not found')
  ) {
    statusCode = 404;
  } else if (
    error.message?.includes('401') ||
    error.message?.includes('unauthorized')
  ) {
    statusCode = 401;
  } else if (
    error.message?.includes('403') ||
    error.message?.includes('forbidden')
  ) {
    statusCode = 403;
  }

  if (statusCode === 500) {
    logger.error('Internal Server Error - Request Details:', {
      method: req.method,
      url: req.url,
      path: req.path,
      query: req.query,
      body: req.body,
      headers: req.headers,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      correlationId: req.correlationId,
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });
  }

  res.status(statusCode).json({
    success: false,
    error: error.message || 'Internal server error',
    correlationId: req.correlationId,
    timestamp: new Date().toISOString(),
  });
};

module.exports = { ErrorHandler, errorMiddleware };
module.exports.ErrorHandler = ErrorHandler;
module.exports.middleware = errorMiddleware;
