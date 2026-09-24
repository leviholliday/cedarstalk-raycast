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
  type Classmate,
  type ClassmateResult,
  EngineUnavailable,
  classmates,
} from "./engine";

/**
 * Who else is moving through the week alongside this person -- the people to
 * ask about an assignment, or to study with before an exam.
 *
 * The caveat here used to be about harvest progress -- true when a sweep had
 * reached only a few hundred students, and wrong now that every student type
 * except dual-enrolment is harvested at 100%. What is left is structural: a
 * section nobody assigned books to is invisible however many people are in
 * it, and dual-enrolment classmates can never appear. So this is still a
 * floor rather than a roster, for reasons worth stating accurately.
 */

const THRESHOLDS = [2, 3, 4] as const;
type Threshold = (typeof THRESHOLDS)[number];

function subjectOf(section: string): string {
  return section.split("-")[0] ?? section;
}

/** "BTGE-1725-10" is how the registrar writes it; "BTGE 1725" is how people say it. */
function readableSection(section: string): string {
  const [subject, number] = section.split("-");
  return number ? `${subject} ${number}` : section;
}

export function Classmates({
  personId,
  personName,
}: {
  personId: string;
  personName: string;
}) {
  const [result, setResult] = useState<ClassmateResult | null>(null);
  const [minShared, setMinShared] = useState<Threshold>(2);
  const [isLoading, setIsLoading] = useState(true);
  const [failure, setFailure] = useState<EngineUnavailable | null>(null);

  useEffect(() => {
    let live = true;
    setIsLoading(true);
    classmates(personId, minShared)
      .then((found) => {
        if (!live) return;
        setResult(found);
        setFailure(null);
      })
      .catch((error) => {
        if (!live) return;
        setResult(null);
        setFailure(
          error instanceof EngineUnavailable
            ? error
            : new EngineUnavailable(String(error), "http"),
        );
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [personId, minShared]);

  const photos = usePersonPhotos((result?.classmates ?? []).map((m) => m.studentId));

  if (failure) {
    return (
      <List isLoading={false}>
        <List.EmptyView
          icon={Icon.Plug}
          title={
            failure.kind === "unconfigured"
              ? "cedarstalk is not set up"
              : "cedarstalk is not answering"
          }
          description={
            failure.kind === "unconfigured"
              ? `${failure.message} Add its URL and token in the extension preferences.`
              : `${failure.message} Start it and try again.`
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

  const found = result?.classmates ?? [];
  const harvested = result?.harvested ?? null;

  const caveat = harvested
    ? `From ${harvested.toLocaleString()} timetables — misses dual-enrolment students and sections with no books assigned.`
    : "Drawn from booklists, so sections with no books assigned are invisible.";

  const actionsFor = (mate: Classmate) => (
    <ActionPanel>
      {/* Opening the person is what pressing Enter on a name should do. */}
      <Action.Push
        title="Open Their Dossier"
        icon={Icon.BullsEye}
        target={
          <DossierById
            personId={mate.studentId}
            personName={mate.name ?? `#${mate.studentId}`}
          />
        }
      />
      <Action.CopyToClipboard
        title="Copy Name"
        content={mate.name ?? mate.studentId}
      />
      <Action.CopyToClipboard
        title="Copy Shared Classes"
        icon={Icon.Book}
        content={mate.sharedSections.map(readableSection).join(", ")}
      />
      <Action.OpenInBrowser
        title="Open Info Page"
        icon={Icon.Globe}
        url={`https://selfservice.cedarville.edu/Cedarinfo/Info?id=${mate.studentId}`}
      />
      {THRESHOLDS.filter((n) => n !== minShared).map((n) => (
        <Action
          key={n}
          title={`Require ${n} Shared Classes`}
          icon={Icon.Filter}
          onAction={() => setMinShared(n)}
        />
      ))}
    </ActionPanel>
  );

  return (
    <List
      isLoading={isLoading}
      navigationTitle={`Shares Classes with ${personName}`}
      searchBarPlaceholder="Filter by name or course"
      searchBarAccessory={
        <List.Dropdown
          tooltip="How much overlap counts"
          value={String(minShared)}
          onChange={(value) => setMinShared(Number(value) as Threshold)}
        >
          {THRESHOLDS.map((n) => (
            <List.Dropdown.Item
              key={n}
              title={`${n}+ shared classes`}
              value={String(n)}
            />
          ))}
        </List.Dropdown>
      }
    >
      {!isLoading && found.length === 0 ? (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title={`No one shares ${minShared} classes with ${personName}`}
          description={
            minShared > 2
              ? `${caveat} Try lowering the overlap to 2.`
              : `Either no booklist names their sections, or they are dual-enrolment. ${caveat}`
          }
          actions={
            minShared > 2 ? (
              <ActionPanel>
                <Action
                  title="Require Only 2 Shared Classes"
                  icon={Icon.Filter}
                  onAction={() => setMinShared(2)}
                />
              </ActionPanel>
            ) : undefined
          }
        />
      ) : (
        <List.Section
          title={result?.term ? `${result.term} overlap` : "Overlap"}
          subtitle={caveat}
        >
          {found.map((mate) => (
            <List.Item
              key={mate.studentId}
              icon={
                photos[mate.studentId]
                  ? personIcon(mate.studentId, photos)
                  : mate.sharedSections.length >= 3
                    ? { source: Icon.TwoPeople, tintColor: Color.Green }
                    : Icon.Person
              }
              title={mate.name ?? `#${mate.studentId}`}
              subtitle={mate.sharedSections.map(readableSection).join(" · ")}
              keywords={[
                ...mate.sharedSections,
                ...mate.sharedSections.map(subjectOf),
              ]}
              accessories={[
                {
                  tag: {
                    value: `${mate.sharedSections.length} shared`,
                    color:
                      mate.sharedSections.length >= 3
                        ? Color.Green
                        : Color.SecondaryText,
                  },
                },
              ]}
              actions={actionsFor(mate)}
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
