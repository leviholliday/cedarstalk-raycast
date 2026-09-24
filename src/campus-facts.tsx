import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { useEffect, useState } from "react";
import { type Curiosities, type MajorSchool, curiosities, majorDistribution } from "./engine";

/**
 * Whatever is interesting about campus as a whole, read-only.
 *
 * Everything here is the engine's own /v1/stats/curiosities plus the major
 * guesser's distribution -- nothing computed twice, nothing rephrased past
 * what the numbers actually say. The engine attaches its own caveats to this
 * data (`notes`), and those are shown rather than summarised away, because a
 * fact like "no textbook has a recorded price" changes what the rest of the
 * screen means.
 */

function n(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export default function Command() {
  const [data, setData] = useState<Curiosities | null>(null);
  const [majors, setMajors] = useState<{
    students: number;
    confident: number;
    schools: MajorSchool[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let live = true;
    Promise.all([curiosities(), majorDistribution()])
      .then(([facts, dist]) => {
        if (!live) return;
        setData(facts);
        setMajors(dist);
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  if (!isLoading && !data) {
    return (
      <List isLoading={false}>
        <List.EmptyView
          icon={Icon.Plug}
          title="cedarstalk has nothing to show"
          description="Check that it is running and the token is set in the extension preferences."
        />
      </List>
    );
  }

  // DIRECTACCESS is a digital-materials placeholder, not a book -- same
  // filter as My Textbooks, for the same reason.
  const books = (data?.commonBooks ?? []).filter((b) => b.isbn !== "DIRECTACCESS");
  const topStates = data?.hometownStates.slice(0, 10) ?? [];
  const earliest = [...(data?.earlyBirds ?? [])].slice(0, 8);
  const biggest = [...(data?.classSize ?? [])].slice(0, 8);
  const schools = majors?.schools ?? [];
  const biggestState = topStates[0]?.people ?? 0;

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter">
      {data ? (
        <>
          <List.Section title="Where everyone's from" subtitle={data.term}>
            {topStates.map((row) => (
              <List.Item
                key={row.state}
                icon={Icon.Pin}
                title={row.state}
                accessories={[
                  { text: "█".repeat(Math.max(1, Math.round((row.people / (biggestState || 1)) * 10))) },
                  { tag: { value: n(row.people), color: Color.Blue } },
                ]}
              />
            ))}
            <List.Item
              icon={Icon.Airplane}
              title="Furthest from home"
              subtitle={
                data.distance.furthest
                  ? `${data.distance.furthest.city}, ${data.distance.furthest.state} — ${n(data.distance.furthest.miles)} mi`
                  : "n/a"
              }
              accessories={[
                {
                  text: `median ${n(data.distance.medianMiles)} mi`,
                  tooltip: `Straight-line from Cedarville, OH. ${n(data.distance.geocoded)} of ${n(data.distance.ofPeople)} hometowns could be placed.`,
                },
              ]}
            />
          </List.Section>

          <List.Section
            title="Probably studying"
            subtitle={
              majors
                ? `${n(majors.confident)} of ${n(majors.students)} guessed with real confidence`
                : undefined
            }
          >
            {schools.map((school) => (
              <List.Item
                key={school.school}
                icon={Icon.Book}
                title={school.school}
                accessories={[{ tag: { value: n(school.students), color: Color.Purple } }]}
              />
            ))}
          </List.Section>

          <List.Section title="Earliest subjects" subtitle="share of meetings starting before 9am">
            {earliest.map((row) => (
              <List.Item
                key={row.subject}
                icon={{ source: Icon.Sunrise, tintColor: Color.Orange }}
                title={row.subject}
                accessories={[
                  { tag: { value: `${Math.round(row.share * 100)}%`, color: Color.Orange } },
                  { text: `${row.early}/${row.meetings}` },
                ]}
              />
            ))}
          </List.Section>

          <List.Section title="Biggest classes on average" subtitle="mean enrolled per section, by subject">
            {biggest.map((row) => (
              <List.Item
                key={row.subject}
                icon={Icon.TwoPeople}
                title={row.subject}
                subtitle={`${row.sections} sections`}
                accessories={[
                  { tag: { value: `~${Math.round(row.meanClassSize)}`, color: Color.Green } },
                ]}
              />
            ))}
          </List.Section>

          <List.Section
            title="Most assigned books"
            subtitle={`${Math.round(data.optionalShare.share * 100)}% of all assigned books are optional`}
          >
            {books.slice(0, 8).map((book) => (
              <List.Item
                key={book.isbn}
                icon={Icon.Book}
                title={book.title ?? book.isbn}
                accessories={[{ tag: { value: `${n(book.students)} students`, color: Color.SecondaryText } }]}
                actions={
                  <ActionPanel>
                    <Action.CopyToClipboard title="Copy ISBN" content={book.isbn} />
                  </ActionPanel>
                }
              />
            ))}
          </List.Section>

          {data.notes.length ? (
            <List.Section title="Worth knowing about this data">
              {data.notes.map((note) => (
                <List.Item key={note} icon={Icon.Info} title={note} />
              ))}
            </List.Section>
          ) : null}
        </>
      ) : null}
    </List>
  );
}
