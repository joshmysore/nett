import { ArrowRight, PaperPlaneTilt, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { api, isAbortError } from "@/lib/api";
import type { AgentAnswer, Person } from "@/types";

type ModelState =
  | { checked: false }
  | { checked: true; available: boolean; model?: string; documents?: number };

const examples = [
  "What do I know about the people I contacted most recently?",
  "Which people have I written notes about?",
  "Where did I meet the people I know best?",
];

/** The server answers either with a local model or, when the model call fails,
 *  with the raw evidence rows it matched. Say which one happened. */
function providerNote(provider: string) {
  if (provider.startsWith("ollama:")) {
    return `Written by ${provider.slice("ollama:".length)} running on this Mac.`;
  }
  return "No model output. These are the stored records that matched the question.";
}

export function AskNett({ onOpen }: { onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<AgentAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<ModelState>({ checked: false });
  const abortRef = useRef<AbortController | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    let current = true;
    api
      .intelligenceStatus()
      .then((status) => {
        if (!current) return;
        setModel({
          checked: true,
          available: Boolean(status.ok),
          model: status.selectedModel,
          documents: status.evidenceDocuments,
        });
      })
      .catch(() => current && setModel({ checked: true, available: false }));
    return () => {
      current = false;
      abortRef.current?.abort();
    };
  }, []);

  const ask = async (value = query) => {
    const next = value.trim();
    if (!next) return;
    setQuery(next);
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.query(next, abort.signal);
      if (id !== requestId.current || abort.signal.aborted) return;
      setAnswer(result);
    } catch (reason) {
      if (isAbortError(reason) || abort.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : "Nett could not answer that question");
    } finally {
      if (id === requestId.current) setLoading(false);
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
    <section className="ask" aria-labelledby="ask-nett-title">
      <h2 id="ask-nett-title">Ask Nett</h2>
      <p className="ask-note">
        Questions run against the records stored on this Mac. Nothing is sent anywhere
        else.
      </p>

      <form
        className="ask-form"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <label className="sr-only" htmlFor="ask-nett-query">
          Ask a question about your records
        </label>
        <textarea
          id="ask-nett-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ask about a person, a place you met someone, or something you wrote down"
          aria-describedby="ask-nett-provider"
        />
        <button className="ask-send" disabled={loading || !query.trim()}>
          {loading ? (
            <SpinnerGap className="spin" size={16} aria-hidden="true" />
          ) : (
            <PaperPlaneTilt size={16} aria-hidden="true" />
          )}
          <span className="sr-only">Ask</span>
        </button>
      </form>

      {!answer && !loading && (
        <ul className="ask-examples">
          {examples.map((example) => (
            <li key={example}>
              <button onClick={() => void ask(example)}>
                {example}
                <ArrowRight size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="ask-status" aria-live="polite">
        {loading && <span>Searching stored records...</span>}
      </div>

      {answer && !loading && (
        <div className="ask-answer">
          <p className="ask-provenance">{providerNote(answer.provider)}</p>
          <p>
            {answer.answer?.trim() ||
              "That question came back empty. Try naming a person, a place, or a phrase you would have written down."}
          </p>
          {citations.length ? (
            <ul className="ask-citations">
              {citations.map((citation) => (
                <li key={`${citation.personId}:${citation.field}`}>
                  <button onClick={() => onOpen(citation.personId)}>
                    <span>{citation.label}</span>
                    <small>
                      {citation.source} / {citation.field.replace(/_/g, " ")}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ask-uncited">
              No stored record was linked to this answer, so there is nothing to check it
              against. Treat it as a guess.
            </p>
          )}
          <button className="text-button" onClick={() => setAnswer(null)}>
            Ask something else
          </button>
        </div>
      )}

      {error && (
        <p className="inline-error" role="alert">
          <WarningCircle size={15} aria-hidden="true" />
          {error}
          <button className="text-button" onClick={() => void ask()}>
            Try again
          </button>
        </p>
      )}

      <p className="ask-provider" id="ask-nett-provider">
        {!model.checked
          ? "Checking whether a local model is running..."
          : model.available
            ? `Local model ${model.model || "unnamed"} is running${
                typeof model.documents === "number"
                  ? ` over ${model.documents.toLocaleString()} indexed records`
                  : ""
              }. Its answers are generated text, not stored facts.`
            : "No local model is running. Nett will return the stored records that match your question instead of a written answer."}
      </p>
    </section>
  );
}

export function personContext(person: Pick<Person, "company" | "location" | "industry">) {
  return [person.company, person.location, person.industry].filter(Boolean).join(" / ");
}
