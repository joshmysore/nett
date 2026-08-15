import {
  ArrowRight,
  CaretDown,
  Copy,
  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AskComposer, type AskComposerValue, type AskPersonRef } from "@/components/AskComposer";
import { Avatar } from "@/components/Primitives";
import {
  abilityById,
  composeAskQuestion,
  primaryAskAbility,
} from "@/lib/ask-composer";
import { api, isAbortError } from "@/lib/api";
import type { AgentAnswer, Citation, Person } from "@/types";

type ModelState =
  | { checked: false }
  | {
      checked: true;
      available: boolean;
      model?: string;
      reasonModel?: string;
      embedModel?: string;
      documents?: number;
      indexedAt?: string | null;
      interactionIndexedAt?: string | null;
      stale?: boolean;
      staleSources?: string[];
    };

type Stage = {
  id: string;
  label: string;
  detail?: string;
  done: boolean;
};

type Turn = {
  id: number;
  question: string;
  people: AskPersonRef[];
  abilities: AskComposerValue["abilities"];
  answer: AgentAnswer | null;
  stages: Stage[];
  error: string | null;
  loading: boolean;
};

const emptyComposer = (): AskComposerValue => ({ text: "", people: [], abilities: [] });

const examples = [
  "Who do I know in Paris who like spicy food?",
  "Who might be interested in legal tech?",
  "What do I know about the people I contacted most recently?",
];

const PIXEL_DELAYS = [0, 90, 180, 90, 180, 270, 180, 270, 360];

function relativeAge(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function indexNote(model: Extract<ModelState, { checked: true }>): string {
  const age = relativeAge(model.interactionIndexedAt || model.indexedAt);
  const stale = model.staleSources || [];
  if (stale.includes("messages") || stale.includes("whatsapp")) {
    return "Index is behind Messages or WhatsApp.";
  }
  if (age) return `Indexed ${age}`;
  return "Index age unknown";
}

function providerNote(answer: AgentAnswer) {
  if (answer.note) return answer.note;
  if (answer.provider.startsWith("ollama:")) {
    return `Written by ${answer.provider.slice("ollama:".length)} on this Mac.`;
  }
  if (answer.provider === "local-people-index") return "From the people index.";
  return "From stored records.";
}

function cleanExcerpt(value: string) {
  return value
    .replace(/\bdirection:\s*(incoming|outgoing)\b/gi, "")
    .replace(/\b(conversation|subject):\s*/gi, "")
    .replace(/^name:\s*/i, "")
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?/g, (iso) => {
      const ms = Date.parse(iso);
      if (!Number.isFinite(ms)) return iso;
      return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    })
    .replace(/\s+/g, " ")
    .trim();
}

function sourceLabel(source: string) {
  if (source === "messages") return "Messages";
  if (source === "whatsapp") return "WhatsApp";
  if (source === "gmail") return "Gmail";
  if (source === "telegram") return "Telegram";
  return source;
}

type PersonHit = {
  personId: string;
  name: string;
  sources: string[];
  excerpts: Citation[];
};

function groupCitations(citations: Citation[]): PersonHit[] {
  const order: PersonHit[] = [];
  const byId = new Map<string, PersonHit>();
  for (const citation of citations) {
    if (!citation.personId) continue;
    const existing = byId.get(citation.personId);
    const excerpt = cleanExcerpt(citation.value || "");
    if (existing) {
      if (citation.source && !existing.sources.includes(citation.source)) {
        existing.sources.push(citation.source);
      }
      if (excerpt && !existing.excerpts.some((item) => item.value === citation.value)) {
        existing.excerpts.push(citation);
      }
      continue;
    }
    const next: PersonHit = {
      personId: citation.personId,
      name: citation.label,
      sources: citation.source ? [citation.source] : [],
      excerpts: excerpt ? [citation] : [],
    };
    byId.set(citation.personId, next);
    order.push(next);
  }
  return order.slice(0, 8);
}

function followUps(question: string, people: PersonHit[]): string[] {
  const first = people[0]?.name;
  if (people.length === 1 && first) {
    return [
      `What have ${first} and I talked about recently?`,
      `What else should I remember about ${first}?`,
    ];
  }
  return [
    first ? `What else do I know about ${first}?` : "",
    /paris|london|new york|lisbon/i.test(question)
      ? "Who have I talked to there recently?"
      : "Who have I talked to about this recently?",
  ].filter(Boolean);
}

