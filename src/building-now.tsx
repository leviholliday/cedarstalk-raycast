import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { useEffect, useState } from "react";
import { DossierById } from "./dossier";
import { personIcon, usePersonPhotos } from "./photos";
import { type Presence, type PresentSection, presenceIn } from "./engine";

/**
 * Who is standing in a building right now, section by section.
 *
 * Same honesty as the class roster, for the same reason: a named student is
 * really scheduled there, a missing one is invisible rather than absent. So
 * sections with no reconstructed roster still appear with their real headcount
 * -- dropping them would make a busy building look empty.
 */

function coverageNote(section: PresentSection): {
  text: string;
  color: Color;
} {
  if (section.coverage === null || section.enrolled === null) {
    return { text: "no roster", color: Color.SecondaryText };
  }
  const pct = Math.round(section.coverage * 100);
  if (section.coverage >= 0.99) return { text: "all named", color: Color.Green };
  return {
    text: `${section.students.length}/${section.enrolled}`,
    color: pct >= 90 ? Color.Green : Color.Orange,
  };
}

export function BuildingNow({ building }: { building: string }) {
  const [presence, setPresence] = useState<Presence | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let live = true;
    presenceIn(building)
      .then((found) => {
        if (live) setPresence(found);
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [building]);

  const sections = presence?.sections ?? [];
  const photos = usePersonPhotos(sections.flatMap((s) => s.students.map((st) => st.id)));

  return (
    <List
      isLoading={isLoading}
      navigationTitle={
        presence ? `${building} — ${presence.people} people` : building
      }
      searchBarPlaceholder="Filter by name, room or section"
      isShowingDetail={false}
    >
      {!isLoading && !sections.length ? (
        <List.EmptyView
          icon={Icon.Moon}
          title="Nothing scheduled here right now"
          description="No class is meeting in this building at this minute. People may still be in it -- the timetable is all the engine can see."
        />
      ) : (
        sections.map((section) => {
          const note = coverageNote(section);
          return (
            <List.Section
              key={section.sectionId}
              title={`${section.name ?? section.sectionId} · ${section.room}`}
              subtitle={`${section.start}–${section.end} · ${section.title ?? ""} · ${note.text}`}
            >
              {section.students.length ? (
                section.students.map((student) => (
                  <List.Item
                    key={`${section.sectionId}-${student.id}`}
                    icon={personIcon(student.id, photos)}
                    title={student.name ?? `#${student.id}`}
                    subtitle={student.dormName ?? ""}
                    keywords={[section.name ?? "", section.room, student.dormName ?? ""]}
                    accessories={
                      student.studentClass
                        ? [
                            {
                              tag: {
                                value: student.studentClass,
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
                          target={
                            <DossierById
                              personId={student.id}
                              personName={student.name ?? `#${student.id}`}
                            />
                          }
                        />
                        <Action.CopyToClipboard
                          title="Copy Name"
                          content={student.name ?? student.id}
                        />
                        <Action.CopyToClipboard
                          title="Copy This Room's List"
                          icon={Icon.Clipboard}
                          content={section.students
                            .map((s) => s.name ?? `#${s.id}`)
                            .join("\n")}
                        />
                      </ActionPanel>
                    }
                  />
                ))
              ) : (
                <List.Item
                  icon={{ source: Icon.QuestionMark, tintColor: Color.SecondaryText }}
                  title={`${section.enrolled ?? "?"} enrolled, none reconstructed`}
                  subtitle="No booklist names this section — an online section, or one with no books assigned"
                />
              )}
            </List.Section>
          );
        })
      )}
    </List>
  );
}
