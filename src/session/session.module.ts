import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BackendClient } from '@/external/mssuize/backend-client.js';
import { BackendClientModule } from '@/external/mssuize/backend-client.module.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [BackendClientModule],
  providers: [
    {
      provide: SessionService,
      inject: [ConfigService, BackendClient],
      useFactory: (config: ConfigService, backend: BackendClient) =>
        new SessionService({
          backend,
          maxSessions: config.getOrThrow<number>('SESSION_MAX_COUNT'),
          idleTtlMs:
            config.getOrThrow<number>('SESSION_IDLE_TTL_SECONDS') * 1000,
          refreshTtlMs:
            config.getOrThrow<number>('SESSION_REFRESH_TTL_SECONDS') * 1000,
        }),
    },
  ],
  exports: [SessionService],
})
export class SessionModule {}
