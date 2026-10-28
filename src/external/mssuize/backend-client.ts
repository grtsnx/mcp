import type { z } from 'zod';
import {
  BackendError,
  type BackendErrorKind,
  errorKindForStatus,
} from './backend-error.js';

export type BackendMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// Fragile by nature: this reads a 400 reply's text and matches it against phrases the backend
// happens to use. If the backend rewords an error, the match silently falls back to the generic
// 400 kind. The text is only compared, never kept, so it cannot reach a message.
export interface BackendErrorPhrase {
  /** Compared case-insensitively against the reply text. */
  phrase: string;
  kind: BackendErrorKind;
}

export interface BackendRequest<S extends z.ZodType> {
  method: BackendMethod;
  /** Path under the base URL, starting with "/". */
  path: string;
  body?: unknown;
  /** Extra headers for this call, for example a retry key. */
  headers?: Record<string, string>;
  /** Shape of the successful JSON body; anything else is "unexpected_response". */
  response: S;
  /** For a 400 reply only: the first phrase found in its text decides the error kind. */
  errorPhrases?: readonly BackendErrorPhrase[];
}

// What tools depend on, so tests can pass a fake and the real client can change freely.
export interface BackendApi {
  request<S extends z.ZodType>(
    request: BackendRequest<S>,
  ): Promise<z.output<S>>;
}

// Service identity seam: supply the default token header without touching any tool.
export interface BackendAuth {
  headers(): Promise<Record<string, string>>;
}

export interface BackendClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  auth?: BackendAuth;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

const MAX_ERROR_TEXT_BYTES = 4096;

function decodeChunks(
  chunks: readonly Uint8Array[],
  totalBytes: number,
): string {
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// Reads at most a few KB of an error reply, only so it can be matched against known phrases.
async function readErrorText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return '';
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (totalBytes < MAX_ERROR_TEXT_BYTES) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const remaining = MAX_ERROR_TEXT_BYTES - totalBytes;
      const boundedChunk = chunk.value.slice(0, remaining);
      chunks.push(boundedChunk);
      totalBytes += boundedChunk.byteLength;
      if (boundedChunk.byteLength < chunk.value.byteLength) break;
    }
  } catch {
    // A partial error reply may still contain a useful phrase.
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The error response has already failed; cancellation is best effort.
    }
  }

  return decodeChunks(chunks, totalBytes);
}

async function readResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try {
      await response.body?.cancel();
    } catch {
      // The response is rejected either way.
    }
    throw new BackendError('unexpected_response');
  }

  const reader = response.body?.getReader();
  if (reader === undefined) throw new BackendError('unexpected_response');
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new BackendError('unexpected_response');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof BackendError) throw error;
    throw new BackendError(
      isTimeout(error) ? 'timeout' : 'unexpected_response',
    );
  }

  return decodeChunks(chunks, totalBytes);
}

// By default the status alone decides the error and the body is freed unread, so a failed cancel
// is reported as that same failure. A 400 with phrases to look for is read first, and the text is
// dropped as soon as the kind is chosen.
async function failureForStatus(
  response: Response,
  phrases: readonly BackendErrorPhrase[] | undefined,
): Promise<BackendError> {
  if (response.status === 400 && phrases !== undefined && phrases.length > 0) {
    const text = (await readErrorText(response)).toLowerCase();
    const match = phrases.find((entry) =>
      text.includes(entry.phrase.toLowerCase()),
    );
    return new BackendError(match?.kind ?? errorKindForStatus(400));
  }
  const failure = new BackendError(errorKindForStatus(response.status));
  try {
    await response.body?.cancel();
  } catch {
    return failure;
  }
  return failure;
}

export class BackendClient implements BackendApi {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly auth?: BackendAuth;

  constructor(options: BackendClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes =
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.auth = options.auth;
  }

  async request<S extends z.ZodType>(
    request: BackendRequest<S>,
  ): Promise<z.output<S>> {
    if (!request.path.startsWith('/')) {
      throw new Error('Backend request path must start with "/".');
    }

    const signal = AbortSignal.timeout(this.timeoutMs);
    const hasBody = request.body !== undefined;

    let response: Response;
    try {
      const authHeaders = (await this.auth?.headers()) ?? {};
      response = await fetch(`${this.baseUrl}${request.path}`, {
        method: request.method,
        headers: {
          Accept: 'application/json',
          ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
          // The hook sets the default identity; a header given for one call wins, so a user's
          // session token is never replaced by the agent's.
          ...authHeaders,
          ...request.headers,
        },
        body: hasBody ? JSON.stringify(request.body) : undefined,
        redirect: 'error',
        signal,
      });
    } catch (error) {
      throw new BackendError(isTimeout(error) ? 'timeout' : 'unreachable');
    }

    if (!response.ok) {
      throw await failureForStatus(response, request.errorPhrases);
    }

    let body: unknown;
    try {
      body = JSON.parse(
        await readResponseText(response, this.maxResponseBytes),
      );
    } catch (error) {
      if (error instanceof BackendError) throw error;
      throw new BackendError(
        isTimeout(error) ? 'timeout' : 'unexpected_response',
      );
    }

    const parsed = request.response.safeParse(body);
    if (!parsed.success) throw new BackendError('unexpected_response');
    return parsed.data;
  }
}
