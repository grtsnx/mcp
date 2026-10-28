import type { z } from 'zod';
import { fetchCurrentUser } from '@/external/mssuize/auth-api.js';
import type { ToolContext } from '../define-tool.js';
import type { sessionMeInputSchema, sessionMeOutputSchema } from './schemas.js';

export async function sessionMeHandler(
  input: z.output<typeof sessionMeInputSchema>,
  { backend, sessions }: ToolContext,
): Promise<z.input<typeof sessionMeOutputSchema>> {
  const me = await sessions.withAccessToken(input.sessionId, (accessToken) =>
    fetchCurrentUser(backend, accessToken),
  );
  return {
    id: me.id,
    email: me.email,
    role: me.role,
    firstName: me.firstName,
    lastName: me.lastName,
    status: me.status,
    householdId: me.householdId ?? null,
  };
}
