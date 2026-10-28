import type { z } from 'zod';
import { fetchMembers } from '@/external/mssuize/household-api.js';
import type { ToolContext } from '../define-tool.js';
import type {
  householdMembersInputSchema,
  householdMembersOutputSchema,
} from './schemas.js';

export async function householdMembersHandler(
  input: z.output<typeof householdMembersInputSchema>,
  { backend, sessions }: ToolContext,
): Promise<z.input<typeof householdMembersOutputSchema>> {
  const members = await sessions.withHousehold(
    input.sessionId,
    (accessToken, householdId) =>
      fetchMembers(backend, accessToken, householdId),
  );
  return {
    members: members.map((member) => ({
      id: member.id,
      firstName: member.firstName ?? null,
      lastName: member.lastName ?? null,
      role: member.role,
      status: member.status,
      accessScope: member.accessScope,
      learnerIds: member.learnerIds ?? [],
    })),
  };
}
