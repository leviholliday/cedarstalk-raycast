import {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  getPreferenceValues,
  openExtensionPreferences,
  showToast,
  Toast,
} from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import {
  type CampusBuilding,
  EngineUnavailable,
  type QuietRoom,
  campusBuildings,
  quietRooms,
  resolveBuilding,
} from "./engine";
import {
  LIBCAL_URL,
  RESERVE_URL,
  SPOTS,
  type Spot,
  hiddenBuildings,
  mapUrl,
  setHiddenBuildings,
  walkUrl,
} from "./spots";

/**
 * Somewhere to sit and work, right now.
 *
 * Worth being honest about what this list is, because the word "quiet"
 * promises more than the data can give. Nothing on campus counts heads. What
 * the engine has is the registrar's timetable, so a room is "quiet" when
 * little is scheduled in the building around it, nothing is scheduled next
 * door, and few people have to walk past it. Three things follow, and the
 * view says all three rather than implying otherwise: an unscheduled room is
 * not necessarily unlocked, it is not necessarily yours without booking, and
 * the places people actually study are mostly not classrooms at all -- so
 * those are listed separately, from students rather than from the timetable.
 */

const HORIZONS = [30, 60, 120, 180] as const;
type Horizon = (typeof HORIZONS)[number];

const ANYWHERE = "__anywhere__";

function horizonLabel(minutes: Horizon): string {
  return minutes < 60 ? `${minutes} min` : `${minutes / 60}h`;
}

/** Cycles, so the shortcut never dead-ends at the longest option. */
function nextHorizon(current: Horizon): Horizon {
  const at = HORIZONS.indexOf(current);
  return HORIZONS[(at + 1) % HORIZONS.length];
}

