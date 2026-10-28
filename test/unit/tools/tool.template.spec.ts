// TEMPLATE: copy this file to test/unit/tools/<tool-name>.spec.ts, then replace `ping` with your tool.
// Every tool should pass the same checks: listing, a happy path, bad input, and a backend failure.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pingTool } from '@/tools/ping/index.js';
import { connectTools } from '../../helpers/tool-harness.js';

describe('ping tool', () => {
  let connection: Awaited<ReturnType<typeof connectTools>>;

  beforeAll(async () => {
    connection = await connectTools([pingTool]);
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(() => {
    connection.request.mockReset();
  });

  it('is listed with strict input and an object output', async () => {
    const { tools } = await connection.client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(['ping']);
    expect(tools[0]?.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(tools[0]?.outputSchema?.type).toBe('object');
  });

  it('returns the expected result', async () => {
    const result = await connection.client.callTool({
      name: 'ping',
      arguments: {},
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ ok: true });
  });

  it('rejects unknown input fields before the handler runs', async () => {
    const outcome = await connection.client
      .callTool({ name: 'ping', arguments: { extra: true } })
      .then((result) => result.isError === true)
      .catch(() => true);

    expect(outcome).toBe(true);
    expect(connection.request).not.toHaveBeenCalled();
  });

  // Backend-backed tool: use connection.request.mockResolvedValue(...) for the happy path and
  // connection.request.mockRejectedValue(new BackendError('unavailable')) for a failure, then
  // expect result.isError to be true and textOf(result) to be the tool's error message.
});
