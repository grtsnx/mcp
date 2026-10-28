import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from '@/middleware/filters/http-exception.filter.js';

describe('HttpExceptionFilter', () => {
  it('does not log exception messages or stacks that may contain secrets', () => {
    const logged: unknown[] = [];
    const errorLog = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((message) => logged.push(message));
    const adapterHost = {
      httpAdapter: {
        isHeadersSent: () => false,
        reply: vi.fn(),
      },
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          url: '/mcp?token=secret-private-value',
          requestId: 'request-1',
        }),
        getResponse: () => ({}),
      }),
    };

    new HttpExceptionFilter(adapterHost as never).catch(
      new Error('token=secret-private-value'),
      host as never,
    );

    expect(JSON.stringify(logged)).not.toContain('secret-private-value');
    expect(logged).toEqual([
      {
        errorType: 'Error',
        method: 'POST',
        requestId: 'request-1',
      },
    ]);
    const responseBody = adapterHost.httpAdapter.reply.mock.calls[0]?.[1];
    expect(JSON.stringify(responseBody)).not.toContain('secret-private-value');
    errorLog.mockRestore();
  });
});
