import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { z } from 'zod';
import type {
  BackendApi,
  BackendErrorPhrase,
  BackendRequest,
} from '@/external/mssuize/backend-client.js';
import {
  BackendError,
  errorKindForStatus,
} from '@/external/mssuize/backend-error.js';
import { FakeScheduling } from './fake-scheduling.js';
import { FakeTutorChange } from './fake-tutor-change.js';
import { FakeWeekly } from './fake-weekly.js';

// Every token this fake issues carries the marker, so a test can prove none ever leaks into an output.
export const TOKEN_MARKER = 'SHOULD-NOT-LEAK';

export interface FakeSessionCredentials {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: typeof fakeUser;
  householdId: string;
}

export interface FakeRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: unknown;
}

interface FakeReply {
  status: number;
  body?: unknown;
  /** The backend never answers, so the caller times out. */
  neverRespond?: boolean;
}

export const fakeUser = {
  id: '4b0f4f8e-6f7e-4c45-a7a3-0d1a0b2c3d4e',
  email: 'guardian@example.com',
  role: 'guardian',
  firstName: 'Ada',
  lastName: 'Lovelace',
  phone: '+15555550100',
  country: 'US',
  timezone: 'America/New_York',
  status: 'active',
  emailVerified: true,
  mfaEnabled: false,
  householdId: 'house-1',
  onboardingStatus: { step: 'done' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

export const FAKE_EMAIL_MARKER = 'private-contact-SHOULD-NOT-LEAK@example.com';
export const FAKE_PHONE_MARKER = '+15550001111';

// Includes fields the real backend sends that the tools must never pass on.
export const fakeHousehold = {
  id: 'house-1',
  primaryGuardianId: fakeUser.id,
  currentLearnerId: 'learner-1',
  name: 'The Lovelace Family',
  timezone: 'America/New_York',
  communicationPrefs: { email: true },
  recordingConsent: true,
  onboardingWalkthrough: false,
  referralCode: 'REF-123',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

export const fakeLearners = [
  {
    id: 'learner-1',
    firstName: 'Byron',
    lastName: 'Lovelace',
    gradeLevel: '6-8',
    actualGradeLevel: '7th Grade',
    status: 'active',
    age: 12,
    householdId: 'house-1',
    zipCode: '10001',
    schoolDistrict: 'District 2',
    averageScore: 91.5,
    paymentCompletedAt: '2026-02-01T00:00:00Z',
  },
  {
    id: 'learner-2',
    firstName: 'Anne',
    lastName: 'Lovelace',
    gradeLevel: 'K-2',
    status: 'No Plan',
    age: 7,
    zipCode: '10001',
  },
  {
    id: 'learner-3',
    firstName: 'Ralph',
    lastName: 'Lovelace',
    gradeLevel: '9-12',
    actualGradeLevel: '10th Grade',
    status: 'archived',
    age: 15,
  },
];

export const fakeMembers = [
  {
    id: 'member-1',
    userId: fakeUser.id,
    email: FAKE_EMAIL_MARKER,
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: FAKE_PHONE_MARKER,
    role: 'primary',
    status: 'active',
    invitedAt: '2026-01-01T00:00:00Z',
    acceptedAt: '2026-01-01T00:00:00Z',
    accessScope: 'all',
    learnerIds: ['learner-1', 'learner-2', 'learner-3'],
    learners: [{ id: 'learner-1', firstName: 'Byron', lastName: 'Lovelace' }],
  },
  {
    // A pending invite: no names yet, and a contact detail that must stay hidden.
    id: 'member-2',
    email: 'invited-SHOULD-NOT-LEAK@example.com',
    phone: '+15550002222',
    role: 'delegate',
    status: 'pending',
    invitedAt: '2026-03-01T00:00:00Z',
    accessScope: 'selected',
    learnerIds: ['learner-1'],
    learners: [],
  },
];

function cookieValue(
  header: string | undefined,
  name: string,
): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

// Mirrors the ms-backend auth routes: refresh reads the cookie and rotates the refresh token.
export class FakeMssuize {
  readonly requests: FakeRequest[] = [];
  readonly issuedRefreshTokens: string[] = [];
  refreshCalls = 0;
  /** What the next refreshes report as expiresIn, in seconds. */
  refreshExpiresIn = 7200;
  /** When set, every refresh answers with this status. */
  refreshFailure?: number;
  /** When set, logout answers with this status. */
  logoutFailure?: number;
  /** When true, /auth/me rejects every access token, even a fresh one. */
  rejectAllAccessTokens = false;
  /** When true, /auth/me leaves householdId out, as it does for tutors. */
  omitHouseholdFromMe = false;
  /** What the household routes return; a test can empty or change them. */
  learners: unknown[] = fakeLearners;
  members: unknown[] = fakeMembers;
  household: Record<string, unknown> = fakeHousehold;
  /** When true, GET /households/me answers 404, as for a user with no household. */
  householdMissing = false;
  /** When true, every household route answers 403, as the backend's role check does for a tutor. */
  householdForbidden = false;
  /** The scheduling routes (a learner's lessons, one lesson, a reschedule preview). */
  readonly scheduling = new FakeScheduling(fakeHousehold.id);
  /** A learner's weekly schedule routes (the read and the preview). */
  readonly weekly = new FakeWeekly();
  /** The parent's tutor-change request routes (create and list). */
  readonly tutorChange = new FakeTutorChange();

  private readonly accessTokens = new Set<string>();
  private readonly refreshTokens = new Set<string>();
  private counter = 0;

  /** All access tokens handed out so far stop working, as if they had expired. */
  expireAccessTokens(): void {
    this.accessTokens.clear();
  }

  /** All refresh tokens stop working, as if they had expired or been revoked. */
  revokeRefreshTokens(): void {
    this.refreshTokens.clear();
  }

  isRefreshTokenValid(token: string): boolean {
    return this.refreshTokens.has(token);
  }

  createTestSessionCredentials(): FakeSessionCredentials {
    return {
      ...this.issue(),
      expiresIn: 7200,
      user: fakeUser,
      householdId: fakeUser.householdId,
    };
  }

  handle(request: FakeRequest): FakeReply {
    this.requests.push(request);
    const url = new URL(request.path, 'http://fake.invalid');
    const route = `${request.method} ${url.pathname}`;
    const household =
      /^GET \/api\/v1\/households\/([^/]+)(?:\/(learners|members))?$/.exec(
        route,
      );
    if (household?.[1] === 'me' && household[2] === undefined) {
      return this.myHousehold(request);
    }
    if (household?.[2] === 'learners') {
      return this.householdLearners(request, household[1]!, url);
    }
    if (household?.[2] === 'members') {
      return this.householdMembers(request, household[1]!);
    }
    const scheduled = this.scheduling.handle(
      request,
      url,
      this.hasValidAccessToken(request),
    );
    if (scheduled !== undefined) return scheduled;
    const weekly = this.weekly.handle(
      request,
      url,
      this.hasValidAccessToken(request),
    );
    if (weekly !== undefined) return weekly;
    const change = this.tutorChange.handle(
      request,
      url,
      this.hasValidAccessToken(request),
    );
    if (change !== undefined) return change;
    if (route === 'GET /api/v1/auth/me') return this.me(request);
    if (route === 'POST /api/v1/auth/refresh') return this.refresh(request);
    if (route === 'POST /api/v1/auth/logout') return this.logout(request);
    return { status: 404, body: { error: 'no such route' } };
  }

  private issue() {
    this.counter += 1;
    const accessToken = `access-${this.counter}-${TOKEN_MARKER}`;
    const refreshToken = `refresh-${this.counter}-${TOKEN_MARKER}`;
    this.accessTokens.add(accessToken);
    this.refreshTokens.add(refreshToken);
    this.issuedRefreshTokens.push(refreshToken);
    return { accessToken, refreshToken };
  }

  private hasValidAccessToken(request: FakeRequest): boolean {
    const token = /^Bearer (.+)$/.exec(
      request.headers.authorization ?? '',
    )?.[1];
    return (
      !this.rejectAllAccessTokens &&
      token !== undefined &&
      this.accessTokens.has(token)
    );
  }

  private myHousehold(request: FakeRequest): FakeReply {
    if (!this.hasValidAccessToken(request)) {
      return { status: 401, body: { error: 'unauthorized' } };
    }
    if (this.householdForbidden) {
      return { status: 403, body: { error: 'forbidden role' } };
    }
    if (this.householdMissing) {
      return { status: 404, body: { error: 'household not found' } };
    }
    return { status: 200, body: this.household };
  }

  // Mirrors the backend: a bare array, "unarchived" by default, and an unknown status is not an
  // error but an empty list.
  private householdLearners(
    request: FakeRequest,
    householdId: string,
    url: URL,
  ): FakeReply {
    if (!this.hasValidAccessToken(request)) {
      return { status: 401, body: { error: 'unauthorized' } };
    }
    if (this.householdForbidden || householdId !== fakeHousehold.id) {
      return {
        status: 403,
        body: { error: 'unauthorized to access this household' },
      };
    }
    const status = url.searchParams.get('status') || 'unarchived';
    const all = this.learners as { status: string }[];
    const filters: Record<string, (learner: { status: string }) => boolean> = {
      all: () => true,
      unarchived: (learner) => learner.status !== 'archived',
      archived: (learner) => learner.status === 'archived',
      active: (learner) => learner.status === 'active',
      paused: (learner) => learner.status === 'paused',
    };
    return { status: 200, body: all.filter(filters[status] ?? (() => false)) };
  }

  private householdMembers(
    request: FakeRequest,
    householdId: string,
  ): FakeReply {
    if (!this.hasValidAccessToken(request)) {
      return { status: 401, body: { error: 'unauthorized' } };
    }
    if (this.householdForbidden || householdId !== fakeHousehold.id) {
      return { status: 403, body: { error: 'access denied' } };
    }
    return { status: 200, body: { members: this.members } };
  }

  private me(request: FakeRequest): FakeReply {
    if (!this.hasValidAccessToken(request)) {
      return { status: 401, body: { error: 'unauthorized' } };
    }
    if (this.omitHouseholdFromMe) {
      const { householdId: _householdId, ...withoutHousehold } = fakeUser;
      return { status: 200, body: withoutHousehold };
    }
    return { status: 200, body: fakeUser };
  }

  private refresh(request: FakeRequest): FakeReply {
    this.refreshCalls += 1;
    if (this.refreshFailure !== undefined) {
      return { status: this.refreshFailure, body: { error: 'refresh failed' } };
    }
    const token = cookieValue(request.headers.cookie, 'refresh_token');
    if (token === undefined) {
      return { status: 400, body: { error: 'Refresh token not found' } };
    }
    if (!this.refreshTokens.delete(token)) {
      return {
        status: 401,
        body: { error: 'invalid or expired refresh token' },
      };
    }
    return {
      status: 200,
      body: {
        user: fakeUser,
        ...this.issue(),
        expiresIn: this.refreshExpiresIn,
      },
    };
  }

  private logout(request: FakeRequest): FakeReply {
    if (this.logoutFailure !== undefined) {
      return {
        status: this.logoutFailure,
        body: { error: 'Failed to logout' },
      };
    }
    const token = cookieValue(request.headers.cookie, 'refresh_token');
    if (token === undefined) {
      return { status: 400, body: { error: 'Refresh token not found' } };
    }
    this.refreshTokens.delete(token);
    return { status: 200, body: { message: 'Logged out successfully' } };
  }
}

// The same choice the real client makes for an error reply: by status, and for a 400 with phrases,
// by the first phrase found in the error text.
function kindFor(
  reply: FakeReply,
  phrases: readonly BackendErrorPhrase[] | undefined,
) {
  if (reply.status === 400 && phrases !== undefined) {
    const text = JSON.stringify(reply.body ?? '').toLowerCase();
    const match = phrases.find((entry) =>
      text.includes(entry.phrase.toLowerCase()),
    );
    if (match) return match.kind;
  }
  return errorKindForStatus(reply.status);
}

// A BackendApi that answers from the fake, with the same error mapping as the real client.
export function createFakeMssuizeApi(
  fake: FakeMssuize,
  options: { latencyMs?: number } = {},
): BackendApi & { createTestSessionCredentials: () => FakeSessionCredentials } {
  return {
    createTestSessionCredentials: () => fake.createTestSessionCredentials(),
    async request<S extends z.ZodType>(
      request: BackendRequest<S>,
    ): Promise<z.output<S>> {
      if (options.latencyMs) {
        await new Promise((resolve) => setTimeout(resolve, options.latencyMs));
      }
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers ?? {})) {
        headers[name.toLowerCase()] = value;
      }
      const reply = fake.handle({
        method: request.method,
        path: request.path,
        headers,
        body: request.body,
      });
      if (reply.neverRespond) throw new BackendError('timeout');
      if (reply.status >= 400) {
        throw new BackendError(kindFor(reply, request.errorPhrases));
      }
      const parsed = request.response.safeParse(reply.body);
      if (!parsed.success) throw new BackendError('unexpected_response');
      return parsed.data;
    },
  };
}

// The same fake behind a real HTTP server, for the e2e tests.
export async function startFakeMssuizeServer(
  fake: FakeMssuize,
  options: { latencyMs?: number } = {},
): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let body: unknown;
      try {
        body = text === '' ? undefined : JSON.parse(text);
      } catch {
        body = undefined;
      }
      const headers: Record<string, string | undefined> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        headers[name] = Array.isArray(value) ? value.join(', ') : value;
      }
      const reply = fake.handle({
        method: request.method ?? 'GET',
        path: request.url ?? '',
        headers,
        body,
      });
      // A request that is never answered: the client's own timeout ends it.
      if (reply.neverRespond) return;
      const send = () => {
        response.writeHead(reply.status, {
          'Content-Type': 'application/json',
        });
        response.end(JSON.stringify(reply.body ?? {}));
      };
      if (options.latencyMs) setTimeout(send, options.latencyMs);
      else send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
