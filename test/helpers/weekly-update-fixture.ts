import type { BackendApi } from '@/external/mssuize/backend-client.js';
import { BackendError } from '@/external/mssuize/backend-error.js';
import { learnerWeeklyScheduleUpdateTool } from '@/tools/learner-weekly-schedule-update/index.js';
import { FAKE_LEARNER_ID } from './fake-lessons-data.js';
import {
  FakeMssuize,
  type FakeRequest,
  createFakeMssuizeApi,
} from './fake-mssuize.js';
import { WINDOW_SUNDAY_ID, WINDOW_TUESDAY_ID } from './fake-weekly.js';
import { signInViaTool } from './household-fixtures.js';
import { connectTools, createClock } from './tool-harness.js';
import { weeklyLearner } from './weekly-fixture.js';

export const UPDATE_REASON = 'Soccer practice moved';
export const CHANGED =
  'Things changed since the proposal. Make a new proposal and ask the parent again.';
export const LESSONS_SEPARATELY =
  "The backend adjusts the learner's upcoming lessons separately, and the family and the tutor may be told about moved lessons. Check the lessons with learner_sessions_list.";

// Tuesday moved an hour later; Sunday kept as it is.
export const MOVED_WINDOWS = [
  {
    windowId: WINDOW_TUESDAY_ID,
    dayOfWeek: 2,
    startTime: '17:00',
    endTime: '19:00',
  },
  {
    windowId: WINDOW_SUNDAY_ID,
    dayOfWeek: 0,
    startTime: '09:00',
    endTime: '11:00',
  },
];

// A connected server with learner_weekly_schedule_update and a fake backend that owns the learner.
export async function createUpdateFixture() {
  const fake = new FakeMssuize();
  fake.learners = [weeklyLearner];
  const clock = createClock();
  const state = { failReadBack: false, expireBeforePut: false };
  const api = createFakeMssuizeApi(fake);
  const weeklyPath = `/api/v1/learners/${FAKE_LEARNER_ID}/weekly-schedule-v2`;
  // The same backend, except that it can fail the read-back after a save, and can make the access
  // token expire at the moment the save is sent (a real 401 on the write).
  const backend: BackendApi = {
    request: async (request) => {
      if (state.expireBeforePut && request.method === 'PUT') {
        state.expireBeforePut = false;
        fake.expireAccessTokens();
      }
      if (
        state.failReadBack &&
        request.method === 'GET' &&
        request.path === weeklyPath &&
        fake.weekly.putBodies.length > 0
      ) {
        throw new BackendError('timeout');
      }
      return api.request(request);
    },
  };
  const connection = await connectTools([learnerWeeklyScheduleUpdateTool], {
    backend,
    createTestSessionCredentials: () => fake.createTestSessionCredentials(),
    now: clock.now,
  });

  const update = (arguments_: Record<string, unknown>) =>
    connection.client.callTool({
      name: 'learner_weekly_schedule_update',
      arguments: arguments_,
    });
  const propose = (
    sessionId: string,
    overrides: Record<string, unknown> = {},
  ) =>
    update({
      step: 'propose',
      sessionId,
      learnerId: FAKE_LEARNER_ID,
      windows: MOVED_WINDOWS,
      reason: UPDATE_REASON,
      ...overrides,
    });
  const confirm = (
    sessionId: string,
    confirmationToken: string,
    overrides: Record<string, unknown> = {},
  ) =>
    update({
      step: 'confirm',
      sessionId,
      confirmationToken,
      parentAcknowledgesLessonsMayBeChanged: true,
      ...overrides,
    });
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
    update,
    propose,
    confirm,
    proposed,
    close: () => connection.close(),
  };
}

// Every save request that reached the backend, including ones it refused.
export function putRequests(fake: FakeMssuize): FakeRequest[] {
  return fake.requests.filter((request) => request.method === 'PUT');
}

// Every request to a weekly-schedule route that is not a plain read.
export function weeklyWrites(fake: FakeMssuize): string[] {
  return fake.requests
    .filter(
      (request) =>
        request.path.includes('/weekly-schedule') &&
        !(request.method === 'GET' || request.path.endsWith('/preview')),
    )
    .map((request) => `${request.method} ${request.path}`);
}
