import type { z } from 'zod';
import {
  fetchRescheduleWeek,
  minutesBetween,
  schedulingRoles,
} from '@/external/mssuize/scheduling-api.js';
import type { ToolContext } from '../define-tool.js';
import { dateLocal, localClock } from '../local-time.js';
import type {
  sessionRescheduleOptionsWeekInputSchema,
  sessionRescheduleOptionsWeekOutputSchema,
} from './schemas.js';

export async function sessionRescheduleOptionsWeekHandler(
  input: z.output<typeof sessionRescheduleOptionsWeekInputSchema>,
  { backend, sessions }: ToolContext,
): Promise<z.input<typeof sessionRescheduleOptionsWeekOutputSchema>> {
  sessions.assertRole(input.sessionId, schedulingRoles);
  const week = await sessions.withAccessToken(input.sessionId, (accessToken) =>
    fetchRescheduleWeek(backend, accessToken, input.lessonId, input.timezone),
  );
  // The zone the backend used for these slots: the family's own unless the caller asked for another.
  const clock = localClock(week.timezone);
  const days = (week.days ?? []).map((day) => {
    const slots = (day.slots ?? []).map((slot) => ({
      start: slot.start,
      end: slot.end,
      whenLocal: clock.between(slot.start, slot.end),
    }));
    return {
      date: day.date,
      dateLocal: dateLocal(day.date),
      slots,
      count: slots.length,
    };
  });
  return {
    lessonId: week.session_id,
    timezone: clock.timezone,
    durationMinutes:
      week.duration_minutes > 0
        ? Math.round(week.duration_minutes)
        : minutesBetween(week.current_start, week.current_end),
    currentStart: week.current_start,
    currentEnd: week.current_end,
    currentWhenLocal: clock.between(week.current_start, week.current_end),
    days,
    totalSlots: days.reduce((total, day) => total + day.count, 0),
  };
}
