import { Module } from '@nestjs/common';
import { BackendClientModule } from '@/external/mssuize/backend-client.module.js';
import { McpAuthGuard } from '@/middleware';
import { SessionModule } from '@/session/session.module.js';
import { McpController } from './mcp.controller.js';
import { WellKnownController } from './well-known.controller.js';

@Module({
  imports: [BackendClientModule, SessionModule],
  controllers: [McpController, WellKnownController],
  providers: [McpAuthGuard],
})
export class McpModule {}
