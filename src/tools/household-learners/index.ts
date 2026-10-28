import { defineTool } from '../define-tool.js';
import { householdLearnersHandler } from './handler.js';
import {
  householdLearnersInputSchema,
  householdLearnersOutputSchema,
} from './schemas.js';

export const householdLearnersTool = defineTool({
  name: 'household_learners',
  title: 'List learners',
  description:
    "Lists the learners (children) in the signed-in person's household: id, names, grade levels, status and age. Optional status filter: active, paused, archived, unarchived or all (default unarchived). Uses the request’s sign-in.",
  input: householdLearnersInputSchema,
  output: householdLearnersOutputSchema,
  hints: { readOnly: true, destructive: false },
  handler: householdLearnersHandler,
  errorMessages: { forbidden: 'Not allowed to access this household.' },
});
