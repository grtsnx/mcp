import { defineTool } from '../define-tool.js';
import { householdMembersHandler } from './handler.js';
import {
  householdMembersInputSchema,
  householdMembersOutputSchema,
} from './schemas.js';

export const householdMembersTool = defineTool({
  name: 'household_members',
  title: 'List household members',
  description:
    "Lists the people in the signed-in person's household: id, names, role, status, accessScope and the learnerIds each can access. Email and phone are never returned. Uses the request’s sign-in.",
  input: householdMembersInputSchema,
  output: householdMembersOutputSchema,
  hints: { readOnly: true, destructive: false },
  handler: householdMembersHandler,
  errorMessages: { forbidden: 'Not allowed to access this household.' },
});
