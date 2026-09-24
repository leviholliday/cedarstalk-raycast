# Cedarville People Search Raycast Extension

> Originally built by [Kieran Klukas](https://dunkirk.sh) -- the directory
> search, sign-in helper and everything it started with are his work. The
> cedarstalk commands added in this fork were made with
> [Claude](https://claude.com/claude-code). Same MIT license, Kieran's copyright.
>
> **Using cedarstalk?** Double-click `Start cedarstalk.command` from the
> cedarstalk download and say yes when it offers Raycast -- it installs this for
> you. Raycast then asks for your token the first time you run a command.

![detail of a user](./media/cedarstalk-1.png)

Search the Cedarville University student and staff directory from Raycast. Look up anyone by name, view their schedule, majors, office, and contact info -- all without opening a browser.

## Features

- Search by first name, last name, or both
- Filter by population type (undergraduate, graduate, etc.) or department
- View class schedules, majors, minors, advisors, and office locations
- Profile photos loaded automatically
- Results cached locally for instant fuzzy search
- Copy email, phone, or ID

## Setup

You need a Cedarville University account to use this extension.

1. Open the **Search Cedarville Directory** command
2. Click **Sign In** — a small login window will open
3. Complete SSO login with your Cedarville credentials
4. The window closes automatically and you're ready to search

Your session cookie is stored in Raycast's local storage. The site's own session
only lasts a few hours, so the sign-in window also keeps its SSO session in an
owner-only file in the extension's support directory, and renews the site cookie
silently in the background when it expires. In practice you sign in once.

Use **Sign Out** (⌘⇧S) from any result to log out — that clears the stored SSO
session too, so the next sign-in asks for your password again.

## Note

This extension is only useful if you have a Cedarville University account. It accesses the same directory available at [selfservice.cedarville.edu](https://selfservice.cedarville.edu/cedarinfo/directory).
