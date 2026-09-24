import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Icon,
  openExtensionPreferences,
} from "@raycast/api";
import { useEffect, useState } from "react";
import type { DirectoryPerson, ScheduleItem } from "./api";
import { Classmates } from "./classmates";
import { CrossingsWith } from "./crossings";
import {
  type CampusBuilding,
  type LocationNow,
  type Roommates,
  type Transit,
  type WeeklyPattern,
  type Transition,
  type CarpoolResult,
  type MajorResult,
  campusBuildings,
  carpoolFor,
  engineSchedule,
  locationNow,
  majorOf,
  personById,
  roommatesOf,
  transitBetween,
  weeklyPattern,
} from "./engine";
import { describeGap, placeOf, statusNow } from "./now";
import { mapUrl, walkUrl } from "./spots";

/**
 * Everything the engine knows about where one person will be, on one card.
 *
 * Built for Assassins, which is worth saying plainly because it sets the
 * standard for honesty rather than lowering it. A card like this is only fun
 * if it is right, and every number on it is an inference from a timetable:
 * the walk positions are dead reckoning at a constant 1.35 m/s, the routine
 * is what the registrar scheduled rather than what anyone does, and a person
 * with no booklist has no pattern here at all. So each block says where it
 * came from and how much to trust it, and an absence is labelled as an
 * absence rather than drawn as an empty schedule.
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

/** "15:00" -> "3:00 PM", which is how anyone would read a schedule out loud. */
function clock(time: string): string {
  const [h, m] = time.split(":").map((n) => Number.parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * How much of a recurring walk is actually predictable.
 *
 * The first version of this scored the whole transition and rated almost
 * everything "loose", which was the wrong question. The *departure* is as
 * reliable as the timetable -- at 9:50 they walk out of that door, whatever
 * they do next. It is only the destination that the gap makes uncertain: ten
 * minutes and they have to go straight there, ninety and they are getting
 * lunch on the way. So the door is stated as fact and the gap qualifies the
 * rest.
 */
function straightness(t: Transition): {
  label: string;
  rank: number;
  emoji: string;
} {
  if (!t.possible)
    return {
      label: `${t.gapMinutes} min for a ${Math.round(t.walkMinutes)} min walk — always running`,
      rank: 0,
      emoji: "🔥",
    };
  if (t.gapMinutes <= 30)
    return {
      label: `${t.gapMinutes} min gap — straight there`,
      rank: 1,
      emoji: "🟢",
    };
  if (t.gapMinutes <= 90)
    return {
      label: `${t.gapMinutes} min gap — a stop on the way`,
      rank: 2,
      emoji: "🟡",
    };
  return {
    label: `${t.gapMinutes} min gap — anywhere in between`,
    rank: 3,
    emoji: "⚪️",
  };
}

function sortTransitions(a: Transition, b: Transition): number {
  return (
    straightness(a).rank - straightness(b).rank ||
    a.fromEnd.localeCompare(b.fromEnd)
  );
}

export function Dossier({
  person,
  name,
  items: given,
}: {
  person: DirectoryPerson;
  name: string;
  /**
   * The schedule the caller already resolved, when there is one. Opened from
   * a search row there is none, so the card fetches its own rather than being
   * a weaker dossier for having been opened a different way.
   */
  items?: ScheduleItem[];
}) {
  const [fetched, setFetched] = useState<ScheduleItem[]>([]);
  const items = given?.length ? given : fetched;

  useEffect(() => {
    if (given?.length) return;
    let live = true;
    engineSchedule(person.Id).then((result) => {
      if (live && result) setFetched(result.items);
    });
    return () => {
      live = false;
    };
  }, [person.Id, given?.length]);

  const [here, setHere] = useState<LocationNow | null>(null);
  const [pattern, setPattern] = useState<WeeklyPattern | null>(null);
  const [mates, setMates] = useState<Roommates | null>(null);
  const [buildings, setBuildings] = useState<CampusBuilding[]>([]);
  const [major, setMajor] = useState<MajorResult | null>(null);
  const [carpool, setCarpool] = useState<CarpoolResult | null>(null);
  const [transit, setTransit] = useState<Transit | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // "ends in 12 min" is wrong within the minute, so the card re-reads the
  // clock while it is open rather than freezing at render time.
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([
      locationNow(person.Id),
      weeklyPattern(person.Id),
      roommatesOf(person.Id),
      campusBuildings(),
      majorOf(person.Id),
      carpoolFor(person.Id, 40),
    ])
      .then(([where, week, room, places, study, ride]) => {
        if (!live) return;
        setHere(where);
        setPattern(week);
        setMates(room);
        setBuildings(places);
        setMajor(study);
        setCarpool(ride);
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [person.Id]);

  const status = statusNow(items);

  // Mid-walk is the one state neither Self-Service nor the engine reports:
  // it has to be reckoned from when the last class let out.
  useEffect(() => {
    let live = true;
    const from = status.previous ? placeOf(status.previous) : null;
    const to = status.next ? placeOf(status.next) : null;
    if (!from || !to || status.minutesSincePrevious === null) {
      setTransit(null);
      return;
    }
    transitBetween(from, to, status.minutesSincePrevious).then((found) => {
      if (live) setTransit(found);
    });
    return () => {
      live = false;
    };
  }, [status.previous, status.next, status.minutesSincePrevious]);

  const coordsOf = new Map<string, { lat: number; lon: number }>();
  for (const b of buildings) {
    if (b.lat !== null && b.lon !== null)
      coordsOf.set(b.label, { lat: b.lat, lon: b.lon });
  }

  // ── Right now ────────────────────────────────────────────────────────────

  const today = new Date().getDay();
  const lines: string[] = [`# ${name}`];

  let pin: { label: string; lat: number; lon: number } | null = null;

  const engineClass = here?.inClass;
  if (status.state === "in-class" && status.current) {
    const place = placeOf(status.current) ?? "somewhere unlisted";
    lines.push(
      `## 🎯 In class now`,
      "",
      `**${place}** — ${status.current.title}`,
      "",
      status.minutesAway !== null
        ? `Out in **${describeGap(status.minutesAway)}**${
            status.next
              ? `, then ${placeOf(status.next) ?? "an unlisted room"} at ${clock(status.next.startTime)}`
              : " with nothing after it today"
          }.`
        : "",
    );
    const label = status.current.building ?? place;
    const at = coordsOf.get(label);
    if (at) pin = { label, ...at };
  } else if (transit?.enRoute) {
    lines.push(
      `## 🚶 Walking, right now`,
      "",
      `**${transit.from} → ${transit.to}**`,
      "",
      transit.near
        ? `About **${transit.near.label}** at the moment — roughly ${Math.round(transit.progress * 100)}% of the way, arriving in ${describeGap(transit.minutesOut)}.`
        : `Roughly ${Math.round(transit.progress * 100)}% of the way, arriving in ${describeGap(transit.minutesOut)}.`,
      "",
      `> Dead reckoning: assumes they left the moment class ended and walk straight there at 1.35 m/s. Nobody does exactly that.`,
    );
    const at = transit.near ? coordsOf.get(transit.near.label) : undefined;
    if (at && transit.near) pin = { label: transit.near.label, ...at };
  } else if (engineClass) {
    const place = [engineClass.building, engineClass.room]
      .filter(Boolean)
      .join(" ");
    lines.push(
      `## 🎯 In class now`,
      "",
      `**${place}** — ${engineClass.title ?? engineClass.section}`,
      "",
      `Out at ${clock(engineClass.endsAt)}.`,
      "",
      `> From the booklist harvest rather than the registrar directly.`,
    );
    if (engineClass.building) {
      const at = coordsOf.get(engineClass.building);
      if (at) pin = { label: engineClass.building, ...at };
    }
  } else if (status.state === "free" && status.next) {
    lines.push(
      `## ☕️ Between things`,
      "",
      `Next up **${placeOf(status.next) ?? "an unlisted room"}** at ${clock(status.next.startTime)}${
        status.minutesAway !== null
          ? ` — ${describeGap(status.minutesAway)} from now`
          : ""
      }.`,
      "",
      status.previous
        ? `Last seen leaving ${placeOf(status.previous) ?? "an unlisted room"} at ${clock(status.previous.endTime)}.`
        : "Nothing scheduled before it today.",
    );
    const label = status.next.building;
    const at = label ? coordsOf.get(label) : undefined;
    if (at && label) pin = { label, ...at };
  } else {
    const fallback = here?.location;
    lines.push(
      `## 🌙 Nothing scheduled right now`,
      "",
      fallback
        ? `Best guess is where the directory lists them: **${fallback.label}${fallback.room ? ` ${fallback.room}` : ""}**.`
        : items.length
          ? "Nothing on their timetable for this moment."
          : "No timetable for them at all — the booklist harvest has not reached them yet.",
    );
    if (fallback?.lat != null && fallback?.lon != null) {
      pin = { label: fallback.label, lat: fallback.lat, lon: fallback.lon };
    }
  }

  // ── The rest of today ────────────────────────────────────────────────────

  const todayName = DAY_NAMES[today];
  const remaining = items
    .filter((item) => item.day === todayName)
    .filter((item) => {
      const now = new Date();
      const [h, m] = item.startTime.split(":").map(Number);
      return h * 60 + m > now.getHours() * 60 + now.getMinutes();
    })
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  if (remaining.length) {
    lines.push("", "## Rest of today", "");
    for (const item of remaining) {
      lines.push(
        `- **${clock(item.startTime)}–${clock(item.endTime)}** · ${placeOf(item) ?? "room unlisted"} · ${item.title}`,
      );
    }
  }

  // ── Where to wait ────────────────────────────────────────────────────────

  // Today is read as "what is coming", so it goes in clock order. The other
  // days are read as "what is this person like", so those lead with the most
  // predictable walk instead.
  const todayWalks = (pattern?.days.find((d) => d.day === today)?.transitions ??
    [])
    .slice()
    .sort((a, b) => a.fromEnd.localeCompare(b.fromEnd));

  if (todayWalks.length) {
    lines.push(
      "",
      `## Chokepoints today`,
      "",
      "| Walks out of | At | Heading for | Walk | Then |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const t of todayWalks) {
      const c = straightness(t);
      lines.push(
        `| **${t.from}** | **${clock(t.fromEnd)}** | ${t.to} | ${Math.round(t.walkMinutes)} min | ${c.emoji} ${c.label} |`,
      );
    }
    lines.push(
      "",
      "> The door and the time come straight from the timetable — that part is as good as the registrar. The last column is only how likely they are to go *straight* to the next room rather than stopping somewhere first.",
    );
  }

  const otherDays = (pattern?.days ?? [])
    .filter((d) => d.day !== today && d.transitions.length)
    .sort((a, b) => a.day - b.day);

  if (otherDays.length) {
    lines.push("", "## The rest of the week", "");
    for (const day of otherDays) {
      const best = [...day.transitions].sort(sortTransitions)[0];
      const c = straightness(best);
      lines.push(
        `- **${day.label}** · ${c.emoji} ${clock(best.fromEnd)} ${best.from} → ${best.to} (${day.transitions.length} walk${day.transitions.length === 1 ? "" : "s"}, ${day.metres} m total)`,
      );
    }
  }

  if (pattern?.impossibleTransitions.length) {
    lines.push(
      "",
      "## Always rushing",
      "",
      "The timetable does not leave enough time for these, so they are late or running:",
      "",
    );
    for (const t of pattern.impossibleTransitions) {
      lines.push(
        `- **${DAY_NAMES[t.day]} ${clock(t.fromEnd)}** ${t.from} → ${t.to} — needs ${Math.round(t.walkMinutes)} min, has ${t.gapMinutes}.`,
      );
    }
  }

  // ── Provenance, always last ──────────────────────────────────────────────

  if (!pattern && !isLoading) {
    // Dual-enrolment students take Cedarville courses from their own high
    // schools and never buy from the campus store, so there is nothing to
    // infer a timetable from and never will be. Every other student type is
    // harvested at 100%, which makes a blank pattern for one of them a real
    // oddity rather than the expected state -- worth saying differently.
    const dualEnrolled =
      person.StudentType === "DE" || person.StudentClass === "HS";
    lines.push(
      "",
      "---",
      "",
      dualEnrolled
        ? "*No movement pattern, and none is coming: they are dual-enrolment, taking Cedarville courses from their high school. Dual-enrolment students never buy from the campus store, which is the only source for a timetable here.*"
        : "*No movement pattern: no booklist names any section for them this term. Either they bought no books, or their sections had none assigned — not that they have no classes.*",
    );
  }

  const markdown = lines.join("\n");

  const bestPin = pin;
  const roommateNames = (mates?.roommates ?? [])
    .map((r) => `${r.nickname ?? r.firstName ?? ""} ${r.lastName ?? ""}`.trim())
    .filter(Boolean);

  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={`Dossier — ${name}`}
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.TagList title="Status">
            <Detail.Metadata.TagList.Item
              text={
                status.state === "in-class"
                  ? "In class"
                  : transit?.enRoute
                    ? "Walking"
                    : (here?.status ?? "Unknown")
              }
              color={
                status.state === "in-class"
                  ? Color.Red
                  : transit?.enRoute
                    ? Color.Orange
                    : Color.SecondaryText
              }
            />
          </Detail.Metadata.TagList>
          {bestPin && (
            <Detail.Metadata.Link
              title="Best guess"
              text={bestPin.label}
              target={mapUrl(bestPin.label, bestPin.lat, bestPin.lon)}
            />
          )}
          <Detail.Metadata.Separator />
          {mates?.dormName && (
            <Detail.Metadata.Label
              title="Lives"
              text={`${mates.dormName}${mates.dormRoom ? ` ${mates.dormRoom}` : ""}`}
              icon={Icon.House}
            />
          )}
          {roommateNames.length > 0 && (
            <Detail.Metadata.Label
              title={roommateNames.length === 1 ? "Roommate" : "Roommates"}
              text={roommateNames.join(", ")}
              icon={Icon.TwoPeople}
            />
          )}
          {(person.AddressCity || person.AddressState) && (
            <Detail.Metadata.Label
              title="From"
              text={[person.AddressCity, person.AddressState]
                .filter(Boolean)
                .join(", ")}
              icon={Icon.Pin}
            />
          )}
          {carpool?.geocoded && carpool.matches.length > 0 && (
            <Detail.Metadata.Label
              title="Neighbours at Cedarville"
              text={`${carpool.matches.length} within ${carpool.radiusMiles} mi of home`}
              icon={Icon.Car}
            />
          )}
          {major?.guesses.length ? (
            <Detail.Metadata.TagList title="Probably studying">
              <Detail.Metadata.TagList.Item
                text={major.guesses[0].title}
                color={major.signal >= 4 ? Color.Blue : Color.SecondaryText}
              />
            </Detail.Metadata.TagList>
          ) : null}
          {major?.guesses.length ? (
            <Detail.Metadata.Label
              title="Guess rests on"
              text={
                `${major.signal} harvested course${major.signal === 1 ? "" : "s"}` +
                (major.school
                  ? ` · ${major.school.agreement}/${major.school.of} point at ${major.school.name}`
                  : "")
              }
              icon={Icon.QuestionMark}
            />
          ) : null}
          <Detail.Metadata.Separator />
          {pattern && (
            <Detail.Metadata.Label
              title="Walks per week"
              text={`${pattern.weeklyMetres.toLocaleString()} m`}
              icon={Icon.Footprints}
            />
          )}
          {here?.harvestedAt && (
            <Detail.Metadata.Label
              title="Timetable harvested"
              text={new Date(here.harvestedAt).toLocaleString()}
              icon={Icon.Clock}
            />
          )}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          {bestPin && (
            <Action.OpenInBrowser
              title="Show Best Guess on Map"
              icon={Icon.Map}
              url={mapUrl(bestPin.label, bestPin.lat, bestPin.lon)}
            />
          )}
          {bestPin && (
            <Action.OpenInBrowser
              title="Walking Directions"
              icon={Icon.Footprints}
              shortcut={{ modifiers: ["cmd"], key: "d" }}
              url={walkUrl(bestPin.lat, bestPin.lon)}
            />
          )}
          <Action.Push
            title="Who They're Usually With"
            icon={Icon.TwoPeople}
            shortcut={{ modifiers: ["cmd"], key: "t" }}
            target={<Classmates personId={person.Id} personName={name} />}
          />
          <Action.Push
            title="Crossing Paths With…"
            icon={Icon.Compass}
            shortcut={{ modifiers: ["cmd"], key: "x" }}
            target={<CrossingsWith personId={person.Id} personName={name} />}
          />
          <Action.CopyToClipboard
            title="Copy Dossier"
            icon={Icon.Clipboard}
            content={markdown}
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          />
          <Action
            title="Open Extension Preferences"
            icon={Icon.Gear}
            shortcut={{ modifiers: ["cmd"], key: "," }}
            onAction={openExtensionPreferences}
          />
        </ActionPanel>
      }
    />
  );
}

/**
 * A dossier for someone we only have an id and a name for.
 *
 * Classmate lists, roommate lists and carpool matches all hand back ids. The
 * engine keeps its own copy of the directory, so following one of those names
 * does not need a Self-Service round trip -- which is what makes tapping a
 * name feel like opening a person rather than like starting a new search.
 */
export function DossierById({
  personId,
  personName,
}: {
  personId: string;
  personName: string;
}) {
  const [person, setPerson] = useState<DirectoryPerson | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    personById(personId)
      .then((found) => {
        if (!live) return;
        if (found) setPerson(found);
        else setMissing(true);
      })
      .catch(() => {
        if (live) setMissing(true);
      });
    return () => {
      live = false;
    };
  }, [personId]);

  if (person) return <Dossier person={person} name={personName} />;

  return (
    <Detail
      isLoading={!missing}
      navigationTitle={personName}
      markdown={
        missing
          ? `# ${personName}\n\ncedarstalk has no directory record for id \`${personId}\`.\n\nThat usually means the person left after the roster that named them was harvested.`
          : `# ${personName}\n\nLooking them up…`
      }
    />
  );
}
