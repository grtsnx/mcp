import type {
  WeeklyPreviewRequest,
  WeeklySchedule,
} from '@/external/mssuize/scheduling-api.js';

export interface SessionProfile {
  id: string;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
}

// Replaced as one object on refresh, so the two tokens can never be out of step.
export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
}

// A change the person has been asked to approve. It lives on the sign-in session, so it can only be
// confirmed by the session that proposed it, and it is gone when the session is. `action` says what
// it is for: a token made for one action is refused by every other.
export type ProposalDetails =
  | {
      action: 'reschedule';
      lessonId: string;
      reason: string;
      newStart: string;
      newEnd: string;
      /** Where the lesson was, so the confirmed move can show the old time too. */
      currentStart: string;
      currentEnd: string;
    }
  | { action: 'cancel'; lessonId: string; reason: string }
  | {
      action: 'weekly_update';
      learnerId: string;
      reason: string;
      /** The exact body the save will send. */
      request: WeeklyPreviewRequest;
      /** The learner's schedule as it was when the proposal was made. */
      current: WeeklySchedule;
      /** A stable summary of the backend's preview, to notice when it changes. */
      previewFingerprint: string;
    }
  | {
      action: 'tutor_change';
      learnerId: string;
      lessonId: string;
      /** Taken from the lesson, kept here and never returned by a tool. */
      tutorId: string;
      reason: string;
    };

export type Proposal = ProposalDetails & { expiresAt: number };

export type ProposalAction = Proposal['action'];

export interface Session {
  readonly id: string;
  readonly profile: SessionProfile;
  readonly householdId: string | null;
  tokens: SessionTokens;
  /** Pending proposals by confirmation token. */
  proposals: Map<string, Proposal>;
  /** Counts completed refreshes, so a late 401 can tell its token was already replaced. */
  generation: number;
  lastUsedAt: number;
  /** Set synchronously when logout begins, preventing new operations and refreshes. */
  closing: boolean;
  /** Calls that already passed session lookup must finish before backend sign-out. */
  activeOperations: number;
  operationsDrained?: () => void;
  /** Set while a refresh is running; every caller joins it instead of starting another. */
  refreshing?: Promise<void>;
}
