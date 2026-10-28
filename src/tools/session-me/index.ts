import { defineTool } from '../define-tool.js';
import { sessionMeHandler } from './handler.js';
import { sessionMeInputSchema, sessionMeOutputSchema } from './schemas.js';

// Named for the signed-in user's session; "whoami" is reserved for the agent identity route.
export const sessionMeTool = defineTool({
  name: 'session_me',
  title: 'Who is signed in',
  description:
    'Returns who a signed-in session belongs to: id, email, role, names, status and householdId. Uses the request’s sign-in.',
  input: sessionMeInputSchema,
  output: sessionMeOutputSchema,
  hints: { readOnly: true, destructive: false },
  handler: sessionMeHandler,
  summarise: (me) =>
    `Signed in as ${me.firstName} ${me.lastName} (${me.email}), role ${me.role}, status ${me.status}.`,
});
