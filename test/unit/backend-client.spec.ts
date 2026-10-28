import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BackendClient } from '@/external/mssuize/backend-client.js';
import { BackendError } from '@/external/mssuize/backend-error.js';

const detail = 'internal-stack-trace-SHOULD-NOT-LEAK';

interface Recorded {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: string;
}

describe('BackendClient.request', () => {
  let server: Server;
  let baseUrl: string;
  const received: Recorded[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.push({
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        const path = request.url ?? '';
        const json = (status: number, payload: unknown) => {
          response.writeHead(status, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify(payload));
        };

        if (path === '/thing') json(200, { name: 'thing', extra: 'ignored' });
        else if (path === '/wrong-shape') json(200, { other: true });
        else if (path === '/large') {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ name: 'x'.repeat(1024) }));
        } else if (path === '/not-json') {
          response.writeHead(200, { 'Content-Type': 'text/plain' });
          response.end(detail);
        } else if (path === '/slow-body') {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.write('{"name":');
        } else if (path === '/redirect') {
          response.writeHead(302, { Location: '/thing' });
          response.end();
        } else if (path.startsWith('/error400/')) {
          json(400, {
            error: decodeURIComponent(path.slice('/error400/'.length)),
          });
        } else if (path === '/error400-large') {
          json(400, { error: `${'x'.repeat(5000)} cannot reschedule` });
        } else if (path.startsWith('/error500/')) {
          json(500, {
            error: decodeURIComponent(path.slice('/error500/'.length)),
          });
        } else if (path.startsWith('/error403/')) {
          json(403, {
            error: decodeURIComponent(path.slice('/error403/'.length)),
          });
        } else if (path.startsWith('/status/')) {
          json(Number(path.slice('/status/'.length)), { error: detail });
        }
        // Any other path never gets an answer.
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    received.length = 0;
  });

  const thingSchema = z.object({ name: z.string() });
  const client = () => new BackendClient({ baseUrl, timeoutMs: 300 });

  it('returns the body parsed by the response schema', async () => {
    const result = await client().request({
      method: 'GET',
      path: '/thing',
      response: thingSchema,
    });

    expect(result).toEqual({ name: 'thing' });
  });

  it('sends a JSON body with the JSON headers on a write', async () => {
    await client().request({
      method: 'POST',
      path: '/thing',
      body: { a: 1 },
      response: thingSchema,
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      method: 'POST',
      url: '/thing',
      body: '{"a":1}',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
    });
  });

  it('sends no body and no content type when there is no body', async () => {
    await client().request({
      method: 'GET',
      path: '/thing',
      response: thingSchema,
    });

    expect(received[0]?.body).toBe('');
    expect(received[0]?.headers['content-type']).toBeUndefined();
  });

  it('ignores trailing slashes on the base URL', async () => {
    const result = await new BackendClient({
      baseUrl: `${baseUrl}///`,
    }).request({ method: 'GET', path: '/thing', response: thingSchema });

    expect(result.name).toBe('thing');
  });

  it('adds per-call headers, and a header given for one call wins over the auth hook', async () => {
    const withAuth = new BackendClient({
      baseUrl,
      auth: {
        headers: async () => ({
          Authorization: 'Bearer from-hook',
          'X-From-Hook': 'yes',
        }),
      },
    });

    await withAuth.request({
      method: 'POST',
      path: '/thing',
      body: {},
      headers: { 'Idempotency-Key': 'key-1', Authorization: 'Bearer caller' },
      response: thingSchema,
    });

    expect(received[0]?.headers).toMatchObject({
      'idempotency-key': 'key-1',
      authorization: 'Bearer caller',
      'x-from-hook': 'yes',
    });
  });

  it('sends a Cookie header, which is how the refresh token reaches the backend', async () => {
    await client().request({
      method: 'POST',
      path: '/thing',
      headers: { Cookie: 'refresh_token=abc' },
      response: thingSchema,
    });

    expect(received[0]?.headers.cookie).toBe('refresh_token=abc');
    expect(received[0]?.body).toBe('');
  });

  it.each([
    [400, 'invalid_request'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [418, 'rejected'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ])('maps status %i to %s without exposing the body', async (status, kind) => {
    const error = await client()
      .request({
        method: 'GET',
        path: `/status/${status}`,
        response: thingSchema,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BackendError);
    expect(error).toMatchObject({ kind });
    expect(String((error as Error).message)).not.toContain(detail);
  });

  describe('errorPhrases on a 400', () => {
    const phrases = [
      { phrase: 'cannot reschedule', kind: 'cannot_reschedule' },
      { phrase: 'selected time slot', kind: 'slot_unavailable' },
      { phrase: 'learner availability', kind: 'outside_availability' },
    ] as const;
    const call = (path: string, withPhrases = true) =>
      client()
        .request({
          method: 'POST',
          path,
          body: {},
          response: thingSchema,
          errorPhrases: withPhrases ? phrases : undefined,
        })
        .catch((caught: unknown) => caught);

    it.each([
      ['cannot reschedule this session', 'cannot_reschedule'],
      ['CANNOT RESCHEDULE this session', 'cannot_reschedule'],
      ['selected time slot is no longer available', 'slot_unavailable'],
      ['the Selected Time Slot is outside the windows', 'slot_unavailable'],
      ['conflicts with learner availability', 'outside_availability'],
      ['invalid request body', 'invalid_request'],
      ['an error nobody listed', 'invalid_request'],
    ])('maps "%s" to %s', async (text, kind) => {
      const error = await call(`/error400/${encodeURIComponent(text)}`);

      expect(error).toBeInstanceOf(BackendError);
      expect(error).toMatchObject({ kind });
    });

    it('lets the first listed phrase win when a reply holds more than one', async () => {
      const error = await call(
        `/error400/${encodeURIComponent('selected time slot conflicts with learner availability, cannot reschedule')}`,
      );

      expect(error).toMatchObject({ kind: 'cannot_reschedule' });
    });

    it('never keeps the reply text in the error', async () => {
      const text =
        'cannot reschedule this session: secret-detail-SHOULD-NOT-LEAK';

      const error = (await call(
        `/error400/${encodeURIComponent(text)}`,
      )) as Error;

      expect(error.message).not.toContain('secret-detail');
      expect(JSON.stringify(error)).not.toContain('secret-detail');
      expect(error.stack ?? '').not.toContain('secret-detail');
    });

    it('does not read phrases when none are given', async () => {
      const error = await call(
        `/error400/${encodeURIComponent('cannot reschedule')}`,
        false,
      );

      expect(error).toMatchObject({ kind: 'invalid_request' });
    });

    it('bounds the error text before matching phrases', async () => {
      const error = await call('/error400-large');

      expect(error).toMatchObject({ kind: 'invalid_request' });
    });

    it('applies only to a 400: the same words in a 500 or a 403 do not change the kind', async () => {
      const text = encodeURIComponent('cannot reschedule this session');

      expect(await call(`/error500/${text}`)).toMatchObject({
        kind: 'unavailable',
      });
      expect(await call(`/error403/${text}`)).toMatchObject({
        kind: 'forbidden',
      });
    });
  });

  it.each([
    ['/not-json', 'a body that is not JSON'],
    ['/wrong-shape', 'JSON of the wrong shape'],
  ])('reports unexpected_response for %s (%s)', async (path) => {
    await expect(
      client().request({ method: 'GET', path, response: thingSchema }),
    ).rejects.toMatchObject({ kind: 'unexpected_response' });
  });

  it('reports timeout when the backend never answers', async () => {
    await expect(
      client().request({
        method: 'GET',
        path: '/never',
        response: thingSchema,
      }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('reports timeout when the backend stalls while streaming a response', async () => {
    await expect(
      client().request({
        method: 'GET',
        path: '/slow-body',
        response: thingSchema,
      }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('rejects successful responses larger than the configured limit', async () => {
    const limited = new BackendClient({ baseUrl, maxResponseBytes: 32 });

    await expect(
      limited.request({ method: 'GET', path: '/large', response: thingSchema }),
    ).rejects.toMatchObject({ kind: 'unexpected_response' });
  });

  it('reports unreachable when nothing is listening', async () => {
    const unreachable = new BackendClient({
      baseUrl: 'http://127.0.0.1:1',
      timeoutMs: 300,
    });

    await expect(
      unreachable.request({
        method: 'GET',
        path: '/thing',
        response: thingSchema,
      }),
    ).rejects.toMatchObject({ kind: 'unreachable' });
  });

  it('does not follow redirects', async () => {
    await expect(
      client().request({
        method: 'GET',
        path: '/redirect',
        response: thingSchema,
      }),
    ).rejects.toMatchObject({ kind: 'unreachable' });
    expect(received.map((request) => request.url)).toEqual(['/redirect']);
  });

  it('refuses a path that does not start with a slash', async () => {
    await expect(
      client().request({
        method: 'GET',
        path: 'thing',
        response: thingSchema,
      }),
    ).rejects.toThrow('must start with "/"');
    expect(received).toHaveLength(0);
  });
});
