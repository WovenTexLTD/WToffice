/**
 * Notion tasks.
 *
 * `/task something` in any channel files a row in the team's Tasks database.
 * The point is that a job mentioned in passing does not have to be carried to
 * another tab to survive the conversation.
 *
 * The token lives here and only here. It never reaches the browser: the client
 * sends a chat message like any other and the server decides what it means,
 * which also means an integration token is not sitting in a bundle served to
 * anyone who opens the page.
 *
 * Unconfigured is a supported state. With no token the office runs exactly as
 * before and `/task` says so, rather than failing somewhere less obvious.
 */

const TOKEN = process.env.NOTION_TOKEN ?? "";
const DATABASE = process.env.NOTION_TASKS_DB ?? "";

/** The `Category` option new tasks are filed under. */
const CATEGORY = process.env.NOTION_TASK_CATEGORY ?? "WT";

/** The `Status` new tasks start in. Must exist in the database's status list. */
const STATUS = process.env.NOTION_TASK_STATUS ?? "To Do";

export const notionConfigured = Boolean(TOKEN && DATABASE);

export interface TaskResult {
  ok: boolean;
  /** Ready to post back into the channel, whatever happened. */
  message: string;
}

/**
 * File a task.
 *
 * Never throws: this runs off a chat message, and a Notion outage must not take
 * a conversation down with it.
 */
export async function createTask(title: string, author: string): Promise<TaskResult> {
  if (!notionConfigured) {
    return {
      ok: false,
      message: "Notion is not connected — set NOTION_TOKEN and NOTION_TASKS_DB on the server.",
    };
  }

  try {
    const response = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { database_id: DATABASE },
        properties: {
          Task: { title: [{ text: { content: title } }] },
          Status: { status: { name: STATUS } },
          Category: { select: { name: CATEGORY } },
          // Who asked for it, so a task filed from here is traceable back to a
          // conversation rather than appearing from nowhere.
          Notes: { rich_text: [{ text: { content: `Added from the office by ${author}` } }] },
        },
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.warn("[notion] create failed", response.status, detail.slice(0, 300));
      return { ok: false, message: `Notion refused the task (${response.status}).` };
    }

    const page = (await response.json()) as { url?: string };
    return { ok: true, message: `Added to Notion: ${title}${page.url ? ` — ${page.url}` : ""}` };
  } catch (error) {
    console.warn("[notion] create errored", error);
    return { ok: false, message: "Could not reach Notion just now." };
  }
}
