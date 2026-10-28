import { learnerWeeklyScheduleGetTool } from '@/tools/learner-weekly-schedule-get/index.js';
import { learnerWeeklySchedulePreviewTool } from '@/tools/learner-weekly-schedule-preview/index.js';
import { FakeMssuize, createFakeMssuizeApi } from './fake-mssuize.js';
import { FAKE_LEARNER_ID } from './fake-lessons-data.js';
import { signInViaTool } from './household-fixtures.js';
import { connectTools } from './tool-harness.js';

// The household list the ownership check reads must hold the learner the tests use.
export const weeklyLearner = {
  id: FAKE_LEARNER_ID,
  firstName: 'Byron',
  lastName: 'Lovelace',
  gradeLevel: '6-8',
  status: 'active',
  age: 12,
};

// A connected server with both weekly-schedule tools and a fake backend that owns FAKE_LEARNER_ID.
export async function createWeeklyFixture() {
  const fake = new FakeMssuize();
  fake.learners = [weeklyLearner];
  const connection = await connectTools(
    [learnerWeeklyScheduleGetTool, learnerWeeklySchedulePreviewTool],
    { backend: createFakeMssuizeApi(fake) },
  );
  const get = (arguments_: Record<string, unknown>) =>
    connection.client.callTool({
      name: 'learner_weekly_schedule_get',
      arguments: arguments_,
    });
  const preview = (arguments_: Record<string, unknown>) =>
    connection.client.callTool({
      name: 'learner_weekly_schedule_preview',
      arguments: arguments_,
    });
  return {
    connection,
    fake,
    get,
    preview,
    signIn: () => signInViaTool(connection.client),
    close: () => connection.close(),
  };
}

// Requests that reached the weekly-schedule routes, ignoring sign-in and household calls.
export function weeklyRequests(fake: FakeMssuize): string[] {
  return fake.requests
    .filter((request) => request.path.includes('/weekly-schedule'))
    .map((request) => `${request.method} ${request.path}`);
}
