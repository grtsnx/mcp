import { z } from 'zod';
import { bearerHeader } from './auth-api.js';
import type { BackendApi } from './backend-client.js';
import { BackendError } from './backend-error.js';

export const learnerStatuses = [
  'active',
  'paused',
  'archived',
  'unarchived',
  'all',
] as const;

export type LearnerStatus = (typeof learnerStatuses)[number];

// Only the fields the household tools return are listed. Zod drops everything else the backend
// sends (contact details, addresses, scores, payment dates) when the reply is parsed, so it
// never reaches a tool.

export const householdSchema = z.object({
  id: z.string(),
  name: z.string(),
  timezone: z.string(),
  currentLearnerId: z.string().nullish(),
  recordingConsent: z.boolean(),
});

export type Household = z.infer<typeof householdSchema>;

export const learnerSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  gradeLevel: z.string().nullish(),
  actualGradeLevel: z.string().nullish(),
  // Free text: "active", "No Plan", "paused", "archived" and others.
  status: z.string(),
  age: z.number(),
});

export type Learner = z.infer<typeof learnerSchema>;

// The backend answers with a bare array.
const learnersSchema = z.array(learnerSchema);

// email, phone and the nested learner details are left out on purpose.
export const memberSchema = z.object({
  id: z.string(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  role: z.string(),
  status: z.string(),
  accessScope: z.string(),
  learnerIds: z.array(z.string()).nullish(),
});

export type Member = z.infer<typeof memberSchema>;

const membersSchema = z.object({ members: z.array(memberSchema) });

function householdPath(householdId: string): string {
  return `/api/v1/households/${encodeURIComponent(householdId)}`;
}

export function fetchMyHousehold(
  backend: BackendApi,
  accessToken: string,
): Promise<Household> {
  return backend.request({
    method: 'GET',
    path: '/api/v1/households/me',
    headers: bearerHeader(accessToken),
    response: householdSchema,
  });
}

// Without a status the backend uses "unarchived". An unknown status is not an error there: it
// returns an empty list, which is why the tool restricts the value before calling.
export function fetchLearners(
  backend: BackendApi,
  accessToken: string,
  householdId: string,
  status?: LearnerStatus,
): Promise<Learner[]> {
  const query =
    status === undefined ? '' : `?${new URLSearchParams({ status })}`;
  return backend.request({
    method: 'GET',
    path: `${householdPath(householdId)}/learners${query}`,
    headers: bearerHeader(accessToken),
    response: learnersSchema,
  });
}

export async function fetchMembers(
  backend: BackendApi,
  accessToken: string,
  householdId: string,
): Promise<Member[]> {
  const reply = await backend.request({
    method: 'GET',
    path: `${householdPath(householdId)}/members`,
    headers: bearerHeader(accessToken),
    response: membersSchema,
  });
  return reply.members;
}

// ms-backend's learner routes that are not under /households/{id} (the weekly schedule) only check
// that the caller is signed in and is a guardian, delegate or admin. They never check that the
// learner is theirs. This list does: it enforces household access and a delegate's learner scope.
// So a learner id that is not in it is refused here, before any such route is called.
export async function assertLearnerInHousehold(
  backend: BackendApi,
  accessToken: string,
  householdId: string,
  learnerId: string,
): Promise<void> {
  const learners = await fetchLearners(
    backend,
    accessToken,
    householdId,
    'all',
  );
  const wanted = learnerId.toLowerCase();
  if (!learners.some((learner) => learner.id.toLowerCase() === wanted)) {
    throw new BackendError('forbidden');
  }
}
