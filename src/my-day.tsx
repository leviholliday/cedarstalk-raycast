import {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  getPreferenceValues,
  openExtensionPreferences,
} from "@raycast/api";
import { useEffect, useState } from "react";
import type { ScheduleItem } from "./api";
import {
  type QuietRoom,
  type Transit,
  engineSchedule,
  quietRooms,
  transitBetween,
  walkMinutesBetween,
} from "./engine";
import { describeGap, placeOf, statusNow } from "./now";
import { LIBCAL_URL, RESERVE_URL } from "./spots";

/**
 * The one screen worth opening every morning.
 *
 * Nothing here is new — it is the status logic, the walking router and the
 * quiet-room ranking that already existed, pointed at yourself and arranged in
 * the order the day actually happens. The part that earns the command is the
 * gap: knowing you have 190 free minutes is mildly useful, and knowing which
 * quiet room is two minutes from where you have to be next is what you would
 * otherwise work out by hand every time.
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

/** Long enough that walking somewhere to sit down is worth it. */
const GAP_WORTH_FILLING = 30;

function clock(time: string): string {
  const parts = time.split(":");
  const h = Number.parseInt(parts[0] ?? "", 10);
  const m = Number.parseInt(parts[1] ?? "", 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export default function Command() {
  const { myPersonId } = getPreferenceValues<{ myPersonId?: string }>();
  const personId = myPersonId?.trim();

  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [transit, setTransit] = useState<Transit | null>(null);
  const [rooms, setRooms] = useState<QuietRoom[]>([]);
  const [walk, setWalk] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(personId));
  const [failed, setFailed] = useState(false);
  const [, setTick] = useState(0);

  // "out in 12 min" is wrong within the minute.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!personId) return;
    let live = true;
    engineSchedule(personId)
      .then((result) => {
        if (!live) return;
        if (result) setItems(result.items);
        else setFailed(true);
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [personId]);

  const status = statusNow(items);
  const nextPlace = status.next ? placeOf(status.next) : null;
  const nextBuilding = status.next?.building ?? null;

  // Mid-walk, if the last class has let out and another is coming.
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

  // Somewhere to sit in the gap, chosen near where you have to be *next*
  // rather than where you are — walking away from your next class to find
  // quiet is how you end up late to it.
  const gap = status.state === "free" ? status.minutesAway : null;
  useEffect(() => {
    let live = true;
    if (gap === null || gap < GAP_WORTH_FILLING) {
      setRooms([]);
      return;
    }
    quietRooms({
      horizonMinutes: Math.min(gap, 180),
      near: nextBuilding ?? undefined,
    })
      .then((found) => {
        if (live) setRooms(found.filter((r) => r.gem).slice(0, 5));
      })
      .catch(() => {
        if (live) setRooms([]);
      });
    return () => {
      live = false;
    };
  }, [gap, nextBuilding]);

  // How long the walk to the next class takes from where you are now.
  useEffect(() => {
    let live = true;
    const here =
      status.current?.building ?? status.previous?.building ?? null;
    if (!here || !nextBuilding) {
      setWalk(null);
      return;
    }
    walkMinutesBetween(here, nextBuilding).then((minutes) => {
      if (live) setWalk(minutes);
    });
    return () => {
      live = false;
    };
  }, [status.current, status.previous, nextBuilding]);

  if (!personId) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Person}
          title="Tell the extension who you are"
          description={
            "My Day needs your own directory id. Find it in Search Cedarville Directory — " +
            "open yourself and use Copy ID — then paste it into the extension preferences."
          }
          actions={
            <ActionPanel>
              <Action
                title="Open Extension Preferences"
                icon={Icon.Gear}
                onAction={openExtensionPreferences}
              />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  if (failed && !isLoading) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Calendar}
          title="No timetable for that id"
          description="cedarstalk has no harvested booklist for it this term. Check the id in preferences, or that the engine is running."
          actions={
            <ActionPanel>
              <Action
                title="Open Extension Preferences"
                icon={Icon.Gear}
                onAction={openExtensionPreferences}
              />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  const today = DAY_NAMES[new Date().getDay()];
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const rest = items
    .filter((item) => item.day === today)
    .filter((item) => {
      const parts = item.startTime.split(":");
      return (
        Number.parseInt(parts[0] ?? "0", 10) * 60 +
          Number.parseInt(parts[1] ?? "0", 10) >
        nowMinutes
      );
    })
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  // ── Now ──────────────────────────────────────────────────────────────────

  const nowRow = () => {
    if (status.state === "in-class" && status.current) {
      return (
        <List.Item
          icon={{ source: Icon.Clock, tintColor: Color.Red }}
          title={placeOf(status.current) ?? "In class"}
          subtitle={status.current.title}
          accessories={[
            {
              tag: {
                value:
                  status.minutesAway !== null
                    ? `out in ${describeGap(status.minutesAway)}`
                    : "in class",
                color: Color.Red,
              },
            },
          ]}
        />
      );
    }
    if (transit?.enRoute) {
      return (
        <List.Item
          icon={{ source: Icon.Footprints, tintColor: Color.Orange }}
          title={`${transit.from} → ${transit.to}`}
          subtitle={
            transit.near
              ? `about ${transit.near.label} — dead reckoning, not a fix`
              : "walking"
          }
          accessories={[
            { tag: { value: `${describeGap(transit.minutesOut)} to go`, color: Color.Orange } },
          ]}
        />
      );
    }
    return (
      <List.Item
        icon={{ source: Icon.Checkmark, tintColor: Color.Green }}
        title="Free right now"
        subtitle={
          status.next
            ? `until ${clock(status.next.startTime)}`
            : items.length
              ? "nothing else scheduled today"
              : "no classes on record"
        }
        accessories={
          gap !== null ? [{ tag: { value: describeGap(gap), color: Color.Green } }] : []
        }
      />
    );
  };

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter your day">
      <List.Section title="Now">{nowRow()}</List.Section>

      {status.next ? (
        <List.Section title="Next">
          <List.Item
            icon={Icon.ArrowRight}
            title={nextPlace ?? "Room unlisted"}
            subtitle={`${status.next.title} · ${clock(status.next.startTime)}`}
            accessories={[
              ...(walk !== null && walk > 0
                ? [{ tag: { value: `${Math.round(walk)} min walk`, color: Color.Blue } }]
                : []),
              ...(status.minutesAway !== null
                ? [{ text: `in ${describeGap(status.minutesAway)}` }]
                : []),
            ]}
          />
        </List.Section>
      ) : null}

      {rooms.length ? (
        <List.Section
          title="Somewhere to sit in this gap"
          subtitle={
            nextBuilding
              ? `quietest rooms near ${nextBuilding}, where you need to be next`
              : "quietest rooms free right now"
          }
        >
          {rooms.map((room) => (
            <List.Item
              key={`${room.building}/${room.room}`}
              icon={{ source: Icon.Moon, tintColor: Color.Green }}
              title={`${room.building} ${room.room}`}
              subtitle={
                room.minutes !== null && room.minutes !== undefined
                  ? `${Math.max(1, Math.round(room.minutes))} min away`
                  : undefined
              }
              accessories={[{ tag: { value: `quiet ${room.quiet}`, color: Color.Green } }]}
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard
                    title="Copy Room"
                    content={`${room.building} ${room.room}`}
                  />
                  <Action.OpenInBrowser
                    title="Book a Library Room Instead"
                    icon={Icon.Calendar}
                    url={LIBCAL_URL}
                  />
                  <Action.OpenInBrowser
                    title="Reserve a Room (mycu)"
                    icon={Icon.Calendar}
                    url={RESERVE_URL}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ) : null}

      {rest.length ? (
        <List.Section title="Rest of today" subtitle={`${rest.length} to go`}>
          {rest.map((item) => (
            <List.Item
              key={`${item.title}-${item.startTime}`}
              icon={Icon.Dot}
              title={`${clock(item.startTime)} – ${clock(item.endTime)}`}
              subtitle={`${placeOf(item) ?? "room unlisted"} · ${item.title}`}
            />
          ))}
        </List.Section>
      ) : null}

      {!isLoading && !rest.length && status.state !== "in-class" ? (
        <List.Section title="Rest of today">
          <List.Item
            icon={Icon.Moon}
            title="Nothing else scheduled"
            subtitle={items.length ? "you're done for the day" : undefined}
          />
        </List.Section>
      ) : null}
    </List>
  );
}
