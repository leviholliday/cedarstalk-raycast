import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { useEffect, useState } from "react";
import {
  type Crossing,
  type CrossingsResult,
  type DirectoryHit,
  crossingsWith,
  searchPeople,
} from "./engine";

/**
 * Where two people's walks would put them in the same place at once.
 *
 * Deliberately the conservative half of the question. The engine only
 * reports a crossing when both walking windows overlap in clock time *and*
 * the routed paths for each pass through the exact same graph node -- no
 * distance threshold, nothing eyeballed. That means it will miss two people
 * who pass within arm's reach on a wide plaza without the graph happening to
 * route them through a shared point. What it reports, it can prove; what it
 * misses, it says nothing about either way.
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

function clock(time: string): string {
  const parts = time.split(":");
  const h = Number.parseInt(parts[0] ?? "", 10);
  const m = Number.parseInt(parts[1] ?? "", 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function crossingLine(crossing: Crossing, aName: string, bName: string): string {
  return (
    `${aName}: ${crossing.a.from} → ${crossing.a.to}\n` +
    `${bName}: ${crossing.b.from} → ${crossing.b.to}`
  );
}

export function CrossingsWith({
  personId,
  personName,
}: {
  personId: string;
  personName: string;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<DirectoryHit[]>([]);
  const [other, setOther] = useState<{ id: string; name: string } | null>(null);
  const [result, setResult] = useState<CrossingsResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (other || query.trim().length < 2) {
      setFound([]);
      return;
    }
    let live = true;
    searchPeople(query.trim()).then((people) => {
      if (live) setFound(people.filter((p) => p.id !== personId));
    });
    return () => {
      live = false;
    };
  }, [query, other, personId]);

  useEffect(() => {
    if (!other) {
      setResult(null);
      return;
    }
    let live = true;
    setIsLoading(true);
    crossingsWith(personId, other.id)
      .then((found) => {
        if (live) setResult(found);
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [personId, other]);

  if (!other) {
    return (
      <List
        onSearchTextChange={setQuery}
        searchBarPlaceholder={`Who would cross paths with ${personName}?`}
        throttle
      >
        {query.trim().length < 2 ? (
          <List.EmptyView
            icon={Icon.Compass}
            title="Search for someone"
            description="Type a name to check whether their walks and this person's would ever put them in the same place at once."
          />
        ) : !found.length ? (
          <List.EmptyView icon={Icon.MagnifyingGlass} title="No one matches" />
        ) : (
          <List.Section title="Pick someone" subtitle={`${found.length} matches`}>
            {found.map((person) => {
              const name =
                `${person.nickname ?? person.firstName ?? ""} ${person.lastName ?? ""}`.trim() ||
                `#${person.id}`;
              return (
                <List.Item
                  key={person.id}
                  icon={Icon.Person}
                  title={name}
                  subtitle={person.dormName ?? person.department ?? ""}
                  actions={
                    <ActionPanel>
                      <Action
                        title="Check This Person"
                        icon={Icon.Compass}
                        onAction={() => setOther({ id: person.id, name })}
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

  const crossings = result?.crossings ?? [];

  return (
    <List
      isLoading={isLoading}
      navigationTitle={`${personName} × ${other.name}`}
      searchBarPlaceholder="Filter by building"
      isShowingDetail={Boolean(crossings.length)}
    >
      {result && !result.known ? (
        <List.EmptyView
          icon={Icon.QuestionMark}
          title="No timetable for one of them"
          description="Nothing can be checked without a harvested booklist for both people."
          actions={
            <ActionPanel>
              <Action
                title="Pick Someone Else"
                icon={Icon.ArrowLeft}
                onAction={() => setOther(null)}
              />
            </ActionPanel>
          }
        />
      ) : !isLoading && !crossings.length ? (
        <List.EmptyView
          icon={Icon.Checkmark}
          title="No provable crossings this term"
          description="Their walks either never overlap in time, or the routed paths never share a graph node. A real near-miss can still be missed here -- this only reports what the map can prove."
          actions={
            <ActionPanel>
              <Action
                title="Pick Someone Else"
                icon={Icon.ArrowLeft}
                onAction={() => setOther(null)}
              />
            </ActionPanel>
          }
        />
      ) : (
        <List.Section
          title="Crossings"
          subtitle={`${crossings.length} this term`}
        >
          {crossings.map((crossing) => (
            <List.Item
              key={`${crossing.day}-${crossing.overlapStart}-${crossing.a.from}-${crossing.b.from}`}
              icon={{ source: Icon.Compass, tintColor: Color.Orange }}
              title={`${DAY_NAMES[crossing.day]} ${clock(crossing.overlapStart)}–${clock(crossing.overlapEnd)}`}
              subtitle={crossing.near ?? "shared stretch of path"}
              keywords={[
                crossing.a.from,
                crossing.a.to,
                crossing.b.from,
                crossing.b.to,
                crossing.near ?? "",
              ]}
              accessories={[
                { tag: { value: `${crossing.overlapMinutes} min`, color: Color.Orange } },
              ]}
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard
                    title="Copy Details"
                    content={crossingLine(crossing, personName, other.name)}
                  />
                  <Action
                    title="Pick Someone Else"
                    icon={Icon.ArrowLeft}
                    onAction={() => setOther(null)}
                  />
                </ActionPanel>
              }
              detail={
                <List.Item.Detail
                  markdown={[
                    `# ${DAY_NAMES[crossing.day]}, ${clock(crossing.overlapStart)}–${clock(crossing.overlapEnd)}`,
                    "",
                    crossing.near ? `Near **${crossing.near}**` : "No single named building at the shared point.",
                    "",
                    `**${personName}**: ${crossing.a.from} → ${crossing.a.to} (${crossing.a.windowStart}–${crossing.a.windowEnd})`,
                    "",
                    `**${other.name}**: ${crossing.b.from} → ${crossing.b.to} (${crossing.b.windowStart}–${crossing.b.windowEnd})`,
                  ].join("\n")}
                />
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
