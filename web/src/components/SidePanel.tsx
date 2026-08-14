"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  TEAM_CHANNEL,
  dmChannel,
  dmParticipants,
  type ChatMessage,
  type PlayerState,
  type PresenceStatus,
} from "@wtoffice/shared";

export type PanelTab = "chat" | "people";

const STATUS_LABEL: Record<PresenceStatus, string> = {
  available: "Available",
  focusing: "Focusing",
  away: "Away",
};

export interface SidePanelProps {
  players: PlayerState[];
  self: PlayerState | undefined;
  tab: PanelTab;
  onTab(tab: PanelTab): void;
  onClose(): void;

  activeChannel: string;
  onChannel(channel: string): void;
  messages: ChatMessage[];
  hasMore: boolean;
  unread: Record<string, number>;
  onSend(body: string): void;
  onLoadOlder(): void;

  onStatus(status: PresenceStatus, note: string): void;
  /** Walk the local player over to someone. */
  onFind(playerId: string): void;
  /** Where each player is, by area or room name. */
  locationOf(player: PlayerState): string;

}

export function SidePanel(props: SidePanelProps) {
  const { tab, onTab, onClose, unread } = props;

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);

  return (
    <aside className="panel">
      <header className="panel-tabs">
        <button
          type="button"
          className={tab === "chat" ? "on" : ""}
          onClick={() => onTab("chat")}
        >
          Chat
          {totalUnread > 0 && tab !== "chat" && <span className="pip">{totalUnread}</span>}
        </button>
        <button
          type="button"
          className={tab === "people" ? "on" : ""}
          onClick={() => onTab("people")}
        >
          People
        </button>
        <span className="panel-spacer" />
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close panel">
          ×
        </button>
      </header>

      {tab === "chat" ? <ChatTab {...props} /> : <PeopleTab {...props} />}
    </aside>
  );
}

/* ── Chat ──────────────────────────────────────────────────────── */

function ChatTab({
  players,
  self,
  activeChannel,
  onChannel,
  messages,
  hasMore,
  unread,
  onSend,
  onLoadOlder,
}: SidePanelProps) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef(true);

  // Stick to the bottom only if the reader was already there — otherwise a new
  // message would yank them away from what they were reading.
  useEffect(() => {
    const el = listRef.current;
    if (el && bottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const dmThreads = useMemo(() => {
    if (!self) return [];
    return players
      .filter((p) => p.identity !== self.identity)
      .map((p) => ({ player: p, channel: dmChannel(self.identity, p.identity) }));
  }, [players, self]);

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    setDraft("");
  };

  const activeName = (() => {
    if (activeChannel === TEAM_CHANNEL) return "Team";
    const participants = dmParticipants(activeChannel);
    const other = participants?.find((p) => p !== self?.identity);
    return players.find((p) => p.identity === other)?.name ?? other ?? "Direct message";
  })();

  return (
    <div className="panel-body">
      <div className="channels">
        <button
          type="button"
          className={`channel${activeChannel === TEAM_CHANNEL ? " on" : ""}`}
          onClick={() => onChannel(TEAM_CHANNEL)}
        >
          <span className="channel-hash">#</span> team
          {unread[TEAM_CHANNEL] > 0 && <span className="pip">{unread[TEAM_CHANNEL]}</span>}
        </button>

        {dmThreads.map(({ player, channel }) => (
          <button
            key={channel}
            type="button"
            className={`channel${activeChannel === channel ? " on" : ""}`}
            onClick={() => onChannel(channel)}
          >
            <span className="swatch" style={{ background: player.color }} />
            {player.name}
            {unread[channel] > 0 && <span className="pip">{unread[channel]}</span>}
          </button>
        ))}
      </div>

      <div
        className="messages"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          bottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {hasMore && (
          <button type="button" className="load-older" onClick={onLoadOlder}>
            Load older messages
          </button>
        )}

        {messages.length === 0 ? (
          <p className="empty">
            {activeChannel === TEAM_CHANNEL
              ? "Nothing here yet. This one is for everybody."
              : `No messages with ${activeName} yet.`}
          </p>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            // Group consecutive messages from the same person within 5 minutes.
            const grouped = prev && prev.identity === m.identity && m.at - prev.at < 5 * 60_000;
            return (
              <div key={m.id} className={`msg${grouped ? " grouped" : ""}`}>
                {!grouped && (
                  <div className="msg-head">
                    <strong>{m.author}</strong>
                    <time>{formatTime(m.at)}</time>
                  </div>
                )}
                <div className="msg-body">{m.body}</div>
              </div>
            );
          })
        )}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, shift+enter breaks the line.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={`Message ${activeChannel === TEAM_CHANNEL ? "the team" : activeName}`}
          rows={2}
        />
        <button type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

/* ── People ────────────────────────────────────────────────────── */

function PeopleTab({ players, self, onStatus, onFind, onChannel, onTab, locationOf }: SidePanelProps) {
  const [note, setNote] = useState(self?.note ?? "");

  // Adopt the server's note when it changes underneath us (e.g. reconnect),
  // but never while the field is being edited.
  const noteRef = useRef(note);
  noteRef.current = note;
  useEffect(() => {
    if (self && self.note !== noteRef.current) setNote(self.note);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [self?.note]);

  return (
    <div className="panel-body">
      <div className="you">
        <div className="you-head">You</div>
        <div className="status-picker">
          {(["available", "focusing", "away"] as PresenceStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              className={`status-btn ${s}${self?.status === s ? " on" : ""}`}
              onClick={() => onStatus(s, note)}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <input
          className="note-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => onStatus(self?.status ?? "available", note)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onStatus(self?.status ?? "available", note);
              e.currentTarget.blur();
            }
          }}
          placeholder="Add a note — heads down till 3"
          maxLength={80}
        />
      </div>

      <div className="roster">
        {players.map((p) => (
          <div key={p.id} className="person">
            <span className="swatch" style={{ background: p.color }} />
            <div className="person-main">
              <div className="person-name">
                {p.name}
                {p.identity === self?.identity && <span className="you-tag">you</span>}
              </div>
              <div className="person-meta">
                <span className={`status-dot ${p.status}`} />
                {p.note ? p.note : STATUS_LABEL[p.status]} · {locationOf(p)}
              </div>
            </div>
            {p.identity !== self?.identity && (
              <div className="person-actions">
                <button type="button" onClick={() => onFind(p.id)} title="Walk over to them">
                  Find
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!self) return;
                    onChannel(dmChannel(self.identity, p.identity));
                    onTab("chat");
                  }}
                >
                  Message
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
