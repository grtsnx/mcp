import type { z } from 'zod';
import { assertLearnerInHousehold } from '@/external/mssuize/household-api.js';
import {
  fetchWeeklySchedule,
  schedulingRoles,
  weekdayName,
  type WeeklyPreference,
  type WeeklyWindow,
} from '@/external/mssuize/scheduling-api.js';
import type { ToolContext } from '../define-tool.js';
import { windowLocal } from '../local-time.js';
import type {
  learnerWeeklyScheduleGetInputSchema,
  learnerWeeklyScheduleGetOutputSchema,
  preferenceOutputSchema,
  windowOutputSchema,
} from './schemas.js';

export function windowOutput(
  window: WeeklyWindow,
): z.input<typeof windowOutputSchema> {
  return {
    windowId: window.id,
    dayOfWeek: window.dayOfWeek,
    dayName: weekdayName(window.dayOfWeek),
    startTime: window.startTime,
    endTime: window.endTime,
    timezone: window.timezone ?? null,
    status: window.status,
    whenLocal: windowLocal(window),
    ...(window.extraStartTime && window.extraEndTime
      ? {
          extraStartTime: window.extraStartTime,
          extraEndTime: window.extraEndTime,
        }
      : {}),
  };
}

export function preferenceOutput(
  preference: WeeklyPreference,
): z.input<typeof preferenceOutputSchema> {
  return {
    subjectPreferenceId: preference.id,
    learnerSubjectId: preference.learnerSubjectId,
    subject: preference.subject,
    preferredDuration: preference.preferredDuration,
    sessionsPerWeek: preference.sessionsPerWeek,
    status: preference.status,
  };
}

export async function learnerWeeklyScheduleGetHandler(
  input: z.output<typeof learnerWeeklyScheduleGetInputSchema>,
  { backend, sessions }: ToolContext,
): Promise<z.input<typeof learnerWeeklyScheduleGetOutputSchema>> {
  sessions.assertRole(input.sessionId, schedulingRoles);
  const schedule = await sessions.withHousehold(
    input.sessionId,
    async (accessToken, householdId) => {
      // The backend does not check that this learner is the caller's, so it is checked first.
      await assertLearnerInHousehold(
        backend,
        accessToken,
        householdId,
        input.learnerId,
      );
      return fetchWeeklySchedule(backend, accessToken, input.learnerId);
    },
  );
  return {
    learnerId: schedule.learnerId,
    windows: (schedule.windows ?? []).map(windowOutput),
    subjectPreferences: (schedule.subjectPreferences ?? []).map(
      preferenceOutput,
    ),
  };
}
