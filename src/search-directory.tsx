import {
  Action,
  ActionPanel,
  Color,
  Detail,
  getPreferenceValues,
  Icon,
  Image,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import {
  AuthRequiredError,
  type Department,
  type DirectoryPerson,
  type PersonInfo,
  type Population,
  type ScheduleItem,
  getDepartments,
  getPersonInfo,
  getPersonTerms,
  getPopulations,
  searchDirectory,
} from "./api";
import {
  clearCookie,
  drainPendingCookie,
  getStoredCookie,
  hasSignedInBefore,
  launchAuthBrowser,
  refreshCookieSilently,
  signOut,
  storeCookie,
} from "./auth";
import { getCacheSize, mergePeopleIntoCache, searchCache } from "./cache";
import { Classmates } from "./classmates";
import { Dossier } from "./dossier";
import { RideHome } from "./ride-home";
import { getCachedPhotoPath, lastPhotoFailure } from "./images";
import {
  type EngineResult,
  type Transit,
  engineConfigured,
  engineSchedule,
  transitBetween,
} from "./engine";
import { describeGap, placeOf, statusNow } from "./now";

type AuthState =
  | { kind: "loading" }
  | { kind: "ready"; cookie: string }
  | { kind: "sign-in" }
  | { kind: "signing-in" };

const CLASS_LABELS: Record<string, string> = {
  FR: "Freshman",
  SO: "Sophomore",
  JR: "Junior",
  SR: "Senior",
  GR: "Graduate",
  GS: "Graduate Student",
  HS: "High School",
  P1: "Pharmacy Year 1",
  P2: "Pharmacy Year 2",
  P3: "Pharmacy Year 3",
  P4: "Pharmacy Year 4",
};

const TYPE_LABELS: Record<string, string> = {
  UG: "Undergraduate",
  GR: "Graduate",
  GS: "Graduate Student",
  DE: "Dual Enrollment",
  P1: "Pharmacy Year 1",
  P2: "Pharmacy Year 2",
  P3: "Pharmacy Year 3",
  P4: "Pharmacy Year 4",
};

function displayName(person: DirectoryPerson, showLegal = false): string {
  const nickname =
    person.Nickname && person.Nickname !== person.FirstName
      ? person.Nickname
      : null;
  const first =
    showLegal && nickname
      ? `${nickname} (${person.FirstName})`
      : (nickname ?? person.FirstName);
  const middle = person.MiddleName ? ` ${person.MiddleName}` : "";
  return `${first}${middle} ${person.LastName}`;
}

function email(username: string): string {
  return `${username}@cedarville.edu`;
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 4) return `ext. ${digits}`;
  if (digits.length === 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length === 10)
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1")
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return phone.trim();
}

const FACULTY_TITLE_KEYWORDS = /professor|instructor|lecturer|faculty/i;

function isFacultyHeuristic(person: DirectoryPerson): boolean {
  if (person.isFaculty !== undefined) return person.isFaculty;
  return !!person.Title && FACULTY_TITLE_KEYWORDS.test(person.Title);
}

const DEMO_NAMES_STUDENT = ["Alex Johnson", "Jordan Smith", "Taylor Williams"];
const DEMO_NAMES_STAFF = ["Dr. Chris Brown", "Pat Miller", "Sam Davis"];

function demoName(person: DirectoryPerson): string {
  const isStaffPerson =
    !person.StudentType ||
    !!(person.Title?.trim() && person.OfficeBuildingCode);
  const pool = isStaffPerson ? DEMO_NAMES_STAFF : DEMO_NAMES_STUDENT;
  return pool[parseInt(person.Id.slice(-2), 10) % pool.length];
}

function parseSearchQuery(query: string): {
  firstName: string;
  lastName: string;
} {
  const parts = query.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  const lastName = parts.pop() ?? "";
  return { firstName: parts.join(" "), lastName };
}

// ─── Person detail view ────────────────────────────────────────────────────

