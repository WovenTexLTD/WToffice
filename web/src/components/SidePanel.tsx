"use client";

import { useEffect, useRef, useState } from "react";
import type { PlayerState, PresenceStatus } from "@wtoffice/shared";

const STATUS_LABEL: Record<PresenceStatus, string> = {
  available: "Available",
  focusing: "Focusing",
  away: "Away",
};

export interface SidePanelProps {
  players: PlayerState[];
  self: PlayerState | undefined;
  onClose(): void;

  onStatus(status: PresenceStatus, note: string): void;
  /** Walk the local player over to someone. */
  onFind(playerId: string): void;
  /** Where each player is, by area or room name. */
  locationOf(player: PlayerState): string;
}

/**
 * Who is in, where they are, and how to set your own status.
 *
 * A single view since chat was removed — there is nothing left to tab between,
 * and a tab strip with one tab in it is furniture.
 */
export function SidePanel({ players, self, onClose, onStatus, onFind, locationOf }: SidePanelProps) {
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
    <aside className="panel">
      <header className="panel-tabs">
        <span className="panel-title">People</span>
        <span className="panel-spacer" />
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close panel">
          ×
        </button>
      </header>

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
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
