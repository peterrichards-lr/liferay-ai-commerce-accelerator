const { EventEmitter } = require('events');
const { createWebSocketService } = require('../services/webSocketService.cjs');

describe('WebSocketService', () => {
  let wsService;
  let mockLogger;
  let mockServer;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    };

    mockServer = {
      on: vi.fn(),
    };

    wsService = createWebSocketService({ logger: mockLogger });
  });

  it('should initialize correctly', () => {
    wsService.init(mockServer);
    expect(mockServer.on).toHaveBeenCalledWith('upgrade', expect.any(Function));
  });

  it('should handle broadcast', async () => {
    // Mock clients
    const mockWs = {
      readyState: 1, // WebSocket.OPEN
      send: vi.fn(),
      id: 'test-client',
    };
    wsService.clients.set('test-client', mockWs);

    const event = { type: 'test' };
    await wsService.broadcast(event);

    expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify(event));
  });

  it('should close correctly', () => {
    const mockWs = {
      close: vi.fn(),
    };
    wsService.clients.set('test-client', mockWs);

    // Mock heartbeat timer
    wsService.heartbeatTimer = setInterval(() => {}, 1000);

    wsService.close();

    expect(mockWs.close).toHaveBeenCalled();
  });

  describe('upgrade handshake authentication', () => {
    let verifyBearerToken;
    let resolveLiferayUrl;

    function getUpgradeHandler() {
      // wsService.init(mockServer) registers the 'upgrade' listener via
      // mockServer.on -- capture that callback to invoke it directly with
      // fake request/socket objects, rather than needing a real HTTP upgrade.
      const call = mockServer.on.mock.calls.find(
        ([event]) => event === 'upgrade'
      );
      return call[1];
    }

    function mockSocket(remoteAddress) {
      // A real EventEmitter gives ws's real handleUpgrade (called once our
      // own auth check passes) everything it needs (on/once/removeListener)
      // without throwing -- ws's own WS-protocol-header validation isn't
      // what's under test here, only that our auth check didn't reject the
      // connection. write/destroy are spied on to assert our own rejection
      // path specifically.
      const socket = new EventEmitter();
      socket.remoteAddress = remoteAddress;
      socket.write = vi.fn();
      socket.end = vi.fn();
      socket.destroy = vi.fn();
      return socket;
    }

    beforeEach(() => {
      verifyBearerToken = vi.fn();
      resolveLiferayUrl = vi.fn(() => 'http://localhost:8080');
      wsService = createWebSocketService({
        logger: mockLogger,
        verifyBearerToken,
        resolveLiferayUrl,
      });
      wsService.init(mockServer);
    });

    it('rejects a non-loopback connection with no token query param', async () => {
      const upgradeHandler = getUpgradeHandler();
      const socket = mockSocket('203.0.113.1');
      const request = { url: '/ws', headers: {} };

      await upgradeHandler(request, socket, Buffer.alloc(0));

      expect(verifyBearerToken).not.toHaveBeenCalled();
      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('401'));
      expect(socket.destroy).toHaveBeenCalled();
    });

    it('rejects a non-loopback connection with an invalid token', async () => {
      verifyBearerToken.mockRejectedValue(new Error('Invalid JWT'));
      const upgradeHandler = getUpgradeHandler();
      const socket = mockSocket('203.0.113.1');
      const request = { url: '/ws?token=bad-token', headers: {} };

      await upgradeHandler(request, socket, Buffer.alloc(0));

      expect(verifyBearerToken).toHaveBeenCalledWith(
        'bad-token',
        'http://localhost:8080'
      );
      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('401'));
      expect(socket.destroy).toHaveBeenCalled();
    });

    it('allows a non-loopback connection with a valid token', async () => {
      verifyBearerToken.mockResolvedValue({ sub: '123' });
      const upgradeHandler = getUpgradeHandler();
      const socket = mockSocket('203.0.113.1');
      const request = { url: '/ws?token=good-token', headers: {} };

      await upgradeHandler(request, socket, Buffer.alloc(0));

      expect(verifyBearerToken).toHaveBeenCalledWith(
        'good-token',
        'http://localhost:8080'
      );
      expect(socket.destroy).not.toHaveBeenCalled();
    });

    it('allows a loopback connection with no token (CLI/local dev bypass)', async () => {
      const upgradeHandler = getUpgradeHandler();
      const socket = mockSocket('127.0.0.1');
      const request = { url: '/ws', headers: {} };

      await upgradeHandler(request, socket, Buffer.alloc(0));

      expect(verifyBearerToken).not.toHaveBeenCalled();
      expect(socket.destroy).not.toHaveBeenCalled();
    });
  });
});
