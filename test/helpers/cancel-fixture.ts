import type { BackendApi } from '@/external/mssuize/backend-client.js';
import { BackendError } from '@/external/mssuize/backend-error.js';
import { sessionCancelTool } from '@/tools/session-cancel/index.js';
import { FAKE_LESSON_ID } from './fake-lessons-data.js';
import {
  FakeMssuize,
  type FakeRequest,
  createFakeMssuizeApi,
} from './fake-mssuize.js';
import { signInViaTool } from './household-fixtures.js';
import { connectTools, createClock } from './tool-harness.js';

export const CANCEL_REASON = 'Family trip';
export const NOT_CANCELLED =
  'The cancellation did not go through: the lesson is still scheduled. Tell the parent, and do not try again without asking them.';
export const UNKNOWN_OUTCOME =
  "The result is unknown: the lesson may or may not be cancelled. Do not try to cancel again. Call session_get to see the lesson's real status before telling the parent anything.";
export const UNCONFIRMED =
  "The backend accepted the cancellation, but the lesson does not show as cancelled yet. Call session_get to check the lesson's real status before telling the parent anything.";
export const LATE_NOTICE =
  'Cancelling less than 24 hours before the start may incur a late-cancellation fee.';

// The lesson starts 2026-06-01T14:00Z. One day earlier or more is not late; less than a day is.
export const FAR_BEFORE = Date.parse('2026-05-20T12:00:00Z');
export const TWELVE_HOURS_BEFORE = Date.parse('2026-06-01T02:00:00Z');
export const ONE_HOUR_BEFORE = Date.parse('2026-06-01T13:00:00Z');

// A connected server with session_cancel, a fake backend, and a clock a test moves by hand.
export async function createCancelFixture(start = FAR_BEFORE) {
  const fake = new FakeMssuize();
  const clock = createClock(start);
  const state = { failReadBack: false };
  const api = createFakeMssuizeApi(fake);
  // The same backend, except that it can be made to fail the read-back after a cancel.
  const backend: BackendApi = {
    request: async (request) => {
      if (
        state.failReadBack &&
        request.method === 'GET' &&
        request.path === `/api/v1/sessions/${FAKE_LESSON_ID}`
      ) {
        throw new BackendError('timeout');
      }
      return api.request(request);
    },
  };
  const connection = await connectTools([sessionCancelTool], {
    backend,
    createTestSessionCredentials: () => fake.createTestSessionCredentials(),
    now: clock.now,
  });

  const cancel = (arguments_: Record<string, unknown>) =>
    connection.client.callTool({
      name: 'session_cancel',
      arguments: arguments_,
    });
  const propose = (sessionId: string, lessonId: string = FAKE_LESSON_ID) =>
    cancel({ step: 'propose', sessionId, lessonId, reason: CANCEL_REASON });
  const confirm = (sessionId: string, confirmationToken: string) =>
    cancel({ step: 'confirm', sessionId, confirmationToken });
  // Signs in and proposes, returning what a confirm needs.
  async function proposed() {
    const sessionId = await signInViaTool(connection.client);
    const proposal = (await propose(sessionId)).structuredContent as {
      confirmationToken: string;
    };
    return { sessionId, token: proposal.confirmationToken };
  }

  return {
    connection,
    fake,
    clock,
    state,
    cancel,
    propose,
    confirm,
    proposed,
    close: () => connection.close(),
  };
}

// Every cancel request that reached the backend, including ones it refused.
export function cancelRequests(fake: FakeMssuize): FakeRequest[] {
  return fake.requests.filter(
    (request) => request.method === 'POST' && request.path.endsWith('/cancel'),
  );
}
