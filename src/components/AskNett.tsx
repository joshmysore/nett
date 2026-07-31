import {
  Database,
  PaperPlaneTilt,
  Sparkle,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { AgentAnswer, Overview, Person } from "@/types";

export function AskNett({
  overview,
  onOpen,
}: {
  overview: Overview;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<AgentAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prompts = useMemo(() => {
    const location = overview.locations?.[0]?.[0];
    const industry = overview.industries?.[0]?.[0];
    return [
      overview.cold > 0 ? "Which cold ties are worth revisiting?" : "Who have I not contacted recently?",
      location ? `Who could I reconnect with in ${location}?` : "Where are my strongest clusters?",
      industry ? `Who knows the most about ${industry}?` : "Who could make a useful introduction?",
    ];
  }, [overview]);

  const ask = async (value = query) => {
    const next = value.trim();
    if (!next) return;
    setQuery(next);
    setLoading(true);
    setError(null);
    try {
      setAnswer(await api.query(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nett could not answer that query");
    } finally {
      setLoading(false);
    }
  };

  const citations = answer
    ? [
        ...new Map(
          (answer.citations || []).map((citation) => [
            `${citation.personId}:${citation.field}`,
            citation,
          ]),
        ).values(),
      ].slice(0, 6)
    : [];

  return (
    <section className="insight-panel ask-workspace glass-panel" aria-labelledby="ask-nett-title">
      <div className="ai-heading">
        <div className="ai-glyph">
          <Sparkle size={20} weight="fill" />
        </div>
        <div>
          <h2 id="ask-nett-title">Ask Nett</h2>
          <p>Every answer links back to local evidence.</p>
        </div>
      </div>

      <form
        className="agent-input"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <label className="sr-only" htmlFor="agent-query">
          Ask about your network
        </label>
        <textarea
          id="agent-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ask who to contact, what you know, or where a connection came from"
          aria-describedby="agent-provider"
        />
        <button aria-label="Ask Nett" disabled={loading || !query.trim()}>
          {loading ? (
            <SpinnerGap className="spin" size={17} />
          ) : (
            <PaperPlaneTilt size={17} weight="fill" />
          )}
        </button>
      </form>

      {!answer && (
        <div className="query-prompts" aria-label="Suggested questions">
          {prompts.map((prompt) => (
            <button key={prompt} onClick={() => void ask(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
      )}

      <div className="agent-status" aria-live="polite">
        {loading && <span>Searching people, memories, and source evidence...</span>}
      </div>

      {answer && !loading && (
        <div className="agent-answer">
          <p>{answer.answer}</p>
          {citations.length > 0 && (
            <div className="citation-list" aria-label="Answer evidence">
              {citations.map((citation) => (
                <button
                  key={`${citation.personId}:${citation.field}`}
                  onClick={() => onOpen(citation.personId)}
                >
                  <span>{citation.label}</span>
                  <small>
                    {citation.source} / {citation.field.replace(/_/g, " ")}
                  </small>
                </button>
              ))}
            </div>
          )}
          <button className="text-button" onClick={() => setAnswer(null)}>
            Ask another question
          </button>
        </div>
      )}

      {error && (
        <p className="inline-error" role="alert">
          <WarningCircle size={15} />
          {error}
        </p>
      )}
      <div className="provider-note" id="agent-provider">
        <Database size={13} />
        Local evidence only
      </div>
    </section>
  );
}

export function personContext(person: Person) {
  return [person.company, person.location, person.industry].filter(Boolean).join(" / ");
}
