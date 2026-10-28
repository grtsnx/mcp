import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BackendApi } from '@/external/mssuize/backend-client.js';
import type { SessionService } from '@/session/session.service.js';
import type { Tool } from '@/tools/define-tool.js';
import { tools } from '@/tools/index.js';

export interface McpServerDependencies {
  platformName: string;
  backend: BackendApi;
  sessions: SessionService;
  /** The signed-in person's session for this request, from their bearer token. */
  callerSessionId?: string;
  /** Defaults to the central list in tools/index.ts. */
  toolList?: readonly Tool[];
}

export function createMcpServer({
  platformName,
  backend,
  sessions,
  callerSessionId,
  toolList = tools,
}: McpServerDependencies): McpServer {
  const server = new McpServer({
    name: platformName,
    version: '0.0.1',
  });

  for (const tool of toolList)
    tool.register(server, { backend, sessions, callerSessionId });

  return server;
}
