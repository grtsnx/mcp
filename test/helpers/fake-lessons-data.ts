// Static lessons, ids and leak markers shared by the fake scheduling routes.
// Real-looking UUIDs, because the tools check that every id is one.
export const FAKE_LEARNER_ID = '3f0c2c1e-5b7a-4d1e-9a3b-0c1d2e3f4a5b';
export const FAKE_SECOND_LEARNER_ID = '7e9a1c24-3b5d-4f6a-8c0e-1f2a3b4c5d6e';
export const FAKE_SECOND_LEARNER_LESSON_ID =
  '3c5e7a91-4d6f-4b8c-9d1e-2a3b4c5d6e7f';
export const FAKE_OTHER_LEARNER_ID = '5d2e8a40-7c1b-4e92-8f3a-1b2c3d4e5f60';
export const FAKE_UNKNOWN_LEARNER_ID = '9b1c7d33-6a2e-4f58-a1c4-2d3e4f5a6b70';
export const FAKE_LESSON_ID = '8a1f6e52-2c4b-4f0e-bd51-7c9e0a1b2c3d';
export const FAKE_COMPLETED_LESSON_ID = '2e4d6f81-3a5c-4b7d-8e9f-0a1b2c3d4e5f';
export const FAKE_LOCKED_LESSON_ID = '1d3f5a70-8b9c-4d1e-a2b3-c4d5e6f70819';
export const FAKE_OTHER_LESSON_ID = '6c8e0a12-4d6f-4a8b-9c0d-1e2f3a4b5c6d';
export const FAKE_UNKNOWN_LESSON_ID = '0f1e2d3c-4b5a-4968-8776-655443322110';

// Everything below must never reach a tool output.
export const SIGNED_LINK_MARKER = 'X-Amz-Signature=SHOULD-NOT-LEAK';
export const TUTOR_EMAIL_MARKER = 'tutor-private-SHOULD-NOT-LEAK@example.com';
export const PAYLOAD_MARKER = 'PAYLOAD-SHOULD-NOT-LEAK';
export const MEETING_MARKER = 'https://meet.example.com/SHOULD-NOT-LEAK';
export const FAKE_TUTOR_ID = '7a9c1e23-5d7f-4b9a-8c1d-2e3f4a5b6c7d';
export const FAKE_ACTOR_ID = '1b3d5f70-6e8a-4c1b-9d2e-3f4a5b6c7d8e';

function lessonItem(
  id: string,
  start: string,
  end: string,
  status: string,
  can: boolean,
  learnerId: string = FAKE_LEARNER_ID,
) {
  return {
    id,
    tutorId: FAKE_TUTOR_ID,
    tutorName: 'Grace Hopper',
    tutorFirstName: 'Grace',
    tutorLastName: 'Hopper',
    tutorVerificationPhotoUrl: `https://s3.example.com/photo.jpg?${SIGNED_LINK_MARKER}`,
    learnerId,
    learnerName: 'Byron Lovelace',
    subjects: ['Math', 'Science'],
    scheduledStart: start,
    scheduledEnd: end,
    // The real list reports 0 here even for a 60 minute class.
    durationMinutes: 0,
    status,
    meetingProvider: 'zoom',
    videoProvider: 'zoom',
    meetingUrl: MEETING_MARKER,
    canReschedule: can,
    canCancel: can,
  };
}

export const fakeLessons = [
  lessonItem(
    FAKE_LESSON_ID,
    '2026-06-01T14:00:00Z',
    '2026-06-01T15:00:00Z',
    'scheduled',
    true,
  ),
  lessonItem(
    FAKE_COMPLETED_LESSON_ID,
    '2026-05-01T14:00:00Z',
    '2026-05-01T14:45:00Z',
    'completed',
    false,
  ),
  lessonItem(
    '4a6c8e10-2b4d-4f6a-8b0c-1d2e3f4a5b6c',
    '2026-05-10T09:00:00Z',
    '2026-05-10T09:30:00Z',
    'cancelled',
    false,
  ),
];

// Scheduled, but too close to its start to move. It is not in the learner list.
const lockedLesson = lessonItem(
  FAKE_LOCKED_LESSON_ID,
  '2026-06-03T14:00:00Z',
  '2026-06-03T15:00:00Z',
  'scheduled',
  false,
);

const secondLearnerLesson = lessonItem(
  FAKE_SECOND_LEARNER_LESSON_ID,
  '2026-06-04T14:00:00Z',
  '2026-06-04T15:00:00Z',
  'scheduled',
  true,
  FAKE_SECOND_LEARNER_ID,
);

export const knownLessons = [...fakeLessons, lockedLesson, secondLearnerLesson];

// Oldest first, as the backend sends them, with ids and payloads that must stay hidden.
function lessonEvents(lessonId: string) {
  return [...Array(12).keys()].map((index) => ({
    id: `00000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`,
    session_id: lessonId,
    event_type: `event_${index}`,
    occurred_at: new Date(Date.UTC(2026, 4, 1, 12, index)).toISOString(),
    actor_id: FAKE_ACTOR_ID,
    actor_role: index % 2 === 0 ? 'guardian' : 'system',
    payload: { note: PAYLOAD_MARKER },
    created_at: new Date(Date.UTC(2026, 4, 1, 12, index)).toISOString(),
  }));
}

export function lessonDetail(
  lessonId: string,
  times?: { start: string; end: string },
  status?: string,
) {
  const item = knownLessons.find((lesson) => lesson.id === lessonId)!;
  return {
    session: {
      id: item.id,
      tutorId: FAKE_TUTOR_ID,
      learnerId: item.learnerId,
      subjects: item.subjects,
      scheduledStart: times?.start ?? item.scheduledStart,
      scheduledEnd: times?.end ?? item.scheduledEnd,
      durationMinutes: 0,
      status: status ?? item.status,
      meetingProvider: 'zoom',
      meetingUrl: MEETING_MARKER,
      canReschedule: item.canReschedule,
      canCancel: item.canCancel,
    },
    tutor: {
      id: FAKE_TUTOR_ID,
      first_name: 'Grace',
      last_name: 'Hopper',
      email: TUTOR_EMAIL_MARKER,
      identity_photo_url: `https://s3.example.com/id.jpg?${SIGNED_LINK_MARKER}`,
    },
    learner: {
      id: FAKE_LEARNER_ID,
      first_name: 'Byron',
      last_name: 'Lovelace',
    },
    events: lessonEvents(item.id),
  };
}
