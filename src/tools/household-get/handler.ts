import type { z } from 'zod';
import { fetchMyHousehold } from '@/external/mssuize/household-api.js';
import type { ToolContext } from '../define-tool.js';
import type {
  householdGetInputSchema,
  householdGetOutputSchema,
} from './schemas.js';

export async function householdGetHandler(
  input: z.output<typeof householdGetInputSchema>,
  { backend, sessions }: ToolContext,
): Promise<z.input<typeof householdGetOutputSchema>> {
  const household = await sessions.withHousehold(
    input.sessionId,
    (accessToken) => fetchMyHousehold(backend, accessToken),
  );
  return {
    id: household.id,
    name: household.name,
    timezone: household.timezone,
    currentLearnerId: household.currentLearnerId ?? null,
    recordingConsent: household.recordingConsent,
  };
}
