import { z } from 'zod';
import { bearerHeader } from './auth-api.js';
import type { BackendApi, BackendErrorPhrase } from './backend-client.js';

// The backend answers 400 for every failure of these routes, and the text is the raw internal
// error (it can include database error text). Only these two exact phrases are looked for, only to
// pick a fixed message; the text itself is never kept or returned. If the backend rewords them, the
// match falls back to the generic "not accepted" message.
export const tutorChangeCreateErrorPhrases: readonly BackendErrorPhrase[] = [
  { phrase: 'pending request already exists', kind: 'already_pending' },
];

export const tutorChangeListErrorPhrases: readonly BackendErrorPhrase[] = [
  { phrase: 'could not determine household', kind: 'household_not_found' },
];

// Only the status is read from the reply; the id and the backend's message are dropped.
const createReplySchema = z.object({ status: z.literal('pending') });

// The parent list sends only these fields (checked in ms-backend: id, learnerId, currentTutorName,
// reason, status, createdAt). The other fields are optional because the admin list, which looks
// similar, sends them, and a later backend version may too. Ids of tutors and the names of staff
// are never read.
const requestItemSchema = z.object({
  id: z.string(),
  learnerId: z.string(),
  learnerName: z.string().nullish(),
  currentTutorName: z.string().nullish(),
  reason: z.string().nullish(),
  status: z.string(),
  newTutorName: z.string().nullish(),
  createdAt: z.string(),
  reviewedAt: z.string().nullish(),
});

const requestListSchema = z.object({
  requests: z.array(requestItemSchema).nullish(),
  total: z.number().int().nullish(),
  page: z.number().int().nullish(),
  pageSize: z.number().int().nullish(),
});

export type TutorChangeRequestItem = z.infer<typeof requestItemSchema>;
export type TutorChangeRequestList = z.infer<typeof requestListSchema>;

// A WRITE: it files a request that goes to the school's staff by Slack and email. The backend
// checks neither that the person may act for the learner nor that the tutor is the learner's
// tutor, so the caller must. The body is exactly { learnerId, currentTutorId, reason }. There is no
// retry key, and a repeat would be refused or file a second request, so it is never sent twice.
export function createTutorChangeRequest(
  backend: BackendApi,
  accessToken: string,
  request: { learnerId: string; currentTutorId: string; reason: string },
): Promise<{ status: 'pending' }> {
  return backend.request({
    method: 'POST',
    path: '/api/v1/tutor-change-requests',
    headers: bearerHeader(accessToken),
    body: {
      learnerId: request.learnerId,
      currentTutorId: request.currentTutorId,
      reason: request.reason,
    },
    response: createReplySchema,
    errorPhrases: tutorChangeCreateErrorPhrases,
  });
}

// The route has no paging or filter parameters (read in ms-backend), so none are sent.
export function listTutorChangeRequests(
  backend: BackendApi,
  accessToken: string,
): Promise<TutorChangeRequestList> {
  return backend.request({
    method: 'GET',
    path: '/api/v1/tutor-change-requests',
    headers: bearerHeader(accessToken),
    response: requestListSchema,
    errorPhrases: tutorChangeListErrorPhrases,
  });
}
