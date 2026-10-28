import type { FakeRequest } from './fake-mssuize.js';
import { FAKE_OTHER_LEARNER_ID, FAKE_TUTOR_ID } from './fake-lessons-data.js';

interface FakeReply {
  status: number;
  body?: unknown;
  /** The backend never answers, so the caller times out. */
  neverRespond?: boolean;
}

// Everything below must never reach a tool output.
export const ADMIN_NOTES_MARKER = 'admin-notes-SHOULD-NOT-LEAK';
export const REVIEWER_MARKER = 'Reviewer-Name-SHOULD-NOT-LEAK';
export const REQUESTER_MARKER = 'Requester-Name-SHOULD-NOT-LEAK';
export const HOUSEHOLD_MARKER = 'household-id-SHOULD-NOT-LEAK';
export const DB_ERROR_MARKER = 'pq: duplicate key value SECRET-DB-DETAIL';

export const DUPLICATE_TEXT =
  'a pending request already exists for this learner and tutor';
export const NO_HOUSEHOLD_TEXT = 'could not determine household';

export type TutorChangeOutcome =
  'success' | 'timeout' | { status: number; text: string };

interface StoredRequest {
  id: string;
  learnerId: string;
  currentTutorId: string;
  reason?: string;
  status: string;
}

// The tutor-change routes of ms-backend for a parent. Like the backend, the create checks neither
// that the person may act for the learner nor that the tutor is the learner's tutor; it only
// refuses a second pending request for the same learner and tutor. Every failure is a 400 whose
// body is raw internal text. The list has no paging and sends only the parent's fields (plus extra
// ones here, to prove they are dropped).
export class FakeTutorChange {
  /** How the create answers: success, a timeout, or a status with the error text it would carry. */
  createOutcome: TutorChangeOutcome = 'success';
  /** When true, a create that answers with a failure or a timeout has still been filed. */
  createSavedDespiteFailure = false;
  /** How the list answers: success, or a status with the error text it would carry. */
  listOutcome: 'success' | { status: number; text: string } = 'success';
  /** The status the create reply carries; anything but "pending" is not what the tool expects. */
  replyStatus = 'pending';
  /** The body of every create request, in order. */
  readonly createBodies: unknown[] = [];
  /** Requests already filed before a test starts. */
  readonly requests: StoredRequest[] = [
    {
      id: 'e1b2c3d4-0001-4222-8333-444455556666',
      learnerId: FAKE_OTHER_LEARNER_ID,
      currentTutorId: FAKE_TUTOR_ID,
      reason: 'Another household’s request',
      status: 'pending',
    },
  ];
  /** Extra fields a later backend might send on the list; the tools must not return them. */
  extraListFields: Record<string, unknown> = {};
  /** Extra fields beside the list (a total, a page) that a later backend might send. */
  extraTopFields: Record<string, unknown> = {};

  private counter = 0;

  /** Forgets every request a test filed and puts the outcomes back. */
  reset(): void {
    this.createOutcome = 'success';
    this.createSavedDespiteFailure = false;
    this.listOutcome = 'success';
    this.createBodies.length = 0;
    this.requests.length = 1;
    this.extraListFields = {};
    this.extraTopFields = {};
    this.replyStatus = 'pending';
  }

  handle(
    request: FakeRequest,
    url: URL,
    tokenIsValid: boolean,
  ): FakeReply | undefined {
    if (url.pathname !== '/api/v1/tutor-change-requests') return undefined;
    if (request.method !== 'POST' && request.method !== 'GET') return undefined;
    if (!tokenIsValid) return { status: 401, body: { error: 'unauthorized' } };
    return request.method === 'POST' ? this.create(request.body) : this.list();
  }

  private create(body: unknown): FakeReply {
    this.createBodies.push(body);
    const outcome = this.createOutcome;
    if (outcome !== 'success') {
      if (this.createSavedDespiteFailure) this.file(body);
      if (outcome === 'timeout') return { status: 0, neverRespond: true };
      return { status: outcome.status, body: { error: outcome.text } };
    }
    const { learnerId, currentTutorId } = (body ?? {}) as Record<
      string,
      string
    >;
    if (!learnerId || !currentTutorId) {
      return {
        status: 400,
        body: { error: 'learnerId and currentTutorId are required' },
      };
    }
    if (
      this.requests.some(
        (stored) =>
          stored.status === 'pending' &&
          stored.learnerId === learnerId &&
          stored.currentTutorId === currentTutorId,
      )
    ) {
      return { status: 400, body: { error: DUPLICATE_TEXT } };
    }
    const id = this.file(body);
    return {
      status: 201,
      body: {
        id,
        status: this.replyStatus,
        message: 'Tutor change request submitted successfully',
      },
    };
  }

  private file(body: unknown): string {
    const { learnerId, currentTutorId, reason } = (body ?? {}) as Record<
      string,
      string
    >;
    this.counter += 1;
    const id = `e1b2c3d4-1000-4222-8333-44445555${String(this.counter).padStart(4, '0')}`;
    this.requests.push({
      id,
      learnerId: learnerId ?? '',
      currentTutorId: currentTutorId ?? '',
      reason,
      status: 'pending',
    });
    return id;
  }

  private list(): FakeReply {
    if (this.listOutcome !== 'success') {
      return {
        status: this.listOutcome.status,
        body: { error: this.listOutcome.text },
      };
    }
    return {
      status: 200,
      body: {
        ...this.extraTopFields,
        requests: this.requests.map((stored) => ({
          id: stored.id,
          learnerId: stored.learnerId,
          currentTutorName:
            stored.currentTutorId === FAKE_TUTOR_ID
              ? 'Grace Hopper'
              : 'Someone Else',
          reason: stored.reason,
          status: stored.status,
          createdAt: '2026-05-01T12:00:00Z',
          // None of these are in the parent list today; they are here to prove they are dropped.
          currentTutorId: stored.currentTutorId,
          householdId: HOUSEHOLD_MARKER,
          adminNotes: ADMIN_NOTES_MARKER,
          reviewedByName: REVIEWER_MARKER,
          requestedByName: REQUESTER_MARKER,
          parentNotified: true,
          ...this.extraListFields,
        })),
      },
    };
  }
}
