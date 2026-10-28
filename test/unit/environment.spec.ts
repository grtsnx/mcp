import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '@/config/environment.js';

const mcpApiKey = 'test-mcp-api-key-01';
const requiredEnvironment = {
  MCP_API_KEY: mcpApiKey,
  BACKEND_BASE_URL: 'http://localhost:8080',
};

describe('validateEnvironment', () => {
  it('uses secure, stateless defaults', () => {
    expect(validateEnvironment({ ...requiredEnvironment })).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      PLATFORM_NAME: 'Agentic',
      CORS_ORIGINS: [],
      OBSERVE_ENABLED: false,
      SWAGGER_ENABLED: true,
      ...requiredEnvironment,
    });
  });

  it('defaults the session limits and accepts overrides', () => {
    expect(validateEnvironment({ ...requiredEnvironment })).toMatchObject({
      SESSION_MAX_COUNT: 1000,
      SESSION_IDLE_TTL_SECONDS: 3600,
      SESSION_REFRESH_TTL_SECONDS: 604_800,
    });
    expect(
      validateEnvironment({
        ...requiredEnvironment,
        SESSION_MAX_COUNT: '5',
        SESSION_IDLE_TTL_SECONDS: '120',
        SESSION_REFRESH_TTL_SECONDS: '600',
      }),
    ).toMatchObject({
      SESSION_MAX_COUNT: 5,
      SESSION_IDLE_TTL_SECONDS: 120,
      SESSION_REFRESH_TTL_SECONDS: 600,
    });
  });

  it.each([
    ['SESSION_MAX_COUNT', '0'],
    ['SESSION_MAX_COUNT', 'many'],
    ['SESSION_IDLE_TTL_SECONDS', '10'],
    ['SESSION_REFRESH_TTL_SECONDS', '-1'],
  ])('rejects %s=%s', (name, value) => {
    expect(() =>
      validateEnvironment({ ...requiredEnvironment, [name]: value }),
    ).toThrow(name);
  });

  it('normalizes and deduplicates CORS origins', () => {
    const environment = validateEnvironment({
      ...requiredEnvironment,
      CORS_ORIGINS:
        'https://app.example.com, https://admin.example.com,https://app.example.com',
    });

    expect(environment.CORS_ORIGINS).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
  });

  it('rejects wildcard and path-based CORS origins', () => {
    expect(() =>
      validateEnvironment({ ...requiredEnvironment, CORS_ORIGINS: '*' }),
    ).toThrow(/CORS_ORIGINS/);
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        CORS_ORIGINS: 'https://example.com/app',
      }),
    ).toThrow(/CORS_ORIGINS/);
  });

  it('disables Swagger by default in production', () => {
    expect(
      validateEnvironment({
        NODE_ENV: 'production',
        MCP_API_KEY: 'a'.repeat(32),
        BACKEND_BASE_URL: 'https://backend.example.com',
      }).SWAGGER_ENABLED,
    ).toBe(false);
  });

  it('requires a 32-character key and HTTPS backend in production', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        MCP_API_KEY: mcpApiKey,
        BACKEND_BASE_URL: 'https://backend.example.com',
      }),
    ).toThrow(/MCP_API_KEY/);
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        MCP_API_KEY: 'a'.repeat(32),
        BACKEND_BASE_URL: 'http://backend.example.com',
      }),
    ).toThrow(/BACKEND_BASE_URL/);
    expect(
      validateEnvironment({
        NODE_ENV: 'production',
        MCP_API_KEY: 'a'.repeat(32),
        BACKEND_BASE_URL: 'https://backend.example.com',
      }).BACKEND_BASE_URL,
    ).toBe('https://backend.example.com');
  });

  it('rejects backend URLs with credentials, query strings, or fragments', () => {
    for (const BACKEND_BASE_URL of [
      'https://user:pass@backend.example.com',
      'https://backend.example.com?token=secret',
      'https://backend.example.com#fragment',
    ]) {
      expect(() =>
        validateEnvironment({ ...requiredEnvironment, BACKEND_BASE_URL }),
      ).toThrow(/BACKEND_BASE_URL/);
    }
  });

  it('rejects invalid ports and booleans', () => {
    expect(() =>
      validateEnvironment({ ...requiredEnvironment, PORT: '0' }),
    ).toThrow(/PORT/);
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        OBSERVE_ENABLED: 'sometimes',
      }),
    ).toThrow(/OBSERVE_ENABLED/);
    expect(() => validateEnvironment({})).toThrow(/MCP_API_KEY/);
    expect(() => validateEnvironment({ MCP_API_KEY: 'too-short' })).toThrow(
      /MCP_API_KEY/,
    );
  });

  it('requires complete observability credentials when enabled', () => {
    expect(() =>
      validateEnvironment({ ...requiredEnvironment, OBSERVE_ENABLED: 'true' }),
    ).toThrow(/OBSERVE_APP_KEY/);

    expect(
      validateEnvironment({
        ...requiredEnvironment,
        OBSERVE_ENABLED: 'true',
        OBSERVE_APP_KEY: 'key',
        OBSERVE_APP_SECRET: 'secret',
        OBSERVE_SERVICE_ID: 'service',
      }).OBSERVE_ENABLED,
    ).toBe(true);
  });

  it('requires an http(s) BACKEND_BASE_URL and trims trailing slashes', () => {
    expect(() => validateEnvironment({ MCP_API_KEY: mcpApiKey })).toThrow(
      /BACKEND_BASE_URL/,
    );
    expect(() =>
      validateEnvironment({
        MCP_API_KEY: mcpApiKey,
        BACKEND_BASE_URL: 'ftp://backend.example.com',
      }),
    ).toThrow(/BACKEND_BASE_URL/);
    expect(() =>
      validateEnvironment({
        MCP_API_KEY: mcpApiKey,
        BACKEND_BASE_URL: 'not a url',
      }),
    ).toThrow(/BACKEND_BASE_URL/);
    expect(
      validateEnvironment({
        MCP_API_KEY: mcpApiKey,
        BACKEND_BASE_URL: ' https://backend.example.com// ',
      }).BACKEND_BASE_URL,
    ).toBe('https://backend.example.com');
  });
});
