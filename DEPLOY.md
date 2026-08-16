# Deploying

The office is two programs, and only one of them can live on Vercel.

| Part | What it is | Where it can run |
| --- | --- | --- |
| `web/` | Next.js pages, the 3D floor, the interface | Vercel |
| `server/` | WebSocket server, SQLite, Notion polling | **Not Vercel** |

## Why the server cannot go on Vercel

Vercel runs functions that start on a request and stop after it. The office
server is the opposite of that:

- it holds a **WebSocket open** for as long as someone is in the office
- it keeps **who is standing where** in memory and broadcasts it many times a
  second
- it writes **SQLite** — profile pictures, notification settings, queued alerts,
  remembered devices — to a file that must survive restarts
- it runs a **timer every 45 seconds** to poll Notion, whether anyone is
  connected or not

None of that survives a serverless function. The server needs a host that runs
a process and keeps a disk: Fly.io, Railway, Render, or any small VPS.

## Vercel settings

The repo is a workspace, so point Vercel at the web app:

- **Root Directory:** `web`
- **Build Command:** `npm run build` (from the repo root Vercel handles the
  workspace install)
- **Environment variable:** `NEXT_PUBLIC_WS_URL = wss://your-server-host`

Without that variable the deployed site now says so on the entry screen rather
than silently trying to reach a server on the visitor's own machine. Note
`wss://`, not `ws://` — a browser refuses an insecure socket from a secure page,
and that failure looks exactly like the server being down.

## The server's own environment

Wherever it runs, it needs:

```
OFFICE_KEY=…            the shared password
NOTION_TOKEN=…          the Notion integration token
NOTION_TASKS_DB=…       the database the board opens on
```

and a persistent volume mounted where `DB_PATH` points, default
`server/data/office.db`. Losing that file loses profile pictures, notification
settings and remembered devices — not the tasks, which live in Notion.

## Still missing for calls between two homes

Voice and video are peer to peer. Two people on home broadband usually cannot
open a direct path, and without a relay the call never connects. That needs a
TURN server — `coturn` on the same box as the office server is the usual
answer, with its credentials handed to the browser alongside the STUN ones.

Everything else — the floor, presence, the task board, notifications — works
without it.
