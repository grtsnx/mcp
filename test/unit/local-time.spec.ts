import { describe, expect, it } from 'vitest';
import { BackendError } from '@/external/mssuize/backend-error.js';
import {
  FALLBACK_TIME_ZONE,
  dateLocal,
  householdClock,
  localClock,
  windowLocal,
} from '@/tools/local-time.js';
import { fakeHousehold } from '../helpers/fake-mssuize.js';
import { setupSessions } from '../helpers/session-fixture.js';

describe('localClock', () => {
  it('writes a lesson in a zone without daylight saving (Africa/Lagos)', () => {
    const clock = localClock('Africa/Lagos');

    expect(clock.timezone).toBe('Africa/Lagos');
    expect(clock.between('2026-12-08T21:00:00Z', '2026-12-08T22:00:00Z')).toBe(
      'Tuesday 8 December 2026, 10:00 PM to 11:00 PM',
    );
  });

  it('shows the local day when it differs from the UTC day', () => {
    // 23:30 UTC on Tuesday is already Wednesday in Lagos.
    expect(
      localClock('Africa/Lagos').between(
        '2026-12-08T23:30:00Z',
        '2026-12-09T00:30:00Z',
      ),
    ).toBe('Wednesday 9 December 2026, 12:30 AM to 1:30 AM');
    // 02:00 UTC on Tuesday is still Monday evening in New York.
    expect(
      localClock('America/New_York').between(
        '2026-06-02T02:00:00Z',
        '2026-06-02T03:00:00Z',
      ),
    ).toBe('Monday 1 June 2026, 10:00 PM to 11:00 PM');
  });

  it('follows daylight saving in America/New_York', () => {
    const clock = localClock('America/New_York');

    expect(clock.between('2026-01-15T15:00:00Z', '2026-01-15T16:00:00Z')).toBe(
      'Thursday 15 January 2026, 10:00 AM to 11:00 AM',
    );
    expect(clock.between('2026-07-15T15:00:00Z', '2026-07-15T16:00:00Z')).toBe(
      'Wednesday 15 July 2026, 11:00 AM to 12:00 PM',
    );
    // The clocks jump from 2:00 to 3:00 AM on 8 March 2026, inside this hour-long lesson.
    expect(clock.between('2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z')).toBe(
      'Sunday 8 March 2026, 1:30 AM to 3:30 AM',
    );
  });

  it('writes the end date too when the lesson ends on another day', () => {
    expect(
      localClock('America/New_York').between(
        '2026-06-02T03:30:00Z',
        '2026-06-02T04:30:00Z',
      ),
    ).toBe('Monday 1 June 2026, 11:30 PM to Tuesday 2 June 2026, 12:30 AM');
  });

  it('reads instants written with any offset', () => {
    expect(
      localClock('Africa/Lagos').between(
        '2026-06-02T10:00:00+01:00',
        '2026-06-02T07:00:00-04:00',
      ),
    ).toBe('Tuesday 2 June 2026, 10:00 AM to 12:00 PM');
  });

  it.each([
    ['no zone', undefined],
    ['a null zone', null],
    ['an empty zone', ''],
    ['an unknown zone', 'Mars/Olympus_Mons'],
    ['an offset instead of a name', '+01:00'],
  ])('falls back to UTC, and says so, for %s', (_label, zone) => {
    const clock = localClock(zone);

    expect(clock.timezone).toBe(FALLBACK_TIME_ZONE);
    expect(clock.between('2026-12-08T21:00:00Z', '2026-12-08T22:00:00Z')).toBe(
      'Tuesday 8 December 2026, 9:00 PM to 10:00 PM UTC',
    );
  });

  it('says UTC when the family itself is on UTC', () => {
    expect(
      localClock('Etc/UTC').between(
        '2026-12-08T21:00:00Z',
        '2026-12-08T22:00:00Z',
      ),
    ).toBe('Tuesday 8 December 2026, 9:00 PM to 10:00 PM UTC');
  });

  it('refuses an instant it cannot read, as an unexpected reply', () => {
    expect(() =>
      localClock('Africa/Lagos').between('not a time', '2026-12-08T22:00:00Z'),
    ).toThrow(BackendError);
  });
});

describe('dateLocal', () => {
  it('writes a calendar date as written, whatever the zone', () => {
    expect(dateLocal('2026-06-02')).toBe('Tuesday 2 June 2026');
    expect(dateLocal('2026-12-31T00:00:00Z')).toBe('Thursday 31 December 2026');
  });

  it.each(['June 2', '2026-02-30', ''])('refuses %j', (date) => {
    expect(() => dateLocal(date)).toThrow(BackendError);
  });
});

describe('windowLocal', () => {
  it('writes a window in words, with its own zone and its extra range', () => {
    expect(
      windowLocal({
        dayOfWeek: 2,
        startTime: '16:00:00',
        endTime: '18:00:00',
        extraStartTime: '19:00:00',
        extraEndTime: '20:00:00',
        timezone: 'Africa/Lagos',
      }),
    ).toBe('Tuesday, 4:00 PM to 6:00 PM and 7:00 PM to 8:00 PM (Africa/Lagos)');
  });

  it('never converts a window, and leaves the zone out when it has none', () => {
    expect(
      windowLocal({ dayOfWeek: 0, startTime: '00:00', endTime: '12:30' }),
    ).toBe('Sunday, 12:00 AM to 12:30 PM');
  });

  it('refuses a time it cannot read', () => {
    expect(() =>
      windowLocal({ dayOfWeek: 1, startTime: '4pm', endTime: '18:00' }),
    ).toThrow(BackendError);
  });
});

describe('householdClock', () => {
  const householdReads = (fixture: ReturnType<typeof setupSessions>) =>
    fixture.fake.requests.filter(
      (request) => request.path === '/api/v1/households/me',
    );

  it("uses the household's own zone, read once", async () => {
    const fixture = setupSessions();
    fixture.fake.household = { ...fakeHousehold, timezone: 'Africa/Lagos' };
    const sessionId = fixture.signIn();
    fixture.fake.requests.length = 0;

    const clock = await householdClock(fixture, sessionId);

    expect(clock.timezone).toBe('Africa/Lagos');
    expect(householdReads(fixture)).toHaveLength(1);
  });

  it('falls back to UTC when the household cannot be read', async () => {
    const fixture = setupSessions();
    fixture.fake.householdMissing = true;

    const clock = await householdClock(fixture, fixture.signIn());

    expect(clock.timezone).toBe('UTC');
  });

  it('falls back to UTC when the household has an unusable zone', async () => {
    const fixture = setupSessions();
    fixture.fake.household = { ...fakeHousehold, timezone: 'Not a zone' };

    const clock = await householdClock(fixture, fixture.signIn());

    expect(clock.timezone).toBe('UTC');
  });

  it('falls back to UTC, without a backend call, when the session has no household', async () => {
    const fixture = setupSessions();
    const credentials = fixture.fake.createTestSessionCredentials();
    const sessionId = fixture.sessions.create({
      ...credentials,
      householdId: null,
    });
    fixture.fake.requests.length = 0;

    const clock = await householdClock(fixture, sessionId);

    expect(clock.timezone).toBe('UTC');
    expect(householdReads(fixture)).toHaveLength(0);
  });
});
