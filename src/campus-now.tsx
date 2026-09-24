import {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  openExtensionPreferences,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { BuildingNow } from "./building-now";
import {
  type OccupancyBy,
  type OccupiedBuilding,
  campusOccupancy,
} from "./engine";
import { mapUrl, walkUrl } from "./spots";

/**
 * Where campus is, right now.
 *
 * Every person the engine can place, placed: in the room their timetable puts
 * them in during class, and in their dorm or office otherwise. So at 2pm this
 * is a map of classes and at 2am it is a map of beds, and both are true in
 * the same limited sense -- it is where people are *scheduled* to be, not a
 * headcount. Nobody is counted twice, and anyone the harvest has not reached
 * is not counted at all, which makes every number here a floor.
 */

const BY_OPTIONS: { value: OccupancyBy; title: string }[] = [
  { value: "class", title: "By year" },
  { value: "type", title: "By student type" },
  { value: "department", title: "By department" },
];

/** A crude bar, because a number alone does not show how lopsided campus is. */
function bar(count: number, max: number): string {
  if (max <= 0) return "";
  const width = Math.max(1, Math.round((count / max) * 12));
  return "█".repeat(width);
}

function summarise(breakdown: Record<string, number>, limit = 4): string {
  return Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, n]) => `${key} ${n}`)
    .join(" · ");
}

export default function Command() {
  const [buildings, setBuildings] = useState<OccupiedBuilding[]>([]);
  const [by, setBy] = useState<OccupancyBy>("class");
  const [isLoading, setIsLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setIsLoading(true);
    campusOccupancy(by)
      .then((found) => {
        if (!live) return;
        setBuildings(found);
        setFailed(found.length === 0);
      })
      .catch(() => {
        if (live) setFailed(true);
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [by]);

  const sorted = [...buildings].sort((a, b) => b.people - a.people);
  const busiest = sorted[0]?.people ?? 0;
  const total = sorted.reduce((sum, b) => sum + b.people, 0);

  // Somewhere with residents in it is a hall; somewhere with none is a place
  // people are only ever passing through. They answer different questions.
  const halls = sorted.filter((b) => b.residents > 0);
  const elsewhere = sorted.filter((b) => b.residents === 0 && b.people > 0);
  const empty = sorted.filter((b) => b.people === 0);

  if (failed && !isLoading) {
    return (
      <List isLoading={false}>
        <List.EmptyView
          icon={Icon.Plug}
          title="cedarstalk has nothing to place"
          description="Either it is not running, or no schedules have been harvested yet."
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

  const item = (building: OccupiedBuilding) => {
    const here =
      building.lat !== null && building.lon !== null
        ? { lat: building.lat, lon: building.lon }
        : null;
    const share = total ? Math.round((building.people / total) * 100) : 0;

    return (
      <List.Item
        key={building.label}
        icon={{
          source: building.residents > 0 ? Icon.House : Icon.Building,
          tintColor:
            building.people >= busiest * 0.6
              ? Color.Red
              : building.people >= busiest * 0.25
                ? Color.Orange
                : Color.SecondaryText,
        }}
        title={building.label}
        subtitle={summarise(building.breakdown)}
        keywords={Object.keys(building.breakdown)}
        accessories={[
          { text: bar(building.people, busiest) },
          {
            tag: {
              value: `${building.people}`,
              color:
                building.people >= busiest * 0.6 ? Color.Red : Color.SecondaryText,
            },
            tooltip:
              `${building.people} people — ${share}% of everyone placed right now\n` +
              `${building.residents} living here, ${building.workers} working here\n\n` +
              "Scheduled positions, not a headcount. Unharvested people are not counted.",
          },
        ]}
        actions={
          <ActionPanel>
            <Action.Push
              title="Who's in There Now"
              icon={Icon.PersonLines}
              target={<BuildingNow building={building.label} />}
            />
            {here && (
              <Action.OpenInBrowser
                title="Show on Map"
                icon={Icon.Map}
                url={mapUrl(building.label, here.lat, here.lon)}
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
            <Action.CopyToClipboard
              title="Copy Building"
              content={building.label}
            />
          </ActionPanel>
        }
      />
    );
  };

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Filter by building"
      searchBarAccessory={
        <List.Dropdown
          tooltip="Break the numbers down by"
          value={by}
          onChange={(value) => setBy(value as OccupancyBy)}
        >
          {BY_OPTIONS.map((option) => (
            <List.Dropdown.Item
              key={option.value}
              title={option.title}
              value={option.value}
            />
          ))}
        </List.Dropdown>
      }
    >
      <List.Section
        title="Halls"
        subtitle={
          total
            ? `${total.toLocaleString()} people placed — scheduled positions, not a headcount`
            : undefined
        }
      >
        {halls.map(item)}
      </List.Section>

      <List.Section title="Everywhere else" subtitle={`${elsewhere.length}`}>
        {elsewhere.map(item)}
      </List.Section>

      {empty.length > 0 ? (
        <List.Section
          title="Nobody scheduled"
          subtitle={`${empty.length} buildings`}
        >
          {empty.map(item)}
        </List.Section>
      ) : null}
    </List>
  );
}
