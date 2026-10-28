import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BackendError } from '@/external/mssuize/backend-error.js';
import { defineTool, type Tool } from '@/tools/define-tool.js';
import { connectTools, textOf } from '../helpers/tool-harness.js';

const secret = 'internal-detail-SHOULD-NOT-LEAK';

// Deliberately not .strict(): defineTool must still reject unknown fields.
const echo = defineTool({
  name: 'echo',
  title: 'Echo',
  description: 'Echoes the input.',
  input: z.object({ message: z.string() }),
  output: z.object({ echoed: z.string() }),
  hints: { readOnly: true, destructive: false },
  handler: async ({ message }) => ({ echoed: message }),
});

const failing = (error: unknown) =>
  defineTool({
    name: 'failing',
    title: 'Failing',
    description: 'Always fails.',
    input: z.object({}),
    output: z.object({ ok: z.boolean() }),
    hints: { readOnly: false, destructive: true, openWorld: false },
    handler: async () => {
      throw error;
    },
    errorMessages: { unauthorized: 'Custom unauthorized wording.' },
  });

describe('defineTool', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  async function connect(toolList: readonly Tool[]) {
    const connection = await connectTools(toolList);
    close = connection.close;
    return connection;
  }

  it('turns the hints into annotations, with the documented defaults', async () => {
    const { client } = await connect([echo, failing(new Error('x'))]);
    const { tools } = await client.listTools();

    expect(tools.find((tool) => tool.name === 'echo')?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(tools.find((tool) => tool.name === 'failing')?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it('returns structured content and the result as JSON text by default', async () => {
    const { client } = await connect([echo]);
    const result = await client.callTool({
      name: 'echo',
      arguments: { message: 'hi' },
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ echoed: 'hi' });
    expect(textOf(result)).toBe('{"echoed":"hi"}');
  });

  it('uses summarise for the text when the tool gives one', async () => {
    const summarised = defineTool({
      name: 'summarised',
      title: 'Summarised',
      description: 'Has a summary.',
      input: z.object({}),
      output: z.object({ count: z.number() }),
      hints: { readOnly: true, destructive: false },
      handler: async () => ({ count: 3 }),
      summarise: ({ count }) => `Counted ${count}.`,
    });
    const { client } = await connect([summarised]);
    const result = await client.callTool({ name: 'summarised', arguments: {} });

    expect(textOf(result)).toBe('Counted 3.');
  });

  it('rejects unknown input fields even when the schema is not strict', async () => {
    const { client } = await connect([echo]);
    const outcome = await client
      .callTool({ name: 'echo', arguments: { message: 'hi', extra: true } })
      .then((result) => result.isError === true)
      .catch(() => true);

    expect(outcome).toBe(true);
  });

  it('hands the shared backend to the handler', async () => {
    const usesBackend = defineTool({
      name: 'uses_backend',
      title: 'Uses backend',
      description: 'Calls the backend.',
      input: z.object({}),
      output: z.object({ name: z.string() }),
      hints: { readOnly: true, destructive: false },
      handler: async (_input, { backend }) =>
        backend.request({
          method: 'GET',
          path: '/api/v1/thing',
          response: z.object({ name: z.string() }),
        }),
    });
    const { client, request } = await connect([usesBackend]);
    request.mockResolvedValue({ name: 'thing' });

    const result = await client.callTool({
      name: 'uses_backend',
      arguments: {},
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/api/v1/thing' }),
    );
    expect(result.structuredContent).toEqual({ name: 'thing' });
  });

  it.each([
    ['invalid_request', /rejected the request as invalid/i],
    ['rate_limited', /too many requests/i],
    ['forbidden', /did not allow/i],
    ['not_found', /could not find/i],
    ['rejected', /rejected the request/i],
    ['unavailable', /unavailable/i],
    ['timeout', /did not respond/i],
    ['unreachable', /could not be reached/i],
    ['unexpected_response', /unexpected response/i],
  ] as const)(
    'maps a %s backend failure to a default tool error',
    async (kind, message) => {
      const { client } = await connect([failing(new BackendError(kind))]);
      const result = await client.callTool({ name: 'failing', arguments: {} });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(textOf(result)).toMatch(message);
    },
  );

  it('lets a tool override the wording for one failure kind', async () => {
    const { client } = await connect([
      failing(new BackendError('unauthorized')),
    ]);
    const result = await client.callTool({ name: 'failing', arguments: {} });

    expect(textOf(result)).toBe('Custom unauthorized wording.');
  });

  it('hides the message of any other error', async () => {
    const { client } = await connect([failing(new Error(secret))]);
    const result = await client.callTool({ name: 'failing', arguments: {} });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('The tool failed unexpectedly.');
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
