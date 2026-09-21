import type { ScheduleItem } from "./api";

/**
 * "Where are they right now", from the schedule already on screen.
 *
 * This deliberately does not ask cedarengine. The engine can answer the same
 * question, but only for students whose booklist has been harvested — and it
 * infers the timetable from which books a shop was told to stock, so a
 * section nobody assigned a book to is invisible to it. Self-Service hands
 * this extension the registrar's own schedule for whoever is on screen:
 * complete, authoritative, and already fetched for the schedule section
 * below. Computing the answer here costs one pass over an array and works
 * whether or not the engine is running.
 */

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** "14:05" -> 845. Self-Service gives 24-hour times. */
function minutesOfDay(time: string): number | null {
  const [h, m] = time.split(":");
  const hour = Number.parseInt(h, 10);
  const minute = Number.parseInt(m, 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return hour * 60 + minute;
}

export type NowState = "in-class" | "free" | "no-schedule";

export interface NowStatus {
  state: NowState;
  /** The class covering this moment, when there is one. */
  current: ScheduleItem | null;
  /** The next class later the same day, whether or not one is happening now. */
  next: ScheduleItem | null;
  /** The most recent class that has already let out today -- where a walk would have started. */
  previous: ScheduleItem | null;
  /** Minutes since `previous` let out. */
  minutesSincePrevious: number | null;
  /** Minutes until `current` lets out, or until `next` begins. */
  minutesAway: number | null;
}

export function statusNow(
  items: ScheduleItem[],
  at: Date = new Date(),
): NowStatus {
  const empty: NowStatus = {
    state: "no-schedule",
    current: null,
    next: null,
    previous: null,
    minutesSincePrevious: null,
    minutesAway: null,
  };
  if (!items.length) return empty;

  const today = DAY_NAMES[at.getDay()];
  const nowMinutes = at.getHours() * 60 + at.getMinutes();

  const todays = items
    .filter((item) => item.day === today)
    .map((item) => ({
      item,
      start: minutesOfDay(item.startTime),
      end: minutesOfDay(item.endTime),
    }))
    .filter(
      (slot): slot is { item: ScheduleItem; start: number; end: number } =>
        slot.start !== null && slot.end !== null,
    )
    .sort((a, b) => a.start - b.start);

  // A schedule that exists but has nothing today is still a real answer:
  // they are free, and there is nothing left to come.
  if (!todays.length) {
    return {
      state: "free",
      current: null,
      next: null,
      previous: null,
      minutesSincePrevious: null,
      minutesAway: null,
    };
  }

  const current = todays.find(
    (slot) => slot.start <= nowMinutes && nowMinutes < slot.end,
  );
  const next = todays.find((slot) => slot.start > nowMinutes);
  // Latest class already finished: the one a walk would be leaving from.
  const previous = [...todays]
    .reverse()
    .find((slot) => slot.end <= nowMinutes);

  if (current) {
    return {
      state: "in-class",
      current: current.item,
      next: next?.item ?? null,
      previous: previous?.item ?? null,
      minutesSincePrevious: previous ? nowMinutes - previous.end : null,
      minutesAway: current.end - nowMinutes,
    };
  }
  return {
    state: "free",
    current: null,
    next: next?.item ?? null,
    previous: previous?.item ?? null,
    minutesSincePrevious: previous ? nowMinutes - previous.end : null,
    minutesAway: next ? next.start - nowMinutes : null,
  };
}

/** "in 5 minutes" reads better than "in 0.08 hours"; past an hour, hours do. */
export function describeGap(minutes: number): string {
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** Room, when Self-Service bothers to say -- it is not in every payload. */
export function placeOf(item: ScheduleItem): string | null {
  const room = [item.building, item.room].filter(Boolean).join(" ").trim();
  return room || item.location?.trim() || null;
}
