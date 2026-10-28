import { BackendError } from '@/external/mssuize/backend-error.js';
import { fetchMyHousehold } from '@/external/mssuize/household-api.js';
import {
  ianaTimeZoneSchema,
  weekdayName,
} from '@/external/mssuize/scheduling-api.js';
import type { ToolContext } from './define-tool.js';

// Used when no valid zone is known. Its text always ends in "UTC", so it is never mistaken for
// the family's own time.
export const FALLBACK_TIME_ZONE = 'UTC';

const UTC_NAMES: ReadonlySet<string> = new Set([
  'UTC',
  'Etc/UTC',
  'Etc/GMT',
  'GMT',
]);

// Added to the description of every tool that returns a *Local text.
export const SHOW_LOCAL_TIMES =
  "Each field ending in Local (such as whenLocal or newWhenLocal) is ready-to-read text: a lesson or slot time is already in the time zone named in timezone (the family's own unless another was asked for), and a weekly window's text is in that window's own zone. Show this text to the person exactly as given, and never convert, recalculate or reword a time or a weekday yourself.";

/** Turns instants into ready-to-read text in one time zone. */
export interface LocalClock {
  /** The zone the text is written in. */
  readonly timezone: string;
  /** For example "Tuesday 8 December 2026, 10:00 PM to 11:00 PM"; the end's date only when it is another day. */
  between(start: string, end: string): string;
}

// Built from parts so the text is the same on every runtime: day-month order, 12-hour clock.
function formatIn(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
  });
}

function partsOf(
  format: Intl.DateTimeFormat,
  instant: string,
): { date: string; time: string } {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  try {
    for (const part of format.formatToParts(new Date(instant))) {
      parts[part.type] = part.value;
    }
  } catch {
    throw new BackendError('unexpected_response');
  }
  const { weekday, day, month, year, hour, minute, dayPeriod } = parts;
  return {
    date: `${weekday} ${day} ${month} ${year}`,
    time: `${hour}:${minute} ${dayPeriod?.toUpperCase()}`,
  };
}

// A zone the backend sent that Intl cannot use falls back to UTC rather than failing the tool.
export function localClock(zone: string | null | undefined): LocalClock {
  const timezone =
    zone && ianaTimeZoneSchema.safeParse(zone).success
      ? zone
      : FALLBACK_TIME_ZONE;
  const format = formatIn(timezone);
  const suffix = UTC_NAMES.has(timezone) ? ' UTC' : '';

  return {
    timezone,
    between(start, end) {
      const from = partsOf(format, start);
      const to = partsOf(format, end);
      const until = to.date === from.date ? to.time : `${to.date}, ${to.time}`;
      return `${from.date}, ${from.time} to ${until}${suffix}`;
    },
  };
}

const utcFormat = formatIn(FALLBACK_TIME_ZONE);

// A calendar date (YYYY-MM-DD) has no time zone, so it is read as written: "Tuesday 2 June 2026".
export function dateLocal(date: string): string {
  const day = date.slice(0, 10);
  const noon = new Date(`${day}T12:00:00Z`);
  // A round trip refuses a day that does not exist, which Date would roll over (30 February).
  if (Number.isNaN(noon.getTime()) || noon.toISOString().slice(0, 10) !== day) {
    throw new BackendError('unexpected_response');
  }
  return partsOf(utcFormat, noon.toISOString()).date;
}

//1. The family's time zone, from the signed-in person's own household (the same read as
//   household_get). Each tool call reads it at most once.
//2. It never fails the tool: with no household, a failed read or an unusable zone, the text is
//   written in UTC and says so. A lost sign-in is still reported by the tool's own call.
export async function householdClock(
  { backend, sessions }: ToolContext,
  sessionId: string,
): Promise<LocalClock> {
  try {
    const household = await sessions.withHousehold(sessionId, (accessToken) =>
      fetchMyHousehold(backend, accessToken),
    );
    return localClock(household.timezone);
  } catch {
    return localClock(undefined);
  }
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

// "16:00" or "16:00:00" as "4:00 PM".
function clockText(value: string): string {
  const match = CLOCK.exec(value);
  if (match === null) throw new BackendError('unexpected_response');
  const hours = Number(match[1]);
  const period = hours < 12 ? 'AM' : 'PM';
  return `${hours % 12 === 0 ? 12 : hours % 12}:${match[2]} ${period}`;
}

export interface WindowTimes {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  extraStartTime?: string | null;
  extraEndTime?: string | null;
  timezone?: string | null;
}

// A weekly window is a wall-clock range in its own zone, not an instant, so it is never converted:
// the text names the window's zone when it has one. For example "Tuesday, 4:00 PM to 6:00 PM".
export function windowLocal(window: WindowTimes): string {
  let text = `${weekdayName(window.dayOfWeek)}, ${clockText(window.startTime)} to ${clockText(window.endTime)}`;
  if (window.extraStartTime && window.extraEndTime) {
    text += ` and ${clockText(window.extraStartTime)} to ${clockText(window.extraEndTime)}`;
  }
  return window.timezone ? `${text} (${window.timezone})` : text;
}
