import '@testing-library/jest-dom';
import { beforeAll, afterEach, afterAll, vi } from 'vitest';
import { server } from './mocks/server';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' });
  window.scrollTo = vi.fn();
});
afterEach(() => {
  server.resetHandlers();
  vi.clearAllTimers();
});
afterAll(() => {
  server.close();
  vi.clearAllTimers();
});
