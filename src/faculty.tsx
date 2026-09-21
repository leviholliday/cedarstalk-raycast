import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { useEffect, useState } from "react";
import {
  type FacultyDetail,
  type FacultyRow,
  facultyDetail,
  facultyList,
} from "./engine";

/**
 * A professor's whole term: what they teach, where, and how hard they work.
 *
 * One constraint shapes the whole command: `/v1/faculty/:name` matches on the
 * **exact** full name the catalog holds ("Dr. Misti M. Grimson"), so a name
 * typed by hand almost never resolves. The list comes first and the detail is
 * only ever opened from a row, which makes a wrong name impossible rather than
 * merely unlikely.
 */

const DAY_LETTERS = ["Su", "M", "T", "W", "Th", "F", "Sa"];

function Detail({ row }: { row: FacultyRow }) {
  const [detail, setDetail] = useState<FacultyDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let live = true;
    facultyDetail(row.faculty)
      .then((found) => {
        if (live) setDetail(found);
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [row.faculty]);

  const taught = detail?.taught ?? [];

  return (
    <List
      isLoading={isLoading}
      navigationTitle={row.faculty}
      searchBarPlaceholder="Filter by course, room or building"
    >
      <List.Section title="This term">
        <List.Item
          icon={Icon.BarChart}
          title={`${row.sections} sections · ${row.enrolled} students · ${row.credits} credits`}
          subtitle={`${row.distinctRooms} rooms in ${row.distinctBuildings} buildings`}
          accessories={
            row.earlyMeetings
              ? [
                  {
                    tag: {
                      value: `${row.earlyMeetings} early`,
                      color: Color.Orange,
                    },
                    tooltip: "Meetings starting before 9am across the term",
                  },
                ]
              : []
          }
        />
      </List.Section>

      <List.Section title="Teaches" subtitle={`${taught.length} sections`}>
        {taught.map((course) => {
          const when = course.meetings
            .filter((m) => m.start && m.end)
            .map(
              (m) =>
                `${m.days.map((d) => DAY_LETTERS[d] ?? d).join("")} ${m.start}–${m.end}` +
                (m.building ? ` · ${m.building}${m.room ? ` ${m.room}` : ""}` : ""),
            )
            .join("  |  ");
          return (
            <List.Item
              key={course.name}
              icon={Icon.Book}
              title={course.name}
              subtitle={course.title ?? ""}
              keywords={course.meetings.map((m) => m.building ?? "")}
              accessories={[
                ...(when ? [{ text: when }] : [{ text: "online / unscheduled" }]),
                ...(course.enrolled !== null
                  ? [{ tag: { value: `${course.enrolled}`, color: Color.SecondaryText } }]
                  : []),
              ]}
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard title="Copy Section" content={course.name} />
                  {when ? (
                    <Action.CopyToClipboard title="Copy When and Where" content={when} />
                  ) : null}
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
    </List>
  );
}

export default function Command() {
  const [rows, setRows] = useState<FacultyRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let live = true;
    facultyList()
      .then((found) => {
        if (live) setRows(found);
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search a professor by name">
      <List.Section
        title="Busiest first"
        subtitle={rows.length ? `${rows.length} teaching this term` : undefined}
      >
        {rows.map((row) => (
          <List.Item
            key={row.faculty}
            icon={Icon.Person}
            title={row.faculty}
            subtitle={`${row.sections} sections · ${row.enrolled} students`}
            accessories={[
              ...(row.earlyMeetings
                ? [{ tag: { value: `${row.earlyMeetings} early`, color: Color.Orange } }]
                : []),
              { text: `${row.distinctBuildings} bldg` },
            ]}
            actions={
              <ActionPanel>
                <Action.Push
                  title="What They Teach"
                  icon={Icon.Book}
                  target={<Detail row={row} />}
                />
                <Action.CopyToClipboard title="Copy Name" content={row.faculty} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
