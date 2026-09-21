import { LocalStorage } from "@raycast/api";

/**
 * The two things the registrar's timetable cannot tell you about a room:
 * whether you are allowed in it, and whether anyone actually studies there.
 *
 * cedarengine knows when a room has no class in it. That is a genuinely
 * different question from "can I go and sit in it right now" -- the Health
 * Sciences Center and the chemistry labs are card-locked to their own
 * majors, a classroom that is free at 2pm may still need reserving, and the
 * places people actually study are mostly not classrooms at all. None of
 * that is derivable from the data, so it lives here as stated knowledge.
 */

// ─── Booking ───────────────────────────────────────────────────────────────

/** myCU's "Reserve a Room" task, which is where a general room request starts. */
export const RESERVE_URL = "https://mycu.cedarville.edu/task/all/reserve-a-room";

/** The library's own system -- a separate pool of rooms, bookable 3h per day. */
export const LIBCAL_URL = "https://cedarville.libcal.com/reserve/groupstudyrooms";

// ─── Places people actually study ──────────────────────────────────────────

export interface Spot {
  name: string;
  where: string;
  note: string;
  /** Null for the ones that are not a mapped campus building. */
  building: string | null;
  bookingUrl: string | null;
  lat?: number;
  lon?: number;
}

/**
 * Curated, not computed -- and worth keeping short. These are places students
 * name, which is a different and often better signal than an empty room.
 */
export const SPOTS: Spot[] = [
  {
    name: "Library Group Study Rooms",
    where: "Centennial Library",
    note: "Actually bookable, up to 3 hours a day, through the library's own system.",
    building: "Centennial Library",
    bookingUrl: LIBCAL_URL,
  },
  {
    name: "Library Quiet Zone",
    where: "Centennial Library",
    note: "The enforced-silence floor. No booking, first come first served.",
    building: "Centennial Library",
    bookingUrl: null,
  },
  {
    name: "Upper Library",
    where: "Centennial Library",
    note: "Quieter than the main floor without being silent.",
    building: "Centennial Library",
    bookingUrl: null,
  },
  {
    name: "Stinger's",
    where: "Stevens Student Center",
    note: "Tables in the student centre. Loud, but open late and caffeinated.",
    building: null,
    bookingUrl: null,
  },
  {
    name: "Beans-n-Cream",
    where: "Downtown Cedarville",
    note: "Off campus, short walk. Cafe seating, no card access to worry about.",
    // Deliberately no coordinates: it is not a building the engine has mapped,
    // and a pin dropped on a guess is worse than no pin at all.
    building: null,
    bookingUrl: null,
  },
];

// ─── Which buildings you can actually get into ─────────────────────────────

const HIDDEN_KEY = "quiet-rooms:hidden-buildings";
const SEEDED_KEY = "quiet-rooms:seeded";

/**
 * Buildings to leave out, because being unscheduled is not the same as being
 * open to you. Seeded once with the ones Levi said he cannot get into, then
 * entirely his to change -- nothing here is inferred, so nothing should be
 * silently re-added later.
 */
const SEED_HIDDEN = ["Health Sciences Center", "Chemistry Lab Center"];

export async function hiddenBuildings(): Promise<Set<string>> {
  const raw = await LocalStorage.getItem<string>(HIDDEN_KEY);
  if (raw !== undefined) {
    try {
      return new Set(JSON.parse(raw) as string[]);
    } catch {
      // Corrupt value: fall through and reseed rather than crash the command.
    }
  }
  // Only ever seed once. If the list is empty because it was deliberately
  // emptied, a seed flag is what stops it filling itself back up.
  const seeded = await LocalStorage.getItem<string>(SEEDED_KEY);
  if (seeded) return new Set();
  await LocalStorage.setItem(SEEDED_KEY, "1");
  await LocalStorage.setItem(HIDDEN_KEY, JSON.stringify(SEED_HIDDEN));
  return new Set(SEED_HIDDEN);
}

export async function setHiddenBuildings(hidden: Set<string>): Promise<void> {
  await LocalStorage.setItem(SEEDED_KEY, "1");
  await LocalStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
}

/** An Apple Maps pin, which is the fastest way to answer "where even is that". */
export function mapUrl(name: string, lat: number, lon: number): string {
  return `https://maps.apple.com/?ll=${lat},${lon}&q=${encodeURIComponent(name)}`;
}

/** Walking directions from wherever the phone thinks you are. */
export function walkUrl(lat: number, lon: number): string {
  return `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=w`;
}
