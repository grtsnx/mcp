import type { z } from 'zod';
import { assertLearnerInHousehold } from '@/external/mssuize/household-api.js';
import {
  fetchLesson,
  schedulingRoles,
} from '@/external/mssuize/scheduling-api.js';
import {
  createTutorChangeRequest,
  listTutorChangeRequests,
  type TutorChangeRequestItem,
} from '@/external/mssuize/tutor-change-api.js';
import { ToolError, type ToolContext } from '../define-tool.js';
import type {
  tutorChangeRequestCreateInputSchema,
  tutorChangeRequestCreateOutputSchema,
} from './schemas.js';

type Input = z.output<typeof tutorChangeRequestCreateInputSchema>;
type Output = z.input<typeof tutorChangeRequestCreateOutputSchema>;

const INCOMPLETE = 'The proposal is missing a field.';
const NOT_THEIRS = 'That lesson does not belong to this learner.';
const NO_TUTOR = 'That lesson has no tutor to ask about.';
const ALREADY_PENDING = 'A request for this tutor is already pending.';
const SENT_TO_STAFF =
  "The request goes to the school's staff, who decide. It does not change the tutor by itself.";
const CHECK_UNAVAILABLE =
  "Whether a request is already pending could not be checked, so it was not. If one is, the backend will refuse a second. Tell the parent the request goes to the school's staff, who decide.";

// Only when the request was sent and then timed out, failed on the network or got a 5xx: the
// backend may have filed it, and has told the staff, before it failed.
const UNKNOWN_OUTCOME =
  'The result is unknown: the request may or may not have been filed. Do not try again. Call tutor_change_request_list to see whether a pending request exists before telling the parent anything.';

function nameOf(first?: string | null, last?: string | null): string {
  return `${first ?? ''} ${last ?? ''}`.trim().toLowerCase();
}

// The parent's list names the tutor in words only, so a request is the same tutor's when the name
// matches (or when a later backend sends the id and it matches).
function isPendingForTutor(
  request: TutorChangeRequestItem,
  learnerId: string,
  tutorName: string,
): boolean {
  if (request.status !== 'pending') return false;
  if (request.learnerId.toLowerCase() !== learnerId.toLowerCase()) return false;
  const listed = (request.currentTutorName ?? '').trim().toLowerCase();
  // With no name on either side the tutor cannot be told apart, so it counts as the same.
  return listed === '' || tutorName === '' || listed === tutorName;
}

// Nothing is changed here. It reads the lesson to find the tutor, so the model never supplies one,
// and checks that the lesson is this learner's and the learner is in the signed-in household.
async function propose(
  input: Input,
  { backend, sessions }: ToolContext,
): Promise<Output> {
  const { sessionId, learnerId, lessonId, reason } = input;
  if (
    learnerId === undefined ||
    lessonId === undefined ||
    reason === undefined
  ) {
    throw new ToolError(INCOMPLETE);
  }

  const detail = await sessions.withHousehold(
    sessionId,
    async (accessToken, householdId) => {
      // The backend checks neither of these for this request, so both are checked here.
      await assertLearnerInHousehold(
        backend,
        accessToken,
        householdId,
        learnerId,
      );
      return fetchLesson(backend, accessToken, lessonId);
    },
  );
  const lesson = detail.session;
  if (lesson.learnerId.toLowerCase() !== learnerId.toLowerCase()) {
    throw new ToolError(NOT_THEIRS);
  }
  const tutorId = lesson.tutorId;
  if (!tutorId) throw new ToolError(NO_TUTOR);

  // Best effort: the backend refuses a duplicate itself, so a failed check does not stop this.
  let note: string | undefined;
  try {
    const listed = await sessions.withAccessToken(sessionId, (accessToken) =>
      listTutorChangeRequests(backend, accessToken),
    );
    const tutorName = nameOf(detail.tutor?.first_name, detail.tutor?.last_name);
    if (
      (listed.requests ?? []).some((request) =>
        isPendingForTutor(request, learnerId, tutorName),
      )
    ) {
      throw new ToolError(ALREADY_PENDING);
    }
  } catch (error) {
    if (error instanceof ToolError) throw error;
    note = CHECK_UNAVAILABLE;
  }

  const { confirmationToken, expiresInSeconds } = sessions.createProposal(
    sessionId,
    { action: 'tutor_change', learnerId, lessonId, tutorId, reason },
  );
  return {
    status: 'proposed',
    confirmationToken,
    learnerFirstName: detail.learner?.first_name ?? null,
    tutorFirstName: detail.tutor?.first_name ?? null,
    tutorLastName: detail.tutor?.last_name ?? null,
    reason,
    alreadyPending: false,
    expiresInSeconds,
    note: note ?? SENT_TO_STAFF,
  };
}

// Sends exactly one request. The token is used up first, and nothing here retries it.
async function confirm(
  input: Input,
  { backend, sessions }: ToolContext,
): Promise<Output> {
  const { sessionId, confirmationToken } = input;
  if (confirmationToken === undefined) throw new ToolError(INCOMPLETE);
  const proposal = sessions.takeProposal(
    sessionId,
    confirmationToken,
    'tutor_change',
  );

  // After a 401 only, the session service refreshes the token and sends it once more.
  const sent = await sessions.sendWrite(sessionId, (accessToken) =>
    createTutorChangeRequest(backend, accessToken, {
      learnerId: proposal.learnerId,
      currentTutorId: proposal.tutorId,
      reason: proposal.reason,
    }),
  );
  if (sent.status === 'unknown') throw new ToolError(UNKNOWN_OUTCOME);
  return { status: 'filed', requestStatus: 'pending', note: SENT_TO_STAFF };
}

export async function tutorChangeRequestCreateHandler(
  input: Input,
  context: ToolContext,
): Promise<Output> {
  context.sessions.assertRole(input.sessionId, schedulingRoles);
  return input.step === 'propose'
    ? propose(input, context)
    : confirm(input, context);
}
