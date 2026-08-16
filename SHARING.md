# Sharing the office with one other person

Three things have to be true before Abdullah can use this, and a private URL
is only the first of them.

## 1. He has to be able to reach it

The office runs on your laptop. Nothing outside it can see `localhost`.

**Recommended: Tailscale.** It builds a private network between your two
machines. There is no public address at all — the office is not on the internet
to be found, so nobody can knock on the door in the first place.

```sh
brew install --cask tailscale     # both machines, sign in to the same account
tailscale serve --bg 3000         # publishes the web app on your tailnet
```

Tailscale gives the address an HTTPS certificate, which matters for the next
point. Abdullah opens the `https://<your-machine>.<tailnet>.ts.net` address it
prints. Nobody outside your tailnet can load it.

The alternative is a public tunnel — `cloudflared tunnel`, ngrok — which gives a
URL anyone can reach and then relies on the passphrase below. That is weaker,
and it needs a TURN server (point 3).

## 2. Microphones only work over HTTPS

`getUserMedia` is refused on any origin that is not `localhost` or `https:`.
Over plain `http://192.168.x.x`, Abdullah can walk around and see people, and
will not be able to speak or be heard — the browser will not even ask.

Tailscale's certificate handles this. A tunnel that terminates TLS handles it
too. A bare LAN address does not.

## 3. Set a passphrase

```sh
# .env
OFFICE_KEY=something-long-and-not-guessable
```

Restart the server; it logs `access: passphrase required` at start-up. Without
it the log says `access: open`, and anyone who can reach the port walks in.

An unguessable URL is not a lock: links end up in history, in screenshots, in
messages. The passphrase is the actual gate.

## What still will not work between two networks

Voice and video are peer to peer. Between two machines on the same tailnet they
connect directly. Over a public tunnel, with both of you behind home routers,
they will often fail to connect at all — that needs a TURN server relaying the
media, which this does not have yet.

This is the strongest argument for Tailscale: it makes the two machines
neighbours, so the calls work without any of that.
