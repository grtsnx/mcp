import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BackendClient } from './backend-client.js';

@Module({
  providers: [
    {
      provide: BackendClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new BackendClient({
          baseUrl: config.getOrThrow<string>('BACKEND_BASE_URL'),
        }),
    },
  ],
  exports: [BackendClient],
})
export class BackendClientModule {}
