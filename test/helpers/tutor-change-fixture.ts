import { tutorChangeRequestCreateTool } from '@/tools/tutor-change-request-create/index.js';
import { tutorChangeRequestListTool } from '@/tools/tutor-change-request-list/index.js';
import {
  FAKE_LEARNER_ID,
  FAKE_LESSON_ID,
  FAKE_SECOND_LEARNER_ID,
} from './fake-lessons-data.js';
import {
  FakeMssuize,
  type FakeRequest,
  createFakeMssuizeApi,
} from './fake-mssuize.js';
import { signInViaTool } from './household-fixtures.js';
import { connectTools, createClock } from './tool-harness.js';
import { weeklyLearner } from './weekly-fixture.js';

export const CHANGE_REASON = 'The lessons are not a good fit';
export const SENT_TO_STAFF =
  "The request goes to the school's staff, who decide. It does not change the tutor by itself.";
export const CHECK_UNAVAILABLE =
  "Whether a request is already pending could not be checked, so it was not. If one is, the backend will refuse a second. Tell the parent the request goes to the school's staff, who decide.";
export const UNKNOWN_FILING =
  'The result is unknown: the request may or may not have been filed. Do not try again. Call tutor_change_request_list to see whether a pending request exists before telling the parent anything.';
export const REFUSED =
  'That confirmation is not valid any more. Make a new proposal and ask the parent to confirm it.';

// Two learners in the household, so a lesson of one can be used for the other.
export const secondLearner = {
  id: FAKE_SECOND_LEARNER_ID,
  firstName: 'Anne',
  lastName: 'Lovelace',
  gradeLevel: 'K-2',
  status: 'active',
  age: 7,
};

// A connected server with both tutor-change tools and a fake backend that owns the learners.
export async function createTutorChangeFixture() {
  const fake = new FakeMssuize();
  fake.learners = [weeklyLearner, secondLearner];
  const clock = createClock();
  const connection = await connectTools(
    [tutorChangeRequestCreateTool, tutorChangeRequestListTool],
    { backend: createFakeMssuizeApi(fake), now: clock.now },
  );

  const create = (arguments_: Record<string, unknown>) =>
    connection.client.callTool({
      name: 'tutor_change_request_create',
      arguments: arguments_,
    });
  const list = (arguments_: Record<string, unknown>) =>
    connection.client.callTool({
      name: 'tutor_change_request_list',
      arguments: arguments_,
    });
  const propose = (
    sessionId: string,
    overrides: Record<string, unknown> = {},
  ) =>
    create({
      step: 'propose',
      sessionId,
      learnerId: FAKE_LEARNER_ID,
      lessonId: FAKE_LESSON_ID,
      reason: CHANGE_REASON,
      ...overrides,
    });
  const confirm = (sessionId: string, confirmationToken: string) =>
    create({ step: 'confirm', sessionId, confirmationToken });
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
    create,
    list,
    propose,
    confirm,
    proposed,
    signIn: () => signInViaTool(connection.client),
    close: () => connection.close(),
  };
}

// Every create request that reached the backend, including ones it refused.
export function createRequests(fake: FakeMssuize): FakeRequest[] {
  return fake.requests.filter(
    (request) =>
      request.method === 'POST' &&
      request.path === '/api/v1/tutor-change-requests',
  );
}

// Requests that read lessons, to show a refusal happened before any lesson was read.
export function lessonReads(fake: FakeMssuize): string[] {
  return fake.requests
    .filter((request) => request.path.startsWith('/api/v1/sessions/'))
    .map((request) => `${request.method} ${request.path}`);
}
