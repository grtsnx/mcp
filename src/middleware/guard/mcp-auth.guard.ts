import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { bearerTokenMatches, readBearerToken } from '@/config/bearer.js';
import { SessionService } from '@/session/session.service.js';

// A request to /mcp, with the signed-in person's session when a person's token was sent.
export type McpRequest = Request & { mcpSessionId?: string };

//1. The bearer token is either MCP_API_KEY, for a trusted agent with no person signed in, or a
//   person's own ms-backend access token, as any MCP client sends it.
//2. A person's token is checked with ms-backend and becomes the request's session, so the tools
//   act for that person only. A token that does not check out is refused.
@Injectable()
export class McpAuthGuard implements CanActivate {
  private readonly apiKey: string;

  constructor(
    config: ConfigService,
    private readonly sessions: SessionService,
  ) {
    this.apiKey = config.getOrThrow<string>('MCP_API_KEY');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<McpRequest>();
    const token = readBearerToken(request.headers.authorization);
    if (token !== undefined && bearerTokenMatches(this.apiKey, token))
      return true;
    if (token !== undefined) {
      const sessionId = await this.sessions.signIn(token);
      if (sessionId) {
        request.mcpSessionId = sessionId;
        return true;
      }
    }
    // Standard MCP authorization: point the client at where to sign in.
    http
      .getResponse<Response>()
      .setHeader(
        'WWW-Authenticate',
        `Bearer resource_metadata="${resourceMetadataUrl(request)}"`,
      );
    throw new UnauthorizedException('Unauthorized');
  }
}

export function resourceMetadataUrl(request: Request): string {
  return `${request.protocol}://${request.get('host')}/.well-known/oauth-protected-resource`;
}
