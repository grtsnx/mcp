import { defineTool } from '../define-tool.js';
import { householdGetHandler } from './handler.js';
import {
  householdGetInputSchema,
  householdGetOutputSchema,
} from './schemas.js';

export const householdGetTool = defineTool({
  name: 'household_get',
  title: 'Get household',
  description:
    "Returns the signed-in person's household: id, name, timezone, currentLearnerId and recordingConsent. Uses the request’s sign-in. The household is always the session's own; it cannot be chosen.",
  input: householdGetInputSchema,
  output: householdGetOutputSchema,
  hints: { readOnly: true, destructive: false },
  handler: householdGetHandler,
  errorMessages: { forbidden: 'Not allowed to access this household.' },
});
