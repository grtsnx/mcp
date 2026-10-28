import { z } from 'zod';

// No householdId here on purpose: the household always comes from the session.
export const householdMembersInputSchema = z
  .object({ sessionId: z.string().min(1).max(256) })
  .strict();

// No email and no phone: these are other people's contact details.
const memberOutputSchema = z
  .object({
    id: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    role: z.string(),
    status: z.string(),
    accessScope: z.string(),
    learnerIds: z.array(z.string()),
  })
  .strict();

// MCP needs an object at the root, so the members stay wrapped as the backend sends them.
export const householdMembersOutputSchema = z
  .object({ members: z.array(memberOutputSchema) })
  .strict();
