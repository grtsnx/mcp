# Agentic

MCP Agents is a NestJS MCP server for the MsSuzie agents platform. It exposes versioned health APIs, OpenAPI documents, structured HTTP responses, and a Streamable HTTP MCP endpoint at `POST /mcp`. It does not collect user passwords. Authenticated household and scheduling tools require a session created by a trusted authentication issuer; that issuer is not included yet.

## Requirements

- Bun 1.3.14
- Node.js 24 or later for the production runtime
- Docker or another OCI-compatible container runtime for deployment

## Local development

```bash
cp .env.example .env
bun install --frozen-lockfile
bun run start:dev
```

Swagger UI runs at `http://localhost:3000/api`, and Scalar runs at `http://localhost:3000/docs`. Both use the version-specific OpenAPI documents at `/api/v1-json` and `/api/v2-json`. The application prints every enabled documentation URL when it starts.

## Configuration

The application validates configuration before it starts. Invalid ports, booleans, and CORS origins stop startup.

| Variable                      | Default               | Purpose                                                                                                                             |
| ----------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                    | `development`         | Selects development, test, or production behavior.                                                                                  |
| `PORT`                        | `3000`                | Sets the HTTP port.                                                                                                                 |
| `PLATFORM_NAME`               | `Agentic`             | Names the API and OpenAPI document.                                                                                                 |
| `CORS_ORIGINS`                | empty                 | Lists exact, comma-separated browser origins. Empty disables CORS.                                                                  |
| `SWAGGER_ENABLED`             | on outside production | Enables Swagger, Scalar, and OpenAPI JSON. Set it explicitly in production.                                                         |
| `MCP_API_KEY`                 | none                  | Bearer secret for `POST /mcp`. At least 16 characters in development and 32 in production.                                          |
| `MCP_AUTHORIZATION_SERVERS`   | empty                 | Where an MCP client signs a person in, such as ms-backend, listed in `/.well-known/oauth-protected-resource`. Comma-separated URLs. |
| `BACKEND_BASE_URL`            | none                  | ms-backend base URL. Production requires HTTPS; URLs cannot contain credentials, query strings, or fragments.                       |
| `SESSION_MAX_COUNT`           | `1000`                | Most sign-in sessions kept in memory; the least recently used one is dropped when full.                                             |
| `SESSION_IDLE_TTL_SECONDS`    | `3600`                | A session unused for this long is dropped.                                                                                          |
| `SESSION_REFRESH_TTL_SECONDS` | `604800`              | How long ms-backend keeps a refresh token valid (7 days); the session is dropped after it.                                          |
| `OBSERVE_ENABLED`             | `false`               | Enables NestJS Observe when valid credentials are present.                                                                          |

Never use `*` in `CORS_ORIGINS`. The server accepts only complete HTTP or HTTPS origins without paths.

## Health checks

- `GET /v1/health/live` proves that the process can answer requests.
- `GET /v1/health/ready` checks the process's memory limits.

Both routes also support API version 2. The checks do not depend on external websites, databases, or Redis.

## Using the tools

### 1. Run it and connect

```bash
cp .env.example .env          # set MCP_API_KEY (16+ chars; 32+ in production) and BACKEND_BASE_URL
bun install --frozen-lockfile
bun run start:dev             # http://localhost:3000
```

Every call is `POST /mcp` with these headers:

```text
Authorization: Bearer <MCP_API_KEY>
Content-Type: application/json
Accept: application/json, text/event-stream
```

Or add it to an MCP client:

```bash
claude mcp add --transport http mcp-agents http://localhost:3000/mcp --header "Authorization: Bearer <MCP_API_KEY>"
```

### 2. Call a tool

List the tools, then call one:

```bash
curl -s -X POST http://localhost:3000/mcp -H "Authorization: Bearer <MCP_API_KEY>" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl -s -X POST http://localhost:3000/mcp -H "Authorization: Bearer <MCP_API_KEY>" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ping","arguments":{}}}'
# result: { "ok": true }
```

In the examples below only `name` and `arguments` change. A failed call returns `isError: true` and a short fixed message, never backend text.

### 3. Sign in as a person

Every tool except `ping` acts for one signed-in person. Send that person's ms-backend access token as the bearer token instead of `MCP_API_KEY`; the server checks it and uses their household. No tool takes a `sessionId`. With only `MCP_API_KEY`, those tools answer `Sign in to MsSuzie first, then try again.` See "Authentication and sign-in" below.

- `lessonId` is a tutoring class.

### 4. Tools and examples

#### Check the server

| Tool   | Arguments | You get          |
| ------ | --------- | ---------------- |
| `ping` | `{}`      | `{ "ok": true }` |

#### Session

| Tool         | Arguments | You get                                               |
| ------------ | --------- | ----------------------------------------------------- |
| `session_me` | `{}`      | `id`, `email`, `role`, names, `status`, `householdId` |

#### Household (read-only)

| Tool                 | Arguments                | You get                                                                      |
| -------------------- | ------------------------ | ---------------------------------------------------------------------------- |
| `household_get`      | `{}`                     | `id`, `name`, `timezone`, `currentLearnerId`, `recordingConsent`             |
| `household_learners` | `{ "status": "active" }` | `{ learners: [{ id, firstName, lastName, gradeLevel, status, age, ... }] }`  |
| `household_members`  | `{}`                     | `{ members: [{ id, firstName, lastName, role, status, accessScope, ... }] }` |

`status` is one of `active`, `paused`, `archived`, `unarchived`, `all`. Get a `learnerId` here first.

#### Lessons (read-only)

| Tool                              | Arguments                                                | You get                                                                                                                                                              |
| --------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `learner_sessions_list`           | `{ "learnerId", "status": "scheduled", "pageSize": 20 }` | `{ timezone, lessons: [{ lessonId, tutorName, subjects, scheduledStart, scheduledEnd, whenLocal, durationMinutes, status, canReschedule, canCancel }], totalCount }` |
| `household_sessions_list`         | `{ "status": "scheduled" }`                              | the same lessons for every learner, ids only                                                                                                                         |
| `session_get`                     | `{ "lessonId" }`                                         | one lesson, the tutor's and learner's names, the 10 newest events                                                                                                    |
| `session_reschedule_options_day`  | `{ "lessonId", "targetDate": "2026-06-02" }`             | `{ slots: [{ start, end, whenLocal }], currentStart, currentEnd, currentWhenLocal, timezone }`                                                                       |
| `session_reschedule_options_week` | `{ "lessonId" }`                                         | free slots for each of the next 6 days                                                                                                                               |

Filters: `startAfter` and `startBefore` (ISO 8601 with an offset), `page` (from 0), `pageSize` (1 to 50).

