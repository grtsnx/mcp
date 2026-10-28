import type { Request, Response } from 'express';
import { HttpStatus } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  createMcpServer,
  type McpServerDependencies,
} from '@/mcp/mcp-server.js';

export function sendMethodNotAllowed(response: Response): void {
  response.status(HttpStatus.METHOD_NOT_ALLOWED).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
}

export async function handleMcpPost(
  request: Request,
  response: Response,
  dependencies: McpServerDependencies,
): Promise<void> {
  const server = createMcpServer(dependencies);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  // Registered before handleRequest: in JSON mode the response can close before it returns.
  response.on('close', () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  } catch {
    if (!response.headersSent) {
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
}
