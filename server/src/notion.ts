/**
 * Notion tasks.
 *
 * The token lives here and only here. It never reaches the browser: the client
 * asks the server for a list or to file a task, and the server holds the
 * credential, so no integration token is ever in a bundle served to a page.
 *
 * Nothing about the schema is hard-coded. Seven databases are shared with this
 * integration and every one of them names its title column differently — Task,
 * Task name, Offer, Project name, Deliverable Name — and they do not all carry
 * a Priority or a Due date. Writing to "Task" worked on two of them and failed
 * on the rest, so each database's schema is read once and used to decide what
 * can be written to it.
 *
 * Unconfigured is a supported state: with no token the office runs exactly as
 * before and the board says so, rather than failing somewhere less obvious.
 */

import type { NotionSource, NotionTask } from "@wtoffice/shared";

const TOKEN = process.env.NOTION_TOKEN ?? "";

/** The database the board opens on. Everything else is discovered. */
const DEFAULT_DB = process.env.NOTION_TASKS_DB ?? "";

const CATEGORY = process.env.NOTION_TASK_CATEGORY ?? "WT";
const STATUS = process.env.NOTION_TASK_STATUS ?? "To Do";

export const notionConfigured = Boolean(TOKEN && DEFAULT_DB);

const API = "https://api.notion.com/v1";
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

/** What we need to know about one database to read and write it. */
interface Schema {
  id: string;
  title: string;
  /** The page it lives under, used to tell same-named databases apart. */
  parentId: string | null;
  /** The name of the title column, which differs in every database. */
  titleProp: string;
  statusProp: string | null;
  statusOptions: string[];
  priorityProp: string | null;
  priorityOptions: string[];
  dueProp: string | null;
  categoryProp: string | null;
  categoryOptions: string[];
  /** Somewhere to record who asked, if the database has such a column. */
  notesProp: string | null;
}

let cache: { at: number; list: Schema[] } | null = null;
const CACHE_MS = 60_000;

const plain = (rich: unknown): string =>
  Array.isArray(rich) ? rich.map((r) => (r as { plain_text?: string })?.plain_text ?? "").join("") : "";

/** Find the first property of a given type, since names are not dependable. */
function findProp(props: Record<string, { type?: string }>, type: string, prefer?: string[]) {
  const entries = Object.entries(props);
  for (const name of prefer ?? []) {
    if (props[name]?.type === type) return name;
  }
  return entries.find(([, v]) => v?.type === type)?.[0] ?? null;
}

function readSchema(db: Record<string, any>): Schema {
  const props: Record<string, any> = db.properties ?? {};

  const statusProp = findProp(props, "status", ["Status"]) ?? findProp(props, "select", ["Status"]);
  const priorityProp = findProp(props, "select", ["Priority"]);
  const categoryProp = findProp(props, "select", ["Category"]);

  const options = (name: string | null): string[] => {
    if (!name) return [];
    const p = props[name];
    const raw = p?.type === "status" ? p.status?.options : p?.select?.options;
    return Array.isArray(raw) ? raw.map((o: { name?: string }) => String(o?.name ?? "")) : [];
  };

  return {
    id: String(db.id),
    title: plain(db.title) || "Untitled",
    parentId: db.parent?.type === "page_id" ? String(db.parent.page_id) : null,
    titleProp: findProp(props, "title") ?? "Name",
    statusProp,
    statusOptions: options(statusProp),
    // Priority and Category are both selects; never let them resolve to the
    // same column, or filing a task would overwrite one with the other.
    priorityProp: priorityProp === categoryProp ? null : priorityProp,
    priorityOptions: priorityProp === categoryProp ? [] : options(priorityProp),
    dueProp: findProp(props, "date", ["Due", "Due date", "Date"]),
    categoryProp,
    categoryOptions: options(categoryProp),
    notesProp: findProp(props, "rich_text", ["Notes", "Note", "Description"]),
  };
}

/** Every database shared with the integration, schemas included. Cached. */
async function schemas(): Promise<Schema[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.list;

  const response = await fetch(`${API}/search`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      filter: { property: "object", value: "database" },
      page_size: 50,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`search ${response.status}`);

  const data = (await response.json()) as { results?: Record<string, any>[] };
  const list = (data.results ?? []).map(readSchema);
  await disambiguate(list);
  cache = { at: Date.now(), list };
  return list;
}

/**
 * Make same-named databases tellable apart.
 *
 * Two of these are called "Tasks" and a dropdown with the same word twice in it
 * is useless. Only the colliding ones are looked up — their parent page names
 * the owner ("Karim - Work Planner"), which is the distinction a person
 * actually holds in their head.
 */
async function disambiguate(list: Schema[]): Promise<void> {
  const counts = new Map<string, number>();
  for (const s of list) counts.set(s.title, (counts.get(s.title) ?? 0) + 1);

  const clashing = list.filter((s) => (counts.get(s.title) ?? 0) > 1 && s.parentId);
  if (clashing.length === 0) return;

  const parents = [...new Set(clashing.map((s) => s.parentId!))];
  const titles = new Map<string, string>();

  await Promise.all(
    parents.map(async (id) => {
      try {
        const response = await fetch(`${API}/pages/${id}`, {
          headers: HEADERS,
          signal: AbortSignal.timeout(6000),
        });
        if (!response.ok) return;
        const page = (await response.json()) as { properties?: Record<string, any> };
        const prop = Object.values(page.properties ?? {}).find((v) => v?.type === "title");
        const title = plain(prop?.title);
        if (title) titles.set(id, title);
      } catch {
        // A parent we cannot read just leaves that database with its bare name.
      }
    }),
  );

  for (const schema of clashing) {
    const parent = titles.get(schema.parentId!);
    if (!parent) continue;
    // "Karim - Work Planner" is really just "Karim" for labelling purposes.
    const owner = alias(parent.split(/\s*[-–—|·]\s*/)[0].trim());
    if (owner) schema.title = `${owner} ${schema.title.toLowerCase()}`;
  }
}