**Weekly windows** (a window is a range the family offers, like Tuesday 16:00 to 18:00. It is not a lesson time. `dayOfWeek` 0 is Sunday.)

| Tool                              | Arguments                                                                                                | You get                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `learner_weekly_schedule_get`     | `{ "learnerId" }`                                                                                        | `windows` (with `dayName`) and `subjectPreferences`        |
| `learner_weekly_schedule_preview` | `{ "learnerId", "windows": [{ "windowId", "dayOfWeek": 2, "startTime": "17:00", "endTime": "19:00" }] }` | counts and the lessons that would move. **Saves nothing.** |

Send the **complete** new list of windows. Keep a window by passing its `windowId` from the get. An empty preview does not prove nothing will move.

**Changing things: two steps, always.** Each of these has `step: "propose"` (changes nothing) and `step: "confirm"` (does it, once).

| Tool                             | Propose arguments                                                          | Confirm arguments                                                  |
| -------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `session_reschedule`             | `lessonId`, `newStart`, `newEnd` (a slot from the options tools), `reason` | `confirmationToken`                                                |
| `session_cancel`                 | `lessonId`, `reason`                                                       | `confirmationToken`                                                |
| `learner_weekly_schedule_update` | `learnerId`, `windows` (as in the preview), `reason`                       | `confirmationToken`, `parentAcknowledgesLessonsMayBeChanged: true` |
| `tutor_change_request_create`    | `learnerId`, `lessonId`, `reason`. The tutor comes from the lesson.        | `confirmationToken`                                                |

Example, moving a lesson:

```jsonc
// 1. Look at the free times
{ "name": "session_reschedule_options_day",
  "arguments": { "lessonId": "<LESSON_ID>", "targetDate": "2026-06-02" } }

// 2. Propose: nothing moves. Returns a confirmationToken (single use, 5 minutes).
{ "name": "session_reschedule",
  "arguments": { "step": "propose", "lessonId": "<LESSON_ID>",
                 "newStart": "2026-06-02T10:00:00-04:00", "newEnd": "2026-06-02T11:00:00-04:00",
                 "reason": "Soccer practice moved" } }
// -> { "status": "proposed", "confirmationToken": "...", "currentStart": "...", "newStart": "...", "expiresInSeconds": 300 }

// 3. Show the parent the proposal. Only after an explicit yes:
{ "name": "session_reschedule",
  "arguments": { "step": "confirm", "confirmationToken": "<TOKEN>" } }
// -> { "status": "rescheduled", "lessonId": "...", "newStart": "...", "newEnd": "..." }
```

Cancelling is the same, with `session_cancel` and no times. If the lesson starts in under 24 hours the proposal adds a late-cancellation notice.

#### Ask for a tutor change

| Tool                          | Arguments           | You get                                                                                                  |
| ----------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------- |
| `tutor_change_request_create` | see the table above | propose: the learner's and tutor's first names. confirm: `{ status: "filed", requestStatus: "pending" }` |
| `tutor_change_request_list`   | `{}`                | `{ requests: [{ requestId, learnerId, currentTutorName, status, reason, createdAt }], total }`           |

A request goes to the school's staff, who decide. It does not change the tutor by itself. The list may answer "No household could be found for this account's tutor-change requests." for a primary guardian; that is a backend limit.

### 5. Rules that apply to every write

- **Show the parent the whole proposal and wait for an explicit yes** before confirming. Never confirm on your own.
- The token works once, for 5 minutes, and only for the session that proposed it.
- **A write is never retried.** If a confirm says the result is unknown, do not try again. Read the real state first: `session_get` for a lesson, `learner_weekly_schedule_get` then `learner_sessions_list` for the weekly schedule, `tutor_change_request_list` for a tutor request.
- A weekly save can move lessons and notify the family and the tutor. The tool re-checks the schedule and the preview just before saving and sends nothing if they changed.
- A cancel cannot be undone with these tools.

More detail on each tool, the exact backend routes, and curl for every call are in the sections below.

## MCP

Agents call `POST /mcp` with `Authorization: Bearer <MCP_API_KEY>`. The server is stateless Streamable HTTP (a new MCP server per request). GET and DELETE on `/mcp` return `405`.

Tools include `ping`, session, household, scheduling, weekly-schedule, and tutor-change tools. Session-dependent tools accept only opaque session handles; no tool accepts email or password. Until the trusted authentication issuer is integrated, only `ping` is available for a complete end-to-end MCP workflow. Layout:

```text
src/mcp/                the MCP endpoint: controller, module, mcp-server.ts
src/middleware/guard/   MCP bearer guard and the stateless request handler
src/tools/
  define-tool.ts        shared pattern every tool uses
  local-time.ts         the one formatter for every *Local text
  index.ts              the one list of tools (one line per tool)
  ping/                 schemas.ts, handler.ts, index.ts
  session-me/           same three files
  auth-logout/          same three files
  household-get/        same three files
  household-learners/   same three files
  household-members/    same three files
  learner-sessions-list/  same three files
  session-get/          same three files
  session-reschedule-options-day/  same three files
  session-reschedule-options-week/  same three files
  household-sessions-list/  same three files
  session-reschedule/   same three files (the first write tool)
  learner-weekly-schedule-get/      same three files
  learner-weekly-schedule-preview/  same three files
  session-cancel/       same three files (a write tool that cannot be undone)
  learner-weekly-schedule-update/   same three files (a write tool: two steps, re-checked before the save)
  tutor-change-request-create/      same three files (a write tool: two steps)
  tutor-change-request-list/        same three files
src/session/            in-memory sign-in sessions and all token handling
src/config/             environment validation and bearer.ts (MCP key check)
src/external/mssuize/   the only code that calls ms-backend
```

### Authentication and sign-in

`POST /mcp` takes one bearer token, the standard MCP way:

- **A person's own ms-backend access token**, as any MCP client sends it after the person signs in. The server checks it with ms-backend (`GET /api/v1/auth/me`) and the tools then act for that person and their household only. A check is reused for a minute. The client keeps its token fresh; this server never holds a refresh token.
- **`MCP_API_KEY`**, for a trusted agent with no person signed in. Only `ping` works; every other tool answers `Sign in to MsSuzie first, then try again.`

No tool takes a `sessionId`. The person always comes from the request's sign-in, so no model can choose whose household a tool acts for. A token ms-backend refuses gets `401` with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`, and that document (RFC 9728) lists where to sign in from `MCP_AUTHORIZATION_SERVERS`. Passwords are never accepted.

How it works inside (`src/session/session.service.ts`, `SessionService.signIn`):

