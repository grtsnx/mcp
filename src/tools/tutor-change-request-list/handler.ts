import type { z } from 'zod';
import { fetchLearners } from '@/external/mssuize/household-api.js';
import { schedulingRoles } from '@/external/mssuize/scheduling-api.js';
import { listTutorChangeRequests } from '@/external/mssuize/tutor-change-api.js';
import type { ToolContext } from '../define-tool.js';
import type {
  tutorChangeRequestListInputSchema,
  tutorChangeRequestListOutputSchema,
} from './schemas.js';

export async function tutorChangeRequestListHandler(
  input: z.output<typeof tutorChangeRequestListInputSchema>,
  { backend, sessions }: ToolContext,
): Promise<z.input<typeof tutorChangeRequestListOutputSchema>> {
  sessions.assertRole(input.sessionId, schedulingRoles);
  const { learners, listed } = await sessions.withHousehold(
    input.sessionId,
    async (accessToken, householdId) => ({
      learners: await fetchLearners(backend, accessToken, householdId, 'all'),
      listed: await listTutorChangeRequests(backend, accessToken),
    }),
  );

  // The backend picks the household from the person's membership, not from this sign-in, so only
  // requests for learners of the signed-in household are kept.
  const ours = new Set(learners.map((learner) => learner.id.toLowerCase()));
  const requests = (listed.requests ?? [])
    .filter((request) => ours.has(request.learnerId.toLowerCase()))
    .map((request) => ({
      requestId: request.id,
      learnerId: request.learnerId,
      learnerName: request.learnerName ?? null,
      currentTutorName: request.currentTutorName ?? null,
      status: request.status,
      reason: request.reason ?? null,
      createdAt: request.createdAt,
      reviewedAt: request.reviewedAt ?? null,
      newTutorName: request.newTutorName ?? null,
    }));
  return {
    requests,
    total: requests.length,
    ...(listed.page == null ? {} : { page: listed.page }),
    ...(listed.pageSize == null ? {} : { pageSize: listed.pageSize }),
  };
}
