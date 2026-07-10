const { ErrorHandler, errorMiddleware } = require('../utils/errorHandler.cjs');
const logger = require('../utils/logger.cjs');

vi.mock('../utils/logger.cjs', () => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

describe('ErrorHandler', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    vi.clearAllMocks();

    req = {
      method: 'POST',
      url: '/api/generate',
      path: '/api/generate',
      query: { dryRun: 'true' },
      body: { productCount: 10 },
      headers: { 'content-type': 'application/json' },
      ip: '127.0.0.1',
      get: vi.fn().mockReturnValue('MockUserAgent'),
      correlationId: 'test-correlation-id',
    };

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    next = vi.fn();
  });

  describe('handleError & middleware', () => {
    it('should handle standard Axios response error shapes', () => {
      const error = {
        response: {
          status: 400,
          data: { title: 'Bad Input Data' },
        },
      };

      ErrorHandler.handleError(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Bad Input Data',
          correlationId: 'test-correlation-id',
        })
      );
    });

    it('should parse application status property on error object', () => {
      const error = new Error('Custom validation failed');
      error.statusCode = 422;

      ErrorHandler.handleError(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Custom validation failed',
        })
      );
    });

    it('should parse 404 from error message keywords', () => {
      const error = new Error('Product not found in this catalog');

      ErrorHandler.handleError(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should parse 401 from error message keywords', () => {
      const error = new Error('401 Unauthorized access');

      ErrorHandler.handleError(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should parse 403 from error message keywords', () => {
      const error = new Error('forbidden operation');

      ErrorHandler.handleError(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should fallback to 500 status and log request details on internal errors', () => {
      const error = new Error('Database connection failed');

      ErrorHandler.handleError(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(logger.error).toHaveBeenCalledWith(
        'Internal Server Error - Request Details:',
        expect.objectContaining({
          method: 'POST',
          url: '/api/generate',
          ip: '127.0.0.1',
          userAgent: 'MockUserAgent',
        })
      );
    });

    it('should run as Express error middleware', () => {
      const error = new Error('Express route crash');
      error.statusCode = 400;

      errorMiddleware(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Express route crash',
        })
      );
    });
  });

  describe('handleLiferayError', () => {
    it('should handle 400 Bad Request and log request body if provided', () => {
      const error = {
        response: {
          status: 400,
          data: { title: 'Missing required field' },
        },
      };

      const result = ErrorHandler.handleLiferayError(error, 'create-product', {
        name: 'test',
      });

      expect(result.status).toBe(400);
      expect(result.message).toBe('Bad request: Missing required field');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Request body that caused 400'),
        expect.any(Object)
      );
    });

    it('should handle 401 Unauthorized', () => {
      const error = {
        response: {
          status: 401,
          data: { title: 'Expired token' },
        },
      };

      const result = ErrorHandler.handleLiferayError(error, 'oauth');

      expect(result.status).toBe(401);
      expect(result.message).toContain('Authentication failed');
    });

    it('should handle 403 Forbidden', () => {
      const error = {
        response: {
          status: 403,
          data: { title: 'Forbidden access' },
        },
      };

      const result = ErrorHandler.handleLiferayError(error, 'oauth');

      expect(result.status).toBe(403);
      expect(result.message).toContain('Access denied');
    });

    it('should handle 404 Not Found', () => {
      const error = {
        response: {
          status: 404,
          data: { title: 'Product 10 not found' },
        },
      };

      const result = ErrorHandler.handleLiferayError(error, 'get-product');

      expect(result.status).toBe(404);
      expect(result.message).toContain(
        'Resource not found: Product 10 not found'
      );
    });

    it('should handle 409 Conflict', () => {
      const error = {
        response: {
          status: 409,
          data: { title: 'Entity already exists' },
        },
      };

      const result = ErrorHandler.handleLiferayError(error, 'create-product');

      expect(result.status).toBe(409);
      expect(result.message).toContain('Conflict');
    });

    it('should handle 422 Unprocessable Entity', () => {
      const error = {
        response: {
          status: 422,
          data: { title: 'Invalid SKU format' },
        },
      };

      const result = ErrorHandler.handleLiferayError(error, 'create-sku');

      expect(result.status).toBe(422);
      expect(result.message).toContain('Validation error');
    });

    it('should handle 429 Rate Limit', () => {
      const error = {
        response: {
          status: 429,
          data: { title: 'Too many requests' },
        },
      };

      const result = ErrorHandler.handleLiferayError(error, 'api-request');

      expect(result.status).toBe(429);
      expect(result.message).toContain('Rate limit exceeded');
    });

    it('should handle 500 Server Error', () => {
      const error = {
        response: {
          status: 500,
          data: { title: 'NullPointerException inside Liferay' },
        },
      };

      const result = ErrorHandler.handleLiferayError(error, 'api-request');

      expect(result.status).toBe(500);
      expect(result.message).toContain('Liferay server error');
    });

    it('should handle default fallback status codes', () => {
      const error = {
        response: {
          status: 502,
          data: { title: 'Bad Gateway' },
        },
      };

      const result = ErrorHandler.handleLiferayError(error, 'api-request');

      expect(result.status).toBe(502);
      expect(result.message).toContain('Liferay API error (502)');
    });

    it('should handle ECONNREFUSED socket failures', () => {
      const error = { code: 'ECONNREFUSED' };

      const result = ErrorHandler.handleLiferayError(error, 'connection');

      expect(result.status).toBe(503);
      expect(result.message).toContain('Connection refused');
    });

    it('should handle ETIMEDOUT socket failures', () => {
      const error = { code: 'ETIMEDOUT' };

      const result = ErrorHandler.handleLiferayError(error, 'connection');

      expect(result.status).toBe(504);
      expect(result.message).toContain('Request timeout');
    });

    it('should handle generic non-status errors', () => {
      const error = new Error('Internal memory failure');

      const result = ErrorHandler.handleLiferayError(error, 'process');

      expect(result.status).toBe(500);
      expect(result.message).toBe('process failed: Internal memory failure');
    });
  });

  describe('handleBatchErrors', () => {
    it('should aggregate and format multiple errors into a summary', () => {
      const errors = [
        { status: 400, message: 'Invalid SKU' },
        { status: 404, message: 'Product not found' },
        new Error('Network error'),
      ];

      const result = ErrorHandler.handleBatchErrors(errors, 'upsert-products');

      expect(result.total).toBe(3);
      expect(result.byType).toEqual({
        400: 1,
        404: 1,
        unknown: 1,
      });
      expect(result.messages).toEqual([
        'Invalid SKU',
        'Product not found',
        'Network error',
      ]);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('isRetryableError', () => {
    it('should return true if error does not have a response object', () => {
      const error = new Error('Local connection failure');
      expect(ErrorHandler.isRetryableError(error)).toBe(true);
    });

    it('should return true for status >= 500 or 429', () => {
      const error500 = { response: { status: 500 } };
      const error429 = { response: { status: 429 } };

      expect(ErrorHandler.isRetryableError(error500)).toBe(true);
      expect(ErrorHandler.isRetryableError(error429)).toBe(true);
    });

    it('should return false for status < 500 (except 429)', () => {
      const error400 = { response: { status: 400 } };
      const error404 = { response: { status: 404 } };

      expect(ErrorHandler.isRetryableError(error400)).toBe(false);
      expect(ErrorHandler.isRetryableError(error404)).toBe(false);
    });
  });

  describe('shouldStopBatch', () => {
    it('should return true if error count equals or exceeds maxErrors', () => {
      const errors = [new Error('E1'), new Error('E2')];
      expect(ErrorHandler.shouldStopBatch(errors, 2)).toBe(true);
      expect(ErrorHandler.shouldStopBatch(errors, 1)).toBe(true);
    });

    it('should return false if error count is below maxErrors', () => {
      const errors = [new Error('E1')];
      expect(ErrorHandler.shouldStopBatch(errors, 5)).toBe(false);
    });
  });
});