- One in-memory session per person. A newer token updates it, so a pending confirmation survives a token refresh by the client.
- Tokens never appear in a tool output, log or error.
- When ms-backend refuses the token during a call, the session ends and the tool tells the model to ask the person to sign in again. Nothing is retried with another token.
- Sessions live in memory, so a restart only means each person's next request is checked again; nothing is lost that the client cannot resend. Pending confirmations are lost on restart.
- `SESSION_MAX_COUNT` and `SESSION_IDLE_TTL_SECONDS` bound how many are kept.
- `session_me` takes no input and returns `id`, `email`, `role`, `firstName`, `lastName`, `status` and `householdId`.
- Household calls go through `SessionService.withHousehold(...)`, which uses the household from the person's own sign-in.

### Household tools (read-only)

Three tools read the household of the signed-in person, from their own access token (see "Authentication and sign-in" above).

| Tool                 | Input         | Returns                                                                                  |
| -------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| `household_get`      | `{}`          | `id`, `name`, `timezone`, `currentLearnerId`, `recordingConsent`                         |
| `household_learners` | `{ status? }` | `{ learners: [{ id, firstName, lastName, gradeLevel, actualGradeLevel, status, age }] }` |
| `household_members`  | `{}`          | `{ members: [{ id, firstName, lastName, role, status, accessScope, learnerIds }] }`      |

- **`householdId` is not an input, and is rejected if sent.** The household always comes from the profile stored in the session when the person signed in, so the agent can only ever read its own signed-in person's household. A household id supplied by the model would let a wrong or manipulated prompt point a call at someone else's household. If the session has no household, the tool returns `No household is linked to this session.`
- **`status`** (learners only) is one of `active`, `paused`, `archived`, `unarchived` or `all`; without it the backend returns `unarchived`. The backend answers an unknown status with a `200` and an empty list, which would look like "no children", so any other value is rejected before a backend call is made.
- **Data minimisation.** Learners are children and members are other people, so each tool returns only the fields above. Member email and phone are never returned, and the backend's other fields (addresses, school district, scores, payment dates, nested learner details) are dropped when its reply is parsed, before a tool sees them. None of this data is logged or put in an error message.
- **Errors.** A backend `403` becomes `Not allowed to access this household.` (household routes are for guardian, delegate and admin users, so a tutor gets this). A refresh that fails with a `401` ends the session and asks the model to have the user sign in again. Every other failure uses the standard short message, never the backend's body.

### Scheduling tools (read-only)

Three tools let the agent find a child's class and see when it could move. They use the normal guardian-facing routes (never `/agent/...`), a session from the trusted authentication issuer, and the same automatic token refresh. None of them changes anything.

| Tool                             | Input                                                                           | Returns                                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `learner_sessions_list`          | `learnerId`, optional `status`, `startAfter`, `startBefore`, `page`, `pageSize` | `{ timezone, lessons: [{ lessonId, tutorName, learnerName, subjects, scheduledStart, scheduledEnd, whenLocal, durationMinutes, status, canReschedule, canCancel }], totalCount, page, pageSize }` |
| `session_get`                    | `lessonId`                                                                      | `{ lesson, tutor: { firstName, lastName }, learner: { firstName, lastName }, recentEvents }` (10 newest events)                                                                                   |
| `session_reschedule_options_day` | `lessonId`, `targetDate` (`YYYY-MM-DD`), optional `timezone`                    | `{ lessonId, targetDate, targetDateLocal, timezone, durationMinutes, currentStart, currentEnd, currentWhenLocal, slots: [{ start, end, whenLocal }], count }`                                     |

