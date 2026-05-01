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
});
