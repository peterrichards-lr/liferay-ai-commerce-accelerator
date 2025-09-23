const liferayConfig = require('../config/liferayConfig.cjs');

class ErrorHandler {
  static handleError(error, req, res, next) {
    console.error('Error occurred:', error);

    // Default error response
    let status = 500;
    let message = 'Internal server error';
    let details = null;

    // Handle different types of errors
    if (error.response) {
      // Axios/HTTP errors
      status = error.response.status || 500;
      message =
        error.response.data?.title || error.response.statusText || message;
      details = error.response.data;
    } else if (error.message) {
      // Custom errors with messages
      message = error.message;
      if (error.status) {
        status = error.status;
      }
    }

    // Log error details if configured
    if (liferayConfig.errorConfig.logErrors) {
      console.error('Error details:', {
        status,
        message,
        details,
        url: req.url,
        method: req.method,
        timestamp: new Date().toISOString(),
        stack: liferayConfig.errorConfig.includeStackTrace
          ? error.stack
          : undefined,
      });
    }

    // Send error response
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
    console.error(`Liferay ${operation} error:`, error);

    if (error.response) {
      const { status, data } = error.response;

      // Handle specific Liferay error patterns
      switch (status) {
        case 400:
          // Log the request body for 400 BAD REQUEST errors
          if (requestBody) {
            console.error(`Request body that caused 400 BAD REQUEST:`, JSON.stringify(requestBody, null, 2));
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

    // Handle network or other errors
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

    // Generic error fallback
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

    console.error(
      `Batch ${operation} completed with ${errors.length} errors:`,
      errorSummary
    );

    return errorSummary;
  }

  static isRetryableError(error) {
    if (!error.response) return true; // Network errors are retryable

    const status = error.response.status;

    // Retry on server errors and rate limiting
    return status >= 500 || status === 429;
  }

  static shouldStopBatch(
    errors,
    maxErrors = liferayConfig.errorConfig.maxErrorsPerOperation
  ) {
    return errors.length >= maxErrors;
  }
}

// Express error handling middleware
const errorMiddleware = (error, req, res, next) => {
  ErrorHandler.handleError(error, req, res, next);
};

// Enhanced error handling with request logging for 500 errors
ErrorHandler.handleError = (error, req, res, next) => {
  // Determine status code
  let statusCode = 500;
  if (error.statusCode) {
    statusCode = error.statusCode;
  } else if (error.message?.includes('404') || error.message?.includes('not found')) {
    statusCode = 404;
  } else if (error.message?.includes('401') || error.message?.includes('unauthorized')) {
    statusCode = 401;
  } else if (error.message?.includes('403') || error.message?.includes('forbidden')) {
    statusCode = 403;
  }

  // Log full request details for Internal Server Errors (500)
  if (statusCode === 500) {
    console.error('Internal Server Error - Request Details:', {
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
        name: error.name
      }
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