- **`lessonId` is the tutoring class.** The signed-in person comes from the request, never from an input. Every one of these tools says so in its description, so the model does not pass one for the other. A `lessonId` and a `learnerId` must be UUIDs, and `sessionId` is never accepted in their place.
- **The household id is not an input.** `learner_sessions_list` takes the household from the signed-in session, so it can only list lessons in the signed-in person's own household. `householdId` is rejected if sent.
- **Filters are checked before the backend is called.** The backend ignores a `status` or a `startAfter` or `startBefore` it cannot read and answers as if no filter was given, which would look like "all lessons". So `status` must be `scheduled`, `in_progress`, `completed`, `cancelled` or `no_show`; the dates must be ISO 8601 datetimes with seconds and an offset (for example `2026-06-01T00:00:00Z`); `page` starts at 0; `pageSize` is 1 to 50 (default 20). `targetDate` must be a real calendar date, and `timezone`, when given, a valid IANA name such as `America/New_York`. Without a `timezone` none is sent, and the backend uses the family's own.
- **Lengths are worked out, not trusted.** The backend's list reports `durationMinutes: 0` even for a 60 minute class, so `durationMinutes` is calculated from the start and end times. Times are UTC (`...Z`) in the list and lesson, and carry the family's UTC offset in the day preview. Every one also comes as ready-to-read text; see "Local times" below.
- **`session_reschedule_options_day` only previews.** It calls the backend's `reschedule-preview`, which reads the lesson and the tutor's free times and changes nothing, so it does not move, book or cancel a lesson.
- **Data minimisation.** Learners are children. These tools never return signed photo links, the tutor's email or id, actor ids, event payloads, or video and meeting fields. Only the fields in the table are returned, and none of this is logged or put in an error message.
- **Errors.** A `403` (someone else's learner or lesson, or a role that is not guardian, delegate or admin) becomes `Not allowed to access this learner or lesson.`; a `404` becomes `Lesson not found.` (`Learner not found.` for the list); a `400` from the day preview becomes `That date is not valid.`; a refresh that fails with a `401` asks the model to have the user sign in again. No backend text appears in a message.
- **Role check.** These routes are for guardian, delegate and admin users. The role stored in the session is checked first, so a tutor gets the same `403` message even on `GET /sessions/{id}`, which the backend itself leaves open to a lesson's own tutor.

### Local times

A model that turns `2026-12-08T21:00:00Z` into the family's own time can get the weekday or the hour wrong. So every tool that returns a lesson or slot time also returns the same time as text, already in the family's zone, and the model only copies it. The raw fields stay as they are; the text is added next to them.

- **Format.** One field per start and end pair, from `src/tools/local-time.ts` (`localClock`): `whenLocal` is `Tuesday 8 December 2026, 10:00 PM to 11:00 PM`. The end's date is written only when it is another day: `Monday 1 June 2026, 11:30 PM to Tuesday 2 June 2026, 12:30 AM`. Pairs with an old and a new time use `currentWhenLocal` or `oldWhenLocal` and `newWhenLocal`. Calendar dates are `dateLocal` and `targetDateLocal` (`Tuesday 2 June 2026`).
- **`timezone`** names the zone the text is written in, once per output.
- **Where the zone comes from.** The household's own `timezone` (the same `GET /api/v1/households/me` read as `household_get`), read at most once per tool call. The day and week previews and `session_reschedule` propose use the zone the backend's preview names, which is the family's own unless the caller asked for another `timezone`, so they make no extra read.
- **No zone, no guess.** With no household, a failed read or a zone that is not a valid IANA name, the text is in UTC and ends in `UTC` (`... 9:00 PM to 10:00 PM UTC`), and `timezone` is `UTC`. The read never fails the tool.
- **Weekly windows are not converted.** A window is a wall-clock range in its own zone, so `whenLocal` only writes it in words, with that zone when it has one: `Tuesday, 4:00 PM to 6:00 PM and 7:00 PM to 8:00 PM (America/New_York)`. Lessons in a weekly preview are instants and use the family's zone.
- **Descriptions.** Each of these tools tells the model to show the `*Local` text exactly as given and never convert a time itself.

### Rescheduling a lesson (the first write)

`household_sessions_list` and `session_reschedule_options_week` are read-only, like the other scheduling tools: the first lists every learner's lessons in the signed-in person's household (ids only; use `household_learners` to turn a `learnerId` into a name), and the second shows the free slots for each of the next 6 days. `session_reschedule` is different: it moves a real lesson, and the backend may notify the tutor and sync calendars. So it works in two steps, and the first never changes anything.

1. **Propose** (`step: "propose"`, with `lessonId`, `newStart`, `newEnd` as ISO 8601 with an offset, and a `reason` of 1 to 500 characters). It reads the lesson and previews the day, then checks that the lesson is scheduled and can be rescheduled, that the new time has the same length as the lesson, and that it is exactly one of the offered slots for that day. If anything fails it says why; it never invents a slot. If all passes it returns `{ status: "proposed", confirmationToken, lessonId, timezone, currentStart, currentEnd, currentWhenLocal, newStart, newEnd, newWhenLocal, durationMinutes, reason, expiresInSeconds }` and sends nothing that could move the lesson.
2. **Show the parent** the proposal in plain words and get an explicit yes. The model must never confirm on its own.
3. **Confirm** (`step: "confirm"`, with `confirmationToken`). It sends exactly one move (`new_start`, `new_end` and `reason`, nothing else) and then reads the lesson back. It returns `{ status: "rescheduled", lessonId, timezone, newStart, newEnd, newWhenLocal }` with the times the lesson now shows, or `{ status: "unconfirmed" }` if the lesson does not show them yet, in which case `session_get` tells the truth.

The confirmation token works **once**, only for the sign-in session that proposed it, and for **5 minutes**. It is used up before the backend is called, so a repeat can never send a second move. An unknown, used, expired or another session's token all give the same short error.

**Nothing retries a move, ever.** The backend has no retry key on this route, so a second request could move the lesson twice or notify the tutor twice. The one exception is a `401` because the access token expired: the backend answers that before it runs anything, so the token is refreshed once and the request is sent once more. After a timeout, a network error, a 5xx or any other reply, nothing is sent again. If the move was sent and one of those happens, the backend may have saved the new time before it answered, so the tool says the result is unknown, that the model must not try again, and that it must call `session_get` to see the lesson's real time before telling the parent anything. A failure before the move was sent (for example while refreshing the token) is reported as an ordinary error, because nothing was moved.

Known refusals use fixed wording. **This depends on matching the backend's error text, which is fragile**: it reads the reply's text for `cannot reschedule`, `selected time slot` and `learner availability`, so a reworded backend error falls back to the generic message.

| Backend reply                                 | What the tool says                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| 400 containing `cannot reschedule`            | This lesson cannot be rescheduled (its status or timing does not allow it). |
| 400 containing `selected time slot`           | That time is not available.                                                 |
| 400 containing `learner availability`         | That time is outside the learner's availability.                            |
| any other 400                                 | The request was not accepted.                                               |
| 403                                           | Not allowed to change this lesson.                                          |
| 404                                           | Lesson not found.                                                           |
| timeout, network error, 5xx, unreadable reply | The result is unknown. Do not try again; call `session_get` first.          |

The backend records the move as made by the signed-in person, not by an agent, because it is their own sign-in that is used. The `force` field the backend has for admins is never sent. Proposals are kept in memory with the sign-in session, so a restart or another server instance loses them; ask for a new proposal.

### Weekly schedule tools (read-only)

`learner_weekly_schedule_get` and `learner_weekly_schedule_preview` use the guardian-facing `GET /api/v1/learners/{learnerId}/weekly-schedule-v2` and `POST .../weekly-schedule-v2/preview`, never `/agent/...`. Both take the learner's id from `household_learners`, and neither has a `householdId` input.

- **A window is a range, not a lesson time.** A window such as Tuesday 16:00 to 18:00 is the time the family is available; the backend places lessons inside it. `dayOfWeek` is `0` for Sunday up to `6` for Saturday (`dayName` says it in words), and times are in the window's own timezone.
- **`learner_weekly_schedule_get`** returns `{ learnerId, windows: [{ windowId, dayOfWeek, dayName, startTime, endTime, timezone, status, whenLocal, extraStartTime?, extraEndTime? }], subjectPreferences: [{ subjectPreferenceId, learnerSubjectId, subject, preferredDuration, sessionsPerWeek, status }] }`. Notes, date ranges and the preferred-subject text are not returned.
- **`learner_weekly_schedule_preview`** shows what _would_ happen to the learner's upcoming lessons if the windows were changed. It saves nothing and moves nothing. The model sends the complete new list of windows (1 to 14: `windowId?`, `dayOfWeek`, `startTime` and `endTime` as `HH:MM`, optional IANA `timezone`). Duplicate windows and an `endTime` that is not after the `startTime` are refused before any backend call. The tool reads the current schedule first and sends the learner's **current subject preferences unchanged**, so the model can never change a subject or how often it is taught; a window kept by `windowId` also keeps its extra range, status, dates and notes. The result is `{ learnerId, timezone, totalScanned, affectedCount, rescheduleCount, cancelCount, entries: [{ lessonId, subjects, oldStart, oldEnd, oldWhenLocal, action, newStart?, newEnd?, newWhenLocal?, reason }] }` with no tutor or learner names. A non-zero `cancelCount` means lessons would be cancelled, and the parent must be told.
- **The preview endpoint was read to confirm it writes nothing.** The route's handler, `buildLearnerWeeklyScheduleV2Payload`, `computeReconcileSeriesAssignment`, `planAvailabilitySession` and everything they call were read in `ms-backend`, and a scan of the functions reachable from it found no insert, update, delete or notification. That is a read of the source, not a live test, and it does not cover database triggers. The saving route (the same path without `/preview`) is never called.
- **Ownership check.** The backend's weekly-schedule routes check that the caller is signed in and has a guardian, delegate or admin role, but not that the learner belongs to them. So both tools first read the household's learner list (which the backend does enforce) and refuse a learner that is not in it with `Not allowed to access this learner.`, before any weekly-schedule route is called.
- **The preview leaves some lessons out.** Lessons the backend would leave where they are, including ones that would no longer fit the new windows, are not in `entries`, and the learner path never reports a cancel of its own, so an empty list does not prove every lesson still fits.

### Cancelling a lesson

`session_cancel` cancels a real lesson. The backend notifies the tutor and the household, removes the calendar entry and records the cancellation, and **nothing in this service can undo it**. It is built exactly like `session_reschedule`: two steps, and the first changes nothing. It uses the guardian-facing `POST /api/v1/sessions/{id}/cancel` (never the bulk-cancel route).

1. **Propose** (`step: "propose"`, with `lessonId` and a `reason` of 1 to 500 characters). It reads the lesson and checks it is scheduled and that `canCancel` is true. It returns `{ status: "proposed", confirmationToken, lessonId, timezone, scheduledStart, scheduledEnd, whenLocal, durationMinutes, reason, expiresInSeconds, lateCancellationNotice? }` and sends nothing that could cancel. If the lesson starts in under 24 hours (or has started), `lateCancellationNotice` is the fixed sentence "Cancelling less than 24 hours before the start may incur a late-cancellation fee." It names no amount and does not say a fee is charged.
2. **Show the parent** the proposal, including any notice, in plain words and get an explicit yes. The model must never confirm on its own.
3. **Confirm** (`step: "confirm"`, with `confirmationToken`). It sends exactly one cancel with exactly `{ reason }`, reads the lesson back, and returns `{ status: "cancelled", lessonId }` only if the lesson now shows as cancelled. If the backend accepted it but the lesson does not show as cancelled (or cannot be read), it returns `{ status: "unconfirmed" }` and points to `session_get`.

The confirmation token is the same kind as the reschedule one: random, single-use, tied to the sign-in session that proposed it, valid for 5 minutes, and used up before the backend is called. A token made for a cancel cannot confirm a reschedule, and the other way round.

**A cancel is never retried.** There is no retry key on this route, so a second request is not safe. The one exception is a `401` because the access token expired: the backend rejects that before it runs anything, so the token is refreshed once and the request is sent once more.

**Why a `500` is ambiguous.** The backend answers `403` when the person may not cancel and `500 "failed to cancel session"` for **every** other failure: a lesson that is not scheduled, a database error, and a failure after the cancel was already saved (for example while notifying). So a `500`, a timeout or a network error does not say whether the lesson was cancelled. After one of those the tool reads the lesson back once and reports what it finds: if the lesson is cancelled it says `cancelled`; if it is still scheduled it says the cancellation did not go through; if the read-back fails too, it says the result is unknown, not to try again, and to call `session_get`.

| Backend reply or outcome                                   | What the tool says                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| 200 and the lesson reads back cancelled                    | `cancelled`                                                           |
| 200 but the lesson does not read back cancelled            | `unconfirmed`; call `session_get`                                     |
| 500, timeout or network error, lesson reads back cancelled | `cancelled`                                                           |
| 500, timeout or network error, lesson still scheduled      | The cancellation did not go through; do not try again without asking. |
| 500, timeout or network error, read-back also fails        | The result is unknown. Do not try again; call `session_get` first.    |
| 403                                                        | Not allowed to change this lesson.                                    |
| 404                                                        | Lesson not found.                                                     |

Only fixed messages are returned; backend text and tokens never appear. The cancel is recorded by the backend as made by the signed-in person.

### Changing a learner's weekly windows (the update)

`learner_weekly_schedule_update` saves a new set of weekly windows (`PUT /api/v1/learners/{learnerId}/weekly-schedule-v2`). It changes a real schedule, and the backend then moves lessons, so it works in two steps and the first never changes anything. It reuses the preview tool's windows, validation, ownership check and request building (the shared code is in `learner-weekly-schedule-preview/`), so what is proposed is exactly what `learner_weekly_schedule_preview` would show.

1. **Propose** (`step: "propose"`, with `learnerId`, the complete new `windows` and a `reason` of 1 to 500 characters kept for the record). It checks the learner is in the signed-in household, reads the current schedule, previews the new windows, and remembers a proposal bound to this sign-in session, this action, the learner, the exact request, a snapshot of the current schedule and a fingerprint of the preview's lessons. It returns `{ status: "proposed", confirmationToken, learnerId, timezone, currentWindows, newWindows, affectedLessons, previewIsIncomplete: true, warning, expiresInSeconds }` and sends nothing that saves.
2. **Show the parent** the whole proposal, including the warning, in plain words, and get an explicit yes **knowing lessons may be moved or cancelled**.
3. **Confirm** (`step: "confirm"`, with `confirmationToken` and `parentAcknowledgesLessonsMayBeChanged: true`). The flag is refused unless it is exactly `true`, before anything is read or used up, so a missing flag does not burn the token. The token is used up first. Then, before any write, the schedule is fetched again and compared with the snapshot, and the preview is run again and its fingerprint compared; if either differs it answers "Things changed since the proposal. Make a new proposal and ask the parent again." and sends no save. Otherwise it sends exactly one `PUT` with `{ windows, subjectPreferences }` and nothing else, reads the schedule back, and returns `{ status: "updated", windows, subjectPreferences, message }` if it matches what was sent, or `{ status: "unconfirmed" }` if it does not.

The fingerprint covers each listed lesson's id, action and old and new times, and the three counts. It ignores names, free-text reasons, the order of entries and the number of lessons scanned.

**The preview is incomplete, and why.** `previewIsIncomplete` is always `true`. In the backend, a learner's own preview only ever lists lessons it would **reschedule** (every other outcome is dropped before the list is built), its cancel count is hard-coded to 0, and lessons it would leave where they are are not listed. It also plans against the learner's own windows, while the save plans against the "forced learner availability" setting when that is on, and the save sees the real, changing state of the tutor's calendar. So the preview is an estimate, and an empty list proves nothing. The tool shows every entry whatever its `action`, and treats any action that is not clearly "unchanged" as a possible change.

**What the save does to lessons, as read in `ms-backend`** (`UpdateLearnerWeeklyScheduleV2` and everything it calls, on the checked-out branch; this is a read of the source, not a live run, and it does not cover database triggers):

1. **Plan limits first.** The subject preferences that are sent are checked against the plan (maximum subjects, weekly sessions, weekly hours). A plan that is already exceeded refuses even a windows-only change with a 400. If the plan service errors, or there is no subscription, the check is skipped.
2. **Validation.** Times are `HH:MM` or `HH:MM:SS`, the end must be after the start, duplicate rows (same day, start, end and extra range, compared as text) are refused, and every subject must belong to the learner. A window id that is not one of the learner's would be inserted as a new window (and fail if that id exists elsewhere), which is why the tool only sends ids it read from the learner's own schedule.
3. **One database transaction saves the schedule.** Windows and preferences in the body are updated or inserted; any window or preference **left out is marked inactive, not deleted**. A window the schedule read does not return (already inactive) is not sent, so it stays inactive. Also in the transaction: if a subject's weekly frequency is _reduced_ or a subject is dropped, the backend deletes the surplus recurring lines and marks the matching future lessons `deleted`, and removes them from the calendar. The tool never sends a changed or removed subject preference, so this branch cannot run from it.
4. **Lessons.** If the set of windows changed, the backend loads all the learner's future scheduled lessons. A lesson is touched only if it falls on the day of a changed window. For a learner's own change, each such lesson either is **rescheduled** to the nearest slot that both the learner's new windows and the tutor's availability allow and that clashes with nothing, or is **left as it is**. It is left as it is when the learner has no active windows left, when there is no mutual availability, when no free slot is found, or when it already fits. In the backend, the cancel outcome returns nothing for a learner's own change (there is no separate "unmatch" outcome in this path), so **a learner's window save does not cancel lessons**. A lesson that cannot be moved may therefore stay outside the new windows. A reschedule writes a history row, changes the lesson's start and end, resets its reminders, and re-syncs the learner's baseline-assessment designation.
5. **Notifications.** After the transaction, every rescheduled lesson sends a `session.rescheduled` in-app notification and email to **every guardian of the household** and to the tutor. A failure to send is logged and skipped. I did not find a calendar update in this reschedule path (the cancel path has one, but it cannot run here).
6. **The recurring template.** Outside the transaction, and with errors only logged, the backend moves each active template line that no longer fits the new windows to the closest slot the tutor can cover in the next 14 days, or flags it for an administrator to review. This changes how future lessons are generated, not lessons that exist, and it sends no notification. Because a failure here is swallowed, a `200` does not prove the template was reconciled.
7. **Matching** starts only for subjects that are newly active. With unchanged subject preferences nothing starts.
8. The reply has the same shape as the schedule read.

So, as read: a window change from this tool can **reschedule** upcoming lessons (and notify the household and the tutor) and can rearrange the recurring template; it cannot cancel lessons, and it cannot remove subjects. The tool still warns that lessons may be moved or cancelled, because the preview cannot prove otherwise and the backend may change.

**Never retried.** The save has no retry key and a repeat could notify twice. The one exception is a `401` because the access token expired: the token is refreshed once and the save is sent once more. After a timeout, a network error or a 5xx the result is reported as unknown, with the instruction not to retry and to call `learner_weekly_schedule_get` and then `learner_sessions_list`. Errors use fixed wording only: `The schedule was not accepted.` for a 400 (the backend's own text, which can include plan limits or database text, is never forwarded), `Not allowed to change this learner’s schedule.` and `Learner not found.`.

### Tutor-change requests

Two guardian-facing routes, `POST` and `GET /api/v1/tutor-change-requests`. A request goes to the school's staff by Slack and email, and **the staff decide**; filing one does not change the tutor.

- **The model never gives a tutor id.** `tutor_change_request_create` takes `learnerId`, `lessonId` and a `reason` of 1 to 500 characters, and the tutor is read from that lesson. The backend checks neither that the person may act for the learner nor that the tutor is the learner's tutor (it only refuses a second pending request for the same learner and tutor, and needs the learner to have a household). If the model could name the tutor, it could file a request about anyone. So the tool checks both itself: the learner must be in the signed-in household, and the lesson must belong to that learner. The tutor id is kept in the proposal and is never returned.
- **Create is two steps.** _Propose_ changes nothing: it checks the learner and the lesson, looks for a pending request with `tutor_change_request_list` (best effort; if that fails it says so and goes on, because the backend refuses a duplicate itself), and returns `{ status: "proposed", confirmationToken, learnerFirstName, tutorFirstName, tutorLastName, reason, alreadyPending: false, expiresInSeconds, note }`. If a pending request for that learner and tutor exists it refuses with `A request for this tutor is already pending.` _Confirm_ sends exactly one `POST` with `{ learnerId, currentTutorId, reason }` and returns `{ status: "filed", requestStatus: "pending" }`. The token is single-use, 5 minutes, and bound to the sign-in session and the action.
- **Never retried.** Same rule as the other writes: one refresh and one resend after a `401`; after a timeout, network error, 5xx or a reply that is not the expected `pending`, the result is unknown, and the tool says not to try again and to call `tutor_change_request_list`.
- **Every failure of these routes is a 400 with the backend's raw error text, which can include database text. None of it is ever forwarded.** The text is only compared, to pick a fixed message: `pending request already exists` gives `A request for this tutor is already pending.`, and every other 400 gives `The request was not accepted.` This depends on the backend's wording, so a reworded error falls back to the generic message.
- **`tutor_change_request_list`** takes no input: the parent route has **no paging or filter parameters** (the handler reads none), so none are accepted or sent. It returns `{ requests: [{ requestId, learnerId, learnerName, currentTutorName, status, reason, createdAt, reviewedAt, newTutorName }], total }`. The parent route sends only the id, learner id, tutor name, reason, status and created time; the learner name, review time and new tutor are `null` unless a later backend sends them, and `page` and `pageSize` are returned only if the backend sends them. Tutor ids, staff names and notes, the household id and the parent-notified flag are dropped. The backend picks the household from the person's membership, not from the sign-in, so only requests for learners of the signed-in household are kept, and `total` counts what is shown.
- **"No household" on the list.** On the real dev account this route answered `400 could not determine household` for an account that has an active guardian membership. The cause, as read: the handler looks the household up only in `household_members`, but primary guardians are deliberately not stored there (the household is on `households.primary_guardian_id`), so it fails for a primary guardian. I could not confirm this on a live account. The tool answers with the fixed message `No household could be found for this account's tutor-change requests.`; that is a limit of the school's system for the account, not proof that nothing was filed. For a primary guardian the pending check at propose therefore cannot run, and the tool says so.

## Adding a new tool

Before you start, the backend route and scope must already exist in `ms-backend` (see "Build order" in `CLAUDE.md`).

1. Create `src/tools/<tool-name>/` in kebab-case. The tool name is the same in snake_case: folder `get-thing` is tool `get_thing` (a test checks this).
2. Write `schemas.ts`: the zod input and output schemas, and the shape of the backend response. Use `.strict()` on input and output.
3. Write `handler.ts`: call the backend only through `context.backend.request(...)`, never `fetch`. Return exactly the output shape.
4. Write `index.ts`: `defineTool({ ... })` with the name, title, description, hints and the handler.
5. Add one line to `src/tools/index.ts`. Nothing else needs editing.
6. Copy `test/unit/tools/tool.template.spec.ts` to `test/unit/tools/<tool-name>.spec.ts` and adapt it.
7. Run the six checks (see "Verification").

Template, a read-only tool that fetches one thing from the backend:

```ts
// src/tools/get-thing/schemas.ts
import { z } from 'zod';

export const getThingInputSchema = z.object({ id: z.string().min(1) }).strict();

// Only the backend fields the tool needs; others are dropped.
export const backendThingSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const getThingOutputSchema = z
  .object({ id: z.string(), name: z.string() })
  .strict();
```

```ts
// src/tools/get-thing/handler.ts
import type { z } from 'zod';
import type { ToolContext } from '../define-tool.js';
import {
  backendThingSchema,
  type getThingInputSchema,
  type getThingOutputSchema,
} from './schemas.js';

export async function getThingHandler(
  input: z.output<typeof getThingInputSchema>,
  { backend }: ToolContext,
): Promise<z.input<typeof getThingOutputSchema>> {
  const thing = await backend.request({
    method: 'GET',
    path: `/api/v1/agent/things/${encodeURIComponent(input.id)}`,
    response: backendThingSchema,
  });
  return { id: thing.id, name: thing.name };
}
```

```ts
// src/tools/get-thing/index.ts
import { defineTool } from '../define-tool.js';
import { getThingHandler } from './handler.js';
import { getThingInputSchema, getThingOutputSchema } from './schemas.js';

export const getThingTool = defineTool({
  name: 'get_thing',
  title: 'Get thing',
  description: 'Returns one thing by id.',
  input: getThingInputSchema,
  output: getThingOutputSchema,
  hints: { readOnly: true, destructive: false },
  handler: getThingHandler,
});
```

Then in `src/tools/index.ts`: import `getThingTool` and add it to the `tools` array.

Notes:

- `hints` are the MCP annotations. `readOnly` and `destructive` are required. `idempotent` defaults to `readOnly`, and `openWorld` defaults to `true` (set it to `false` for a tool that never leaves this service, like `ping`).
- Output must be an object at the root, because MCP requires it. If a tool can return several shapes, wrap them in a discriminated result object.
- Backend failures become short tool errors automatically (see the table below). Add `errorMessages: { unauthorized: '...' }` to change the wording for one kind. Any other error becomes "The tool failed unexpectedly." and its message is never shown.
- For a write tool, pass a retry key with `headers: { 'Idempotency-Key': ... }` on the request. Risky actions (cancel, reschedule, money) also need the approval step described in `CLAUDE.md`.

### Backend calls

`src/external/mssuize/` is the only code that calls `ms-backend`. `request()` sets the base URL, a 10 second timeout, JSON headers, refuses redirects, caps successful response bodies at 5 MiB and error text at 4 KiB, and validates successful responses with the zod schema. It maps failures to a kind that carries no backend body:

| Backend result                | Kind                  |
| ----------------------------- | --------------------- |
| 400                           | `invalid_request`     |
| 401                           | `unauthorized`        |
| 403                           | `forbidden`           |
| 404                           | `not_found`           |
| 429                           | `rate_limited`        |
| 5xx                           | `unavailable`         |
| other non-2xx                 | `rejected`            |
| no answer in time             | `timeout`             |
| connection failed             | `unreachable`         |
| not JSON or not the zod shape | `unexpected_response` |

The refresh, `/auth/me` and sign-out calls are in `src/external/mssuize/auth-api.ts`; they pass the person's token as a header on that one call. The backend service identity (signed key, cached token, refresh) will plug in through the `auth` option of `BackendClient`, which adds the service token as a default header, so no tool needs to change. A header given for one call wins over that default, so a person's token is never replaced by the service token.

## Examples

Replace `<MCP_API_KEY>` with the value of `MCP_API_KEY` from your `.env`. Never commit a real key. The examples assume the server runs on `http://localhost:3000` (`bun run start:dev`).

### curl or Postman

Every call is a `POST` to `http://localhost:3000/mcp` with these headers:

| Header          | Value                                 |
| --------------- | ------------------------------------- |
| `Authorization` | `Bearer <MCP_API_KEY>`                |
| `Content-Type`  | `application/json`                    |
| `Accept`        | `application/json, text/event-stream` |

List the tools (Postman: set the body to raw JSON with the same text after `-d`):

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <MCP_API_KEY>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Call `ping`:

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <MCP_API_KEY>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ping","arguments":{}}}'
```

These examples act for a signed-in person, so they send that person's ms-backend access token as `<ACCESS_TOKEN>` instead of `MCP_API_KEY`. Never paste a password, and never put a token in a prompt.

Read the household of the signed-in person (the three household tools take no input except an optional `status` for `household_learners`; send the person's access token as the bearer token):

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"household_get","arguments":{}}}'
```

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"household_learners","arguments":{"status":"active"}}}'
```

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"household_members","arguments":{}}}'
```

