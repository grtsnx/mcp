import { FakeMssuize } from './fake-mssuize.js';

// A fake backend with one signed-in access token, and an empty request log.
export function createApiFixture() {
  const fake = new FakeMssuize();
  const credentials = fake.createTestSessionCredentials();
  fake.requests.length = 0;
  return { fake, accessToken: credentials.accessToken };
}
