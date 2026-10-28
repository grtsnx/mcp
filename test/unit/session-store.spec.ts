import { describe, expect, it } from 'vitest';
import { SessionStore } from '@/session/session-store.js';
import type { Session } from '@/session/session.types.js';
import { createClock } from '../helpers/tool-harness.js';

const HOUR = 3_600_000;

function makeSession(id: string, now: number): Session {
  return {
    id,
    profile: {
      id: 'u1',
      email: 'a@example.com',
      role: 'guardian',
      firstName: 'Ada',
      lastName: 'Lovelace',
    },
    householdId: null,
    tokens: {
      accessToken: 'a',
      refreshToken: 'r',
      accessExpiresAt: now + 7_200_000,
      refreshExpiresAt: now + 7 * 24 * HOUR,
    },
    proposals: new Map(),
    generation: 0,
    lastUsedAt: now,
    closing: false,
    activeOperations: 0,
  };
}

describe('SessionStore', () => {
  const setup = (maxSessions = 3, idleTtlMs = HOUR) => {
    const clock = createClock();
    const store = new SessionStore({ maxSessions, idleTtlMs, now: clock.now });
    return { clock, store };
  };

  it('returns a stored session and nothing for an unknown id', () => {
    const { clock, store } = setup();
    store.add(makeSession('s1', clock.now()));

    expect(store.get('s1')?.id).toBe('s1');
    expect(store.get('nope')).toBeUndefined();
    expect(store.size).toBe(1);
  });

  it('drops the least recently used session when full', () => {
    const { clock, store } = setup(2);
    store.add(makeSession('s1', clock.now()));
    store.add(makeSession('s2', clock.now()));
    store.get('s1');
    store.add(makeSession('s3', clock.now()));

    expect(store.size).toBe(2);
    expect(store.get('s2')).toBeUndefined();
    expect(store.get('s1')).toBeDefined();
    expect(store.get('s3')).toBeDefined();
  });

  it('never holds more than the cap, however many are added', () => {
    const { clock, store } = setup(3);
    for (let index = 0; index < 20; index += 1) {
      store.add(makeSession(`s${index}`, clock.now()));
    }

    expect(store.size).toBe(3);
    expect(store.get('s19')).toBeDefined();
    expect(store.get('s0')).toBeUndefined();
  });

  it('drops a session that has been idle too long, and use keeps it alive', () => {
    const { clock, store } = setup(3, HOUR);
    store.add(makeSession('idle', clock.now()));
    store.add(makeSession('busy', clock.now()));

    clock.advance(HOUR - 1);
    expect(store.get('busy')).toBeDefined();
    clock.advance(2);

    expect(store.get('idle')).toBeUndefined();
    expect(store.get('busy')).toBeDefined();
  });

  it('drops a session once its refresh token has expired', () => {
    const { clock, store } = setup(3, 30 * 24 * HOUR);
    const session = makeSession('s1', clock.now());
    session.tokens.refreshExpiresAt = clock.now() + 1000;
    store.add(session);

    clock.advance(999);
    expect(store.get('s1')).toBeDefined();
    clock.advance(1);
    expect(store.get('s1')).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('clears stale sessions when a new one is added', () => {
    const { clock, store } = setup(10, HOUR);
    store.add(makeSession('old1', clock.now()));
    store.add(makeSession('old2', clock.now()));
    clock.advance(HOUR);
    store.add(makeSession('fresh', clock.now()));

    expect(store.size).toBe(1);
  });

  it('deletes a session', () => {
    const { clock, store } = setup();
    store.add(makeSession('s1', clock.now()));
    store.delete('s1');

    expect(store.get('s1')).toBeUndefined();
  });
});