Find a learner's lessons, read one, and preview a day it could move to (`<LEARNER_ID>` and `<LESSON_ID>` are UUIDs; the lesson id comes from the list):

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"learner_sessions_list","arguments":{"learnerId":"<LEARNER_ID>","status":"scheduled","pageSize":10}}}'
```

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"session_get","arguments":{"lessonId":"<LESSON_ID>"}}}'
```

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"session_reschedule_options_day","arguments":{"lessonId":"<LESSON_ID>","targetDate":"<YYYY-MM-DD>"}}}'
```

Reschedule a lesson, in two steps. Propose first (nothing moves), show the parent the result, and only after an explicit yes confirm with the token it returned:

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"session_reschedule","arguments":{"step":"propose","lessonId":"<LESSON_ID>","newStart":"<NEW_START>","newEnd":"<NEW_END>","reason":"<REASON>"}}}'
```

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"session_reschedule","arguments":{"step":"confirm","confirmationToken":"<CONFIRMATION_TOKEN>"}}}'
```

`<NEW_START>` and `<NEW_END>` are ISO 8601 with an offset, and must match a slot from `session_reschedule_options_day` or `session_reschedule_options_week`. Do not run the confirm call again if it fails; check the lesson with `session_get` instead.

The week of free slots, and every lesson in the household:

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"session_reschedule_options_week","arguments":{"lessonId":"<LESSON_ID>"}}}'
```

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":15,"method":"tools/call","params":{"name":"household_sessions_list","arguments":{"status":"scheduled"}}}'
```

Look at a learner's weekly windows, preview moving one (nothing is saved), and cancel a lesson in two steps:

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":16,"method":"tools/call","params":{"name":"learner_weekly_schedule_get","arguments":{"learnerId":"<LEARNER_ID>"}}}'
```

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":17,"method":"tools/call","params":{"name":"learner_weekly_schedule_preview","arguments":{"learnerId":"<LEARNER_ID>","windows":[{"windowId":"<WINDOW_ID>","dayOfWeek":2,"startTime":"<HH:MM>","endTime":"<HH:MM>"}]}}}'
```

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":18,"method":"tools/call","params":{"name":"session_cancel","arguments":{"step":"propose","lessonId":"<LESSON_ID>","reason":"<REASON>"}}}'
```

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":19,"method":"tools/call","params":{"name":"session_cancel","arguments":{"step":"confirm","confirmationToken":"<CONFIRMATION_TOKEN>"}}}'
```

Only run the cancel confirm after the parent has said yes; it cannot be undone. Do not run it again if it fails; check the lesson with `session_get` instead.

Change a learner's weekly windows in two steps (propose first, show the parent, then confirm only after an explicit yes that knows lessons may be moved or cancelled), and ask the school to change a tutor in two steps:

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":20,"method":"tools/call","params":{"name":"learner_weekly_schedule_update","arguments":{"step":"propose","learnerId":"<LEARNER_ID>","windows":[{"windowId":"<WINDOW_ID>","dayOfWeek":2,"startTime":"<HH:MM>","endTime":"<HH:MM>"}],"reason":"<REASON>"}}}'
```

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":21,"method":"tools/call","params":{"name":"learner_weekly_schedule_update","arguments":{"step":"confirm","confirmationToken":"<CONFIRMATION_TOKEN>","parentAcknowledgesLessonsMayBeChanged":true}}}'
```

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":22,"method":"tools/call","params":{"name":"tutor_change_request_create","arguments":{"step":"propose","learnerId":"<LEARNER_ID>","lessonId":"<LESSON_ID>","reason":"<REASON>"}}}'
```

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":23,"method":"tools/call","params":{"name":"tutor_change_request_create","arguments":{"step":"confirm","confirmationToken":"<CONFIRMATION_TOKEN>"}}}'
```

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":24,"method":"tools/call","params":{"name":"tutor_change_request_list","arguments":{}}}'
```

