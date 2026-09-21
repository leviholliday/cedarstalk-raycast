import { getPreferenceValues } from "@raycast/api";
import type { DirectoryPerson, ScheduleItem } from "./api";

/**
 * cedarengine, as a fallback for schedules Self-Service will not hand over.
 *
 * Self-Service only fills in course rows for yourself and your advisees --
 * ask it about a classmate and it answers, quite legitimately, that it has
 * nothing. cedarengine infers a timetable from a different direction
 * entirely: the campus store's booklists name the *section* a book was
 * bought for, and the catalog says when and where that section meets.
 *
 * Two honest limits, both surfaced to the reader rather than hidden. It only
 * knows students whose booklist has actually been harvested, and a section
 * nobody assigned a book to is invisible to it no matter who is enrolled.
 */

/** cedarengine counts days the way `Date.getDay` does: Sunday is 0. */
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

interface EngineMeeting {
  days: number[];
  start: string | null;
  end: string | null;
  kind: string | null;
  building: string | null;
  room: string | null;
  online: boolean;
}

interface EngineSection {
  name: string;
  code: string | null;
  title: string | null;
  meetings: EngineMeeting[];
}

interface EngineSchedule {
  term: string;
  sections: EngineSection[];
  harvestedAt: string | null;
}

export interface EngineResult {
  items: ScheduleItem[];
  term: string;
  harvestedAt: string | null;
}

/**
 * Read structurally rather than through `Preferences.SearchDirectory`: these
 * two settings live on the extension now, so every command sees them, and
 * naming one command's generated type here would be a lie in the others.
 */
function config(): { url: string; token: string } | null {
  const prefs = getPreferenceValues<{
    engineUrl?: string;
    engineToken?: string;
  }>();
  const url = (prefs.engineUrl ?? "").trim().replace(/\/$/, "");
  const token = (prefs.engineToken ?? "").trim();
  if (!url || !token) return null;
  return { url, token };
}

export function engineConfigured(): boolean {
  return config() !== null;
}

/**
 * Null means "nothing to show" for any reason -- not configured, not
 * running, no booklist for this person. The caller cannot do anything
 * different about those cases, so they collapse into one.
 */
export async function engineSchedule(
  personId: string,
): Promise<EngineResult | null> {
  const settings = config();
  if (!settings) return null;

  try {
    const res = await fetch(
      `${settings.url}/v1/people/${encodeURIComponent(personId)}/schedule`,
      { headers: { authorization: `Bearer ${settings.token}` } },
    );
    if (!res.ok) {
      // 404 is the ordinary "no booklist harvested for them" answer.
      if (res.status !== 404) {
        console.log(`[engine] ${personId}: HTTP ${res.status}`);
      }
      return null;
    }
    const data = (await res.json()) as EngineSchedule;

    const items: ScheduleItem[] = [];
    for (const section of data.sections ?? []) {
      for (const meeting of section.meetings ?? []) {
        if (meeting.online || !meeting.start || !meeting.end) continue;
        // One row per day, matching what Self-Service hands back -- the
        // renderer collapses them into "MWF" again on the way out.
        for (const day of meeting.days ?? []) {
          const name = DAY_NAMES[day];
          if (!name) continue;
          items.push({
            title: section.name,
            description: section.title ?? section.code ?? "",
            startTime: meeting.start,
            endTime: meeting.end,
            day: name,
            type: meeting.kind ?? "",
            building: meeting.building,
            room: meeting.room,
          });
        }
      }
    }
    if (!items.length) return null;
    return { items, term: data.term, harvestedAt: data.harvestedAt ?? null };
  } catch (error) {
    console.log(`[engine] ${personId}: unreachable —`, error);
    return null;
  }
}

// ─── Where someone is between two buildings ────────────────────────────────

interface Route {
  metres: number;
  minutes: number;
  /** Map metres, one pair per node along the walk. */
  points: [number, number][];
}

interface Landmark {
  label: string;
  x: number;
  y: number;
}

const routeCache = new Map<string, Route | null>();
let landmarks: Landmark[] | null = null;

