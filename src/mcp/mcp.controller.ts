import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { BackendClient } from '@/external/mssuize/backend-client.js';
import {
  McpAuthGuard,
  handleMcpPost,
  sendMethodNotAllowed,
  type McpRequest,
} from '@/middleware';
import { SessionService } from '@/session/session.service.js';

@Controller('mcp')
@ApiExcludeController()
@UseGuards(McpAuthGuard)
export class McpController {
  private readonly platformName: string;

  constructor(
    config: ConfigService,
    private readonly backend: BackendClient,
    private readonly sessions: SessionService,
  ) {
    this.platformName = config.getOrThrow<string>('PLATFORM_NAME');
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async post(
    @Req() request: McpRequest,
    @Res() response: Response,
  ): Promise<void> {
    await handleMcpPost(request, response, {
      platformName: this.platformName,
      backend: this.backend,
      sessions: this.sessions,
      callerSessionId: request.mcpSessionId,
    });
  }

  @Get()
  get(@Res() response: Response): void {
    sendMethodNotAllowed(response);
  }

  @Delete()
  delete(@Res() response: Response): void {
    sendMethodNotAllowed(response);
  }
}
