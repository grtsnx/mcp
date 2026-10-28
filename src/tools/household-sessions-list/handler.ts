import type { z } from 'zod';
import {
  fetchHouseholdLessons,
  minutesBetween,
  schedulingRoles,
} from '@/external/mssuize/scheduling-api.js';
import type { ToolContext } from '../define-tool.js';
import { householdClock } from '../local-time.js';
import type {
  householdSessionsListInputSchema,
  householdSessionsListOutputSchema,
} from './schemas.js';

export async function householdSessionsListHandler(
  input: z.output<typeof householdSessionsListInputSchema>,
  context: ToolContext,
): Promise<z.input<typeof householdSessionsListOutputSchema>> {
  const { backend, sessions } = context;
  sessions.assertRole(input.sessionId, schedulingRoles);
  const list = await sessions.withHousehold(
    input.sessionId,
    (accessToken, householdId) =>
      fetchHouseholdLessons(backend, accessToken, householdId, {
        status: input.status,
        startAfter: input.startAfter,
        startBefore: input.startBefore,
        page: input.page,
        pageSize: input.pageSize,
      }),
  );
  const clock = await householdClock(context, input.sessionId);
  return {
    timezone: clock.timezone,
    lessons: (list.sessions ?? []).map((lesson) => ({
      lessonId: lesson.id,
      learnerId: lesson.learnerId,
      subjects: lesson.subjects ?? [],
      scheduledStart: lesson.scheduledStart,
      scheduledEnd: lesson.scheduledEnd,
      whenLocal: clock.between(lesson.scheduledStart, lesson.scheduledEnd),
      durationMinutes: minutesBetween(
        lesson.scheduledStart,
        lesson.scheduledEnd,
      ),
      status: lesson.status,
      canReschedule: lesson.canReschedule ?? false,
      canCancel: lesson.canCancel ?? false,
    })),
    totalCount: list.totalCount,
    page: list.page,
    pageSize: list.pageSize,
  };
}