Do not run a confirm call again if it fails; check with `learner_weekly_schedule_get` and `learner_sessions_list` (weekly update) or `tutor_change_request_list` (tutor change) instead.

A missing or wrong key returns `401`.

### Claude Code

```bash
claude mcp add --transport http mcp-agents http://localhost:3000/mcp \
  --header "Authorization: Bearer <MCP_API_KEY>"
claude mcp list
```

Inside Claude Code, `/mcp` shows the server and its tools.

### Cursor

Put this in `~/.cursor/mcp.json` (global, so the key stays out of the repo), then enable the server in Cursor's MCP settings:

```json
{
  "mcpServers": {
    "mcp-agents": {
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer <MCP_API_KEY>" }
    }
  }
}
```

### Prompts to try

- `Use the mcp-agents ping tool and tell me what it returned.`
- `List the tools the mcp-agents server offers and what each one does.`
- `Call session_me without signing in and show me the exact error you get.`
- `After I sign in, show me my household, then list my active learners, then who else is in the household.`
- `Try household_learners with status "banana" and tell me what the server says.`
- `After I sign in, find my child's next scheduled class, then show me what times it could move to tomorrow.`
- `Find my child's next class and propose moving it to one of the free times this week. Tell me the old and new time and the reason, and wait for me to say yes before you confirm.`
- `Try session_reschedule with step propose and a time that is not one of the offered slots, and tell me what it says.`
- `Try session_reschedule_options_day with the date 2026-02-30 and tell me what the server says.`
- `Show me my child's weekly availability windows, with the day of the week in words.`
- `Preview what would happen to my child's lessons if the Tuesday window moved an hour later. Do not save anything.`
- `Find my child's next class and propose cancelling it because of a trip. Tell me the time and any late-cancellation notice, and wait for me to say yes before you confirm.`
- `Preview moving my child's Tuesday window an hour later, and tell me which lessons the backend says would move and what the preview cannot tell us. Do not save anything yet.`
- `Propose changing my child's Tuesday window to start an hour later, show me everything including the warning, and only save it after I say yes.`
- `Find my child's lesson with Ms. X and propose asking the school to change the tutor because the lessons are not a good fit. Tell me who the request is about and wait for my yes before you file it.`
- `Show me the tutor-change requests we have filed.`

