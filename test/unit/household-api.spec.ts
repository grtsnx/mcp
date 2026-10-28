import { beforeEach, describe, expect, it } from 'vitest';
import {
  fetchLearners,
  fetchMembers,
  fetchMyHousehold,
  learnerStatuses,
} from '@/external/mssuize/household-api.js';
import {
  FAKE_EMAIL_MARKER,
  FakeMssuize,
  createFakeMssuizeApi,
} from '../helpers/fake-mssuize.js';

describe('household-api', () => {
  let fake: FakeMssuize;
  let accessToken: string;
  const backend = () => createFakeMssuizeApi(fake);

  beforeEach(() => {
    fake = new FakeMssuize();
    accessToken = fake.createTestSessionCredentials().accessToken;
    fake.requests.length = 0;
  });

  const lastPath = () => fake.requests.at(-1)?.path;

  it('sends the access token as a bearer header', async () => {
    await fetchMyHousehold(backend(), accessToken);

    expect(fake.requests[0]?.headers.authorization).toBe(
      `Bearer ${accessToken}`,
    );
  });

  it('asks for the household of the token with GET /households/me', async () => {
    await fetchMyHousehold(backend(), accessToken);

    expect(fake.requests[0]).toMatchObject({
      method: 'GET',
      path: '/api/v1/households/me',
    });
  });

  it('sends no query when no status is given, so the backend default applies', async () => {
    await fetchLearners(backend(), accessToken, 'house-1');

    expect(lastPath()).toBe('/api/v1/households/house-1/learners');
  });

  it.each(learnerStatuses)(
    'sends status=%s as a query parameter',
    async (status) => {
      await fetchLearners(backend(), accessToken, 'house-1', status);

      expect(lastPath()).toBe(
        `/api/v1/households/house-1/learners?status=${status}`,
      );
    },
  );

  it('encodes the household id so it cannot change the path', async () => {
    await fetchMembers(backend(), accessToken, 'a/b?c=d').catch(
      (error: unknown) => error,
    );

    expect(lastPath()).toBe('/api/v1/households/a%2Fb%3Fc%3Dd/members');
  });

  it('keeps only the household fields the tools return', async () => {
    const household = await fetchMyHousehold(backend(), accessToken);

    expect(Object.keys(household).sort()).toEqual([
      'currentLearnerId',
      'id',
      'name',
      'recordingConsent',
      'timezone',
    ]);
  });

  it('keeps only the learner fields the tools return', async () => {
    const [first] = await fetchLearners(
      backend(),
      accessToken,
      'house-1',
      'all',
    );

    expect(Object.keys(first ?? {}).sort()).toEqual([
      'actualGradeLevel',
      'age',
      'firstName',
      'gradeLevel',
      'id',
      'lastName',
      'status',
    ]);
  });

  it('drops member contact details and nested learners when parsing', async () => {
    const members = await fetchMembers(backend(), accessToken, 'house-1');

    expect(members).toHaveLength(2);
    for (const member of members) {
      expect(Object.keys(member)).not.toContain('email');
      expect(Object.keys(member)).not.toContain('phone');
      expect(Object.keys(member)).not.toContain('learners');
    }
    expect(JSON.stringify(members)).not.toContain(FAKE_EMAIL_MARKER);
  });

  it('accepts a learner with no grade levels and a member with no names', async () => {
    fake.learners = [
      { id: 'l', firstName: 'A', lastName: 'B', status: 'No Plan', age: 5 },
    ];
    fake.members = [
      { id: 'm', role: 'delegate', status: 'pending', accessScope: 'selected' },
    ];

    const [learner] = await fetchLearners(backend(), accessToken, 'house-1');
    const [member] = await fetchMembers(backend(), accessToken, 'house-1');

    expect(learner?.gradeLevel).toBeUndefined();
    expect(member?.firstName).toBeUndefined();
    expect(member?.learnerIds).toBeUndefined();
  });

  it('reports a reply of the wrong shape as an unexpected response', async () => {
    fake.learners = [{ id: 'l', firstName: 'A' }];

    await expect(
      fetchLearners(backend(), accessToken, 'house-1'),
    ).rejects.toMatchObject({ kind: 'unexpected_response' });
  });

  it('maps a 403 to forbidden and a 401 to unauthorized', async () => {
    await expect(
      fetchMembers(backend(), accessToken, 'someone-elses'),
    ).rejects.toMatchObject({ kind: 'forbidden' });

    fake.expireAccessTokens();
    await expect(
      fetchMembers(backend(), accessToken, 'house-1'),
    ).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});
