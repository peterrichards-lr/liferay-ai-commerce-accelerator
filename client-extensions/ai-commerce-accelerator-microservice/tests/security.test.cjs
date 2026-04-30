const { sqlInjectionProtectionMiddleware } = require('../middleware/securityMiddleware.cjs');
const { logger } = require('../utils/logger.cjs');

describe('Security Middleware - SQL Injection', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = {
      path: '/api/v1/batch/callback',
      query: {},
      body: {},
      correlationId: 'test-cid'
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    };
    next = vi.fn();
  });

  it('should allow legitimate batch operation codes in callback path', () => {
    const operations = ['create', 'update', 'delete', 'upsert', 'CREATE', 'UPDATE'];
    
    operations.forEach(op => {
      req.query.opCode = op;
      sqlInjectionProtectionMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalledWith(400);
      next.mockClear();
    });
  });

  it('should still block actual SQL keywords in other fields', () => {
    req.query.otherField = 'SELECT * FROM users';
    sqlInjectionProtectionMiddleware(req, res, next);
    
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('should block SQL keywords in opCode if path is not callback', () => {
    req.path = '/api/v1/other-endpoint';
    req.query.opCode = 'CREATE';
    
    sqlInjectionProtectionMiddleware(req, res, next);
    
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
