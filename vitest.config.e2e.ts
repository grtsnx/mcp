import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/e2e/**/*.e2e-spec.ts'],
    env: {
      MCP_API_KEY: 'test-mcp-api-key-01',
      BACKEND_BASE_URL: 'http://backend.invalid',
    },
  },
});
