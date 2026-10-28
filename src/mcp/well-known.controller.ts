import { Controller, Get, Req, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';

//1. Standard MCP authorization discovery (RFC 9728): tells any MCP client that /mcp takes a
//   person's bearer token, and where that person signs in.
//2. A client that gets a 401 from /mcp follows the link in its WWW-Authenticate header here.
@Controller({ path: '.well-known', version: VERSION_NEUTRAL })
@ApiExcludeController()
export class WellKnownController {
  constructor(private readonly config: ConfigService) {}

  // Sent as plain JSON, not in the app's response envelope, as OAuth clients expect.
  @Get('oauth-protected-resource')
  protectedResource(@Req() request: Request, @Res() response: Response) {
    response.json({
      resource: `${request.protocol}://${request.get('host')}/mcp`,
      authorization_servers:
        this.config.get<string[]>('MCP_AUTHORIZATION_SERVERS') ?? [],
      bearer_methods_supported: ['header'],
      resource_name: this.config.get<string>('PLATFORM_NAME'),
    });
  }
}
