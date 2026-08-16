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

  /** Drop a task into another status column. */
  onMove(page: string, status: string): void;
}

const bare = (id: string) => id.replace(/-/g, "");

/** Midnight today, for comparing against Notion's date-only values. */
function startOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * A due date as a person would say it.
 *
 * "2026-08-14" tells you nothing at a glance; "3 days late" does. Anything
 * further out than a week falls back to the date, where the exact day starts
 * mattering more than the distance.
 */
function dueLabel(due: string): { text: string; tone: "late" | "soon" | "calm" } {
  const [y, m, d] = due.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return { text: due, tone: "calm" };

  const days = Math.round((new Date(y, m - 1, d).getTime() - startOfToday()) / 86_400_000);
  if (days < 0) return { text: days === -1 ? "1 day late" : `${-days} days late`, tone: "late" };
  if (days === 0) return { text: "Today", tone: "late" };
  if (days === 1) return { text: "Tomorrow", tone: "soon" };
  if (days <= 6) return { text: `In ${days} days`, tone: "soon" };
  return {
    text: new Date(y, m - 1, d).toLocaleDateString([], { day: "numeric", month: "short" }),
    tone: "calm",
  };
}

const Caret = () => (
  <svg viewBox="0 0 10 6" aria-hidden="true">
    <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/**
 * The task board.
 *
 * Its own screen rather than a tab, because a list of everything the team owes
 * wants columns, and columns want room.
 *
 * Every control here is styled from scratch. A native select or date input
 * renders as the operating system's own widget — a white box with a blue focus
 * ring — which is fine on a white page and looks like a bug on a dark one.
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
  onMove,
}: TasksBoardProps) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("");
  const [due, setDue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  /** The column a card is currently hovering over, for the drop highlight. */
  const [over, setOver] = useState<string | null>(null);
  /** The task being dragged, so its own column does not light up. */
  const dragging = useRef<{ id: string; from: string } | null>(null);

  const current = sources.find((s) => bare(s.id) === bare(database));
  const watched = watching.some((id) => bare(id) === bare(database));

  const flagged = new Set(unseen.map((a) => a.id));
  const perSource = new Map<string, number>();
  for (const alert of unseen) {
    const key = bare(alert.database);
    perSource.set(key, (perSource.get(key) ?? 0) + 1);
  }
  const hereCount = perSource.get(bare(database)) ?? 0;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Columns come from the database, not from this file. One calls them To Do /
  // In Progress / On Hold and the next Not started / In progress.
  const columns = useMemo(() => {
    const byStatus = new Map<string, NotionTask[]>(statuses.map((name) => [name, []]));
    const loose: NotionTask[] = [];
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

  return (
    <div className="tasks-scrim" onPointerDown={onClose}>
      <section
        className="tasks-board"
        onPointerDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Tasks"
      >
        <header className="tasks-head">
          <div className="tasks-heading">
            <h2>Tasks</h2>
            <span className="tasks-count">
              {tasks.length} open
              {hereCount > 0 && ` · ${hereCount} new`}
            </span>
          </div>

          <label className="tasks-picker">
            <select value={database} onChange={(e) => onPick(e.target.value)} aria-label="Database">
              {sources.length === 0 && <option value={database}>Loading…</option>}
              {sources.map((source) => {
                const marked = perSource.get(bare(source.id)) ?? 0;
                return (
                  <option key={source.id} value={source.id}>
                    {marked > 0 ? `● ${source.title} (${marked})` : source.title}
                  </option>
                );
              })}
            </select>
            <Caret />
          </label>

          <span className="tasks-grow" />

          {hereCount > 0 && (
            <button
              type="button"
              className="tasks-bang"
              onClick={() => onDismiss({ database })}
              title={`${hereCount} new here — dismiss all`}
            >
              <span className="bang-dot" />
              {hereCount} new
            </button>
          )}

          <button
            type="button"
            className={`tasks-icon${watched ? " on" : ""}`}
            onClick={() => onWatch(database, !watched)}
            aria-pressed={watched}
            title={watched ? "You are notified about this list" : "Notify me about this list"}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M18 8a6 6 0 10-12 0c0 6-3 7-3 7h18s-3-1-3-7M13.7 20a2 2 0 01-3.4 0"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <button type="button" className="tasks-icon" onClick={onRefresh} title="Refresh">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M20 11a8 8 0 10-2.3 5.7M20 5v6h-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <button
            type="button"
            className="tasks-icon"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <form className="tasks-new" onSubmit={submit}>
          <input
            ref={inputRef}
            className="tasks-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            maxLength={200}
          />

          {current?.hasPriority !== false && (
            <label className="tasks-picker small">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                aria-label="Priority"
              >
                <option value="">Priority</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
              <Caret />
            </label>
          )}

          {current?.hasDue !== false && (
            <input
              type="date"
              className="tasks-date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              aria-label="Due date"
            />
          )}

          <button type="submit" className="tasks-add" disabled={!title.trim()}>
            Add
          </button>
        </form>

        {state === "unconfigured" ? (
          <p className="tasks-empty">Notion is not connected on the server.</p>
        ) : state === "error" ? (
          <p className="tasks-empty">
            No answer from the server. If it was started before this feature, it needs a restart.
            <button type="button" className="tasks-retry" onClick={onRefresh}>
              Try again
            </button>
          </p>
        ) : state === "loading" && tasks.length === 0 ? (
          <p className="tasks-empty">Loading…</p>
        ) : (
          <div
            className="tasks-columns"
            style={{ gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(0, 1fr))` }}
          >
            {columns.map((column, i) => (
              <section
                key={column.name}
                className={`tasks-column${over === column.name ? " is-over" : ""}`}
                data-column={i % 4}
                onDragOver={(e) => {
                  // Without preventDefault the browser refuses the drop.
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragging.current && dragging.current.from !== column.name) {
                    setOver(column.name);
                  }
                }}
                onDragLeave={(e) => {
                  // Leaving for a child of this column is not leaving it.
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  setOver((name) => (name === column.name ? null : name));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  const page = e.dataTransfer.getData("text/task-id") || dragging.current?.id;
                  const from = dragging.current?.from;
                  dragging.current = null;
                  if (page && from !== column.name) onMove(page, column.name);
                }}
              >
                <h3>
                  <span className="col-dot" />
                  {column.name}
                  <span className="col-count">{column.items.length}</span>
                </h3>

                <div className="tasks-stack">
                  {column.items.map((task) => {
                    const isNew = flagged.has(task.id);
                    const label = task.due ? dueLabel(task.due) : null;
                    return (
                      <a
                        key={task.id}
                        className={`tasks-card${isNew ? " is-new" : ""}`}
                        href={task.url}
                        target="_blank"
                        rel="noreferrer"
                        data-priority={task.priority?.toLowerCase() ?? "none"}
                        draggable
                        onDragStart={(e) => {
                          dragging.current = { id: task.id, from: column.name };
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/task-id", task.id);
                          // A link drags its href by default, which offers the
                          // Notion URL to every other drop target on the desktop.
                          e.dataTransfer.setData("text/plain", task.title);
                        }}
                        onDragEnd={() => {
                          dragging.current = null;
                          setOver(null);
                        }}
                      >
                        <span className="tasks-card-title">{task.title}</span>

                        {(task.priority || label || isNew) && (
                          <span className="tasks-card-meta">
                            {isNew && (
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
                                <span className="bang-dot" />
                                New
                              </button>
                            )}
                            {task.priority && (
                              <span className={`tasks-pill p-${task.priority.toLowerCase()}`}>
                                {task.priority}
                              </span>
                            )}
                            {label && (
                              <span className={`tasks-pill d-${label.tone}`}>{label.text}</span>
                            )}
                          </span>
                        )}
                      </a>
                    );
                  })}

                  {column.items.length === 0 && <p className="tasks-none">Nothing here</p>}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
