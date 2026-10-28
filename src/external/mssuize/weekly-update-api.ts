import { bearerHeader } from './auth-api.js';
import type { BackendApi } from './backend-client.js';
import {
  weeklyScheduleSchema,
  type WeeklyPreviewRequest,
  type WeeklySchedule,
} from './scheduling-api.js';

// A WRITE: it saves the learner's whole weekly schedule, and the backend then moves the lessons
// that no longer fit. What it does to lessons is written up in the README ("What the save does").
// The body is exactly { windows, subjectPreferences }. The backend has no retry key on this route,
// and a repeat could notify the family and the tutor twice, so it is never sent twice.
// A 400 carries the backend's own text (plan limits, validation), a 500 carries raw internal
// error text; neither is read. The reply has the same shape as the weekly schedule read.
export function updateWeeklySchedule(
  backend: BackendApi,
  accessToken: string,
  learnerId: string,
  request: WeeklyPreviewRequest,
): Promise<WeeklySchedule> {
  return backend.request({
    method: 'PUT',
    path: `/api/v1/learners/${encodeURIComponent(learnerId)}/weekly-schedule-v2`,
    headers: bearerHeader(accessToken),
    body: {
      windows: request.windows,
      subjectPreferences: request.subjectPreferences,
    },
    response: weeklyScheduleSchema,
  });
}