async function engineGet<T>(path: string): Promise<T | null> {
  const settings = config();
  if (!settings) return null;
  try {
    const res = await fetch(`${settings.url}${path}`, {
      headers: { authorization: `Bearer ${settings.token}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** One route per building pair for the life of the command -- the campus does not move. */
async function routeBetween(from: string, to: string): Promise<Route | null> {
  const key = `${from} >> ${to}`;
  const held = routeCache.get(key);
  if (held !== undefined) return held;

  const data = await engineGet<{
    metres: number;
    minutes: number;
    points: [number, number][];
  }>(
    `/v1/campus/route?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&path=1`,
  );
  const route =
    data && data.points?.length
      ? { metres: data.metres, minutes: data.minutes, points: data.points }
      : null;
  routeCache.set(key, route);
  return route;
}

async function allLandmarks(): Promise<Landmark[]> {
  if (landmarks) return landmarks;
  const data = await engineGet<{
    buildings: { label: string; x: number | null; y: number | null }[];
  }>("/v1/campus/buildings");
  landmarks = (data?.buildings ?? [])
    .filter((b): b is Landmark => b.x !== null && b.y !== null)
    .map((b) => ({ label: b.label, x: b.x, y: b.y }));
  return landmarks;
}

/**
 * The point `fraction` of the way along a path, measured by distance walked
 * rather than by node index -- the graph's nodes are unevenly spaced, so
 * counting them would have someone crawl through dense stretches and
 * teleport across sparse ones.
 */
function pointAlong(
  points: [number, number][],
  fraction: number,
): [number, number] {
  if (points.length === 1) return points[0];
  const legs: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1],
    );
    legs.push(d);
    total += d;
  }
  let want = Math.max(0, Math.min(1, fraction)) * total;
  for (let i = 0; i < legs.length; i++) {
    if (want <= legs[i] || i === legs.length - 1) {
      const t = legs[i] === 0 ? 0 : want / legs[i];
      return [
        points[i][0] + (points[i + 1][0] - points[i][0]) * t,
        points[i][1] + (points[i + 1][1] - points[i][1]) * t,
      ];
    }
    want -= legs[i];
  }
  return points[points.length - 1];
}

export interface Transit {
  from: string;
  to: string;
  /** True while they should still be walking; false once the walk's duration has elapsed. */
  enRoute: boolean;
  walkMinutes: number;
  metres: number;
  minutesOut: number;
  /** 0-1 along the route. */
  progress: number;
  /** Closest mapped building to where they'd be, and how far off it is. */
  near: { label: string; metres: number } | null;
}

/**
 * Where someone is between two classes.
 *
 * Dead reckoning, and it says so: it assumes they left when the first class
 * let out and walk at the same 1.35 m/s the campus router assumes. Nobody
 * does exactly that -- they stop to talk, they detour for coffee -- so this
 * is where they would be walking straight there, not where they are.
 */
export async function transitBetween(
  from: string,
  to: string,
  minutesSinceLeaving: number,
): Promise<Transit | null> {
  if (!from || !to || from === to) return null;
  const route = await routeBetween(from, to);
  if (!route) return null;

  const progress =
    route.minutes <= 0 ? 1 : Math.min(1, minutesSinceLeaving / route.minutes);
  const enRoute = minutesSinceLeaving < route.minutes;

  let near: Transit["near"] = null;
  const [x, y] = pointAlong(route.points, progress);
  let best = Number.POSITIVE_INFINITY;
  for (const place of await allLandmarks()) {
    const d = Math.hypot(place.x - x, place.y - y);
    if (d < best) {
      best = d;
      near = { label: place.label, metres: Math.round(d) };
    }
  }

  return {
    from,
    to,
    enRoute,
    walkMinutes: route.minutes,
    metres: route.metres,
    minutesOut: Math.max(0, Math.round(route.minutes - minutesSinceLeaving)),
    progress,
    near,
  };
}

// ─── Rooms that are empty right now ────────────────────────────────────────

export interface QuietRoom {
  building: string;
  room: string;
  campusLabel: string | null;
  /** How long until something is scheduled in it again. */
  freeMinutes: number;
  /** Lower is quieter. A blend of the building's own load, next-door spill and footfall. */
  quiet: number;
  ambient: number;
  spill: number;
  centrality: number;
  /** Engine's own mark for the quietest third of what is free. */
  gem: boolean;
  /** Only present when a `near` was asked for. */
  metres?: number | null;
  minutes?: number | null;
}

/**
 * Unlike `engineSchedule`, this throws rather than collapsing every failure
 * into null. A whole command whose only job is to list rooms has nothing else
 * to show, so the reason it came back empty *is* the screen -- "set your token
 * in preferences" and "the engine is not running" want different answers from
 * the reader.
 */
export class EngineUnavailable extends Error {
  constructor(
    message: string,
    readonly kind: "unconfigured" | "unreachable" | "http",
  ) {
    super(message);
    this.name = "EngineUnavailable";
  }
}

export async function quietRooms(options: {
  horizonMinutes: number;
  near?: string;
}): Promise<QuietRoom[]> {
  const settings = config();
  if (!settings) {
    throw new EngineUnavailable(
      "cedarengine is not configured yet.",
      "unconfigured",
    );
  }

  const params = new URLSearchParams({
    horizon: String(options.horizonMinutes),
  });
  if (options.near?.trim()) params.set("near", options.near.trim());

  let res: Response;
  try {
    res = await fetch(`${settings.url}/v1/rooms/quiet?${params}`, {
      headers: { authorization: `Bearer ${settings.token}` },
    });
  } catch {
    throw new EngineUnavailable(
      `Could not reach cedarengine at ${settings.url}.`,
      "unreachable",
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new EngineUnavailable(
      "cedarengine rejected the token.",
      "unconfigured",
    );
  }
  if (!res.ok) {
    throw new EngineUnavailable(`cedarengine answered ${res.status}.`, "http");
  }

  const data = (await res.json()) as { rooms?: QuietRoom[] };
  return data.rooms ?? [];
}

export interface CampusBuilding {
  label: string;
  lat: number | null;
  lon: number | null;
}

/**
 * Every mapped building, for the "walk from" picker and for putting a pin on
 * a room nobody has been to before. Empty when the engine is down, which the
 * callers treat as "no picker" rather than as an error.
 */
export async function campusBuildings(): Promise<CampusBuilding[]> {
  const data = await engineGet<{ buildings: CampusBuilding[] }>(
    "/v1/campus/buildings",
  );
  return (data?.buildings ?? []).map((b) => ({
    label: b.label,
    lat: b.lat ?? null,
    lon: b.lon ?? null,
  }));
}

/**
 * Match what someone typed into a preference against a real building label.
 *
 * The labels come from the registrar and are longer than what anyone says out
 * loud -- "McChesney Hall", not "McChesney" -- so an exact comparison quietly
 * matches nothing and the picker falls back to the whole campus with no
 * explanation. Prefix first, then substring, then give up honestly.
 */
/**
 * What people call a building versus what the registrar calls it. Only
 * initialisms go here -- anything that is merely shorter than the official
 * name is already handled by the prefix and substring passes below.
 */
const ALIASES: Record<string, string> = {
  ens: "Engineering and Science Ctr",
  esc: "Engineering and Science Ctr",
  hsc: "Health Sciences Center",
  dmc: "Dixon Ministry Center",
  bts: "Ctr for Bib and Theo Studies",
  atrc: "Apple Technology Resource Ctr",
  hgc: "History and Government Center",
  tdc: "Tyler Digital Comm Center",
};

export function resolveBuilding(
  typed: string,
  labels: string[],
): string | null {
  const wanted = typed.trim().toLowerCase();
  if (!wanted) return null;
  const alias = ALIASES[wanted];
  if (alias && labels.includes(alias)) return alias;
  return (
    labels.find((label) => label.toLowerCase() === wanted) ??
    labels.find((label) => label.toLowerCase().startsWith(wanted)) ??
    labels.find((label) => label.toLowerCase().includes(wanted)) ??
    null
  );
}

// ─── Who is in the same rooms all week ─────────────────────────────────────

export interface Classmate {
  studentId: string;
  name: string | null;
  sharedSections: string[];
}

export interface ClassmateResult {
  term: string;
  minShared: number;
  classmates: Classmate[];
  /** How many students the engine has a timetable for at all, for the caveat line. */
  harvested: number | null;
}

/**
 * Everyone whose week overlaps this person's by at least `minShared` sections.
 *
 * The honest caveat, which the view prints rather than buries: this is drawn
 * from harvested booklists, so it can only ever see the overlap between two
 * students the engine already knows. A real classmate nobody has harvested is
 * simply absent, and absence here is not evidence.
 */
export async function classmates(
  personId: string,
  minShared: number,
): Promise<ClassmateResult> {
  const settings = config();
  if (!settings) {
    throw new EngineUnavailable(
      "cedarengine is not configured yet.",
      "unconfigured",
    );
  }

  let res: Response;
  try {
    res = await fetch(
      `${settings.url}/v1/people/${encodeURIComponent(personId)}/twins?minShared=${minShared}`,
      { headers: { authorization: `Bearer ${settings.token}` } },
    );
  } catch {
    throw new EngineUnavailable(
      `Could not reach cedarengine at ${settings.url}.`,
      "unreachable",
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new EngineUnavailable("cedarengine rejected the token.", "unconfigured");
  }
  // 404 is the directory saying it has never heard of this id, which is a
  // different thing from "no overlap" and reads better as an empty list.
  if (res.status === 404) {
    return { term: "", minShared, classmates: [], harvested: null };
  }
  if (!res.ok) {
    throw new EngineUnavailable(`cedarengine answered ${res.status}.`, "http");
  }

  const data = (await res.json()) as {
    term: string;
    minShared: number;
    twins?: Classmate[];
  };

  // `/v1/stats` reports booklists per term, so the count that belongs in the
  // caveat is the one for the term this answer was computed against.
  const stats = await engineGet<{
    booklists?: { term: string; students: number }[];
  }>("/v1/stats");
  const harvested =
    stats?.booklists?.find((row) => row.term === data.term)?.students ?? null;

  return {
    term: data.term,
    minShared: data.minShared,
    classmates: data.twins ?? [],
    harvested,
  };
}

// ─── Dossier ───────────────────────────────────────────────────────────────

export interface LocationNow {
  status: "in class" | "free" | "no schedule data";
  inClass: {
    section: string;
    title: string | null;
    building: string | null;
    room: string | null;
    endsAt: string;
  } | null;
  /** Where the directory *lists* them -- dorm or office. Not where class is. */
  location: {
    label: string;
    lat: number | null;
    lon: number | null;
    room: string | null;
  } | null;
  harvestedAt: string | null;
}

export interface Transition {
  day: number;
  from: string;
  to: string;
  fromEnd: string;
  toStart: string;
  gapMinutes: number;
  walkMetres: number;
  walkMinutes: number;
  /** False when the timetable does not leave enough time to make the walk. */
  possible: boolean;
}

export interface WeeklyPattern {
  weeklyMetres: number;
  worstTransition: Transition | null;
  impossibleTransitions: Transition[];
  days: { day: number; label: string; metres: number; transitions: Transition[] }[];
}

export interface Roommate {
  id: string;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  studentClass: string | null;
}

export interface Roommates {
  dormName: string | null;
  dormRoom: string | null;
  roommates: Roommate[];
}

/**
 * These three are read together and each is allowed to be missing on its own.
 * A dossier with no roommates is still a dossier; one that refuses to render
 * because a single request 404'd is not. So unlike `quietRooms`, these return
 * null rather than throwing -- the view decides what an absence means.
 */
export function locationNow(personId: string): Promise<LocationNow | null> {
  return engineGet<LocationNow>(
    `/v1/people/${encodeURIComponent(personId)}/location/now`,
  );
}

export function weeklyPattern(personId: string): Promise<WeeklyPattern | null> {
  return engineGet<WeeklyPattern>(
    `/v1/people/${encodeURIComponent(personId)}/geography`,
  );
}

export function roommatesOf(personId: string): Promise<Roommates | null> {
  return engineGet<Roommates>(
    `/v1/people/${encodeURIComponent(personId)}/roommates`,
  );
}

// ─── What they're probably studying ────────────────────────────────────────

export interface MajorGuess {
  title: string;
  score: number;
}

export interface MajorResult {
  studentClass: string | null;
  /** How many harvested courses the guess rests on. Below ~3 it is barely a guess. */
  signal: number;
  school: {
    name: string;
    agreement: number;
    of: number;
    unanimous: boolean;
  } | null;
  guesses: MajorGuess[];
}

export function majorOf(personId: string): Promise<MajorResult | null> {
  return engineGet<MajorResult>(
    `/v1/people/${encodeURIComponent(personId)}/major`,
  );
}

// ─── Who lives near them ───────────────────────────────────────────────────

export interface CarpoolMatch {
  id: string;
  name: string | null;
  city: string | null;
  state: string | null;
  distanceMiles: number;
}

export interface CarpoolResult {
  home: { city: string | null; state: string | null } | null;
  /** False when the hometown could not be placed, which makes matches meaningless. */
  geocoded: boolean;
  radiusMiles: number;
  matches: CarpoolMatch[];
}

export function carpoolFor(
  personId: string,
  radiusMiles: number,
): Promise<CarpoolResult | null> {
  return engineGet<CarpoolResult>(
    `/v1/people/${encodeURIComponent(personId)}/carpool?radius=${radiusMiles}`,
  );
}

// ─── Sections filling up ───────────────────────────────────────────────────

export interface PressureRow {
  sectionId: string;
  code: string;
  name: string;
  /** How many seat readings this rests on. One reading cannot show a rate. */
  snapshots: number;
  fillPerHour: number;
  minutesToFull: number | null;
  full: boolean;
}

export async function pressureBoard(): Promise<PressureRow[]> {
  const data = await engineGet<{ sections?: PressureRow[] }>(
    "/v1/pressure/leaderboard",
  );
  return data?.sections ?? [];
}

// ─── One person, from the engine's own copy of the directory ───────────────

interface EnginePerson {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  nickname: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  department: string | null;
  title: string | null;
  officeCode: string | null;
  officeName: string | null;
  officeRoom: string | null;
  officePhone: string | null;
  dormCode: string | null;
  dormName: string | null;
  dormRoom: string | null;
  studentType: string | null;
  studentClass: string | null;
  studentWorker: string | null;
  empInactive: string | null;
  photoUrl: string | null;
}

/** The engine stores these as the strings the directory sent, not as booleans. */
function asBool(value: string | null): boolean | null {
  if (value === null) return null;
  return value === "true";
}

/**
 * A directory record for someone we only have an id for.
 *
 * The engine keeps its own copy of every sweep, so a name in a classmate list
 * can become a full person without going back to Self-Service -- which means
 * following a name works offline, and works for the 10,452 people in the
 * engine rather than only those matching the current search.
 */
export async function personById(
  id: string,
): Promise<DirectoryPerson | null> {
  const p = await engineGet<EnginePerson>(
    `/v1/people/${encodeURIComponent(id)}`,
  );
  if (!p) return null;
  return {
    Id: p.id,
    Username: p.username ?? "",
    FirstName: p.firstName ?? "",
    LastName: p.lastName ?? "",
    MiddleName: p.middleName,
    Nickname: p.nickname,
    AddressCity: p.city,
    AddressState: p.state,
    AddressCountry: p.country,
    DepartmentDescription: p.department,
    Title: p.title,
    OfficeBuildingCode: p.officeCode,
    OfficeBuildingName: p.officeName,
    OfficeRoom: p.officeRoom,
    OfficePhone: p.officePhone,
    DormCode: p.dormCode,
    DormName: p.dormName,
    DormRoom: p.dormRoom,
    StudentType: p.studentType,
    StudentClass: p.studentClass,
    studentWorker: asBool(p.studentWorker),
    empInactive: asBool(p.empInactive),
    PhotoUrl: p.photoUrl,
  };
}

// ─── Sections and who is in them ───────────────────────────────────────────

export interface Section {
  sectionId: string;
  code: string | null;
  name: string;
  title: string | null;
  faculty: string | null;
  meetings: string | null;
  available: number | null;
  capacity: number | null;
}

export interface RosterStudent {
  id: string;
  name: string | null;
  dormName: string | null;
  studentClass: string | null;
}

export interface Roster {
  sectionName: string;
  /** What the registrar says the headcount is. */
  enrolled: number;
  /** Reconstructed students over enrolled: 1 means the whole class is named. */
  coverage: number;
  students: RosterStudent[];
}

/** The newest term the catalog holds -- `/v1/sections` will not default it. */
export async function latestTerm(): Promise<string | null> {
  const stats = await engineGet<{ catalog?: { terms?: { term: string }[] } }>(
    "/v1/stats",
  );
  return stats?.catalog?.terms?.[0]?.term ?? null;
}

/**
 * The forms a course code actually gets typed in.
 *
 * The catalog stores "GBIO-1010-01", and the search matches that string, so
 * "GBIO 1010" -- which is how everyone says it and writes it -- finds nothing
 * at all. Rather than telling people to type the hyphen, the space between a
 * subject and a number is treated as one.
 */
function queryForms(query: string): string[] {
  const trimmed = query.trim();
  const forms = new Set<string>([trimmed]);
  const spaced = trimmed.match(/^([A-Za-z]{2,5})\s+(\d.*)$/);
  if (spaced) forms.add(`${spaced[1]}-${spaced[2]}`.replace(/\s+/g, "-"));
  return [...forms];
}

export async function findSections(
  term: string,
  query: string,
): Promise<Section[]> {
  // `q` matches title, instructor and section name at once, so one request
  // per plausible spelling is enough; results are merged on section id
  // because the forms can legitimately overlap.
  const results = await Promise.all(
    queryForms(query).map((form) =>
      engineGet<{ sections?: Section[] }>(
        `/v1/sections?term=${encodeURIComponent(term)}&q=${encodeURIComponent(form)}&limit=50`,
      ),
    ),
  );

  const merged = new Map<string, Section>();
  for (const data of results) {
    for (const section of data?.sections ?? []) {
      if (!merged.has(section.sectionId)) merged.set(section.sectionId, section);
    }
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function rosterOf(sectionId: string): Promise<Roster | null> {
  return engineGet<Roster>(
    `/v1/sections/${encodeURIComponent(sectionId)}/roster`,
  );
}

// ─── Where everyone is ─────────────────────────────────────────────────────

export interface OccupiedBuilding {
  label: string;
  kind: string | null;
  gender: string | null;
  lat: number | null;
  lon: number | null;
  people: number;
  residents: number;
  workers: number;
  breakdown: Record<string, number>;
}

export type OccupancyBy = "class" | "type" | "department";

export async function campusOccupancy(
  by: OccupancyBy,
): Promise<OccupiedBuilding[]> {
  const data = await engineGet<{ buildings?: OccupiedBuilding[] }>(
    `/v1/campus/occupancy?by=${by}`,
  );
  return data?.buildings ?? [];
}

// ─── Who is in a building right now ────────────────────────────────────────

export interface PresentStudent {
  id: string;
  name: string | null;
  studentClass: string | null;
  dormName: string | null;
}

export interface PresentSection {
  sectionId: string;
  name: string | null;
  title: string | null;
  room: string;
  start: string;
  end: string;
  enrolled: number | null;
  coverage: number | null;
  students: PresentStudent[];
}

export interface Presence {
  building: string;
  people: number;
  enrolled: number;
  sections: PresentSection[];
}

export function presenceIn(building: string): Promise<Presence | null> {
  return engineGet<Presence>(
    `/v1/buildings/${encodeURIComponent(building)}/who`,
  );
}

// ─── When several people are free ──────────────────────────────────────────

export interface FreeWindow {
  start: string;
  end: string;
  minutes: number;
  endsBecause: { id: string; name: string | null; section: string; at: string }[];
}

export interface Availability {
  day: number;
  known: { id: string; name: string | null }[];
  /** People with no harvested timetable. Excluded from the windows, never assumed free. */
  unknown: string[];
  windows: FreeWindow[];
}

export function freeTogether(
  ids: string[],
  day: number,
): Promise<Availability | null> {
  return engineGet<Availability>(
    `/v1/people/free?ids=${ids.map(encodeURIComponent).join(",")}&day=${day}`,
  );
}

// ─── Would this section fit? ───────────────────────────────────────────────

export type Verdict = "fits" | "tight" | "impossible" | "clash";

export interface FitOption {
  sectionId: string;
  name: string;
  title: string | null;
  faculty: string | null;
  available: number | null;
  capacity: number | null;
  online: boolean;
  verdict: Verdict;
  /** The sentence to show. Written by the engine so both ends agree. */
  reason: string;
  meetings: {
    days: number[];
    daysDisplay: string | null;
    start: string | null;
    end: string | null;
    building: string | null;
    room: string | null;
  }[];
}

export interface FitResult {
  term: string;
  code: string;
  /** False when there is no timetable to check against, so nothing was ruled out. */
  known: boolean;
  options: FitOption[];
}

export function courseFit(
  personId: string,
  code: string,
): Promise<FitResult | null> {
  return engineGet<FitResult>(
    `/v1/people/${encodeURIComponent(personId)}/fit?code=${encodeURIComponent(code)}`,
  );
}

// ─── Textbooks ─────────────────────────────────────────────────────────────

export interface Book {
  isbn: string;
  title: string | null;
  edition: string | null;
  status: string | null;
  code: string | null;
  alsoNeededBy: number;
}

export interface StudentBooks {
  term: string;
  /** Digital-access rows the store returned that are not books. */
  withoutIsbn: number;
  books: Book[];
}

export function booksOf(personId: string): Promise<StudentBooks | null> {
  return engineGet<StudentBooks>(
    `/v1/people/${encodeURIComponent(personId)}/books`,
  );
}

export interface BookHolders {
  isbn: string;
  title: string | null;
  students: { id: string; name: string | null; studentClass: string | null }[];
}

export function bookHolders(isbn: string): Promise<BookHolders | null> {
  return engineGet<BookHolders>(
    `/v1/books/${encodeURIComponent(isbn)}/students`,
  );
}

// ─── Faculty and dorms ─────────────────────────────────────────────────────

export interface FacultyRow {
  faculty: string;
  sections: number;
  enrolled: number;
  credits: number;
  distinctRooms: number;
  distinctBuildings: number;
  earlyMeetings: number;
}

export interface FacultyDetail extends FacultyRow {
  taught: {
    code: string;
    name: string;
    title: string | null;
    credits: number | null;
    enrolled: number | null;
    meetings: {
      days: number[];
      start: string | null;
      end: string | null;
      building: string | null;
      room: string | null;
    }[];
  }[];
}

export async function facultyList(): Promise<FacultyRow[]> {
  const data = await engineGet<{ faculty?: FacultyRow[] }>("/v1/faculty?limit=300");
  return data?.faculty ?? [];
}

/** The route matches on the exact full name, so only ever pass one from the list. */
export function facultyDetail(name: string): Promise<FacultyDetail | null> {
  return engineGet<FacultyDetail>(`/v1/faculty/${encodeURIComponent(name)}`);
}

export interface DormRow {
  key: string;
  n: number;
}

export async function dormList(): Promise<DormRow[]> {
  const data = await engineGet<{ dorms?: DormRow[] }>("/v1/dorms");
  return data?.dorms ?? [];
}

export interface DormRoom {
  room: string;
  occupants: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    nickname: string | null;
    studentClass: string | null;
    city: string | null;
    state: string | null;
  }[];
}

export async function dormRooms(name: string): Promise<DormRoom[]> {
  const data = await engineGet<{ rooms?: DormRoom[] }>(
    `/v1/dorms/${encodeURIComponent(name)}/rooms`,
  );
  return data?.rooms ?? [];
}

// ─── Walking route between two buildings ───────────────────────────────────

export async function walkMinutesBetween(
  from: string,
  to: string,
): Promise<number | null> {
  if (!from || !to || from === to) return 0;
  const data = await engineGet<{ minutes: number }>(
    `/v1/campus/route?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
  return data?.minutes ?? null;
}

// ─── Searching the engine's own copy of the directory ──────────────────────

export interface DirectoryHit {
  id: string;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  studentClass: string | null;
  studentType: string | null;
  dormName: string | null;
  department: string | null;
}

/**
 * Name search against the engine rather than Self-Service.
 *
 * Works without a Self-Service session, which matters for the commands that
 * are not the directory search -- they should not need the cookie to be alive
 * just to let someone pick a name.
 */
export async function searchPeople(query: string): Promise<DirectoryHit[]> {
  const data = await engineGet<{ people?: DirectoryHit[] }>(
    `/v1/people?q=${encodeURIComponent(query)}&limit=25`,
  );
  return data?.people ?? [];
}
