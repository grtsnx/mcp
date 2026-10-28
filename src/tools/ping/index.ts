import { defineTool } from '../define-tool.js';
import { pingHandler } from './handler.js';
import { pingInputSchema, pingOutputSchema } from './schemas.js';

export const pingTool = defineTool({
  name: 'ping',
  title: 'Ping',
  description: 'Confirms the MCP server is reachable. Returns { ok: true }.',
  input: pingInputSchema,
  output: pingOutputSchema,
  hints: {
    readOnly: true,
    destructive: false,
    openWorld: false,
  },
  handler: pingHandler,
});
