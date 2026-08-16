import { createApiClient } from '@dongtian/contracts';

function resolveBaseUrl(): string | undefined {
  const envBase = import.meta.env['VITE_API_BASE_URL'];
  if (typeof envBase === 'string' && envBase.length > 0) {
    return envBase;
  }

  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  return undefined;
}

const baseUrl = resolveBaseUrl();

export const apiClient = baseUrl === undefined ? createApiClient() : createApiClient({ baseUrl });