function formatTime(t: string): string {
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  return `${hour > 12 ? hour - 12 : hour || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
}

const DAY_ORDER = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const DAY_ABBR: Record<string, string> = {
  Monday: "M",
  Tuesday: "T",
  Wednesday: "W",
  Thursday: "Th",
  Friday: "F",
  Saturday: "Sa",
  Sunday: "Su",
};
const TYPE_LABEL: Record<string, string> = {
  Lecture: "",
  Laboratory: "Lab",
  "Instructional Laboratory": "Lab",
  "Participation Course": "Participation",
};

function buildScheduleText(items: ScheduleItem[], demo: boolean): string {
  // Collapse repeated per-day entries into one slot per unique time+type
  const slotMap = new Map<string, { item: ScheduleItem; days: string[] }>();
  for (const item of items) {
    const key = `${item.title}|${item.startTime}|${item.endTime}|${item.type}`;
    if (!slotMap.has(key)) slotMap.set(key, { item, days: [] });
    slotMap.get(key)!.days.push(item.day);
  }

  // Group slots by course title so lecture + lab appear under one heading
  const courseMap = new Map<string, { item: ScheduleItem; days: string[] }[]>();
  for (const slot of slotMap.values()) {
    if (!courseMap.has(slot.item.title)) courseMap.set(slot.item.title, []);
    courseMap.get(slot.item.title)!.push(slot);
  }

  // Sort courses by earliest day of week
  const courses = [...courseMap.entries()].sort((a, b) => {
    const earliest = (slots: { days: string[] }[]) =>
      Math.min(
        ...slots.flatMap((s) => s.days.map((d) => DAY_ORDER.indexOf(d))),
      );
    return earliest(a[1]) - earliest(b[1]);
  });

  return courses
    .map(([courseTitle, slots]) => {
      const course = demo ? "DEPT 000" : courseTitle;
      const desc = demo ? "Course Name" : slots[0].item.description;

      const sortedSlots = [...slots].sort((a, b) => {
        const aFirst = Math.min(...a.days.map((d) => DAY_ORDER.indexOf(d)));
        const bFirst = Math.min(...b.days.map((d) => DAY_ORDER.indexOf(d)));
        return (
          aFirst - bFirst || a.item.startTime.localeCompare(b.item.startTime)
        );
      });

      const timeLines = sortedSlots.map(({ item, days }) => {
        const sortedDays = [...days].sort(
          (a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b),
        );
        const dayStr = sortedDays.map((d) => DAY_ABBR[d] ?? d).join("");
        const timeStr = `${formatTime(item.startTime)}–${formatTime(item.endTime)}`;
        const typeStr = TYPE_LABEL[item.type] ?? item.type;
        return `- ${dayStr} ${timeStr}${typeStr ? ` *(${typeStr})*` : ""}`;
      });

      return `**${course}** — ${desc}\n${timeLines.join("\n")}`;
    })
    .join("\n\n");
}

function PersonDetail({
  person,
  photoPath,
  cookie,
  onSignOut,
  demo,
}: {
  person: DirectoryPerson;
  photoPath: string | null;
  cookie: string;
  onSignOut: () => void;
  demo: boolean;
}) {
  const name = demo ? demoName(person) : displayName(person, true);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [info, setInfo] = useState<PersonInfo | null>(null);
  const [infoError, setInfoError] = useState<
    "no-terms" | "no-info" | "threw" | null
  >(null);
  const [termTried, setTermTried] = useState<string | null>(null);
  const [fallback, setFallback] = useState<EngineResult | null>(null);
  const [transit, setTransit] = useState<Transit | null>(null);
  // "12 min left" is a lie thirty seconds after it is drawn, so the view
  // re-reads the clock while it is open.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!photoPath) {
      setPhotoDataUrl(null);
      return;
    }
    // Raycast's Detail markdown will not render a `data:` URI -- the image
    // silently comes out blank, which is why this looked like a broken
    // download for so long while the very same file rendered fine as the
    // list row's icon. A file:// URL is what it does accept. The support
    // path contains "Application Support", so every segment is encoded;
    // an unescaped space breaks the URL just as quietly.
    const encoded = photoPath.split("/").map(encodeURIComponent).join("/");
    setPhotoDataUrl(`file://${encoded}`);
  }, [photoPath]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Every failure below used to return silently, which left `isLoading`
      // true forever: the pane spun, no schedule ever arrived, and nothing
      // said why. An expired Self-Service session looks exactly like that.
      try {
        const terms = await getPersonTerms(person.Id, cookie);
        if (cancelled) return;
        console.log(
          `[schedule] ${person.Id}: ${terms.length} terms ->`,
          JSON.stringify(terms.map((t) => ({ code: t.code, start: t.start }))),
        );
        if (!terms.length) {
          setInfoError("no-terms");
          return;
        }
        const now = Date.now();
        const current =
          terms.find((t) => {
            const start = t.start ? new Date(t.start).getTime() : 0;
            const end = t.end ? new Date(t.end).getTime() : Infinity;
            return now >= start && now <= end;
          }) ?? terms[0];
        setTermTried(current.code);
        const result = await getPersonInfo(person.Id, current.code, cookie);
        if (cancelled) return;
        console.log(
          `[schedule] ${person.Id} term ${current.code}: student=${result?.student?.isStudent}` +
            ` items=${result?.student?.scheduleItems?.length ?? "n/a"}` +
            ` faculty=${result?.faculty?.isFaculty}` +
            ` facultyItems=${result?.faculty?.scheduleItems?.length ?? "n/a"}`,
        );
        if (!result) {
          setInfoError("no-info");
          return;
        }
        setInfo(result);
        // Write confirmed isFaculty back to cache
        const confirmed = result.faculty.isFaculty;
        if (person.isFaculty !== confirmed) {
          await mergePeopleIntoCache([{ ...person, isFaculty: confirmed }]);
        }
      } catch (error) {
        if (cancelled) return;
        // Without this the promise rejected into nowhere and the pane sat on
        // a spinner forever, which is indistinguishable from "still loading".
        console.error(`[schedule] ${person.Id} threw:`, error);
        setInfoError("threw");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [person.Id, cookie]);

  // Only asked once Self-Service has actually come back empty, so the engine
  // is never hit for the common case where the real schedule is available.
  const selfServiceEmpty =
    (info !== null || infoError !== null) &&
    !(info?.faculty?.scheduleItems?.length || info?.student?.scheduleItems?.length);

  useEffect(() => {
    if (!selfServiceEmpty || demo) return;
    let cancelled = false;
    engineSchedule(person.Id).then((result) => {
      if (!cancelled) setFallback(result);
    });
    return () => {
      cancelled = true;
    };
  }, [selfServiceEmpty, person.Id, demo]);

  // Between two classes in different buildings: ask the campus router where
  // that walk goes, and how far along it they should be by now. Re-runs on
  // the same 30s tick as the clock, so the position keeps up.
  const walkItems = fallback?.items.length
    ? fallback.items
    : (info?.faculty?.scheduleItems?.length
        ? info.faculty.scheduleItems
        : (info?.student?.scheduleItems ?? []));

  useEffect(() => {
    if (demo || !walkItems.length) return;
    const status = statusNow(walkItems);
    const from = status.previous?.building ?? null;
    const to = status.next?.building ?? null;
    if (status.state !== "free" || !from || !to || status.minutesSincePrevious === null) {
      setTransit(null);
      return;
    }
    let cancelled = false;
    transitBetween(from, to, status.minutesSincePrevious).then((result) => {
      if (!cancelled) setTransit(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkItems, demo, tick]);

  // Photo full-width at top, name + italic tags below
  const md: string[] = [];
  if (!demo && photoDataUrl) md.push(`![Photo](${photoDataUrl})`);
  md.push(`# ${name}`);
  const isStaff =
    !person.StudentType ||
    !!(person.Title?.trim() && person.OfficeBuildingCode);
  const tags: string[] = [];
  if (isStaff) {
    tags.push(isFacultyHeuristic(person) ? "Faculty" : "Staff");
  } else if (person.StudentType === "DE") {
    tags.push("Dual Enrollment");
  } else {
    if (
      person.StudentClass &&
      CLASS_LABELS[person.StudentClass] &&
      person.StudentClass !== "GS" &&
      person.StudentClass !== "HS" &&
      person.StudentType !== null
    )
      tags.push(CLASS_LABELS[person.StudentClass]);
    if (person.StudentType)
      tags.push(TYPE_LABELS[person.StudentType] ?? person.StudentType);
  }
  if (person.studentWorker) tags.push("Student Worker");
  if (person.Title?.trim()) tags.push(person.Title.trim());
  if (tags.length) md.push(`*${tags.join(" · ")}*`);

  const selfServiceItems = info?.faculty?.isFaculty
    ? info.faculty.scheduleItems
    : info?.student?.isStudent
      ? info.student.scheduleItems
      : [];
  // Self-Service first -- it is the registrar's own answer. cedarengine only
  // stands in when that comes back empty, which for anyone but yourself is
  // most of the time.
  const usingFallback = !selfServiceItems.length && !!fallback;
  const scheduleItems = usingFallback ? fallback.items : selfServiceItems;
  const termDesc = info?.faculty?.isFaculty
    ? info.faculty.term?.description
    : info?.student?.term?.description;
  const nonScheduled = info?.student?.isStudent
    ? (info.student.nonScheduledCourses ?? [])
    : [];

  // A missing photo used to be indistinguishable from a person who has none.
  if (!demo && person.PhotoUrl && !photoDataUrl) {
    const why = lastPhotoFailure();
    if (why === "auth") {
      md.push(
        "*Photo unavailable — Self-Service answered the photo request with a sign-in page. " +
          "The session needs refreshing: sign out and back in (⌘K → Sign Out).*",
      );
    } else if (why) {
      md.push("*Photo unavailable — the image could not be downloaded.*");
    }
  }

  if (infoError) {
    md.push(
      infoError === "no-terms"
        ? "*Schedule unavailable — Self-Service returned no terms for this person. " +
            "If this happens for everyone, the session has probably expired: sign out and back in.*"
        : infoError === "threw"
          ? "*Schedule unavailable — the request failed outright. Sign out and back in; " +
            "if it persists the session cookie is likely stale.*"
          : "*Schedule unavailable — Self-Service did not return course data. " +
            "This is usually an expired session; sign out and back in.*",
    );
  } else if (info && !scheduleItems.length && !nonScheduled.length) {
    // Loaded fine, just nothing in it. Previously this rendered nothing at
    // all, which looks identical to the feature being broken.
    md.push(
      `*No schedule returned${termTried ? ` for term ${termTried}` : ""} — ` +
        "Self-Service only shares course rows for yourself and your advisees.*" +
        (engineConfigured()
          ? "\n\n*cedarengine has no harvested booklist for them either, so there is " +
            "nothing to fall back on.*"
          : "\n\n*Set the cedarengine URL and token in this command's preferences " +
            "to fall back on booklist-derived schedules.*"),
    );
  }

  // Right under the name, before the schedule that explains it.
  if (!demo && scheduleItems.length) {
    const status = statusNow(scheduleItems);
    if (status.state === "in-class" && status.current) {
      const place = placeOf(status.current);
      const until = formatTime(status.current.endTime);
      md.push(
        `**In class now** — ${status.current.title}${place ? ` · ${place}` : ""}\n\n` +
          `until ${until}${
            status.minutesAway !== null
              ? ` (${describeGap(status.minutesAway)} left)`
              : ""
          }`,
      );
    } else if (status.state === "free" && transit?.enRoute) {
      // Mid-walk: say where along it, not just that they are free.
      const where = transit.near
        ? transit.near.metres < 40
          ? ` — by ${transit.near.label}`
          : ` — about ${transit.near.metres}m from ${transit.near.label}`
        : "";
      md.push(
        `**Walking** — ${transit.from} → ${transit.to}${where}\n\n` +
          `${Math.round(transit.progress * 100)}% of a ${Math.round(transit.walkMinutes)} min ` +
          `(${transit.metres}m) walk · arrives in ~${transit.minutesOut} min` +
          (status.next ? ` for ${status.next.title}` : "") +
          "\n\n*Dead reckoning: assumes they left when class let out and walked straight there.*",
      );
    } else if (status.state === "free") {
      const settled =
        transit && !transit.enRoute
          ? `**Probably at ${transit.to}** — the walk from ${transit.from} takes about ` +
            `${Math.round(transit.walkMinutes)} min and they left ${describeGap(
              status.minutesSincePrevious ?? 0,
            )} ago`
          : null;
      md.push(
        settled
          ? settled +
              (status.next
                ? `, so waiting on ${status.next.title} at ${formatTime(status.next.startTime)}`
                : "")
          : status.next
            ? `**Free now** — next is ${status.next.title} at ${formatTime(
                status.next.startTime,
              )}${
                status.minutesAway !== null
                  ? `, in ${describeGap(status.minutesAway)}`
                  : ""
              }`
            : "**Free now** — nothing else scheduled today",
      );
    }
  }
  if (scheduleItems.length || nonScheduled.length) {
    md.push(
      `## Schedule${
        usingFallback
          ? ` — ${fallback.term} *(from cedarengine booklists)*`
          : termDesc
            ? ` — ${termDesc}`
            : ""
      }\n`,
    );
    if (scheduleItems.length) md.push(buildScheduleText(scheduleItems, demo));
    if (usingFallback) {
      const when = fallback.harvestedAt
        ? new Date(fallback.harvestedAt).toLocaleDateString()
        : null;
      md.push(
        "*Inferred from campus-store booklists, not the registrar: a section nobody " +
          "assigned a book to will be missing, and a course dropped since the last " +
          `harvest${when ? ` (${when})` : ""} may still be listed.*`,
      );
    }
    if (nonScheduled.length) {
      md.push("**Online / Unscheduled**");
      md.push(
        nonScheduled
          .map(
            (c) =>
              `- ${demo ? "DEPT 000" : c.code} — ${demo ? "Course Name" : c.title} *(${c.methods})*`,
          )
          .join("\n"),
      );
    }
  }

  return (
    <Detail
      isLoading={!info && !infoError}
      markdown={md.join("\n\n")}
      navigationTitle={name}
      metadata={
        <Detail.Metadata>
          {person.Username && (
            <Detail.Metadata.Label
              title="Email"
              text={demo ? "username@cedarville.edu" : email(person.Username)}
            />
          )}
          {person.DepartmentDescription && (
            <Detail.Metadata.Label
              title="Department"
              text={person.DepartmentDescription}
            />
          )}
          {!!(isStaff || person.StudentClass || person.studentWorker) && (
            <Detail.Metadata.Separator />
          )}
          {isStaff ? (
            <Detail.Metadata.TagList title="Role">
              <Detail.Metadata.TagList.Item
                text={isFacultyHeuristic(person) ? "Faculty" : "Staff"}
                color={isFacultyHeuristic(person) ? Color.Orange : Color.Green}
              />
            </Detail.Metadata.TagList>
          ) : person.StudentType === "DE" ? (
            <Detail.Metadata.TagList title="Program">
              <Detail.Metadata.TagList.Item
                text="Dual Enrollment"
                color={Color.Orange}
              />
            </Detail.Metadata.TagList>
          ) : (
            <>
              {person.StudentClass &&
                CLASS_LABELS[person.StudentClass] &&
                person.StudentClass !== "GS" &&
                person.StudentClass !== "HS" &&
                person.StudentType !== null && (
                  <Detail.Metadata.TagList title="Year">
                    <Detail.Metadata.TagList.Item
                      text={CLASS_LABELS[person.StudentClass]}
                      color={Color.Blue}
                    />
                  </Detail.Metadata.TagList>
                )}
              {person.StudentType && (
                <Detail.Metadata.Label
                  title="Program"
                  text={TYPE_LABELS[person.StudentType] ?? person.StudentType}
                />
              )}
            </>
          )}
          {person.studentWorker && (
            <Detail.Metadata.TagList title="Role">
              <Detail.Metadata.TagList.Item
                text="Student Worker"
                color={Color.Yellow}
              />
            </Detail.Metadata.TagList>
          )}
          {!!(
            person.DormName ||
            person.OfficeBuildingName ||
            person.OfficePhone ||
            info?.person?.box
          ) && <Detail.Metadata.Separator />}
          {person.DormName && (
            <Detail.Metadata.Label
              title="Dorm"
              text={
                demo
                  ? "Residence Hall, Room 000"
                  : person.DormRoom
                    ? `${person.DormName}, Room ${person.DormRoom}`
                    : person.DormName
              }
            />
          )}
          {info?.person?.box && (
            <Detail.Metadata.Label
              title="Box"
              text={demo ? "#0000" : `#${info.person.box}`}
            />
          )}
          {person.OfficeBuildingCode && (
            <Detail.Metadata.Label
              title="Office"
              text={
                person.OfficeRoom
                  ? `${person.OfficeBuildingCode} ${person.OfficeRoom}`
                  : person.OfficeBuildingCode
              }
            />
          )}
          {person.OfficePhone && (
            <Detail.Metadata.Label
              title="Phone"
              text={demo ? "ext. ****" : formatPhone(person.OfficePhone)}
            />
          )}
          {!!(
            person.AddressCity ||
            person.AddressState ||
            info?.address?.addresslines?.length
          ) && <Detail.Metadata.Separator />}
          {!!(person.AddressCity || person.AddressState) && (
            <Detail.Metadata.Label
              title="Hometown"
              text={
                demo
                  ? "City, OH"
                  : [person.AddressCity, person.AddressState]
                      .filter(Boolean)
                      .join(", ")
              }
            />
          )}
          {info?.address?.addresslines?.filter(Boolean).length ? (
            <Detail.Metadata.Label
              title="Address"
              text={
                demo
                  ? "123 Example St, City, OH 00000"
                  : info.address.addresslines.filter(Boolean).join(", ")
              }
            />
          ) : null}
          {info?.student?.isStudent &&
            (() => {
              const majors = info.student.majors.filter((m) => m.desc?.trim());
              const minors = info.student.minors.filter((m) => m.desc?.trim());
              const concentrations = info.student.concentrations.filter((c) =>
                c.desc?.trim(),
              );
              const advisors = info.student.advisors.filter((a) =>
                a.advisor.name?.trim(),
              );
              if (
                !majors.length &&
                !minors.length &&
                !concentrations.length &&
                !advisors.length
              )
                return null;
              return (
                <>
                  <Detail.Metadata.Separator />
                  {majors.map((m) => (
                    <Detail.Metadata.Label
                      key={m.code}
                      title="Major"
                      text={m.desc}
                    />
                  ))}
                  {minors.map((m) => (
                    <Detail.Metadata.Label
                      key={m.code}
                      title="Minor"
                      text={m.desc}
                    />
                  ))}
                  {concentrations.map((c) => (
                    <Detail.Metadata.Label
                      key={c.code}
                      title="Concentration"
                      text={c.desc}
                    />
                  ))}
                  {advisors.map((a) => (
                    <Detail.Metadata.Label
                      key={a.advisor.id}
                      title="Advisor"
                      text={demo ? "Advisor Name" : a.advisor.name}
                    />
                  ))}
                </>
              );
            })()}
          {info?.faculty?.isFaculty && info.faculty.facultyDepts.length > 0 && (
            <>
              <Detail.Metadata.Separator />
              {info.faculty.facultyDepts.map((d) => (
                <Detail.Metadata.Label
                  key={d.code}
                  title="Faculty Dept"
                  text={d.description}
                />
              ))}
            </>
          )}
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="ID"
            text={demo ? "000000000" : person.Id}
          />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          {person.Username && (
            <Action.CopyToClipboard
              title="Copy Email"
              content={
                demo ? "username@cedarville.edu" : email(person.Username)
              }
            />
          )}
          {!demo && person.Username && (
            <Action.OpenInBrowser
              title="Send Email"
              url={`mailto:${email(person.Username)}`}
              icon={Icon.Envelope}
            />
          )}
          {person.OfficePhone && (
            <Action.CopyToClipboard
              title="Copy Phone"
              content={demo ? "ext. ****" : formatPhone(person.OfficePhone)}
            />
          )}
          {!demo && (
            <Action.Push
              title="Assassins Dossier"
              icon={Icon.BullsEye}
              shortcut={{ modifiers: ["cmd"], key: "a" }}
              target={
                <Dossier
                  person={person}
                  name={displayName(person)}
                  items={scheduleItems}
                />
              }
            />
          )}
          {!demo && (
            <Action.Push
              title="Who Lives Near Them"
              icon={Icon.Car}
              shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
              target={
                <RideHome personId={person.Id} personName={displayName(person)} />
              }
            />
          )}
          {!demo && (
            <Action.Push
              title="Who Shares Their Classes"
              icon={Icon.TwoPeople}
              shortcut={{ modifiers: ["cmd"], key: "t" }}
              target={
                <Classmates
                  personId={person.Id}
                  personName={displayName(person)}
                />
              }
            />
          )}
          <Action.CopyToClipboard
            title="Copy ID"
            content={demo ? "000000000" : person.Id}
            icon={Icon.Person}
          />
          {!demo && (
            <Action.OpenInBrowser
              title="Open Info Page"
              url={`https://selfservice.cedarville.edu/Cedarinfo/Info?id=${person.Id}`}
              icon={Icon.Globe}
            />
          )}
          {!demo && (
            <Action.CopyToClipboard
              title="Export as JSON"
              icon={Icon.Code}
              content={JSON.stringify(person, null, 2)}
              shortcut={{ modifiers: ["cmd", "shift"], key: "j" }}
            />
          )}
          <Action
            title="Sign Out"
            icon={Icon.ArrowLeft}
            onAction={onSignOut}
            shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
          />
        </ActionPanel>
      }
    />
  );
}

// ─── Person list item ──────────────────────────────────────────────────────

function PersonListItem({
  person,
  photoPath,
  cookie,
  onSignOut,
  demo,
}: {
  person: DirectoryPerson;
  photoPath: string | null;
  cookie: string;
  onSignOut: () => void;
  demo: boolean;
}) {
  const name = demo ? demoName(person) : displayName(person);

  // Subtitle: title for staff, dorm for students
  const isStudent =
    !!person.StudentClass &&
    !!person.StudentType &&
    !(person.Title?.trim() && person.OfficeBuildingCode);
  const hasOffice = !isStudent && !!person.OfficeBuildingCode;
  const rawTitle = demo
    ? undefined
    : isStudent
      ? person.DormName
        ? `${person.DormName}${person.DormRoom ? ` ${person.DormRoom}` : ""}`
        : person.Username
          ? email(person.Username)
          : undefined
      : ((person.Title?.trim() ||
          (person.Username ? email(person.Username) : undefined)) ??
        undefined);
  const subtitle =
    hasOffice && rawTitle && rawTitle.length > 30
      ? `${rawTitle.slice(0, 29)}…`
      : rawTitle;

  // Badge
  let badge: List.Item.Accessory | null = null;
  if (!isStudent) {
    const faculty = isFacultyHeuristic(person);
    badge = {
      tag: {
        value: faculty ? "Faculty" : "Staff",
        color: faculty ? Color.Orange : Color.Green,
      },
    };
  } else if (person.StudentType === "DE") {
    badge = { tag: { value: "DE", color: Color.Orange } };
  } else if (person.StudentType === "GS" || person.StudentClass === "GS") {
    badge = { tag: { value: "Graduate", color: Color.Purple } };
  } else if (
    person.StudentClass &&
    CLASS_LABELS[person.StudentClass] &&
    person.StudentClass !== "HS" &&
    person.StudentType !== null
  ) {
    badge = {
      tag: { value: CLASS_LABELS[person.StudentClass], color: Color.Blue },
    };
  }

  // Accessories: office then badge
  const accessories: List.Item.Accessory[] = [];
  if (hasOffice) {
    const officeLabel = person.OfficeRoom
      ? `${person.OfficeBuildingCode} ${person.OfficeRoom}`
      : person.OfficeBuildingCode!;
    accessories.push({ text: officeLabel, icon: Icon.Building });
  }
  if (badge) accessories.push(badge);

  return (
    <List.Item
      title={name}
      subtitle={subtitle}
      icon={
        !demo && photoPath
          ? {
              source: photoPath,
              mask: Image.Mask.Circle,
              fallback: Icon.Person,
            }
          : Icon.Person
      }
      accessories={accessories}
      actions={
        <ActionPanel>
          <Action.Push
            title="View Details"
            icon={Icon.Eye}
            target={
              <PersonDetail
                person={person}
                photoPath={photoPath}
                cookie={cookie}
                onSignOut={onSignOut}
                demo={demo}
              />
            }
          />
          {person.Username && (
            <Action.CopyToClipboard
              title="Copy Email"
              content={
                demo ? "username@cedarville.edu" : email(person.Username)
              }
            />
          )}
          {!demo && person.Username && (
            <Action.OpenInBrowser
              title="Send Email"
              url={`mailto:${email(person.Username)}`}
              icon={Icon.Envelope}
            />
          )}
          {person.OfficePhone && (
            <Action.CopyToClipboard
              title="Copy Phone"
              content={demo ? "ext. ****" : formatPhone(person.OfficePhone)}
            />
          )}
          {!demo && (
            <Action.Push
              title="Assassins Dossier"
              icon={Icon.BullsEye}
              shortcut={{ modifiers: ["cmd"], key: "a" }}
              target={
                <Dossier person={person} name={displayName(person)} />
              }
            />
          )}
          {!demo && (
            <Action.Push
              title="Who Lives Near Them"
              icon={Icon.Car}
              shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
              target={
                <RideHome personId={person.Id} personName={displayName(person)} />
              }
            />
          )}
          {!demo && (
            <Action.Push
              title="Who Shares Their Classes"
              icon={Icon.TwoPeople}
              shortcut={{ modifiers: ["cmd"], key: "t" }}
              target={
                <Classmates
                  personId={person.Id}
                  personName={displayName(person)}
                />
              }
            />
          )}
          <Action.CopyToClipboard
            title="Copy ID"
            content={demo ? "000000000" : person.Id}
            icon={Icon.Person}
          />
          {!demo && (
            <Action.OpenInBrowser
              title="Open Info Page"
              url={`https://selfservice.cedarville.edu/Cedarinfo/Info?id=${person.Id}`}
              icon={Icon.Globe}
            />
          )}
          {!demo && (
            <Action.CopyToClipboard
              title="Export as JSON"
              icon={Icon.Code}
              content={JSON.stringify(person, null, 2)}
              shortcut={{ modifiers: ["cmd", "shift"], key: "j" }}
            />
          )}
          <Action
            title="Sign Out"
            icon={Icon.ArrowLeft}
            onAction={onSignOut}
            shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
          />
        </ActionPanel>
      }
    />
  );
}

// ─── Main command ──────────────────────────────────────────────────────────

export default function SearchDirectory() {
  const { demoMode: demo } = getPreferenceValues<Preferences.SearchDirectory>();
  const [authState, setAuthState] = useState<AuthState>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [results, setResults] = useState<DirectoryPerson[]>([]);
  const [photoPaths, setPhotoPaths] = useState<Record<string, string>>({});
  const [cacheSize, setCacheSize] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [populations, setPopulations] = useState<Population[]>([]);
  const searchRef = useRef<AbortController | null>(null);
  // Guards against renewing in a loop; cleared once a search actually succeeds.
  const renewedRef = useRef(false);

  useEffect(() => {
    (async () => {
      let cookie = await getStoredCookie();
      if (!cookie) {
        const pending = await drainPendingCookie();
        if (pending) {
          await storeCookie(pending);
          cookie = pending;
        }
      }

      // No cookie but a known SSO session: renew in the background rather than
      // asking for a click that would only ever be answered one way.
      if (!cookie && (await hasSignedInBefore())) {
        cookie = await refreshCookieSilently();
      }

      if (cookie) {
        setAuthState({ kind: "ready", cookie });
        setCacheSize(await getCacheSize());
        getDepartments(cookie).then(setDepartments);
        getPopulations(cookie).then(setPopulations);
        return;
      }
      setAuthState({ kind: "sign-in" });
    })();
  }, []);

  useEffect(() => {
    if (authState.kind !== "ready") return;

    searchRef.current?.abort();
    const controller = new AbortController();
    searchRef.current = controller;

    // Parse filter value into API options
    const apiOptions = filter.startsWith("dept:")
      ? { department: filter.slice(5) }
      : filter.startsWith("pop:")
        ? { population: Number(filter.slice(4)) }
        : {};
    const hasFilter = !!filter;

    // Cache search runs immediately (no debounce)
    if (!hasFilter) {
      searchCache(query.trim()).then((local) => {
        if (!controller.signal.aborted) setResults(local);
      });
    }

    const run = async () => {
      const trimmed = query.trim();

      if (!trimmed) return;

      setIsSearching(true);
      try {
        const { firstName, lastName } = parseSearchQuery(trimmed);

        // For single-word queries, search as both first and last name in parallel
        let fresh: DirectoryPerson[];
        if (trimmed && !lastName) {
          const [byFirst, byLast] = await Promise.all([
            searchDirectory(firstName, "", authState.cookie, apiOptions),
            searchDirectory("", firstName, authState.cookie, apiOptions),
          ]);
          const seen = new Set<string>();
          fresh = [];
          for (const p of [...byFirst, ...byLast]) {
            if (!seen.has(p.Id)) {
              seen.add(p.Id);
              fresh.push(p);
            }
          }
        } else {
          fresh = await searchDirectory(
            firstName,
            lastName,
            authState.cookie,
            apiOptions,
          );
        }

        if (!controller.signal.aborted) {
          renewedRef.current = false;
          await mergePeopleIntoCache(fresh);
          setCacheSize(await getCacheSize());

          if (hasFilter) {
            setResults(fresh);
          } else {
            // Re-run cache search after merge so order stays stable (fuzzy score)
            setResults(await searchCache(trimmed));
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof AuthRequiredError) {
          // The site's own cookie expires in hours; the SSO session behind it
          // lasts weeks. Renew from that first — no window, no typing. One
          // attempt only: a renewed cookie that still gets rejected would
          // otherwise send us round this loop forever.
          if (renewedRef.current) {
            await clearCookie();
            setAuthState({ kind: "sign-in" });
            return;
          }
          renewedRef.current = true;
          const toast = await showToast({
            style: Toast.Style.Animated,
            title: "Session expired — renewing…",
          });
          const renewed = await refreshCookieSilently();
          if (controller.signal.aborted) return;
          if (renewed) {
            toast.hide();
            // Re-running the search is the effect's job; new cookie, new run.
            setAuthState({ kind: "ready", cookie: renewed });
          } else {
            toast.hide();
            await clearCookie();
            setAuthState({ kind: "sign-in" });
          }
        } else {
          await showToast({
            style: Toast.Style.Failure,
            title: "Search failed",
            message: String(err),
          });
        }
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    };

    const timer = setTimeout(run, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, filter, authState]);

  useEffect(() => {
    if (authState.kind !== "ready") return;
    const { cookie } = authState;
    const missingUrl = results.filter((p) => !p.PhotoUrl).length;
    if (missingUrl) {
      console.log(
        `[photo] ${missingUrl}/${results.length} results have no PhotoUrl — those can never load a photo`,
      );
    }
    for (const person of results) {
      if (!person.PhotoUrl || photoPaths[person.Id]) continue;
      getCachedPhotoPath(person.Id, person.PhotoUrl, cookie).then((p) => {
        if (!p) console.log(`[photo] ${person.Id}: fetch/cache returned null`);
        if (p) setPhotoPaths((prev) => ({ ...prev, [person.Id]: p }));
      });
    }
  }, [results, authState]);

  async function handleSignOut() {
    await signOut();
    setResults([]);
    // Always use the base URL — let the server issue a fresh SAML redirect
    // when the browser opens, rather than using a potentially stale one.
    setAuthState({ kind: "sign-in" });
  }

  async function handleSignIn() {
    setAuthState({ kind: "signing-in" });
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Opening sign-in window…",
      message: "Complete login in the window that opens",
    });
    try {
      const cookie = await launchAuthBrowser();
      await storeCookie(cookie);
      toast.style = Toast.Style.Success;
      toast.title = "Signed in!";
      setCacheSize(await getCacheSize());
      getDepartments(cookie).then(setDepartments);
      getPopulations(cookie).then(setPopulations);
      setAuthState({ kind: "ready", cookie });
    } catch (err) {
      toast.style = Toast.Style.Failure;
      toast.title = String(err);
      setAuthState({ kind: "sign-in" });
    }
  }

  // ── Auth screens ────────────────────────────────────────────────────────

  if (authState.kind === "loading") return <List isLoading />;

  if (authState.kind === "sign-in") {
    return (
      <List>
        <List.EmptyView
          title="Sign in to Cedarville"
          description="A small sign-in window will open. Your browser is never touched; the session is kept locally so this only happens once."
          icon={Icon.Lock}
          actions={
            <ActionPanel>
              <Action
                title="Sign In"
                icon={Icon.Person}
                onAction={handleSignIn}
              />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  if (authState.kind === "signing-in") {
    return (
      <List isLoading>
        <List.EmptyView
          title="Waiting for sign-in…"
          description="Complete login in the window that just opened."
          icon={Icon.Clock}
        />
      </List>
    );
  }

  // ── Ready: search ───────────────────────────────────────────────────────

  return (
    <List
      isLoading={isSearching}
      searchBarPlaceholder="Search by name…"
      onSearchTextChange={setQuery}
      throttle={false}
      searchBarAccessory={
        <List.Dropdown tooltip="Filter" value={filter} onChange={setFilter}>
          <List.Dropdown.Item title="All People" value="" />
          {populations.length > 0 && (
            <List.Dropdown.Section title="By Type">
              {populations.map((p) => (
                <List.Dropdown.Item
                  key={p.code}
                  title={p.desc}
                  value={`pop:${p.code}`}
                />
              ))}
            </List.Dropdown.Section>
          )}
          {departments.length > 0 && (
            <List.Dropdown.Section title="By Department">
              {departments.map((d) => (
                <List.Dropdown.Item
                  key={d.code}
                  title={d.description}
                  value={`dept:${d.code}`}
                />
              ))}
            </List.Dropdown.Section>
          )}
        </List.Dropdown>
      }
    >
      {results.length === 0 ? (
        <List.EmptyView
          title={
            query.trim()
              ? "No results found"
              : "Search the Cedarville Directory"
          }
          description={
            query.trim()
              ? `No one matched "${query}"`
              : cacheSize > 0
                ? `${cacheSize} people cached`
                : "Start typing to search"
          }
          icon={query.trim() ? Icon.MagnifyingGlass : Icon.Person}
        />
      ) : (
        <List.Section
          title={`${results.length} result${results.length !== 1 ? "s" : ""}`}
        >
          {results.map((person) => (
            <PersonListItem
              key={person.Id}
              person={person}
              photoPath={photoPaths[person.Id] ?? null}
              cookie={authState.cookie}
              onSignOut={handleSignOut}
              demo={demo}
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
