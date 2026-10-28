import type { z } from 'zod';
import {
  fetchLesson,
  minutesBetween,
  schedulingRoles,
} from '@/external/mssuize/scheduling-api.js';
import type { ToolContext } from '../define-tool.js';
import { householdClock } from '../local-time.js';
import type {
  sessionGetInputSchema,
  sessionGetOutputSchema,
} from './schemas.js';

const MAX_RECENT_EVENTS = 10;

function timeOf(value: string): number {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

export async function sessionGetHandler(
  input: z.output<typeof sessionGetInputSchema>,
  context: ToolContext,
): Promise<z.input<typeof sessionGetOutputSchema>> {
  const { backend, sessions } = context;
  sessions.assertRole(input.sessionId, schedulingRoles);
  const detail = await sessions.withAccessToken(
    input.sessionId,
    (accessToken) => fetchLesson(backend, accessToken, input.lessonId),
  );
  const { session } = detail;
  const clock = await householdClock(context, input.sessionId);

  // The backend sends events oldest first, so the newest ten are found by sorting, not slicing.
  const recentEvents = [...(detail.events ?? [])]
    .sort((a, b) => timeOf(b.occurred_at) - timeOf(a.occurred_at))
    .slice(0, MAX_RECENT_EVENTS)
    .map((event) => ({
      eventType: event.event_type,
      occurredAt: event.occurred_at,
      actorRole: event.actor_role ?? null,
    }));

  return {
    timezone: clock.timezone,
    lesson: {
      lessonId: session.id,
      learnerId: session.learnerId,
      subjects: session.subjects ?? [],
      scheduledStart: session.scheduledStart,
      scheduledEnd: session.scheduledEnd,
      whenLocal: clock.between(session.scheduledStart, session.scheduledEnd),
      durationMinutes: minutesBetween(
        session.scheduledStart,
        session.scheduledEnd,
      ),
      status: session.status,
      canReschedule: session.canReschedule ?? false,
      canCancel: session.canCancel ?? false,
    },
    tutor: {
      firstName: detail.tutor?.first_name ?? null,
      lastName: detail.tutor?.last_name ?? null,
    },
    learner: {
      firstName: detail.learner?.first_name ?? null,
      lastName: detail.learner?.last_name ?? null,
    },
    recentEvents,
  };
}
