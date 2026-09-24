import {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  openExtensionPreferences,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { DossierById } from "./dossier";
import { personIcon, usePersonPhotos } from "./photos";
import {
  type Roster,
  type RosterStudent,
  type Section,
  findSections,
  latestTerm,
  rosterOf,
} from "./engine";

/**
 * Who is actually in a class.
 *
 * The registrar does not publish rosters, and until the booklist harvest got
 * broad this could not be answered at all. It is reconstructed by inversion:
 * the campus store names the section every book was bought for, so gathering
 * every student whose booklist names a section rebuilds that section's roll.
 *
 * Which means the honest question for any roster is not "is this right" but
 * "is this complete" -- a named student really is enrolled, but a missing one
 * is invisible rather than absent. The engine reports that as coverage against
 * the registrar's own headcount and this view leads with it, alongside the
 * reason, because a 60% roster read as a whole class is the one way to be
 * badly misled here.
 */

/**
 * Why a roster is short, which is never "we have not got round to it".
 *
 * Measured rather than assumed: every student type in the directory has a
 * booklist except dual-enrolment (3,811 people, 0%), who take Cedarville
 * courses from their high schools and do not buy from the campus store. So an
 * incomplete roster has one of two structural causes, and saying "not yet
 * harvested" -- which is what this used to say -- would send someone looking
 * for a fix that does not exist.
 */
function coverageTag(
  roster: Roster,
  section: Section,
): { text: string; color: Color; note: string } {
  const pct = Math.round(roster.coverage * 100);
  const online = (section.meetings ?? "").toLowerCase().includes("online");
  const missing = roster.enrolled - roster.students.length;

  if (roster.coverage >= 0.99)
    return {
      text: "complete",
      color: Color.Green,
      note: `All ${roster.enrolled} enrolled students are named.`,
    };
  if (roster.coverage >= 0.9)
    return {
      text: `${pct}%`,
      color: Color.Green,
      note: `${roster.students.length} of ${roster.enrolled} enrolled — ${missing} unaccounted for.`,
    };
  if (online)
    return {
      text: `${pct}%`,
      color: Color.Blue,
      note:
        `Online section: ${missing} of ${roster.enrolled} are missing because ` +
        "dual-enrolment and distance students never buy from the campus store.",
    };
  if (roster.coverage < 0.35)
    return {
      text: `${pct}%`,
      color: Color.Orange,
      note:
        `Only ${roster.students.length} of ${roster.enrolled} are visible — most likely few or no ` +
        "books were assigned to this section, which hides its students entirely.",
    };
  return {
    text: `${pct}%`,
    color: Color.Orange,
    note: `${roster.students.length} of ${roster.enrolled} enrolled. The other ${missing} bought no books for it.`,
  };
}

function RosterView({ section }: { section: Section }) {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let live = true;
    rosterOf(section.sectionId)
      .then((found) => {
        if (live) setRoster(found);
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [section.sectionId]);

  const students: RosterStudent[] = roster?.students ?? [];
  const photos = usePersonPhotos(students.map((s) => s.id));
  const tag = roster ? coverageTag(roster, section) : null;

  const byClass = new Map<string, RosterStudent[]>();
  for (const student of students) {
    const key = student.studentClass ?? "Other";
    byClass.set(key, [...(byClass.get(key) ?? []), student]);
  }
  // Freshman through senior, then anything the directory calls something else.
  const ORDER = ["FR", "SO", "JR", "SR", "GR", "GS", "Other"];
  const groups = [...byClass.entries()].sort(
    (a, b) =>
      (ORDER.indexOf(a[0]) + 1 || 99) - (ORDER.indexOf(b[0]) + 1 || 99),
  );

  const row = (student: RosterStudent) => (
    <List.Item
      key={student.id}
      icon={personIcon(student.id, photos)}
      title={student.name ?? `#${student.id}`}
      subtitle={student.dormName ?? ""}
      keywords={[student.dormName ?? "", student.studentClass ?? ""]}
      accessories={
        student.studentClass
          ? [{ tag: { value: student.studentClass, color: Color.SecondaryText } }]
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
            title="Copy Whole Roster"
            icon={Icon.Clipboard}
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
            content={students
              .map((s) => s.name ?? `#${s.id}`)
              .sort()
              .join("\n")}
          />
        </ActionPanel>
      }
    />
  );

  return (
    <List
      isLoading={isLoading}
      navigationTitle={
        tag ? `${section.name} — roster ${tag.text}` : section.name
      }
      searchBarPlaceholder="Filter by name, dorm or year"
    >
      {tag ? (
        <List.Section title="Completeness">
          <List.Item
            icon={{ source: Icon.Info, tintColor: tag.color }}
            title={tag.note}
            subtitle="Rebuilt from booklists — the registrar does not publish rosters"
            accessories={[{ tag: { value: tag.text, color: tag.color } }]}
          />
        </List.Section>
      ) : null}
      {!isLoading && students.length === 0 ? (
        <List.EmptyView
          icon={Icon.PersonLines}
          title="No one reconstructed for this section"
          description="No booklist names this section. Usually that means no books were assigned to it, or it is an online section full of dual-enrolment students — not that it is empty."
        />
      ) : (
        groups.map(([year, members]) => (
          <List.Section
            key={year}
            title={year}
            subtitle={`${members.length}`}
          >
            {members
              .slice()
              .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
              .map(row)}
          </List.Section>
        ))
      )}
    </List>
  );
}

export default function Command() {
  const [term, setTerm] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    latestTerm().then(setTerm);
  }, []);

  useEffect(() => {
    if (!term || query.trim().length < 2) {
      setSections([]);
      return;
    }
    let live = true;
    setIsLoading(true);
    findSections(term, query.trim())
      .then((found) => {
        if (live) setSections(found);
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [term, query]);

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setQuery}
      searchBarPlaceholder="Course code, title or instructor — e.g. GBIO 1010"
      throttle
    >
      {query.trim().length < 2 ? (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title="Find a class"
          description={
            term
              ? `Type a course code, a title or an instructor's name to see ${term} sections and who is in them.`
              : "Waiting for cedarstalk…"
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
      ) : !isLoading && sections.length === 0 ? (
        <List.EmptyView
          icon={Icon.Book}
          title={`Nothing in ${term ?? "the catalog"} matches "${query.trim()}"`}
          description="Try the subject on its own, like GBIO, or part of the title."
        />
      ) : (
        <List.Section title={term ?? ""} subtitle={`${sections.length} sections`}>
          {sections.map((section) => {
            const seats =
              section.available !== null && section.capacity !== null
                ? `${section.capacity - section.available}/${section.capacity} seats taken`
                : null;
            return (
              <List.Item
                key={section.sectionId}
                icon={Icon.Book}
                title={section.name}
                subtitle={section.title ?? ""}
                keywords={[section.code ?? "", section.faculty ?? ""]}
                accessories={[
                  ...(section.faculty ? [{ text: section.faculty }] : []),
                  ...(seats
                    ? [{ tag: { value: seats, color: Color.SecondaryText } }]
                    : []),
                ]}
                actions={
                  <ActionPanel>
                    <Action.Push
                      title="Who's in It"
                      icon={Icon.PersonLines}
                      target={<RosterView section={section} />}
                    />
                    <Action.CopyToClipboard
                      title="Copy Section"
                      content={section.name}
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
