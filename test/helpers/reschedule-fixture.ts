import type { BackendApi } from '@/external/mssuize/backend-client.js';
import { BackendError } from '@/external/mssuize/backend-error.js';
import { sessionRescheduleTool } from '@/tools/session-reschedule/index.js';
import { FakeMssuize, createFakeMssuizeApi } from './fake-mssuize.js';
import { FAKE_LESSON_ID } from './fake-scheduling.js';
import { signInViaTool } from './household-fixtures.js';
import { connectTools, createClock } from './tool-harness.js';

export const START = '2026-06-02T10:00:00-04:00';
export const END = '2026-06-02T11:00:00-04:00';
export const REASON = 'Soccer practice moved';
export const UNKNOWN_OUTCOME =
  "The result is unknown: the move may or may not have happened. Do not try the move again. Call session_get to see the lesson's real current time before telling the parent anything.";

// A connected server with session_reschedule, a fake backend, and a clock a test moves by hand.
export async function createRescheduleFixture() {
  const fake = new FakeMssuize();
  const clock = createClock();
  const state = { failReadBack: false };
  const api = createFakeMssuizeApi(fake);
  // The same backend, except that it can be made to fail the read-back after a move.
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
  const connection = await connectTools([sessionRescheduleTool], {
    backend,
    createTestSessionCredentials: () => fake.createTestSessionCredentials(),
    now: clock.now,
  });

  const reschedule = (arguments_: Record<string, unknown>) =>
    connection.client.callTool({
      name: 'session_reschedule',
      arguments: arguments_,
    });
  const propose = (sessionId: string) =>
    reschedule({
      step: 'propose',
      sessionId,
      lessonId: FAKE_LESSON_ID,
      newStart: START,
      newEnd: END,
      reason: REASON,
    });
  const confirm = (sessionId: string, confirmationToken: string) =>
    reschedule({ step: 'confirm', sessionId, confirmationToken });
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
    reschedule,
    propose,
    confirm,
    proposed,
    close: () => connection.close(),
  };
}
