import { useMemo } from 'react';

/**
 * useApi hook for communicating with the microservice.
 * @param {string} microserviceUrl - The base URL of the microservice.
 */
export const useApi = (microserviceUrl) => {
  return useMemo(() => {
    const baseUrl = microserviceUrl?.replace(/\/$/, '') || '';

    const request = async (path, options = {}) => {
      const url = `${baseUrl}${path}`;
      const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
      };

      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `HTTP ${response.status}: ${text || response.statusText}`
        );
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }

      if (options.responseType === 'blob') {
        return await response.blob();
      }

      return await response.text();
    };

    return {
      get: (path, opts) => request(path, { ...opts, method: 'GET' }),
      post: (path, body, opts) =>
        request(path, {
          ...opts,
          method: 'POST',
          body: body ? JSON.stringify(body) : undefined,
        }),
      put: (path, body, opts) =>
        request(path, {
          ...opts,
          method: 'PUT',
          body: body ? JSON.stringify(body) : undefined,
        }),
      del: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
    };
  }, [microserviceUrl]);
};
