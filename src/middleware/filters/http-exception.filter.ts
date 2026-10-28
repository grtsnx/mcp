import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { describeException, httpResponse } from '../commons/http-response.js';

@Catch()
@Injectable()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<{
      method?: string;
      originalUrl?: string;
      requestId?: string;
      url?: string;
    }>();
    const response = context.getResponse<unknown>();
    const { statusCode, message, data } = describeException(exception);
    const adapter = this.adapterHost.httpAdapter;
    const path = (request.originalUrl ?? request.url)?.split('?')[0];

    if (!(exception instanceof HttpException)) {
      this.logger.error({
        errorType: exception instanceof Error ? 'Error' : typeof exception,
        method: request.method,
        requestId: request.requestId,
      });
    }

    if (adapter.isHeadersSent(response)) return;

    adapter.reply(
      response,
      httpResponse(statusCode, message, data, {
        path,
        requestId: request.requestId,
        timestamp: new Date().toISOString(),
      }),
      statusCode,
    );
  }
}
