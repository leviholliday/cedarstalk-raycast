import {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  openExtensionPreferences,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { EngineUnavailable, type PressureRow, pressureBoard } from "./engine";

/**
 * Which sections are filling, and how fast.
 *
 * The engine snapshots seat counts every time it collects the catalog, so a
 * fill rate is a real measurement rather than a projection -- but it is only
 * as good as the spacing of those snapshots, and it is measured in seats per
 * hour across the whole gap between two collections. Mid-semester almost
 * nothing moves and this screen is close to empty by design. It earns its
 * keep in the week registration opens, when the difference between "filling
 * at four an hour" and "filling at forty" decides what you get.
 */

/** Sections with one reading cannot show a rate, however dramatic they look. */
const MIN_SNAPSHOTS = 2;

function describeRate(row: PressureRow): string {
  if (row.full) return "full";
  if (row.fillPerHour <= 0) return "not moving";
  if (row.fillPerHour < 1)
    return `${(row.fillPerHour * 24).toFixed(1)} seats/day`;
  return `${row.fillPerHour.toFixed(1)} seats/hour`;
}

function describeEta(row: PressureRow): string | null {
  if (row.full) return null;
  if (row.minutesToFull === null) return null;
  if (row.minutesToFull <= 0) return "full now";
  if (row.minutesToFull < 60) return `full in ~${Math.round(row.minutesToFull)} min`;
  const hours = row.minutesToFull / 60;
  if (hours < 48) return `full in ~${Math.round(hours)}h`;
  return `full in ~${Math.round(hours / 24)}d`;
}

export default function Command() {
  const [rows, setRows] = useState<PressureRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [failure, setFailure] = useState<Error | null>(null);

  useEffect(() => {
    let live = true;
    pressureBoard()
      .then((found) => {
        if (!live) return;
        setRows(found);
        setFailure(null);
      })
      .catch((error) => {
        if (live) setFailure(error as Error);
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  if (failure) {
    return (
      <List isLoading={false}>
        <List.EmptyView
          icon={Icon.Plug}
          title="cedarstalk is not answering"
          description={
            failure instanceof EngineUnavailable
              ? failure.message
              : "Check that it is running and that the token is set."
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

  const measurable = rows.filter((r) => r.snapshots >= MIN_SNAPSHOTS);
  const moving = measurable
    .filter((r) => !r.full && r.fillPerHour > 0)
    .sort((a, b) => b.fillPerHour - a.fillPerHour);
  const full = measurable.filter((r) => r.full);
  const still = measurable.filter((r) => !r.full && r.fillPerHour <= 0);

  const item = (row: PressureRow) => {
    const eta = describeEta(row);
    const accessories: List.Item.Accessory[] = [];
    if (eta) accessories.push({ tag: { value: eta, color: Color.Orange } });
    accessories.push({
      text: `${row.snapshots} readings`,
      tooltip:
        "Seat counts recorded across catalog collections. A rate measured " +
        "from few readings, far apart, is a coarse number.",
    });
    return (
      <List.Item
        key={row.sectionId}
        icon={
          row.full
            ? { source: Icon.XMarkCircle, tintColor: Color.Red }
            : row.fillPerHour > 0
              ? { source: Icon.ArrowUp, tintColor: Color.Orange }
              : Icon.Dot
        }
        title={row.name}
        subtitle={describeRate(row)}
        keywords={[row.code]}
        accessories={accessories}
        actions={
          <ActionPanel>
            <Action.CopyToClipboard title="Copy Section" content={row.name} />
            <Action.OpenInBrowser
              title="Open in Self-Service"
              icon={Icon.Globe}
              url="https://selfservice.cedarville.edu/Student/Courses"
            />
          </ActionPanel>
        }
      />
    );
  };

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Filter by course code or section"
    >
      {!isLoading && measurable.length === 0 ? (
        <List.EmptyView
          icon={Icon.Clock}
          title="Nothing measurable yet"
          description="Seat counts need at least two collections apart in time before a fill rate means anything. The catalog collector runs every 30 minutes."
        />
      ) : null}

      <List.Section
        title="Filling now"
        subtitle={
          moving.length
            ? `${moving.length} sections gaining students`
            : "nothing is moving right now — normal outside registration"
        }
      >
        {moving.map(item)}
      </List.Section>

      <List.Section title="Already full" subtitle={`${full.length} sections`}>
        {full.slice(0, 50).map(item)}
      </List.Section>

      {moving.length === 0 && still.length > 0 ? (
        <List.Section
          title="Holding steady"
          subtitle={`${still.length} tracked, no movement between readings`}
        >
          {still.slice(0, 25).map(item)}
        </List.Section>
      ) : null}
    </List>
  );
}
