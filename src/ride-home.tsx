import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { useEffect, useState } from "react";
import { DossierById } from "./dossier";
import { type CarpoolResult, carpoolFor } from "./engine";

/**
 * Everyone at Cedarville whose hometown is near this person's.
 *
 * Useful about three times a year and very useful on those three occasions.
 * The distance is straight-line between two geocoded towns, not a drive: it
 * answers "roughly on the way" rather than "how long is the detour", and two
 * towns 30 miles apart across a lake are not 30 minutes apart.
 *
 * It rests on the directory's home city, which some people leave blank and
 * others fill in with something the geocoder cannot place. When that happens
 * the view says so instead of showing an empty list that looks like nobody
 * lives near them.
 */

const RADII = [25, 40, 75, 150] as const;
type Radius = (typeof RADII)[number];

export function RideHome({
  personId,
  personName,
}: {
  personId: string;
  personName: string;
}) {
  const [result, setResult] = useState<CarpoolResult | null>(null);
  const [radius, setRadius] = useState<Radius>(40);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setIsLoading(true);
    carpoolFor(personId, radius)
      .then((found) => {
        if (live) setResult(found);
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [personId, radius]);

  const home = [result?.home?.city, result?.home?.state]
    .filter(Boolean)
    .join(", ");

  const dropdown = (
    <List.Dropdown
      tooltip="How far counts as near"
      value={String(radius)}
      onChange={(value) => setRadius(Number(value) as Radius)}
    >
      {RADII.map((r) => (
        <List.Dropdown.Item key={r} title={`Within ${r} mi`} value={String(r)} />
      ))}
    </List.Dropdown>
  );

  if (!isLoading && result && !result.geocoded) {
    return (
      <List isLoading={false} navigationTitle={`Rides — ${personName}`}>
        <List.EmptyView
          icon={Icon.Pin}
          title="Their hometown could not be placed"
          description={
            home
              ? `The directory says "${home}", which the geocoder could not match to a real town. Nothing can be measured from it, so no list is better than a wrong one.`
              : "The directory has no home city for them at all."
          }
        />
      </List>
    );
  }

  const matches = result?.matches ?? [];

  return (
    <List
      isLoading={isLoading}
      navigationTitle={`Rides — ${personName}`}
      searchBarPlaceholder="Filter by name or town"
      searchBarAccessory={dropdown}
    >
      {!isLoading && matches.length === 0 ? (
        <List.EmptyView
          icon={Icon.Car}
          title={`Nobody within ${radius} miles of ${home || "their hometown"}`}
          description="Try a wider radius — plenty of people drive further than that to share a trip."
        />
      ) : (
        <List.Section
          title={home ? `Near ${home}` : "Nearby"}
          subtitle={`${matches.length} within ${radius} mi · straight-line, not driving`}
        >
          {matches.map((match) => {
            const town = [match.city, match.state].filter(Boolean).join(", ");
            return (
              <List.Item
                key={match.id}
                icon={{
                  source: Icon.Car,
                  tintColor:
                    match.distanceMiles <= 15 ? Color.Green : Color.SecondaryText,
                }}
                title={match.name ?? `#${match.id}`}
                subtitle={town}
                keywords={[match.city ?? "", match.state ?? ""]}
                accessories={[
                  {
                    tag: {
                      value: `${Math.round(match.distanceMiles)} mi`,
                      color:
                        match.distanceMiles <= 15
                          ? Color.Green
                          : Color.SecondaryText,
                    },
                  },
                ]}
                actions={
                  <ActionPanel>
                    <Action.Push
                      title="Open Their Dossier"
                      icon={Icon.BullsEye}
                      target={
                        <DossierById
                          personId={match.id}
                          personName={match.name ?? `#${match.id}`}
                        />
                      }
                    />
                    <Action.CopyToClipboard
                      title="Copy Name"
                      content={match.name ?? match.id}
                    />
                    <Action.OpenInBrowser
                      title="Open Info Page"
                      icon={Icon.Globe}
                      url={`https://selfservice.cedarville.edu/Cedarinfo/Info?id=${match.id}`}
                    />
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      )}
    </List>
  );
}
