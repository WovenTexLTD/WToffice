/**
 * Profile store.
 *
 * SQLite via node:sqlite — built into Node, so no container, no native build
 * and no dependency. A five-person office writes a profile picture once and
 * reads it on every sign-in; Postgres would be infrastructure to maintain for
 * no gain.
 *
 * This held chat messages too until chat was removed. The `messages` table is
 * left in place rather than dropped: it is the only copy of anything that was
 * ever said, and deleting it on the next start-up would be a destructive
 * migration nobody asked for. It is simply no longer read or written.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH ?? "./data/office.db";

export class ProfileStore {
  private db: DatabaseSync;

  constructor(path: string = DB_PATH) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);

    // WAL keeps reads from blocking the single writer.
    this.db.exec("PRAGMA journal_mode = WAL");

    // Keyed by identity, not by connection: the whole point is that the
    // picture is still there next time you sign in under the same name.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        identity   TEXT    PRIMARY KEY,
        avatar     TEXT    NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  /** The stored picture for an identity, or null if it has never set one. */
  avatarFor(identity: string): string | null {
    const row = this.db
      .prepare("SELECT avatar FROM profiles WHERE identity = ?")
      .get(identity) as { avatar?: string } | undefined;
    return row?.avatar ?? null;
  }

  /** Store a picture, or clear it when given an empty string. */
  saveAvatar(identity: string, avatar: string): void {
    if (!avatar) {
      this.db.prepare("DELETE FROM profiles WHERE identity = ?").run(identity);
      return;
    }
    this.db
      .prepare(
        "INSERT INTO profiles (identity, avatar, updated_at) VALUES (?, ?, ?)" +
          " ON CONFLICT(identity) DO UPDATE SET avatar = excluded.avatar, updated_at = excluded.updated_at",
      )
      .run(identity, avatar, Date.now());
  }
}