/** Minutes as something a person would say out loud. */
function describeFree(minutes: number): string {
  // Past about ten hours nothing else is scheduled in it today at all, and
  // "free for 9h 51m" is a strange way to say "nobody wants this room".
  if (minutes >= 600) return "free rest of day";
  if (minutes < 60) return `free ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `free ${hours}h ${rest}m` : `free ${hours}h`;
}

function describeWalk(room: QuietRoom): string | null {
  if (room.minutes === null || room.minutes === undefined) return null;
  if (room.metres === 0) return "you're here";
  if (room.minutes < 1) return "under a min";
  return `${Math.round(room.minutes)} min walk`;
}

export default function Command() {
  const { homeBuilding } = getPreferenceValues<{ homeBuilding?: string }>();

  const [rooms, setRooms] = useState<QuietRoom[]>([]);
  const [buildings, setBuildings] = useState<CampusBuilding[]>([]);
  const [near, setNear] = useState<string>(ANYWHERE);
  const [horizon, setHorizon] = useState<Horizon>(60);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [failure, setFailure] = useState<EngineUnavailable | null>(null);

  useEffect(() => {
    let live = true;
    hiddenBuildings().then((set) => {
      if (live) setHidden(set);
    });
    return () => {
      live = false;
    };
  }, []);

  // The "Start From" preference is free text, so it has to be reconciled with
  // the real labels once they arrive -- typing "McChesney" should select
  // "McChesney Hall" rather than silently selecting nothing.
  useEffect(() => {
    let live = true;
    campusBuildings().then((found) => {
      if (!live) return;
      setBuildings(found);
      const typed = homeBuilding?.trim();
      if (!typed) return;
      const matched = resolveBuilding(
        typed,
        found.map((b) => b.label),
      );
      if (matched) {
        setNear(matched);
      } else if (found.length) {
        showToast({
          style: Toast.Style.Failure,
          title: `No building matches "${typed}"`,
          message: "Check Start From in the extension preferences.",
        });
      }
    });
    return () => {
      live = false;
    };
  }, [homeBuilding]);

  useEffect(() => {
    let live = true;
    setIsLoading(true);
    quietRooms({
      horizonMinutes: horizon,
      near: near === ANYWHERE ? undefined : near,
    })
      .then((found) => {
        if (!live) return;
        setRooms(found);
        setFailure(null);
      })
      .catch((error) => {
        if (!live) return;
        setRooms([]);
        setFailure(
          error instanceof EngineUnavailable
            ? error
            : new EngineUnavailable(String(error), "http"),
        );
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [near, horizon]);

  const coordsOf = useMemo(() => {
    const map = new Map<string, { lat: number; lon: number }>();
    for (const b of buildings) {
      if (b.lat !== null && b.lon !== null)
        map.set(b.label, { lat: b.lat, lon: b.lon });
    }
    return map;
  }, [buildings]);

  async function hideBuilding(label: string) {
    const next = new Set(hidden);
    next.add(label);
    setHidden(next);
    await setHiddenBuildings(next);
    showToast({
      style: Toast.Style.Success,
      title: `Hiding ${label}`,
      message: "Undo from the Hidden section at the bottom.",
    });
  }

  async function unhideBuilding(label: string) {
    const next = new Set(hidden);
    next.delete(label);
    setHidden(next);
    await setHiddenBuildings(next);
  }

  // The engine hands rooms back quietest-first. Once a starting point is
  // known, that ordering buries the room across the hall under an equally
  // quiet one on the far side of campus, so each group gets re-sorted by how
  // far it actually is to walk.
  const { gems, rest, hiddenCount } = useMemo(() => {
    const known = near !== ANYWHERE;
    const byWalk = (a: QuietRoom, b: QuietRoom) =>
      (a.metres ?? Infinity) - (b.metres ?? Infinity) || a.quiet - b.quiet;
    const visible = rooms.filter((room) => !hidden.has(room.building));
    const quietest = visible.filter((room) => room.gem);
    const others = visible.filter((room) => !room.gem);
    return {
      gems: known ? [...quietest].sort(byWalk) : quietest,
      rest: known ? [...others].sort(byWalk) : others,
      hiddenCount: rooms.length - visible.length,
    };
  }, [rooms, near, hidden]);

  const sharedActions = (
    <>
      <Action
        title={`Need It for ${horizonLabel(nextHorizon(horizon))}`}
        icon={Icon.Clock}
        shortcut={{ modifiers: ["cmd"], key: "]" }}
        onAction={() => setHorizon(nextHorizon(horizon))}
      />
      <Action
        title={
          showHidden
            ? "Stop Showing Hidden Buildings"
            : `Show Hidden Buildings (${hidden.size})`
        }
        icon={showHidden ? Icon.EyeDisabled : Icon.Eye}
        shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
        onAction={() => setShowHidden((on) => !on)}
      />
      <Action
        title="Open Extension Preferences"
        icon={Icon.Gear}
        shortcut={{ modifiers: ["cmd"], key: "," }}
        onAction={openExtensionPreferences}
      />
    </>
  );

  const roomItem = (room: QuietRoom) => {
    const walk = describeWalk(room);
    const here = room.campusLabel ? coordsOf.get(room.campusLabel) : undefined;
    const accessories: List.Item.Accessory[] = [];
    if (walk) accessories.push({ tag: { value: walk, color: Color.Blue } });
    accessories.push({
      tag: {
        value: `quiet ${room.quiet}`,
        color: room.gem ? Color.Green : Color.SecondaryText,
      },
      tooltip:
        `Scheduled in this building: ${room.ambient}\n` +
        `Scheduled next door: ${room.spill}\n` +
        `Foot traffic past the door: ${room.centrality}\n\n` +
        "No class is scheduled here. That is not the same as unlocked or booked.",
    });

    return (
      <List.Item
        key={`${room.building}/${room.room}`}
        icon={
          room.gem ? { source: Icon.Moon, tintColor: Color.Green } : Icon.Dot
        }
        title={`${room.building} ${room.room}`}
        subtitle={describeFree(room.freeMinutes)}
        accessories={accessories}
        actions={
          <ActionPanel>
            {here && (
              <Action.OpenInBrowser
                title="Show on Map"
                icon={Icon.Map}
                url={mapUrl(room.building, here.lat, here.lon)}
              />
            )}
            {here && (
              <Action.OpenInBrowser
                title="Walking Directions"
                icon={Icon.Footprints}
                shortcut={{ modifiers: ["cmd"], key: "d" }}
                url={walkUrl(here.lat, here.lon)}
              />
            )}
            <Action.OpenInBrowser
              title="Reserve a Room (mycu)"
              icon={Icon.Calendar}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
              url={RESERVE_URL}
            />
            <Action.CopyToClipboard
              title="Copy Room"
              content={`${room.building} ${room.room}`}
            />
            <Action
              title={`Hide ${room.building}`}
              icon={Icon.EyeDisabled}
              shortcut={{ modifiers: ["cmd"], key: "h" }}
              onAction={() => hideBuilding(room.building)}
            />
            {sharedActions}
          </ActionPanel>
        }
      />
    );
  };

  const spotItem = (spot: Spot) => {
    const here =
      spot.lat !== undefined && spot.lon !== undefined
        ? { lat: spot.lat, lon: spot.lon }
        : spot.building
          ? coordsOf.get(spot.building)
          : undefined;

    return (
      <List.Item
        key={spot.name}
        icon={{
          source: spot.bookingUrl ? Icon.Calendar : Icon.Star,
          tintColor: Color.Yellow,
        }}
        title={spot.name}
        subtitle={spot.where}
        accessories={[
          spot.bookingUrl
            ? { tag: { value: "bookable", color: Color.Yellow } }
            : { text: "no booking" },
        ]}
        keywords={[spot.where, "study", "spot"]}
        actions={
          <ActionPanel>
            {spot.bookingUrl && (
              <Action.OpenInBrowser
                title="Book It"
                icon={Icon.Calendar}
                url={spot.bookingUrl}
              />
            )}
            {here && (
              <Action.OpenInBrowser
                title="Show on Map"
                icon={Icon.Map}
                url={mapUrl(spot.name, here.lat, here.lon)}
              />
            )}
            {here && (
              <Action.OpenInBrowser
                title="Walking Directions"
                icon={Icon.Footprints}
                shortcut={{ modifiers: ["cmd"], key: "d" }}
                url={walkUrl(here.lat, here.lon)}
              />
            )}
            {sharedActions}
          </ActionPanel>
        }
      />
    );
  };

  if (failure) {
    return (
      <List isLoading={false}>
        <List.EmptyView
          icon={Icon.Plug}
          title={
            failure.kind === "unconfigured"
              ? "cedarengine is not set up"
              : "cedarengine is not answering"
          }
          description={
            failure.kind === "unconfigured"
              ? `${failure.message} Add its URL and token in the extension preferences.`
              : `${failure.message} Start it and try again.`
          }
          actions={
            <ActionPanel>
              <Action
                title="Open Extension Preferences"
                icon={Icon.Gear}
                onAction={openExtensionPreferences}
              />
              <Action.OpenInBrowser
                title="Book a Library Study Room Instead"
                icon={Icon.Calendar}
                url={LIBCAL_URL}
              />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder={`Free for ${horizonLabel(horizon)} — filter by building or room`}
      searchBarAccessory={
        <List.Dropdown tooltip="Walk from" value={near} onChange={setNear}>
          <List.Dropdown.Item title="Anywhere on campus" value={ANYWHERE} />
          <List.Dropdown.Section title="Walk from">
            {buildings.map((b) => (
              <List.Dropdown.Item
                key={b.label}
                title={b.label}
                value={b.label}
              />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      <List.Section
        title="Study Spots"
        subtitle="Named by students, not derived from the timetable"
      >
        {SPOTS.map(spotItem)}
      </List.Section>

      <List.Section
        title="Quietest Empty Classrooms"
        subtitle={
          gems.length
            ? `${gems.length} rooms · unscheduled, which is not the same as unlocked`
            : undefined
        }
      >
        {gems.map(roomItem)}
      </List.Section>

      <List.Section
        title="Also Free"
        subtitle={rest.length ? `${rest.length} rooms` : undefined}
      >
        {rest.map(roomItem)}
      </List.Section>

      {showHidden ? (
        <List.Section
          title="Hidden Buildings"
          subtitle={`${hiddenCount} rooms filtered out`}
        >
          {[...hidden].sort().map((label) => (
            <List.Item
              key={label}
              icon={Icon.EyeDisabled}
              title={label}
              subtitle="Hidden — you said you can't get in here"
              actions={
                <ActionPanel>
                  <Action
                    title={`Show ${label} Again`}
                    icon={Icon.Eye}
                    onAction={() => unhideBuilding(label)}
                  />
                  {sharedActions}
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ) : null}

      {!isLoading && rooms.length === 0 ? (
        <List.EmptyView
          icon={Icon.Calendar}
          title={`Nothing free for a whole ${horizonLabel(horizon)}`}
          description="Every mapped classroom has something scheduled sooner than that."
          actions={
            <ActionPanel>
              <Action
                title={`Try ${horizonLabel(nextHorizon(horizon))} Instead`}
                icon={Icon.Clock}
                onAction={() => setHorizon(nextHorizon(horizon))}
              />
              <Action.OpenInBrowser
                title="Book a Library Study Room"
                icon={Icon.Calendar}
                url={LIBCAL_URL}
              />
            </ActionPanel>
          }
        />
      ) : null}
    </List>
  );
}
