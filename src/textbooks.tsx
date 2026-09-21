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
import { DossierById } from "./dossier";
import { personIcon, usePersonPhotos } from "./photos";
import { type Book, type BookHolders, type StudentBooks, bookHolders, booksOf } from "./engine";

/**
 * Your textbooks, and the ISBN that lets you buy them somewhere else.
 *
 * The harvest has always carried ISBNs and nothing ever read them. Finding
 * your own means logging into the store and reading it off a page; this makes
 * it one keystroke, and puts the used-book searches next to it, because the
 * campus store's price is rarely the best one.
 *
 * Two honesty notes it prints rather than hides: digital-access rows are not
 * books and are counted separately, and **no prices are shown anywhere**,
 * because the store's price field has come back empty on every row ever
 * harvested. A made-up price would be worse than none.
 */

function searchUrls(isbn: string, title: string | null) {
  const q = encodeURIComponent(isbn);
  return [
    { name: "AbeBooks", url: `https://www.abebooks.com/servlet/SearchResults?isbn=${q}` },
    { name: "Amazon", url: `https://www.amazon.com/s?k=${q}` },
    { name: "eBay", url: `https://www.ebay.com/sch/i.html?_nkw=${q}` },
    {
      name: "Google",
      url: `https://www.google.com/search?q=${q}${title ? `+${encodeURIComponent(title)}` : ""}`,
    },
  ];
}

function Holders({ isbn, title }: { isbn: string; title: string | null }) {
  const [holders, setHolders] = useState<BookHolders | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let live = true;
    bookHolders(isbn)
      .then((found) => {
        if (live) setHolders(found);
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [isbn]);

  const students = holders?.students ?? [];
  const photos = usePersonPhotos(students.map((s) => s.id));

  return (
    <List
      isLoading={isLoading}
      navigationTitle={title ?? isbn}
      searchBarPlaceholder="Filter by name"
    >
      {!isLoading && !students.length ? (
        <List.EmptyView
          icon={Icon.Book}
          title="Nobody else needs this one"
          description="No other harvested booklist names this ISBN this term."
        />
      ) : (
        <List.Section
          title="Also need this book"
          subtitle={`${students.length} — split one, borrow one, or compare notes`}
        >
          {students.map((student) => (
            <List.Item
              key={student.id}
              icon={personIcon(student.id, photos)}
              title={student.name ?? `#${student.id}`}
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
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}

export default function Command() {
  const { myPersonId } = getPreferenceValues<{ myPersonId?: string }>();
  const personId = myPersonId?.trim();

  const [result, setResult] = useState<StudentBooks | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(personId));

  useEffect(() => {
    if (!personId) return;
    let live = true;
    booksOf(personId)
      .then((found) => {
        if (live) setResult(found);
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [personId]);

  if (!personId) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Book}
          title="Tell the extension who you are"
          description="Set your directory id in the extension preferences to see your own booklist."
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

  const books = result?.books ?? [];

  const row = (book: Book) => {
    const links = searchUrls(book.isbn, book.title);
    return (
      <List.Item
        key={book.isbn}
        icon={{
          source: book.status === "optional" ? Icon.Circle : Icon.Book,
          tintColor: book.status === "optional" ? Color.SecondaryText : Color.Blue,
        }}
        title={book.title ?? book.isbn}
        subtitle={book.code ?? ""}
        keywords={[book.isbn, book.code ?? ""]}
        accessories={[
          ...(book.status === "optional" ? [{ text: "optional" }] : []),
          {
            tag: {
              value:
                book.alsoNeededBy > 0 ? `+${book.alsoNeededBy} others` : "just you",
              color: book.alsoNeededBy >= 20 ? Color.Green : Color.SecondaryText,
            },
            tooltip:
              book.alsoNeededBy > 0
                ? `${book.alsoNeededBy} other students need this ISBN this term — used copies should be easy to find.`
                : "No other harvested booklist names this ISBN.",
          },
        ]}
        actions={
          <ActionPanel>
            <Action.CopyToClipboard title="Copy ISBN" content={book.isbn} />
            <ActionPanel.Submenu title="Find It Used" icon={Icon.MagnifyingGlass}>
              {links.map((link) => (
                <Action.OpenInBrowser key={link.name} title={link.name} url={link.url} />
              ))}
            </ActionPanel.Submenu>
            {book.alsoNeededBy > 0 ? (
              <Action.Push
                title={`Who Else Needs It (${book.alsoNeededBy})`}
                icon={Icon.TwoPeople}
                shortcut={{ modifiers: ["cmd"], key: "t" }}
                target={<Holders isbn={book.isbn} title={book.title} />}
              />
            ) : null}
            <Action.CopyToClipboard
              title="Copy Every ISBN"
              icon={Icon.Clipboard}
              shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
              content={books.map((b) => `${b.isbn}  ${b.title ?? ""}`).join("\n")}
            />
          </ActionPanel>
        }
      />
    );
  };

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter by title, course or ISBN">
      {!isLoading && !books.length ? (
        <List.EmptyView
          icon={Icon.Book}
          title="No books with an ISBN this term"
          description={
            result
              ? `The store listed ${result.withoutIsbn} digital-access rows, which are not books.`
              : "cedarengine has no harvested booklist for you this term."
          }
        />
      ) : (
        <List.Section
          title="Your books"
          subtitle={
            result?.withoutIsbn
              ? `${books.length} · ${result.withoutIsbn} digital-access rows not shown · no prices: the store never returns them`
              : `${books.length} · no prices: the store never returns them`
          }
        >
          {books.map(row)}
        </List.Section>
      )}
    </List>
  );
}
