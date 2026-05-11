import { vi, describe, it, expect, beforeEach } from "vitest";
const { http, HttpResponse } = require("msw");
const { server } = require("./mocks/server.cjs");

// Set global process env for the SDK to pick up
process.env.LIFERAY_RETRY_DELAY_MS = "1";

// Mock config-node
vi.doMock("@rotty3000/config-node", () => ({
  lxcConfig: {
    oauthApplication: vi.fn().mockReturnValue({}),
    userAgentApplication: vi.fn().mockReturnValue({}),
    dxpMainDomain: vi.fn().mockReturnValue("localhost"),
    dxpProtocol: vi.fn().mockReturnValue("http"),
  },
  lookupConfig: vi.fn().mockReturnValue(null),
}));

const LiferayRestService = require("../src/liferay/rest.cjs");

describe("SDK Resilience & Retry", () => {
  let restService;
  let mockCtx;
  const config = {
    liferayUrl: "http://localhost:8080",
    clientId: "test-id",
    clientSecret: "test-secret",
  };

  beforeEach(() => {
    const mockCache = new Map();
    mockCtx = {
      cache: {
        get: vi.fn((key) => mockCache.get(key)),
        set: vi.fn((key, value) => mockCache.set(key, value)),
        delete: vi.fn((key) => mockCache.delete(key)),
        clear: vi.fn(() => mockCache.clear()),
      },
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        trace: vi.fn(),
      },
      oauth: {
        getAccessToken: vi.fn().mockResolvedValue("test-token"),
      },
    };

    restService = new LiferayRestService(mockCtx);
  });

  it("should retry on transient failures and eventually succeed", async () => {
    let attempts = 0;

    server.use(
      http.get("http://localhost:8080/o/test-retry-success", () => {
        attempts++;
        if (attempts < 3) {
          return new HttpResponse(null, { status: 500 });
        }
        return HttpResponse.json({ success: true });
      }),
    );

    const result = await restService._request(config, {
      method: "GET",
      url: "/o/test-retry-success",
      op: "test-op",
    });

    expect(attempts).toBe(3);
    expect(result.success).toBe(true);
  });

  it("should fail after maximum retries", async () => {
    let attempts = 0;

    server.use(
      http.get("http://localhost:8080/o/test-retry-fail", () => {
        attempts++;
        return new HttpResponse(null, { status: 500 });
      }),
    );

    await expect(
      restService._request(config, {
        method: "GET",
        url: "/o/test-retry-fail",
        op: "test-op",
      }),
    ).rejects.toThrow();

    expect(attempts).toBe(3);
  });
});
