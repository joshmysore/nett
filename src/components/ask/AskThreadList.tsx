import { CaretLeft, Plus, SidebarSimple, Trash } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { AskThreadSummary } from "@/lib/api";
import { threadDayLabel } from "@/lib/ask-display";

export function AskThreadList({
  threads,
  activeId,
  open,
  onToggle,
  onNew,
  onSelect,
  onRename,
  onArchive,
  onArchiveAll,
}: {
  threads: AskThreadSummary[];
  activeId: string | null;
  open: boolean;
  onToggle: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onArchive: (id: string) => void;
  onArchiveAll: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const groups = useMemo(() => {
    const order: Array<{ label: string; items: AskThreadSummary[] }> = [];
    const byLabel = new Map<string, AskThreadSummary[]>();
    for (const thread of threads) {
      const label = threadDayLabel(thread.updatedAt);
      const existing = byLabel.get(label);
      if (existing) {
        existing.push(thread);
        continue;
      }
      const items = [thread];
      byLabel.set(label, items);
      order.push({ label, items });
    }
    return order;
  }, [threads]);

  if (!open) {
    return (
      <aside className="ask-threads is-collapsed" aria-label="Conversations">
        <button
          type="button"
          className="ask-threads-toggle"
          aria-expanded={false}
          aria-controls="ask-conversations"
          onClick={onToggle}
        >
          <SidebarSimple size={16} aria-hidden="true" />
          <span className="sr-only">Show conversations</span>
        </button>
        <button type="button" className="ask-threads-toggle" onClick={onNew} aria-label="New chat">
          <Plus size={16} aria-hidden="true" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="ask-threads" id="ask-conversations" aria-label="Conversations">
      <div className="ask-threads-head">
        <div className="ask-threads-title">
          <h2>Conversations</h2>
          <button
            type="button"
            className="ask-threads-toggle"
            aria-expanded={true}
            aria-controls="ask-conversations"
            onClick={onToggle}
          >
            <CaretLeft size={14} aria-hidden="true" />
            <span className="sr-only">Hide conversations</span>
          </button>
        </div>
        <div className="ask-threads-actions">
          <button type="button" className="ask-threads-new" onClick={onNew}>
            <Plus size={14} aria-hidden="true" />
            New chat
          </button>
          {threads.length > 0 && (
            <button type="button" className="ask-threads-clear" onClick={onArchiveAll}>
              <Trash size={13} aria-hidden="true" />
              Delete all
            </button>
          )}
        </div>
      </div>
      {threads.length === 0 ? (
        <p className="ask-threads-empty">Past questions stay here.</p>
      ) : (
        <nav>
          {groups.map((group) => (
            <section key={group.label}>
              <h3>{group.label}</h3>
              <ul>
                {group.items.map((thread) => {
                  const selected = thread.id === activeId;
                  return (
                    <li key={thread.id} className={selected ? "is-active" : undefined}>
                      {editing === thread.id ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            const next = String(new FormData(event.currentTarget).get("title") || "").trim();
                            if (next) onRename(thread.id, next);
                            setEditing(null);
                          }}
                        >
                          <input
                            name="title"
                            defaultValue={thread.title}
                            aria-label="Conversation title"
                            autoFocus
                            onBlur={(event) => {
                              const next = event.currentTarget.value.trim();
                              if (next && next !== thread.title) onRename(thread.id, next);
                              setEditing(null);
                            }}
                          />
                        </form>
                      ) : (
                        <button
                          type="button"
                          className="ask-thread-item"
                          onClick={() => onSelect(thread.id)}
                          onDoubleClick={() => setEditing(thread.id)}
                        >
                          {thread.title}
                        </button>
                      )}
                      <button
                        type="button"
                        className="ask-thread-archive"
                        aria-label={`Delete ${thread.title}`}
                        onClick={() => onArchive(thread.id)}
                      >
                        <Trash size={13} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </nav>
      )}
    </aside>
  );
}
