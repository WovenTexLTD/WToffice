/**
 * Where two browsers should look for each other.
 *
 * Without a TURN relay the office works right up until it doesn't. STUN gets
 * each side its public address, which is enough for most home routers; behind a
 * symmetric NAT or carrier-grade NAT the two addresses are useless to each
 * other and the call fails with no error at all — the microphone says live, the
 * peers say connected, and nobody hears anybody. TURN is the fallback that
 * relays the audio when a direct path cannot be found.
 *
 * Two ways to supply one, both optional:
 *
 *   TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL
 *     Long-lived credentials, which is what Metered, Twilio and a self-hosted
 *     coturn hand you. Simple, and fine for an office of five.
 *
 *   TURN_KEY_ID, TURN_KEY_API_TOKEN
 *     Cloudflare, which mints credentials on demand. Better, because what the
 *     browser holds expires by itself and cannot be lifted and reused.
 *
 * With neither set the office runs on STUN alone, exactly as it did before —
 * this is an addition, never a requirement.
 */

import type { IceServer } from "@wtoffice/shared";

/** Free, public, and run by people who are not us — hence a fallback, not a plan. */
const STUN: IceServer = {
  urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
};

/**
 * How long minted credentials last.
 *
 * They are handed out at the door and only need to outlive the visit. A day
 * covers anyone who leaves the office open and comes back to it, and keeps a
 * leaked set from being worth much.
 */
const MINT_TTL_SECONDS = 24 * 60 * 60;

/** Re-mint with this much life left, so nobody is handed a set about to die. */
const MINT_REFRESH_MS = 60 * 60 * 1000;

let cached: { servers: IceServer[]; expiresAt: number } | null = null;

/** Long-lived credentials from the environment, if they are all there. */
function staticTurn(): IceServer | null {
  const urls = (process.env.TURN_URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  const username = process.env.TURN_USERNAME ?? "";
  const credential = process.env.TURN_CREDENTIAL ?? "";

  if (urls.length === 0) return null;
  if (!username || !credential) {
    console.warn("[ice]   TURN_URLS is set but TURN_USERNAME/TURN_CREDENTIAL are not — ignoring");
    return null;
  }
  return { urls, username, credential };
}

/**
 * Ask Cloudflare for a set of credentials.
 *
 * Returns null on any refusal or surprise rather than throwing: a relay that
 * cannot be reached should cost the office its fallback, not its front door.
 */
async function mintTurn(keyId: string, token: string): Promise<IceServer | null> {
  const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ ttl: MINT_TTL_SECONDS }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.warn(`[ice]   Cloudflare refused: ${response.status} ${await response.text()}`);
      return null;
    }

    // Their shape has moved between versions of this API: sometimes one server
    // object, sometimes a list of them. Accept either rather than trusting one.
    const body = (await response.json()) as {
      iceServers?: IceServer | IceServer[];
    };
    const first = Array.isArray(body.iceServers) ? body.iceServers[0] : body.iceServers;

    if (!first?.urls || !first.username || !first.credential) {
      console.warn("[ice]   Cloudflare returned nothing usable");
      return null;
    }
    return {
      urls: Array.isArray(first.urls) ? first.urls : [first.urls],
      username: first.username,
      credential: first.credential,
    };
  } catch (error) {
    console.warn(`[ice]   could not reach Cloudflare: ${String(error)}`);
    return null;
  }
}

/**
 * The list to hand a joining browser.
 *
 * Cached, because everyone who walks in gets the same answer and minting once
 * per join would be a request to Cloudflare per reconnect.
 */
export async function iceServers(): Promise<IceServer[]> {
  if (cached && cached.expiresAt - Date.now() > MINT_REFRESH_MS) return cached.servers;

  const fixed = staticTurn();
  if (fixed) {
    // Nothing to expire, so this is settled for the life of the process.
    cached = { servers: [STUN, fixed], expiresAt: Number.MAX_SAFE_INTEGER };
    return cached.servers;
  }

  const keyId = process.env.TURN_KEY_ID ?? "";
  const token = process.env.TURN_KEY_API_TOKEN ?? "";
  if (keyId && token) {
    const minted = await mintTurn(keyId, token);
    if (minted) {
      cached = { servers: [STUN, minted], expiresAt: Date.now() + MINT_TTL_SECONDS * 1000 };
      return cached.servers;
    }
    // Failed: try again on the next join rather than caching the disappointment.
    return [STUN];
  }

  cached = { servers: [STUN], expiresAt: Number.MAX_SAFE_INTEGER };
  return cached.servers;
}

/** One line at start-up, so which of the three states this is, is never a guess. */
export function describeIce(): string {
  if (staticTurn()) return "TURN relay configured (static credentials)";
  if (process.env.TURN_KEY_ID && process.env.TURN_KEY_API_TOKEN) {
    return "TURN relay configured (Cloudflare, credentials minted per session)";
  }
  return "STUN only — no TURN relay; voice may fail between some home networks";
}
