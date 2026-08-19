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

## The free way: a tunnel to your laptop

No hosting bill, and the database stays on a real disk. Cloudflare gives the
tunnel an HTTPS certificate, so the browser gets `wss://` and microphones work.

```sh
npm run tunnel        # prints https://something.trycloudflare.com
```

Put that address in Vercel as `NEXT_PUBLIC_WS_URL` with `https` swapped for
`wss`, and redeploy. Verified end to end: a secure socket opens through the
tunnel, the password gate still applies, and the task board loads.

Two limits. The address is **random and changes every time the tunnel
restarts**, which is fine for trying it and useless for something you want to
keep — a *named* tunnel on your own domain fixes that, is also free, and needs a
Cloudflare account and one `cloudflared tunnel login`. And your laptop has to be
awake with the server running; close the lid and the office is gone for both of
you.

## The paid way: put the server on a host (about five minutes)

`render.yaml` in the repo root describes the service, so most of this is
answering prompts rather than filling in forms.

1. **render.com** → sign in with GitHub → **New** → **Blueprint**
2. Pick `WovenTexLTD/WToffice`. Render reads `render.yaml` and proposes one
   service, `wtoffice-server`, with a 1 GB disk mounted at `/data`.
3. It asks for the three values kept out of the repo:
   - `OFFICE_KEY` — the site password
   - `NOTION_TOKEN` — the integration token
   - `NOTION_TASKS_DB` — `e17b1734-ceaf-8236-a5cb-815a3a49cad0`
4. Deploy. When it is live, copy the address — `https://wtoffice-server.onrender.com`
   or similar.
5. In **Vercel** → the project → Settings → Environment Variables, add
   `NEXT_PUBLIC_WS_URL` = that address with `https` swapped for `wss`, e.g.
   `wss://wtoffice-server.onrender.com`. Redeploy.

The message on the entry screen goes away and the office works from anywhere.

Two notes. The blueprint asks for a paid instance because the disk needs one —
on a free instance the database is wiped on every restart, taking profile
pictures, notification settings and remembered devices with it. And `OFFICE_KEY`
set here is what the deployed office uses; the `.env` on your laptop only
governs the copy running there.

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

## The image is known to work

Built and run before being handed over, rather than written and hoped for:

- `docker build -f server/Dockerfile .` succeeds
- the container boots, reports the password gate on, and connects to Notion
- `/health` answers
- a wrong password is refused and the right one gets in
- the task board loads through it — ten open tasks across seven databases
- a device grant written to `/data` survives `docker restart`, which is the
  whole point of paying for the disk

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

## Calls between two homes: the TURN relay

Voice and video are peer to peer. STUN tells each side its own public address
and hopes the two can reach each other; behind a symmetric or carrier-grade NAT
they cannot, and the call fails with nothing to show for it — both people in the
room, microphones live, neither hearing anything. A TURN server relays the audio
when no direct path exists.

The office runs without one. Set either group of variables on the server to add
it, and the browser picks it up when someone walks in:

```
TURN_KEY_ID=…           Cloudflare Calls — preferred, because the
TURN_KEY_API_TOKEN=…    credentials are minted per session and expire

TURN_URLS=…             or static credentials, comma separated urls,
TURN_USERNAME=…         from Metered, Twilio, or your own coturn
TURN_CREDENTIAL=…
```

Only the **server** needs these. They travel to the browser inside the welcome
message, which is behind the password gate, so they are never baked into the web
build and rotating them needs no redeploy of the site.

The server prints which of the three states it is in on start-up (`voice: …`).

**To confirm it is working**, press `i` in the office to open diagnostics and read
the `route` column: `direct` is the same network, `nat` is a direct path through
the routers, `relay` means TURN is carrying the call. `relay` appearing at all is
the proof it earns its keep — those are the calls that used to fail.
