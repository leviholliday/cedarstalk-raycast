import {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  LocalStorage,
  getPreferenceValues,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { type Availability, type DirectoryHit, freeTogether, searchPeople } from "./engine";
import { personIcon, usePersonPhotos } from "./photos";

/**
 * When a group of people are all free at once.
 *
 * The one thing this must never do is treat "we cannot see their timetable" as
 * "they are free". Someone dual-enrolled, or in sections nobody assigned books
 * to, is invisible to the engine — and quietly counting them as available would
 * produce a confident answer that is wrong exactly when somebody is relying on
 * it to arrange a meeting. The engine keeps them in a separate `unknown` list
 * and this view shows that list rather than hiding it.
 */

const PICKED_KEY = "free-together:picked";

const DAYS = [
  { value: 1, title: "Monday" },
  { value: 2, title: "Tuesday" },
  { value: 3, title: "Wednesday" },
  { value: 4, title: "Thursday" },
  { value: 5, title: "Friday" },
  { value: 6, title: "Saturday" },
  { value: 0, title: "Sunday" },
];

interface Picked {
  id: string;
  name: string;
}

function clock(time: string): string {
  const parts = time.split(":");
  const h = Number.parseInt(parts[0] ?? "", 10);
  const m = Number.parseInt(parts[1] ?? "", 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function describe(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export default function Command() {
  const { myPersonId } = getPreferenceValues<{ myPersonId?: string }>();

  const [picked, setPicked] = useState<Picked[]>([]);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<DirectoryHit[]>([]);
  const [day, setDay] = useState(() => {
    const today = new Date().getDay();
    return today === 0 || today === 6 ? 1 : today;
  });
  const [result, setResult] = useState<Availability | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Last group restored, so checking the same study group twice is one keystroke.
  useEffect(() => {
    LocalStorage.getItem<string>(PICKED_KEY).then((raw) => {
      if (!raw) return;
      try {
        setPicked(JSON.parse(raw) as Picked[]);
      } catch {
        // A corrupt value just means starting empty.
      }
    });
  }, []);

  useEffect(() => {
    LocalStorage.setItem(PICKED_KEY, JSON.stringify(picked)).catch(() => {});
  }, [picked]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setFound([]);
      return;
    }
    let live = true;
    searchPeople(query.trim()).then((people) => {
      if (live) setFound(people);
    });
    return () => {
      live = false;
    };
  }, [query]);

  useEffect(() => {
    if (picked.length < 2) {
      setResult(null);
      return;
    }
    let live = true;
    setIsLoading(true);
    freeTogether(
      picked.map((p) => p.id),
      day,
    )
      .then((found) => {
        if (live) setResult(found);
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [picked, day]);

  const toggle = (id: string, name: string) =>
    setPicked((current) =>
      current.some((p) => p.id === id)
        ? current.filter((p) => p.id !== id)
        : [...current, { id, name }],
    );

  const addMe = () => {
    const id = myPersonId?.trim();
    if (id && !picked.some((p) => p.id === id)) {
      setPicked((current) => [...current, { id, name: "Me" }]);
    }
  };

  const photos = usePersonPhotos([...found.map((p) => p.id), ...picked.map((p) => p.id)]);

  const unknownNames = (result?.unknown ?? []).map(
    (id) => picked.find((p) => p.id === id)?.name ?? `#${id}`,
  );

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setQuery}
      searchBarPlaceholder="Search a name to add them to the group"
      navigationTitle={
        picked.length ? `${picked.length} people` : "Free Together"
      }
      throttle
      searchBarAccessory={
        <List.Dropdown
          tooltip="Which day"
          value={String(day)}
          onChange={(value) => setDay(Number(value))}
        >
          {DAYS.map((d) => (
            <List.Dropdown.Item key={d.value} title={d.title} value={String(d.value)} />
          ))}
        </List.Dropdown>
      }
    >
      {found.length ? (
        <List.Section title="Add someone" subtitle={`${found.length} matches`}>
          {found.map((person) => {
            const name =
              `${person.nickname ?? person.firstName ?? ""} ${person.lastName ?? ""}`.trim() ||
              `#${person.id}`;
            const already = picked.some((p) => p.id === person.id);
            return (
              <List.Item
                key={person.id}
                icon={already ? Icon.CheckCircle : personIcon(person.id, photos)}
                title={name}
                subtitle={person.dormName ?? person.department ?? ""}
                accessories={
                  person.studentClass
                    ? [{ tag: { value: person.studentClass, color: Color.SecondaryText } }]
                    : []
                }
                actions={
                  <ActionPanel>
                    <Action
                      title={already ? "Remove from Group" : "Add to Group"}
                      icon={already ? Icon.MinusCircle : Icon.PlusCircle}
                      onAction={() => toggle(person.id, name)}
                    />
                    {myPersonId?.trim() ? (
                      <Action title="Add Me" icon={Icon.Person} onAction={addMe} />
                    ) : null}
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      ) : null}

      {picked.length ? (
        <List.Section title="Group" subtitle={`${picked.length} people`}>
          {picked.map((person) => (
            <List.Item
              key={person.id}
              icon={
                result?.unknown.includes(person.id)
                  ? { source: Icon.QuestionMark, tintColor: Color.Orange }
                  : personIcon(person.id, photos)
              }
              title={person.name}
              subtitle={
                result?.unknown.includes(person.id)
                  ? "no timetable — not counted"
                  : undefined
              }
              actions={
                <ActionPanel>
                  <Action
                    title="Remove from Group"
                    icon={Icon.MinusCircle}
                    onAction={() => toggle(person.id, person.name)}
                  />
                  <Action
                    title="Clear the Group"
                    icon={Icon.Trash}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "x" }}
                    onAction={() => setPicked([])}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ) : null}

      {picked.length < 2 ? (
        <List.EmptyView
          icon={Icon.TwoPeople}
          title="Pick at least two people"
          description="Search a name above and add them. The last group you used comes back next time."
          actions={
            myPersonId?.trim() ? (
              <ActionPanel>
                <Action title="Add Me to the Group" icon={Icon.Person} onAction={addMe} />
              </ActionPanel>
            ) : undefined
          }
        />
      ) : null}

      {result?.windows.length ? (
        <List.Section
          title={`All free — ${DAYS.find((d) => d.value === day)?.title}`}
          subtitle={
            unknownNames.length
              ? `computed from ${result.known.length} of ${picked.length}; ${unknownNames.join(", ")} not counted`
              : `all ${result.known.length} counted`
          }
        >
          {result.windows.map((window) => (
            <List.Item
              key={`${window.start}-${window.end}`}
              icon={{ source: Icon.Checkmark, tintColor: Color.Green }}
              title={`${clock(window.start)} – ${clock(window.end)}`}
              subtitle={
                window.endsBecause.length
                  ? `until ${window.endsBecause
                      .map((c) => `${c.name ?? "someone"}'s ${c.section}`)
                      .join(", ")}`
                  : "to the end of the day"
              }
              accessories={[
                { tag: { value: describe(window.minutes), color: Color.Green } },
              ]}
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard
                    title="Copy the Window"
                    content={`${clock(window.start)}–${clock(window.end)} (${describe(window.minutes)})`}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ) : null}

      {picked.length >= 2 && result && !result.windows.length && !isLoading ? (
        <List.EmptyView
          icon={Icon.Calendar}
          title="No window they all share"
          description={
            unknownNames.length
              ? `Not even counting ${unknownNames.join(", ")}, who have no timetable on record. Try another day.`
              : "Try another day."
          }
        />
      ) : null}
    </List>
  );
}