function useElapsed(active: boolean) {
  const [ds, setDs] = useState(0);
  useEffect(() => {
    if (!active) {
      setDs(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => setDs(Math.floor((Date.now() - started) / 100)), 100);
    return () => window.clearInterval(timer);
  }, [active]);
  const total = ds / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

function upsertStage(stages: Stage[], next: Omit<Stage, "done"> & { done?: boolean }): Stage[] {
  const done = next.done ?? false;
  const existing = stages.findIndex((stage) => stage.id === next.id);
  const marked = stages.map((stage, index) => (
    index === existing ? { ...stage, ...next, done } : { ...stage, done: true }
  ));
  if (existing >= 0) return marked;
  return [...stages.map((stage) => ({ ...stage, done: true })), { ...next, done }];
}

function PixelGrid() {
  return (
    <span className="ask-pixel" aria-hidden="true">
      {PIXEL_DELAYS.map((delay, index) => (
        <span key={index} style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}

function ThinkingTrace({
  stages,
  loading,
  elapsed,
}: {
  stages: Stage[];
  loading: boolean;
  elapsed: string;
}) {
  const [open, setOpen] = useState(true);
  const current = [...stages].reverse().find((stage) => !stage.done) || stages[stages.length - 1];
  if (!stages.length && !loading) return null;

  return (
    <div className="ask-thinking-block">
      <button
        type="button"
        className="ask-thinking"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {loading ? <PixelGrid /> : <span className="ask-pixel is-still" aria-hidden="true" />}
        <span className={`ask-thinking-label ${loading ? "is-live" : ""}`}>
          {loading ? current?.label || "Searching records" : "Thought process"}
        </span>
        {elapsed ? <span className="ask-thinking-time">{elapsed}</span> : null}
        <CaretDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <ol className="ask-trace">
          {(stages.length ? stages : [{ id: "search", label: "Searching records", done: false }]).map((stage) => (
            <li key={stage.id} className={stage.done ? "is-done" : "is-live"}>
              <i aria-hidden="true" />
              <span>
                <strong>{stage.label}</strong>
                {stage.detail ? <small>{stage.detail}</small> : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function StreamingWords({
  text,
  live,
}: {
  text: string;
  live: boolean;
}) {
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((part, index) =>
        part.trim() ? (
          <span key={`${index}:${part}`} className={live ? "ask-word" : undefined}>
            {part}
          </span>
        ) : (
          <span key={`s${index}`}>{part}</span>
        ),
      )}
    </>
  );
}

function CitedProse({
  text,
  people,
  live,
  onOpen,
}: {
  text: string;
  people: PersonHit[];
  live: boolean;
  onOpen: (id: string, index: number) => void;
}) {
  const parts: Array<
    | { type: "text"; value: string }
    | { type: "cite"; person: PersonHit; index: number }
  > = [];
  let cursor = 0;
  const found = people
    .map((person, index) => {
      const at = text.toLocaleLowerCase().indexOf(person.name.toLocaleLowerCase());
      return at >= 0 ? { person, index, at } : null;
    })
    .filter((item): item is { person: PersonHit; index: number; at: number } => Boolean(item))
    .sort((a, b) => a.at - b.at);
  for (const hit of found) {
    if (hit.at < cursor) continue;
    if (hit.at > cursor) parts.push({ type: "text", value: text.slice(cursor, hit.at) });
    parts.push({ type: "text", value: text.slice(hit.at, hit.at + hit.person.name.length) });
    parts.push({ type: "cite", person: hit.person, index: hit.index });
    cursor = hit.at + hit.person.name.length;
  }
  if (cursor < text.length) parts.push({ type: "text", value: text.slice(cursor) });
  if (!parts.length) parts.push({ type: "text", value: text });

  return (
    <p className="ask-prose">
      {parts.map((part, i) =>
        part.type === "cite" ? (
          <button
            key={`${part.person.personId}:${i}`}
            type="button"
            className="ask-cite"
            onClick={() => onOpen(part.person.personId, part.index)}
            aria-label={`Evidence for ${part.person.name}`}
          >
            {part.index + 1}
          </button>
        ) : (
          <StreamingWords key={`t${i}`} text={part.value} live={live} />
        ),
      )}
    </p>
  );
}

function SelectionActions({ root }: { root: HTMLElement | null }) {
  const [copied, setCopied] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number; text: string } | null>(null);

  useEffect(() => {
    if (!root) return;
    const onUp = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() || "";
      if (!text || !selection?.rangeCount || !root.contains(selection.anchorNode)) {
        setBox(null);
        return;
      }
      const range = selection.getRangeAt(0).getBoundingClientRect();
      const host = root.getBoundingClientRect();
      setCopied(false);
      setBox({
        top: range.top - host.top - 36,
        left: Math.max(0, range.left - host.left + range.width / 2 - 36),
        text,
      });
    };
    document.addEventListener("selectionchange", onUp);
    return () => document.removeEventListener("selectionchange", onUp);
  }, [root]);

  if (!box) return null;
  return (
    <div className="ask-select" style={{ top: box.top, left: box.left }}>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(box.text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          } catch {
            setCopied(false);
          }
        }}
      >
        <Copy size={13} aria-hidden="true" />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function AskNett({ onOpen }: { onOpen: (id: string) => void }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<AskComposerValue>(emptyComposer);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [model, setModel] = useState<ModelState>({ checked: false });
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const threadRef = useRef<HTMLDivElement>(null);
  const answerRef = useRef<HTMLElement | null>(null);
  const loading = turns.some((turn) => turn.loading);
  const elapsed = useElapsed(loading);

  useEffect(() => {
    let current = true;
    api
      .intelligenceStatus()
      .then((status) => {
        if (!current) return;
        setModel({
          checked: true,
          available: Boolean(status.ok),
          model: status.fastModel || status.selectedModel,
          reasonModel: status.reasonModel,
          embedModel: status.embedModel,
          documents: status.evidenceDocuments,
          indexedAt: status.indexedAt,
          interactionIndexedAt: status.interactionIndexedAt,
          stale: status.stale,
          staleSources: status.staleSources,
        });
      })
      .catch(() => current && setModel({ checked: true, available: false }));
    return () => {
      current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [turns]);

  const patchTurn = (id: number, patch: Partial<Turn> | ((current: Turn) => Turn)) => {
    setTurns((current) =>
      current.map((turn) => {
        if (turn.id !== id) return turn;
        return typeof patch === "function" ? patch(turn) : { ...turn, ...patch };
      }),
    );
  };

  const ask = async (
    value = draft.text,
    attached: Pick<AskComposerValue, "people" | "abilities"> = draft,
  ) => {
    const ability = attached.abilities.length
      ? abilityById(primaryAskAbility(attached.abilities) ?? attached.abilities[0])
      : null;
    const next = composeAskQuestion(value, attached.people, ability);
    if (!next) return;
    setDraft(emptyComposer());
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const id = ++requestId.current;
    const payload = {
      query: next,
      personIds: attached.people.map((person) => person.id),
      ability: primaryAskAbility(attached.abilities),
    };
    const turn: Turn = {
      id,
      question: next,
      people: attached.people,
      abilities: attached.abilities,
      answer: { answer: "", citations: [], provider: "local-evidence" },
      stages: [{ id: "search", label: "Searching records", done: false }],
      error: null,
      loading: true,
    };
    setTurns((current) => [...current, turn]);
    setEvidenceOpen(false);
    setCopied(false);
    try {
      let streamed = false;
      try {
        for await (const event of api.queryStream(payload, abort.signal)) {
          if (id !== requestId.current || abort.signal.aborted) return;
          streamed = true;
          if (event.type === "stage") {
            patchTurn(id, (current) => ({
              ...current,
              stages: upsertStage(current.stages, {
                id: event.id,
                label: event.label,
                detail: event.detail,
              }),
            }));
          } else if (event.type === "meta") {
            patchTurn(id, (current) => ({
              ...current,
              answer: {
                answer: current.answer?.answer || "",
                citations: event.citations || [],
                provider: event.provider,
                note: event.note,
              },
            }));
          } else if (event.type === "token") {
            patchTurn(id, (current) => ({
              ...current,
              answer: {
                answer: `${current.answer?.answer || ""}${event.text}`,
                citations: current.answer?.citations || [],
                provider: current.answer?.provider || "local-evidence",
                note: current.answer?.note,
              },
            }));
          } else if (event.type === "reset") {
            patchTurn(id, (current) => ({
              ...current,
              answer: {
                answer: "",
                citations: current.answer?.citations || [],
                provider: current.answer?.provider || "local-evidence",
                note: current.answer?.note,
              },
              stages: upsertStage(current.stages, {
                id: "escalate",
                label: "First pass was thin — trying the larger local model",
              }),
            }));
          } else if (event.type === "done") {
            patchTurn(id, (current) => ({
              ...current,
              loading: false,
              stages: current.stages.map((stage) => ({ ...stage, done: true })),
              answer: {
                answer: event.answer,
                citations: event.citations || [],
                provider: event.provider,
                note: event.note,
              },
            }));
          }
        }
      } catch (reason) {
        if (isAbortError(reason) || abort.signal.aborted) return;
        if (streamed) throw reason;
        const result = await api.query(payload, abort.signal);
        if (id !== requestId.current || abort.signal.aborted) return;
        patchTurn(id, {
          loading: false,
          answer: result,
          stages: [
            { id: "search", label: "Searching records", done: true },
            { id: "write", label: "Writing from stored records", done: true },
          ],
        });
      }
    } catch (reason) {
      if (isAbortError(reason) || abort.signal.aborted) return;
      patchTurn(id, {
        loading: false,
        error: reason instanceof Error ? reason.message : "Nett could not answer that question",
      });
    } finally {
      if (id === requestId.current) {
        patchTurn(id, (current) => ({
          ...current,
          loading: false,
          stages: current.stages.map((stage) => ({ ...stage, done: true })),
        }));
      }
    }
  };

  const latest = turns[turns.length - 1];
  const people = useMemo(
    () => groupCitations(latest?.answer?.citations || []),
    [latest?.answer?.citations],
  );

  const openPerson = (personId: string) => {
    onOpen(personId);
    navigate(`/people/${personId}#recent`);
  };

  const copyAnswer = async (turn: Turn) => {
    const hits = groupCitations(turn.answer?.citations || []);
    const lines = [
      turn.answer?.answer || "",
      ...hits.map((person) => {
        const quote = person.excerpts[0] ? cleanExcerpt(person.excerpts[0].value) : "";
        return quote ? `${person.name}: “${quote}”` : person.name;
      }),
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="ask ask-agent" id="ask" aria-labelledby="ask-nett-title">
      <header className="ask-head">
        <div>
          <h1 id="ask-nett-title">Ask Nett</h1>
          <p className="ask-note">Questions your records. Ask does not write.</p>
        </div>
        {model.checked && <p className="ask-index">{indexNote(model)}</p>}
      </header>

      <div className="ask-thread" ref={threadRef}>
        {!turns.length && (
          <div className="ask-empty">
            <p className="ask-empty-lead">
              Point at a person with <kbd>@</kbd>, or pick an ability with <kbd>/</kbd>.
              Ask still only reads stored records.
            </p>
            <ul className="ask-examples">
              {examples.map((example) => (
                <li key={example}>
                  <button type="button" onClick={() => void ask(example, emptyComposer())}>
                    {example}
                    <ArrowRight size={13} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {turns.map((turn) => {
          const hits = groupCitations(turn.answer?.citations || []);
          const prose = (turn.answer?.answer || "").trim();
          const hasResult = Boolean(prose || hits.length);
          return (
            <article key={turn.id} className="ask-turn">
              <p className="ask-asked">
                <span>You asked</span>
                {(turn.people.length > 0 || turn.abilities.length > 0) && (
                  <span className="ask-asked-refs">
                    {turn.people.map((person) => (
                      <button
                        key={person.id}
                        type="button"
                        className="ask-chip"
                        onClick={() => openPerson(person.id)}
                      >
                        <Avatar person={person} size="sm" />
                        {person.name}
                      </button>
                    ))}
                    {turn.abilities.map((id) => (
                      <span key={id} className="ask-chip ask-chip-ability">
                        <span className="ask-chip-slash" aria-hidden="true">/</span>
                        {abilityById(id).label}
                      </span>
                    ))}
                  </span>
                )}
                {turn.question}
              </p>
              <ThinkingTrace stages={turn.stages} loading={turn.loading} elapsed={turn.loading ? elapsed : ""} />
              {hasResult && (
                <div
                  className="ask-answer"
                  ref={turn.id === latest?.id ? (node) => { answerRef.current = node; } : undefined}
                >
                  <SelectionActions root={turn.id === latest?.id ? answerRef.current : null} />
                  {prose ? (
                    <CitedProse
                      text={prose}
                      people={hits}
                      live={turn.loading}
                      onOpen={(id) => openPerson(id)}
                    />
                  ) : turn.loading ? null : (
                    <p className="ask-prose">
                      That question came back empty. Try naming a person, a place, or a phrase you wrote down.
                    </p>
                  )}

                  {hits.length > 0 && (
                    <ol className="ask-people">
                      {hits.map((person, index) => {
                        const quote = person.excerpts[0] ? cleanExcerpt(person.excerpts[0].value) : "";
                        return (
                          <li key={person.personId}>
                            <button type="button" onClick={() => openPerson(person.personId)}>
                              <span className="ask-cite" aria-hidden="true">{index + 1}</span>
                              <Avatar person={{ id: person.personId, name: person.name }} size="sm" />
                              <span>
                                <strong>{person.name}</strong>
                                {quote ? <small>“{quote.slice(0, 160)}”</small> : (
                                  <small>{person.sources.map(sourceLabel).join(" · ") || "Stored record"}</small>
                                )}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  )}

                  {hits.some((person) => person.excerpts.length) && (
                    <details
                      className="ask-evidence"
                      open={turn.id === latest?.id ? evidenceOpen : false}
                      onToggle={(event) => {
                        if (turn.id === latest?.id) setEvidenceOpen(event.currentTarget.open);
                      }}
                    >
                      <summary>
                        Evidence
                        <span>{hits.reduce((count, person) => count + person.excerpts.length, 0)}</span>
                        <CaretDown size={14} aria-hidden="true" />
                      </summary>
                      <ul>
                        {hits.flatMap((person) =>
                          person.excerpts.slice(0, 2).map((citation, index) => (
                            <li key={`${person.personId}:${index}`}>
                              <button type="button" onClick={() => openPerson(person.personId)}>
                                <strong>{person.name}</strong>
                                <small>
                                  {sourceLabel(citation.source)}
                                  {citation.field ? ` · ${citation.field.replace(/_/g, " ")}` : ""}
                                </small>
                                <span>{cleanExcerpt(citation.value).slice(0, 180)}</span>
                              </button>
                            </li>
                          )),
                        )}
                      </ul>
                    </details>
                  )}

                  {!hits.length && !turn.loading && prose && (
                    <p className="ask-uncited">
                      No stored record was linked to this answer. Treat it as a guess.
                    </p>
                  )}

                  {!turn.loading && (
                    <div className="ask-actions">
                      <button type="button" className="text-button" onClick={() => void copyAnswer(turn)}>
                        <Copy size={14} aria-hidden="true" />
                        {copied && turn.id === latest?.id ? "Copied" : "Copy"}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setDraft({
                            text: turn.question,
                            people: turn.people,
                            abilities: turn.abilities,
                          });
                          void ask(turn.question, turn);
                        }}
                      >
                        Retry
                      </button>
                      {turn.answer && <span className="ask-path">{providerNote(turn.answer)}</span>}
                    </div>
                  )}
                </div>
              )}
              {turn.error && (
                <p className="inline-error" role="alert">
                  <WarningCircle size={15} aria-hidden="true" />
                  {turn.error}
                  <button className="text-button" onClick={() => void ask(turn.question, turn)}>
                    Try again
                  </button>
                </p>
              )}
            </article>
          );
        })}

        {latest && !latest.loading && people.length > 0 && (
          <div className="ask-follow">
            <p>Follow-ups</p>
            {followUps(latest.question, people).map((item) => (
              <button key={item} type="button" onClick={() => void ask(item)}>
                <ArrowRight size={12} aria-hidden="true" />
                {item}
              </button>
            ))}
          </div>
        )}
      </div>

      <AskComposer
        value={draft}
        loading={loading}
        describedBy="ask-nett-provider"
        onChange={setDraft}
        onSubmit={() => void ask()}
        onStop={() => abortRef.current?.abort()}
      />

      <p className="ask-provider" id="ask-nett-provider">
        {!model.checked
          ? "Checking the local model…"
          : model.available
            ? `Local ${model.model || "model"} · Ask never writes.`
            : "No local model. Matches come from stored records only."}
      </p>
    </section>
  );
}

export function personContext(person: Pick<Person, "company" | "location" | "industry">) {
  return [person.company, person.location, person.industry].filter(Boolean).join(" / ");
}
