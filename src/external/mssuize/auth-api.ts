import { z } from 'zod';
import type { BackendApi } from './backend-client.js';

// Replies are parsed with zod objects, which drop any field not listed here.

export const refreshedTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresIn: z.number().int().positive(),
});

export type RefreshedTokens = z.infer<typeof refreshedTokensSchema>;

// householdId is only sent for guardian and delegate users.
export const currentUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  status: z.string(),
  householdId: z.string().nullish(),
});

export type CurrentUser = z.infer<typeof currentUserSchema>;

const logoutReplySchema = z.object({ message: z.string() });

export function bearerHeader(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

// ms-backend reads the refresh token from this cookie, never from the body.
export function refreshCookieHeader(
  refreshToken: string,
): Record<string, string> {
  return { Cookie: `refresh_token=${refreshToken}` };
}

// The backend rotates the refresh token: the one sent here stops working once this succeeds.
export function refreshTokens(
  backend: BackendApi,
  refreshToken: string,
): Promise<RefreshedTokens> {
  return backend.request({
    method: 'POST',
    path: '/api/v1/auth/refresh',
    headers: refreshCookieHeader(refreshToken),
    response: refreshedTokensSchema,
  });
}

export function fetchCurrentUser(
  backend: BackendApi,
  accessToken: string,
): Promise<CurrentUser> {
  return backend.request({
    method: 'GET',
    path: '/api/v1/auth/me',
    headers: bearerHeader(accessToken),
    response: currentUserSchema,
  });
}

export async function logoutOnBackend(
  backend: BackendApi,
  refreshToken: string,
): Promise<void> {
  await backend.request({
    method: 'POST',
    path: '/api/v1/auth/logout',
    headers: refreshCookieHeader(refreshToken),
    response: logoutReplySchema,
  });
}
