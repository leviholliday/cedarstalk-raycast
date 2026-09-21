import {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  getPreferenceValues,
  openExtensionPreferences,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { type FitOption, type FitResult, type Verdict, courseFit } from "./engine";

/**
 * Whether a section would actually work, before you register for it.
 *
 * Self-Service checks clocks. It will let you take a 9:50 in Health Sciences
 * and a 10:00 in Engineering & Science without a word, because it has no idea
 * the two are a six-minute walk apart. The engine routes that ground, so this
 * can say `impossible` where nothing else on campus can.
 *
 * Every verdict's sentence is written by the engine rather than here, so the
 * reason shown always matches the reason computed.
 */

const LOOK: Record<Verdict, { icon: Icon; colour: Color; label: string }> = {
  fits: { icon: Icon.CheckCircle, colour: Color.Green, label: "fits" },
  tight: { icon: Icon.Clock, colour: Color.Yellow, label: "tight" },
  impossible: { icon: Icon.Footprints, colour: Color.Orange, label: "can't make it" },
  clash: { icon: Icon.XMarkCircle, colour: Color.Red, label: "clash" },
};

const ORDER: Verdict[] = ["fits", "tight", "impossible", "clash"];

const TITLES: Record<Verdict, string> = {
  fits: "Fits",
  tight: "Tight, but possible",
  impossible: "Not enough time to walk it",
  clash: "Clashes with what you already take",
};

function meetingLine(option: FitOption): string {
  if (option.online) return "Online";
  return (
    option.meetings
      .filter((m) => m.start && m.end)
      .map(
        (m) =>
          `${m.daysDisplay ?? m.days.join("/")} ${m.start}–${m.end}` +
          (m.building ? ` · ${m.building}${m.room ? ` ${m.room}` : ""}` : ""),
      )
      .join("  |  ") || "No meeting times listed"
  );
}

export default function Command() {
  const { myPersonId } = getPreferenceValues<{ myPersonId?: string }>();
  const personId = myPersonId?.trim();

  const [query, setQuery] = useState("");
  const [result, setResult] = useState<FitResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const code = query.trim();
    if (!personId || code.length < 3) {
      setResult(null);
      return;
    }
    let live = true;
    setIsLoading(true);
    // The engine matches the catalog's own spelling, so "CS 1220" needs the
    // hyphen putting back the same way the roster search does.
    const normalised = code.replace(/^([A-Za-z]{2,5})\s+(\d)/, "$1-$2").toUpperCase();
    courseFit(personId, normalised)
      .then((found) => {
        if (live) setResult(found);
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [personId, query]);

  if (!personId) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Person}
          title="Tell the extension who you are"
          description="Checking whether a section fits needs your own timetable. Set your directory id in the extension preferences."
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

  const groups = ORDER.map((verdict) => ({
    verdict,
    options: (result?.options ?? []).filter((o) => o.verdict === verdict),
  })).filter((g) => g.options.length);

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setQuery}
      searchBarPlaceholder="Course code — e.g. CS 1220 or MATH-2740"
      throttle
      isShowingDetail={Boolean(groups.length)}
    >
      {query.trim().length < 3 ? (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title="Would it fit?"
          description="Type a course code to see which of its open sections fit around your timetable — including whether you could actually walk there in time."
        />
      ) : !isLoading && !groups.length ? (
        <List.EmptyView
          icon={Icon.Book}
          title={`No open sections of "${query.trim().toUpperCase()}"`}
          description="Either the code does not match anything this term, or every section is full."
        />
      ) : (
        <>
          {result && !result.known ? (
            <List.Section title="Heads up">
              <List.Item
                icon={{ source: Icon.Info, tintColor: Color.Orange }}
                title="No timetable on record for you"
                subtitle="Nothing could be ruled out, so every section below shows as fitting."
              />
            </List.Section>
          ) : null}

          {groups.map(({ verdict, options }) => (
            <List.Section
              key={verdict}
              title={TITLES[verdict]}
              subtitle={`${options.length}`}
            >
              {options.map((option) => {
                const look = LOOK[option.verdict];
                const seats =
                  option.available !== null && option.capacity !== null
                    ? `${option.available} of ${option.capacity} left`
                    : null;
                return (
                  <List.Item
                    key={option.sectionId}
                    icon={{ source: look.icon, tintColor: look.colour }}
                    title={option.name}
                    subtitle={option.reason}
                    keywords={[option.title ?? "", option.faculty ?? ""]}
                    accessories={[
                      ...(seats ? [{ text: seats }] : []),
                      { tag: { value: look.label, color: look.colour } },
                    ]}
                    actions={
                      <ActionPanel>
                        <Action.CopyToClipboard
                          title="Copy Section"
                          content={option.name}
                        />
                        <Action.CopyToClipboard
                          title="Copy Meeting Times"
                          icon={Icon.Clock}
                          content={meetingLine(option)}
                        />
                        <Action.OpenInBrowser
                          title="Register in Self-Service"
                          icon={Icon.Globe}
                          url="https://selfservice.cedarville.edu/Student/Courses"
                        />
                      </ActionPanel>
                    }
                    detail={
                      <List.Item.Detail
                        markdown={[
                          `# ${option.name}`,
                          "",
                          option.title ?? "",
                          "",
                          `**${look.label}** — ${option.reason}`,
                          "",
                          `### When`,
                          meetingLine(option),
                          "",
                          option.faculty ? `### Who\n${option.faculty}` : "",
                        ].join("\n")}
                      />
                    }
                  />
                );
              })}
            </List.Section>
          ))}
        </>
      )}
    </List>
  );
}
