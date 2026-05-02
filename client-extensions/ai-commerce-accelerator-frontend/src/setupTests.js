import '@testing-library/jest-dom';
import { beforeAll, afterEach, afterAll, vi } from 'vitest';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' });
  window.scrollTo = vi.fn();

  // Suppress warnings for unhandled AI config requests
  server.use(
    http.get('*/api/v1/config/ai', () => {
      return HttpResponse.json({ success: true, config: { ai: {} } });
    }),
    http.get('*/', () => {
      return HttpResponse.json({});
    })
  );
});
afterEach(() => {
  server.resetHandlers();
  vi.clearAllTimers();
});
afterAll(() => {
  server.close();
  vi.clearAllTimers();
});
