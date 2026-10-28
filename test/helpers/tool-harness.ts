import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { vi } from 'vitest';
import type { BackendApi } from '@/external/mssuize/backend-client.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SessionService } from '@/session/session.service.js';
import type { Tool, ToolContext } from '@/tools/define-tool.js';
import { tools } from '@/tools/index.js';
import { registerTestSessionCreator } from './household-fixtures.js';
import type { FakeSessionCredentials } from './fake-mssuize.js';

export function createFakeBackend() {
  const request = vi.fn();
  const backend: BackendApi = { request: request as BackendApi['request'] };
  return { backend, request };
}

// A clock a test moves by hand, so token expiry needs no waiting.
export function createClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

export const sessionLimits = {
  maxSessions: 100,
  idleTtlMs: 86_400_000,
  refreshTtlMs: 604_800_000,
};

export function createSessions(
  backend: BackendApi,
  options: { now?: () => number; limits?: Partial<typeof sessionLimits> } = {},
) {
  return new SessionService({
    backend,
    ...sessionLimits,
    ...options.limits,
    now: options.now,
  });
}

interface ConnectOptions {
  /** Defaults to a vi.fn() backend that returns nothing. */
  backend?: BackendApi;
  createTestSessionCredentials?: () => FakeSessionCredentials;
  now?: () => number;
}

// Connects an SDK client to a real MCP server over memory, so tools run exactly as in production.
export async function connectTools(
  toolList?: readonly Tool[],
  options: ConnectOptions = {},
) {
  const fake = createFakeBackend();
  const backend = options.backend ?? fake.backend;
  const sessions = createSessions(backend, { now: options.now });
  // In production the session comes from the request's bearer token. Here a test names it as
  // `sessionId` in the call, and the harness moves it into the request's sign-in.
  const context: ToolContext = { backend, sessions };
  const server = new McpServer({ name: 'test', version: '0.0.1' });
  for (const tool of toolList ?? tools) tool.register(server, context);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'tool-test', version: '0.0.1' });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  const createCredentials =
    options.createTestSessionCredentials ??
    (
      backend as BackendApi & {
        createTestSessionCredentials?: () => FakeSessionCredentials;
      }
    ).createTestSessionCredentials;
  const callTool = client.callTool.bind(client);
  client.callTool = ((request, ...rest) => {
    const { sessionId, ...args } = (request.arguments ?? {}) as Record<
      string,
      unknown
    >;
    context.callerSessionId =
      typeof sessionId === 'string' ? sessionId : undefined;
    return callTool({ ...request, arguments: args }, ...rest);
  }) as typeof client.callTool;
  if (createCredentials !== undefined) {
    registerTestSessionCreator(client, createCredentials, sessions);
  }

  return {
    client,
    request: fake.request,
    sessions,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export function textOf(result: object): string {
  return (
    (result as { content?: unknown }).content as {
      type: string;
      text: string;
    }[]
  )
    .map((block) => block.text)
    .join('\n');
}