/**
 * How the office already refers to people.
 *
 * Abdullah's room is signed ABD, and a task list that calls him something else
 * is a second name for the same person.
 */
function alias(name: string): string {
  return /^abdullah$/i.test(name) ? "ABD" : name;
}

async function schemaFor(id: string): Promise<Schema | null> {
  const list = await schemas();
  return list.find((s) => s.id.replace(/-/g, "") === id.replace(/-/g, "")) ?? null;
}

export interface TaskResult {
  ok: boolean;
  message: string;
}

export interface TaskList {
  items: NotionTask[];
  sources: NotionSource[];
  database: string;
  /**
   * The statuses this database defines, minus the done one.
   *
   * Sent rather than assumed: one database calls them To Do / In Progress /
   * On Hold and the next calls them Not started / In progress, so a board with
   * three hard-coded columns files half the team's work under the wrong one.
   */
  statuses: string[];
  configured: boolean;
  error?: string;
}

/**
 * Open tasks in one database, most recently added first.
 *
 * Newest-first rather than by due date: most rows carry no date at all, and the
 * thing you want after filing something is to see that it landed.
 */
export async function listTasks(database?: string): Promise<TaskList> {
  const target = database || DEFAULT_DB;
  const empty: TaskList = {
    items: [],
    sources: [],
    database: target,
    statuses: [],
    configured: notionConfigured,
  };
  if (!notionConfigured) return empty;

  try {
    const all = await schemas();
    const sources: NotionSource[] = all.map((s) => ({
      id: s.id,
      title: s.title,
      hasPriority: !!s.priorityProp,
      hasDue: !!s.dueProp,
    }));

    const schema = await schemaFor(target);
    if (!schema) return { ...empty, sources, error: "That database is not shared with the integration." };

    const done = schema.statusOptions.find((o) => /^(done|complete|completed)$/i.test(o));
    const response = await fetch(`${API}/databases/${schema.id}/query`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        ...(schema.statusProp && done
          ? { filter: { property: schema.statusProp, status: { does_not_equal: done } } }
          : {}),
        sorts: [{ timestamp: "created_time", direction: "descending" }],
        page_size: 40,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.warn("[notion] query failed", response.status, detail.slice(0, 300));
      return { ...empty, sources, error: `Notion returned ${response.status}.` };
    }

    const data = (await response.json()) as { results?: Record<string, any>[] };
    const items: NotionTask[] = (data.results ?? []).map((page) => {
      const props: Record<string, any> = page.properties ?? {};
      const status = schema.statusProp ? props[schema.statusProp] : null;
      return {
        id: String(page.id),
        title: plain(props[schema.titleProp]?.title) || "Untitled",
        status: status?.status?.name ?? status?.select?.name ?? "",
        priority: schema.priorityProp ? (props[schema.priorityProp]?.select?.name ?? null) : null,
        due: schema.dueProp ? (props[schema.dueProp]?.date?.start ?? null) : null,
        url: String(page.url ?? ""),
      };
    });

    return {
      items,
      sources,
      database: schema.id,
      statuses: schema.statusOptions.filter((o) => o !== done),
      configured: true,
    };
  } catch (error) {
    console.warn("[notion] query errored", error);
    return { ...empty, error: "Could not reach Notion just now." };
  }
}

/**
 * File a task.
 *
 * Never throws: this runs off a websocket message and a Notion outage must not
 * take a conversation down with it. Only writes columns the target database
 * actually has, and only values it actually offers — a Priority of "High" is
 * silently dropped rather than rejected wholesale if that database has no such
 * option.
 */
export async function createTask(
  title: string,
  author: string,
  priority?: string,
  due?: string,
  database?: string,
): Promise<TaskResult> {
  if (!notionConfigured) {
    return { ok: false, message: "Notion is not connected on the server." };
  }

  try {
    const schema = await schemaFor(database || DEFAULT_DB);
    if (!schema) return { ok: false, message: "That database is not shared with the integration." };

    const properties: Record<string, unknown> = {
      [schema.titleProp]: { title: [{ text: { content: title } }] },
    };

    if (schema.statusProp) {
      const start = schema.statusOptions.includes(STATUS)
        ? STATUS
        : (schema.statusOptions.find((o) => /to.?do|not started|backlog/i.test(o)) ??
          schema.statusOptions[0]);
      if (start) properties[schema.statusProp] = { status: { name: start } };
    }
    if (schema.categoryProp && schema.categoryOptions.includes(CATEGORY)) {
      properties[schema.categoryProp] = { select: { name: CATEGORY } };
    }
    if (schema.priorityProp && priority && schema.priorityOptions.includes(priority)) {
      properties[schema.priorityProp] = { select: { name: priority } };
    }
    if (schema.dueProp && due) {
      properties[schema.dueProp] = { date: { start: due } };
    }

    if (schema.notesProp) {
      properties[schema.notesProp] = {
        rich_text: [{ text: { content: `Added from the office by ${author}` } }],
      };
    }

    const response = await fetch(`${API}/pages`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ parent: { database_id: schema.id }, properties }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.warn("[notion] create failed", response.status, detail.slice(0, 300));
      return { ok: false, message: `Notion refused the task (${response.status}).` };
    }

    const page = (await response.json()) as { url?: string };
    return {
      ok: true,
      message: `Added to ${schema.title}: ${title}${page.url ? ` — ${page.url}` : ""}`,
    };
  } catch (error) {
    console.warn("[notion] create errored", error);
    return { ok: false, message: "Could not reach Notion just now." };
  }
}