## Verification

All tests live under `test/`.

```bash
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run test:e2e
bun run test:cov
bun run build
```

## Container deployment

Build and run the same OCI image on Docker, Kubernetes, Nomad, ECS, Cloud Run, Fly.io, Railway, Render, or any compatible platform:

```bash
docker build --tag agentic:local .
docker run --rm --read-only --tmpfs /tmp --publish 3000:3000 agentic:local
```

The image uses pinned Bun and Node digests, contains production dependencies only, and runs as the unprivileged `node` user.

## CI/CD

`.github/workflows/ci.yml` installs the lockfile exactly, checks formatting and types, runs all tests, audits dependencies, builds the application and container, and scans the runtime image. Every external action is pinned to a full commit SHA.

`.github/workflows/release.yml` verifies semantic-version tags, then publishes Linux AMD64 and ARM64 images to GitHub Container Registry. It creates an SBOM and signs a provenance attestation through GitHub OIDC. Configure protection rules and required reviewers on the repository's `production` environment before the first release.

Create a release with an immutable semantic version:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow delivers a portable image. Each hosting platform can deploy that immutable image digest with its own native rollout and rollback controls.

## Reliability and state

The service keeps no business data. It does not pretend that memory or a container filesystem is durable. Add workflow and idempotency modules only with a shared production store and tested transaction boundaries.

The one exception is the in-memory sign-in sessions (see "Sign-in sessions"). They are not durable: a restart or rollback ends every session, and they work for one server instance only, so scale to a single replica until a shared store is designed and agreed. A pending reschedule proposal is kept the same way, so it is lost on a restart and cannot be confirmed from another instance.

The application enables graceful NestJS shutdown hooks. Its global exception filter also handles exceptions thrown by middleware, assigns a safe request ID, logs unexpected server errors, and keeps internal error details out of client responses.

## NestJS guidance applied

This project follows the current NestJS guidance for [exception filters](https://docs.nestjs.com/exception-filters), [security headers](https://docs.nestjs.com/techniques/security/cors), [CSRF protection](https://docs.nestjs.com/security/csrf), [validation](https://docs.nestjs.com/application/validation), [rate limiting](https://docs.nestjs.com/security/rate-limiting), and [shutdown hooks](https://docs.nestjs.com/fundamentals/lifecycle-events).
