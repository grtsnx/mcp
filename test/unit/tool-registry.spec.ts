import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tools } from '@/tools/index.js';
import { connectTools } from '../helpers/tool-harness.js';

const toolsDirectory = fileURLToPath(
  new URL('../../src/tools', import.meta.url),
);

describe('tool registry', () => {
  let connection: Awaited<ReturnType<typeof connectTools>>;

  beforeAll(async () => {
    connection = await connectTools();
  });

  afterAll(async () => {
    await connection.close();
  });

  it('has no duplicate tool names', () => {
    const names = tools.map((tool) => tool.name);

    expect(new Set(names).size).toBe(names.length);
  });

  it('lists a tool for every folder under src/tools, and no others', () => {
    const folders = readdirSync(toolsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name.replaceAll('-', '_'))
      .sort();

    expect(tools.map((tool) => tool.name).sort()).toEqual(folders);
  });

  it('serves every registered tool exactly once', async () => {
    const listed = (await connection.client.listTools()).tools.map(
      (tool) => tool.name,
    );

    expect(listed.sort()).toEqual(tools.map((tool) => tool.name).sort());
  });

  it('gives every tool strict input, an object output and full hints', async () => {
    const { tools: listed } = await connection.client.listTools();

    for (const tool of listed) {
      expect(tool.inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
      expect(tool.outputSchema?.type).toBe('object');
      expect(tool.title).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(Object.keys(tool.annotations ?? {}).sort()).toEqual([
        'destructiveHint',
        'idempotentHint',
        'openWorldHint',
        'readOnlyHint',
      ]);
    }
  });
});
