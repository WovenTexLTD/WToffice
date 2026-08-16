"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NotionSource, NotionTask, TaskAlert } from "@wtoffice/shared";

export type TasksState = "loading" | "ready" | "error" | "unconfigured";

export interface TasksBoardProps {
  tasks: NotionTask[];
  sources: NotionSource[];
  /** Which database is being shown. */
  database: string;
  /** Its own status names, in its own order — one column each. */
  statuses: string[];
  state: TasksState;
  onPick(database: string): void;
  onCreate(title: string, priority?: string, due?: string): void;
  onRefresh(): void;
  onClose(): void;

  /** Databases this person is being told about. */
  watching: string[];
  onWatch(database: string, on: boolean): void;

  /** Alerts not yet dismissed — one mark per database, one per task. */
  unseen: TaskAlert[];
  onDismiss(what: { page?: string; database?: string }): void;
}

/** Today, as the same YYYY-MM-DD string Notion returns, in local time. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The task board.
 *
 * Its own screen rather than a tab, because a list of everything the team owes
 * is not a sidebar-width thing — it wants columns, and columns want room.
 */
export function TasksBoard({
  tasks,
  sources,
  database,
  statuses,
  state,
  onPick,
  onCreate,
  onRefresh,
  onClose,
  watching,
  onWatch,
  unseen,
  onDismiss,
}: TasksBoardProps) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("");
  const [due, setDue] = useState("");

  // What this database can actually hold. Offering a priority field on a
  // database with no such column would silently drop whatever was typed.
  const current = sources.find((s) => s.id.replace(/-/g, "") === database.replace(/-/g, ""));

  const bare = (id: string) => id.replace(/-/g, "");
  const watched = watching.some((id) => bare(id) === bare(database));

  const flagged = new Set(unseen.map((a) => a.id));
  const perSource = new Map<string, number>();
  for (const alert of unseen) {
    const key = bare(alert.database);
    perSource.set(key, (perSource.get(key) ?? 0) + 1);
  }
  const hereCount = perSource.get(bare(database)) ?? 0;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape closes, which is what every overlay in the world does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Columns come from the database, not from this file. One calls them To Do /
  // In Progress / On Hold and the next Not started / In progress; three
  // hard-coded columns filed half of them under the wrong heading.
  const columns = useMemo(() => {
    const byStatus = new Map<string, NotionTask[]>(statuses.map((name) => [name, []]));
    const loose: NotionTask[] = [];
    // A status the database did not declare still has to go somewhere, or the
    // task vanishes from the only view of it.
    for (const task of tasks) {
      const bucket = byStatus.get(task.status);
      if (bucket) bucket.push(task);
      else loose.push(task);
    }
    const named = statuses.map((name) => ({ name, items: byStatus.get(name) ?? [] }));
    return loose.length ? [...named, { name: "Other", items: loose }] : named;
  }, [tasks, statuses]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = title.trim();
    if (!text) return;
    onCreate(text, priority || undefined, due || undefined);
    setTitle("");
    setPriority("");
    setDue("");
  };

  const now = today();

  return (
    <div className="tasks-scrim" onPointerDown={onClose}>
      <section
        className="tasks-board"
        onPointerDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Tasks"
      >
        <header className="tasks-head">
          <h2>Tasks</h2>
          <select
            className="tasks-source"
            value={database}
            onChange={(e) => onPick(e.target.value)}
            aria-label="Database"
          >
            {sources.length === 0 && <option value={database}>Loading…</option>}
            {sources.map((source) => {
              const marked = perSource.get(bare(source.id)) ?? 0;
              return (
                <option key={source.id} value={source.id}>
                  {marked > 0 ? `! ${source.title} (${marked})` : source.title}
                </option>
              );
            })}
          </select>
          {hereCount > 0 && (
            <button
              type="button"
              className="tasks-bang"
              onClick={() => onDismiss({ database })}
              title={`${hereCount} new here — dismiss`}
            >
              ! {hereCount}
            </button>
          )}
          <span className="tasks-count mono">{tasks.length} open</span>
          <span className="tasks-grow" />
          <button
            type="button"
            className={`tasks-ghost${watched ? " on" : ""}`}
            onClick={() => onWatch(database, !watched)}
            aria-pressed={watched}
            title={
              watched
                ? "You are told when a task is added here"
                : "Tell me when a task is added here"
            }
          >
            {watched ? "Notifying" : "Notify me"}
          </button>
          <button type="button" className="tasks-ghost" onClick={onRefresh}>
            Refresh
          </button>
          <button type="button" className="tasks-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <form className="tasks-new" onSubmit={submit}>
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            maxLength={200}
          />
          {current?.hasPriority !== false && (
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              aria-label="Priority"
            >
              <option value="">No priority</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          )}
          {current?.hasDue !== false && (
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              aria-label="Due date"
            />
          )}
          <button type="submit" disabled={!title.trim()}>
            Add task
          </button>
        </form>

        {state === "unconfigured" ? (
          <p className="tasks-empty">Notion is not connected on the server.</p>
        ) : state === "error" ? (
          <p className="tasks-empty">
            No answer from the server. If it was started before this feature, it needs a restart.
            <br />
            <button type="button" className="tasks-ghost" onClick={onRefresh}>
              Try again
            </button>
          </p>
        ) : state === "loading" && tasks.length === 0 ? (
          <p className="tasks-empty">Loading…</p>
        ) : (
          <div className="tasks-columns" style={{ gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(0, 1fr))` }}>
            {columns.map((column) => (
              <div key={column.name} className="tasks-column">
                <h3>
                  {column.name}
                  <span className="mono">{column.items.length}</span>
                </h3>
                {column.items.map((task) => (
                  <a
                    key={task.id}
                    className={`tasks-card${flagged.has(task.id) ? " is-new" : ""}`}
                    href={task.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="tasks-card-title">
                      {flagged.has(task.id) && (
                        <button
                          type="button"
                          className="tasks-bang inline"
                          title="New since you last looked — dismiss"
                          onClick={(e) => {
                            // The card is a link; dismissing must not follow it.
                            e.preventDefault();
                            e.stopPropagation();
                            onDismiss({ page: task.id });
                          }}
                        >
                          !
                        </button>
                      )}
                      {task.title}
                    </span>
                    {(task.priority || task.due) && (
                      <span className="tasks-card-meta mono">
                        {task.priority && (
                          <span className={`tasks-pri p-${task.priority.toLowerCase()}`}>
                            {task.priority}
                          </span>
                        )}
                        {task.due && (
                          <span className={task.due < now ? "tasks-late" : undefined}>
                            {task.due}
                          </span>
                        )}
                      </span>
                    )}
                  </a>
                ))}
                {column.items.length === 0 && <p className="tasks-none">—</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
