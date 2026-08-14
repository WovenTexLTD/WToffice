/**
 * Message store.
 *
 * SQLite via node:sqlite — built into Node, so no container, no native build
 * and no dependency. A five-person office has one writer and a handful of
 * messages a day; Postgres would be infrastructure to maintain for no gain.
 * The schema is plain enough to move later if that ever changes.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { HISTORY_PAGE, MAX_MESSAGE_LENGTH, type ChatMessage } from "@wtoffice/shared";

const DB_PATH = process.env.DB_PATH ?? "./data/office.db";

export class MessageStore {
  private db: DatabaseSync;

  constructor(path: string = DB_PATH) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);

    // WAL keeps reads from blocking the single writer.
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        channel    TEXT    NOT NULL,
        author     TEXT    NOT NULL,
        identity   TEXT    NOT NULL,
        body       TEXT    NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    // Paging walks backwards from the newest id within one channel.
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages (channel, id DESC)");

    // Profiles are keyed by identity, not by connection: the whole point is
    // that the picture is still there next time you sign in under the same
    // name.
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

  append(channel: string, author: string, identity: string, body: string): ChatMessage {
    const at = Date.now();
    const trimmed = body.slice(0, MAX_MESSAGE_LENGTH);

    const result = this.db
      .prepare("INSERT INTO messages (channel, author, identity, body, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(channel, author, identity, trimmed, at);

    return {
      id: Number(result.lastInsertRowid),
      channel,
      author,
      identity,
      body: trimmed,
      at,
    };
  }

  /**
   * One page of history, oldest-first for rendering.
   *
   * `before` pages backwards through older messages; omit it for the newest
   * page. Returns one extra row internally to tell the client whether to offer
   * a "load older" affordance.
   */
  history(channel: string, before?: number): { messages: ChatMessage[]; hasMore: boolean } {
    const limit = HISTORY_PAGE + 1;

    const rows = (
      before === undefined
        ? this.db
            .prepare("SELECT * FROM messages WHERE channel = ? ORDER BY id DESC LIMIT ?")
            .all(channel, limit)
        : this.db
            .prepare("SELECT * FROM messages WHERE channel = ? AND id < ? ORDER BY id DESC LIMIT ?")
            .all(channel, before, limit)
    ) as Array<Record<string, unknown>>;

    const hasMore = rows.length > HISTORY_PAGE;
    const page = hasMore ? rows.slice(0, HISTORY_PAGE) : rows;

    const messages = page
      .map((r) => ({
        id: Number(r.id),
        channel: String(r.channel),
        author: String(r.author),
        identity: String(r.identity),
        body: String(r.body),
        at: Number(r.created_at),
      }))
      .reverse();

    return { messages, hasMore };
  }

  close(): void {
    this.db.close();
  }
}
