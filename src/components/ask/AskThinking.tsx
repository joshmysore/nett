import { CaretDown } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { AskStageOrb } from "@/components/ask-fx";
import type { AskStage } from "@/lib/ask-display";

export function AskThinking({
  stages,
  loading,
  elapsed,
}: {
  stages: AskStage[];
  loading: boolean;
  elapsed: string;
}) {
  const [open, setOpen] = useState(true);
  const current = [...stages].reverse().find((stage) => !stage.done) || stages[stages.length - 1];

  useEffect(() => {
    if (loading) setOpen(true);
  }, [loading]);

  if (!stages.length && !loading) return null;

  const currentId = current?.id || "search";
  const trace = stages.length
    ? stages
    : [{ id: "search", label: "Searching records", done: false }];

  return (
    <div className="ask-thinking-block">
      <button
        type="button"
        className="ask-thinking"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <AskStageOrb id={currentId} live={loading} />
        <span className={`ask-thinking-label ${loading ? "is-live" : ""}`}>
          {loading ? current?.label || "Searching records" : elapsed ? `Thought for ${elapsed}` : "Thought process"}
        </span>
        {elapsed && loading ? <span className="ask-thinking-time">{elapsed}</span> : null}
        <CaretDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <ol className="ask-trace" aria-live="polite">
          {trace.map((stage) => (
            <li key={stage.id} className={stage.done ? "is-done" : "is-live"}>
              <AskStageOrb id={stage.id} live={loading && !stage.done} />
              <span>
                <strong>{stage.label}</strong>
                {stage.detail ? <small>{stage.detail}</small> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
