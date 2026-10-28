import type { z } from 'zod';
import {
  minutesBetween,
  previewLessonReschedule,
  schedulingRoles,
} from '@/external/mssuize/scheduling-api.js';
import type { ToolContext } from '../define-tool.js';
import { dateLocal, localClock } from '../local-time.js';
import type {
  sessionRescheduleOptionsDayInputSchema,
  sessionRescheduleOptionsDayOutputSchema,
} from './schemas.js';

export async function sessionRescheduleOptionsDayHandler(
  input: z.output<typeof sessionRescheduleOptionsDayInputSchema>,
  { backend, sessions }: ToolContext,
): Promise<z.input<typeof sessionRescheduleOptionsDayOutputSchema>> {
  sessions.assertRole(input.sessionId, schedulingRoles);
  const preview = await sessions.withAccessToken(
    input.sessionId,
    (accessToken) =>
      previewLessonReschedule(backend, accessToken, input.lessonId, {
        targetDate: input.targetDate,
        timezone: input.timezone,
      }),
  );
  // The zone the backend used for these slots: the family's own unless the caller asked for another.
  const clock = localClock(preview.timezone);
  const slots = (preview.slots ?? []).map((slot) => ({
    start: slot.start,
    end: slot.end,
    whenLocal: clock.between(slot.start, slot.end),
  }));
  return {
    lessonId: preview.session_id,
    targetDate: preview.target_date,
    targetDateLocal: dateLocal(preview.target_date),
    timezone: clock.timezone,
    durationMinutes:
      preview.duration_minutes > 0
        ? Math.round(preview.duration_minutes)
        : minutesBetween(preview.current_start, preview.current_end),
    currentStart: preview.current_start,
    currentEnd: preview.current_end,
    currentWhenLocal: clock.between(preview.current_start, preview.current_end),
    slots,
    count: slots.length,
  };
}
