/**
 * Local store: profiles and notification subscriptions.
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
import type { TaskAlert } from "@wtoffice/shared";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH ?? "./data/office.db";

export class Store {
  private db: DatabaseSync;

  constructor(path: string = DB_PATH) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);

    // Wait rather than fail if another process still holds the file. Under
    // `tsx watch` the replacement server opens the database while the outgoing
    // one is still closing it, and without this that race crashes the reload
    // outright — which reads as the server being broken rather than busy.
    this.db.exec("PRAGMA busy_timeout = 5000");
    // WAL keeps reads from blocking the single writer.
    this.db.exec("PRAGMA journal_mode = WAL");

    // Keyed by identity, not by connection: the whole point is that the
    // picture is still there next time you sign in under the same name.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS seen_pages (
        page_id     TEXT    PRIMARY KEY,
        database_id TEXT    NOT NULL,
        at          INTEGER NOT NULL
      )
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_seen_db ON seen_pages (database_id)");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS alerts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        identity    TEXT    NOT NULL,
        page_id     TEXT    NOT NULL,
        database_id TEXT    NOT NULL,
        source      TEXT    NOT NULL,
        title       TEXT    NOT NULL,
        url         TEXT    NOT NULL,
        at          INTEGER NOT NULL,
        seen        INTEGER NOT NULL DEFAULT 0,
        UNIQUE (identity, page_id)
      )
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_alerts_identity ON alerts (identity, seen)");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS watches (
        identity    TEXT    NOT NULL,
        database_id TEXT    NOT NULL,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (identity, database_id)
      )
    `);
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

  /** Which databases an identity has asked to be told about. */
  watching(identity: string): string[] {
    const rows = this.db
      .prepare("SELECT database_id FROM watches WHERE identity = ?")
      .all(identity) as { database_id: string }[];
    return rows.map((r) => r.database_id);
  }

  /** Every identity watching a database. */
  watchers(database: string): string[] {
    const rows = this.db
      .prepare("SELECT identity FROM watches WHERE database_id = ?")
      .all(database) as { identity: string }[];
    return rows.map((r) => r.identity);
  }

  /** Every database anyone is watching, so the poller knows what to ask for. */
  watchedDatabases(): string[] {
    const rows = this.db
      .prepare("SELECT DISTINCT database_id FROM watches")
      .all() as { database_id: string }[];
    return rows.map((r) => r.database_id);
  }

  setWatch(identity: string, database: string, on: boolean): void {
    if (on) {
      this.db
        .prepare("INSERT OR IGNORE INTO watches (identity, database_id, created_at) VALUES (?, ?, ?)")
        .run(identity, database, Date.now());
    } else {
      this.db
        .prepare("DELETE FROM watches WHERE identity = ? AND database_id = ?")
        .run(identity, database);
    }
  }

  /**
   * Record a page as announced.
   *
   * Returns true only the first time, which is what decides whether anyone
   * hears about it. In the database rather than in memory: held in memory, a
   * server restart both forgets what it had announced and opens a window where
   * the next poll takes everything new for pre-existing and says nothing.
   */
  recordPage(database: string, pageId: string, at: number): boolean {
    const result = this.db
      .prepare("INSERT OR IGNORE INTO seen_pages (page_id, database_id, at) VALUES (?, ?, ?)")
      .run(pageId, database, at);
    return result.changes > 0;
  }

  /** Whether this database has ever been polled. */
  hasSeenDatabase(database: string): boolean {
    return (
      this.db.prepare("SELECT 1 FROM seen_pages WHERE database_id = ? LIMIT 1").get(database) !==
      undefined
    );
  }

  /**
   * Queue an alert for someone.
   *
   * Stored rather than only pushed down the socket, because the person it is
   * for is usually not looking at the screen when a task is filed — and an
   * alert only the connected receive is one that mostly nobody receives.
   */
  queueAlert(identity: string, alert: TaskAlert): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO alerts (identity, page_id, database_id, source, title, url, at)" +
          " VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(identity, alert.id, alert.database, alert.source, alert.title, alert.url, alert.at);
  }

  /** Everything queued for an identity that it has not acknowledged. */
  unseenAlerts(identity: string): TaskAlert[] {
    const rows = this.db
      .prepare(
        "SELECT page_id, database_id, source, title, url, at FROM alerts" +
          " WHERE identity = ? AND seen = 0 ORDER BY at ASC LIMIT 50",
      )
      .all(identity) as Record<string, string | number>[];

    return rows.map((r) => ({
      id: String(r.page_id),
      database: String(r.database_id),
      source: String(r.source),
      title: String(r.title),
      url: String(r.url),
      at: Number(r.at),
    }));
  }

  markAlertsSeen(identity: string): void {
    this.db.prepare("UPDATE alerts SET seen = 1 WHERE identity = ? AND seen = 0").run(identity);
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
