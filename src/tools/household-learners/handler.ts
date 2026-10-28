import type { z } from 'zod';
import { fetchLearners } from '@/external/mssuize/household-api.js';
import type { ToolContext } from '../define-tool.js';
import type {
  householdLearnersInputSchema,
  householdLearnersOutputSchema,
} from './schemas.js';

export async function householdLearnersHandler(
  input: z.output<typeof householdLearnersInputSchema>,
  { backend, sessions }: ToolContext,
): Promise<z.input<typeof householdLearnersOutputSchema>> {
  const learners = await sessions.withHousehold(
    input.sessionId,
    (accessToken, householdId) =>
      fetchLearners(backend, accessToken, householdId, input.status),
  );
  return {
    learners: learners.map((learner) => ({
      id: learner.id,
      firstName: learner.firstName,
      lastName: learner.lastName,
      gradeLevel: learner.gradeLevel ?? null,
      actualGradeLevel: learner.actualGradeLevel ?? null,
      status: learner.status,
      age: learner.age,
    })),
  };
}
