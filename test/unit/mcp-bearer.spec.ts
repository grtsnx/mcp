import { describe, expect, it } from 'vitest';
import { bearerTokenMatches, readBearerToken } from '@/config/bearer.js';

describe('MCP bearer auth', () => {
  it('reads a Bearer token and ignores extra spaces around it', () => {
    expect(readBearerToken('Bearer secret-token')).toBe('secret-token');
    expect(readBearerToken('bearer secret-token')).toBe('secret-token');
    expect(readBearerToken('Bearer  ')).toBeUndefined();
    expect(readBearerToken('Basic secret-token')).toBeUndefined();
    expect(readBearerToken(undefined)).toBeUndefined();
  });

  it('compares tokens without accepting a different value', () => {
    expect(
      bearerTokenMatches('test-mcp-api-key-01', 'test-mcp-api-key-01'),
    ).toBe(true);
    expect(
      bearerTokenMatches('test-mcp-api-key-01', 'test-mcp-api-key-02'),
    ).toBe(false);
    expect(bearerTokenMatches('short', 'different-length-token')).toBe(false);
  });
});
