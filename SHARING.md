# Sharing the office

The office is password-protected. A browser can be remembered for 30 days so
the password is asked for once, not every visit.

## Setting the password

```sh
# .env
OFFICE_KEY=something-long-and-not-guessable
```

Restart the server. It logs which mode it is in at start-up:

```
access: password required, remembered devices last 30 days
access: open — set OFFICE_KEY before exposing this beyond localhost
```

Unset, anyone who can reach the port walks in. That is fine on your own machine
and wrong the moment it has a domain.

## How "remember this device" works

The browser never stores the password. On a first sign-in with **Remember this
device** ticked, the server issues a random token and stores it with a 30-day
expiry; the browser keeps the token and sends that instead. Three consequences
worth knowing:

- The password is not sitting in anyone's browser storage.
- Access lapses on its own after 30 days and asks again.
- A token cannot mint another token — a copied one dies on schedule rather than
  renewing itself indefinitely.

To end every remembered session — a lost laptop, or a changed password:

```sh
npm run forget-devices
```

Changing `OFFICE_KEY` alone does **not** do this. Existing grants are tokens and
would keep working; run the command as well.

## Putting it on a domain

Two things beyond DNS.

**HTTPS is not optional.** `getUserMedia` is refused on any origin that is not
`localhost` or `https:`. Over plain HTTP, Abdullah can walk around and see
people and will never be heard — the browser will not even ask for his
microphone.

**Voice needs a TURN server between two networks.** Audio and video are peer to
peer. Two people on home broadband usually cannot open a direct path, and
without a relay the call simply never connects. The office has no TURN server
yet; presence, the floor and the task board all work regardless, so this is the
one piece to plan for if calls matter.

The rest is ordinary deployment: build the web app, run the server behind a
reverse proxy that terminates TLS, keep `server/data/office.db` on a disk that
survives restarts — it holds profile pictures, notification settings, queued
alerts and remembered devices — and set `NOTION_TOKEN`, `NOTION_TASKS_DB` and
`OFFICE_KEY` as environment variables rather than shipping the `.env` file.
