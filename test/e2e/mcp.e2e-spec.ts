import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import request from 'supertest';
import { AppModule } from '@/app';
import { configureApplication } from '@/bootstrap/application.js';
import { validateEnvironment } from '@/config/index.js';

const mcpApiKey = 'test-mcp-api-key-01';

describe('MCP Streamable HTTP (e2e)', () => {
  let app: INestApplication;
  let mcpUrl: URL;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ logger: false });
    configureApplication(
      app,
      validateEnvironment({
        NODE_ENV: 'test',
        SWAGGER_ENABLED: false,
        MCP_API_KEY: mcpApiKey,
        BACKEND_BASE_URL: 'http://backend.invalid',
      }),
    );
    await app.listen(0, '127.0.0.1');
    mcpUrl = new URL('/mcp', await app.getUrl());
  });

  afterAll(async () => {
    await app.close();
  });

  it('connects with the SDK client and calls ping', async () => {
    const transport = new StreamableHTTPClientTransport(mcpUrl, {
      requestInit: {
        headers: { Authorization: `Bearer ${mcpApiKey}` },
      },
    });
    const client = new Client({ name: 'mcp-e2e', version: '0.0.1' });

    await client.connect(transport);
    const result = await client.callTool({ name: 'ping', arguments: {} });
    await client.close();

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ ok: true });
  });

  it('rejects a wrong bearer key', async () => {
    const transport = new StreamableHTTPClientTransport(mcpUrl, {
      requestInit: {
        headers: { Authorization: 'Bearer wrong-mcp-api-key' },
      },
    });
    const client = new Client({ name: 'mcp-e2e', version: '0.0.1' });

    await expect(client.connect(transport)).rejects.toThrow();
    await client.close().catch(() => undefined);
  });

  it('rejects a missing bearer key with 401', async () => {
    const response = await request(app.getHttpServer())
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} })
      .expect(401);

    // Standard MCP authorization: the client is told where to sign in.
    expect(response.headers['www-authenticate']).toMatch(
      /^Bearer resource_metadata=".*\/\.well-known\/oauth-protected-resource"$/,
    );
    expect(response.body).toMatchObject({
      statusCode: 401,
      statusType: 'UNAUTHORIZED',
    });
  });

  it('answers GET and DELETE with 405 for an authorised caller', async () => {
    for (const method of ['get', 'delete'] as const) {
      const response = await request(app.getHttpServer())
        [method]('/mcp')
        .set('Authorization', `Bearer ${mcpApiKey}`)
        .expect(405);

      expect(response.body.error.code).toBe(-32000);
    }
  });
});
