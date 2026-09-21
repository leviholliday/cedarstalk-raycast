import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { useEffect, useState } from "react";
import { DossierById } from "./dossier";
import { type DormRoom, type DormRow, dormList, dormRooms } from "./engine";

/**
 * Who lives where, hall by hall and room by room.
 *
 * Straight from the directory's own dorm fields, so unlike most of this
 * extension there is no inference involved -- if the directory lists someone
 * against a room, that is what it says. People who simply have no dorm on
 * record are absent rather than misplaced.
 */

/** "312" -> floor 3. Rooms that do not look numeric get their own group. */
function floorOf(room: string): string {
  const digits = room.match(/^(\d)/);
  return digits ? `Floor ${digits[1]}` : "Other";
}

function Rooms({ dorm }: { dorm: DormRow }) {
  const [rooms, setRooms] = useState<DormRoom[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let live = true;
    dormRooms(dorm.key)
      .then((found) => {
        if (live) setRooms(found);
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [dorm.key]);

  const byFloor = new Map<string, DormRoom[]>();
  for (const room of rooms) {
    const key = floorOf(room.room);
    byFloor.set(key, [...(byFloor.get(key) ?? []), room]);
  }
  const floors = [...byFloor.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <List
      isLoading={isLoading}
      navigationTitle={`${dorm.key} — ${dorm.n}`}
      searchBarPlaceholder="Filter by name, room or hometown"
    >
      {!isLoading && !rooms.length ? (
        <List.EmptyView
          icon={Icon.House}
          title="No rooms listed for this hall"
          description="The directory has nobody on record against a room here."
        />
      ) : (
        floors.map(([floor, group]) => (
          <List.Section key={floor} title={floor} subtitle={`${group.length} rooms`}>
            {group
              .slice()
              .sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }))
              .map((room) =>
                room.occupants.map((person) => {
                  const name =
                    `${person.nickname ?? person.firstName ?? ""} ${person.lastName ?? ""}`.trim() ||
                    `#${person.id}`;
                  const home = [person.city, person.state].filter(Boolean).join(", ");
                  return (
                    <List.Item
                      key={`${room.room}-${person.id}`}
                      icon={Icon.Person}
                      title={name}
                      subtitle={`${room.room}${home ? ` · ${home}` : ""}`}
                      keywords={[room.room, person.city ?? "", person.state ?? ""]}
                      accessories={
                        person.studentClass
                          ? [
                              {
                                tag: {
                                  value: person.studentClass,
                                  color: Color.SecondaryText,
                                },
                              },
                            ]
                          : []
                      }
                      actions={
                        <ActionPanel>
                          <Action.Push
                            title="Open Their Dossier"
                            icon={Icon.BullsEye}
                            target={<DossierById personId={person.id} personName={name} />}
                          />
                          <Action.CopyToClipboard title="Copy Name" content={name} />
                          <Action.CopyToClipboard
                            title="Copy Room"
                            content={`${dorm.key} ${room.room}`}
                          />
                        </ActionPanel>
                      }
                    />
                  );
                }),
              )}
          </List.Section>
        ))
      )}
    </List>
  );
}

export default function Command() {
  const [dorms, setDorms] = useState<DormRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let live = true;
    dormList()
      .then((found) => {
        if (live) setDorms(found);
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const biggest = dorms[0]?.n ?? 0;

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search a hall">
      <List.Section title="Halls" subtitle={`${dorms.length}`}>
        {dorms.map((dorm) => (
          <List.Item
            key={dorm.key}
            icon={Icon.House}
            title={dorm.key}
            accessories={[
              { text: "█".repeat(Math.max(1, Math.round((dorm.n / (biggest || 1)) * 10))) },
              { tag: { value: `${dorm.n}`, color: Color.SecondaryText } },
            ]}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Who Lives Here"
                  icon={Icon.PersonLines}
                  target={<Rooms dorm={dorm} />}
                />
                <Action.CopyToClipboard title="Copy Hall" content={dorm.key} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
