import {
  ArrowRight,
  CaretDown,
  Copy,
  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AskComposer, type AskComposerValue, type AskPersonRef } from "@/components/AskComposer";
import { AskMarkdown } from "@/components/ask/AskMarkdown";
import { AskPersonCard } from "@/components/ask/AskPersonCard";
import { AskRuntimeProvider } from "@/components/ask/AskRuntime";
import { AskThinking } from "@/components/ask/AskThinking";
import { AskThreadList } from "@/components/ask/AskThreadList";
import { Avatar } from "@/components/Primitives";
import {
  abilityById,
  composeAskQuestion,
  primaryAskAbility,
  type AskAbilityId,
} from "@/lib/ask-composer";
import {
  api,
  isAbortError,
  type AskThreadMessage,
  type AskThreadSummary,
  type AskWriterId,
} from "@/lib/api";
import {
  cleanExcerpt,
  groupCitations,
  relativeAge,
  type AskStage,
} from "@/lib/ask-display";
import { buildAskSuggestions, type AskSuggestion } from "@/lib/ask-suggestions";
import { applyAskStreamEvent, emptyAskLiveAnswer } from "@/lib/ask-stream";
import type { AgentAnswer, Citation, Person } from "@/types";

const THREADS_OPEN_KEY = "nett.ask.threadsOpen";

type ModelState =
  | { checked: false }
  | {
      checked: true;
      available: boolean;
      model?: string;
      askWriter?: AskWriterId;
      askWriterDisclosure?: string;
      askWriterHasKey?: boolean;
      interactionIndexedAt?: string | null;
      indexedAt?: string | null;
      staleSources?: string[];
    };

type AskUiMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  people: AskPersonRef[];
  abilities: AskAbilityId[];
  stages: AskStage[];
  evidence: Array<{ id: string; title: string; text: string }>;
  citations: Citation[];
  provider?: string;
  note?: string;
  error: string | null;
  loading: boolean;
  createdAt: string;
};

const emptyComposer = (): AskComposerValue => ({ text: "", people: [], abilities: [] });

function readThreadsOpen(): boolean {
  try {
    return window.localStorage.getItem(THREADS_OPEN_KEY) !== "0";
  } catch {
    return true;
  }
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

function providerNote(answer: Pick<AgentAnswer, "provider" | "note">) {
  if (answer.provider.endsWith(":error")) {
    return answer.note || "OpenRouter did not return an answer.";
  }
  if (answer.note) return answer.note;
  if (answer.provider.startsWith("openrouter:")) {
    return `Written by ${answer.provider.slice("openrouter:".length)} via OpenRouter. Records left this Mac.`;
  }
  if (answer.provider.startsWith("anthropic:")) {
    return `Written by ${answer.provider.slice("anthropic:".length)}. Records left this Mac.`;
  }
  if (answer.provider.startsWith("openai:")) {
    return `Written by ${answer.provider.slice("openai:".length)}. Records left this Mac.`;
  }
  if (answer.provider === "local-people-index") return "From the people index.";
  return "From stored records.";
}

function followUps(question: string, people: ReturnType<typeof groupCitations>): string[] {
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

function asIsoDate(value: string): string {
  const normalized = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
}

function fromStoredMessage(message: AskThreadMessage): AskUiMessage {
  return {
    id: message.id,
    role: message.role === "assistant" ? "assistant" : "user",
    text: message.content?.text || "",
    people: (message.content?.people || []) as AskPersonRef[],
    abilities: (message.content?.abilities || []) as AskAbilityId[],
    stages: (message.content?.stages || []).map((stage) => ({ ...stage, done: true })),
    evidence: message.content?.evidence || [],
    citations: Array.isArray(message.citations) ? message.citations : [],
    provider: message.provider || undefined,
    error: message.content?.error || null,
    loading: false,
    createdAt: asIsoDate(message.createdAt),
  };
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
  const [params, setParams] = useSearchParams();
  const threadParam = params.get("thread");
  const [draft, setDraft] = useState<AskComposerValue>(emptyComposer);
  const [threads, setThreads] = useState<AskThreadSummary[]>([]);
  const [messages, setMessages] = useState<AskUiMessage[]>([]);
  const [model, setModel] = useState<ModelState>({ checked: false });
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [threadsOpen, setThreadsOpen] = useState(readThreadsOpen);
  const [suggestions, setSuggestions] = useState<AskSuggestion[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const loadRef = useRef<AbortController | null>(null);
  const liveRef = useRef(false);
  const requestId = useRef(0);
  const threadRef = useRef<HTMLDivElement>(null);
  const answerRef = useRef<HTMLElement | null>(null);
  const loading = messages.some((message) => message.loading);
  const elapsed = useElapsed(loading);

  const setThreadParam = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("thread", id);
    else next.delete("thread");
    setParams(next, { replace: true });
  };

  const refreshThreads = async (signal?: AbortSignal) => {
    const result = await api.listAskThreads(signal);
    setThreads(result.threads);
  };

  const loadThread = async (id: string) => {
    loadRef.current?.abort();
    const abort = new AbortController();
    loadRef.current = abort;
    setLoadError(null);
    try {
      const detail = await api.getAskThread(id, abort.signal);
      if (abort.signal.aborted) return;
      setMessages(detail.messages.map(fromStoredMessage));
    } catch (reason) {
      if (isAbortError(reason) || abort.signal.aborted) return;
      setLoadError(reason instanceof Error ? reason.message : "Could not open that conversation");
    }
  };

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
          askWriter: status.askWriter,
          askWriterDisclosure: status.askWriterDisclosure,
          askWriterHasKey: status.askWriterHasKey,
          indexedAt: status.indexedAt,
          interactionIndexedAt: status.interactionIndexedAt,
          staleSources: status.staleSources,
        });
      })
      .catch(() => current && setModel({ checked: true, available: false }));
    api.listAskThreads().then((result) => {
      if (current) setThreads(result.threads);
    }).catch(() => undefined);
    const suggest = new AbortController();
    Promise.all([
      api.peoplePage({ recency: "90d", page: 1, limit: 6 }, suggest.signal),
      api.peoplePage({ filter: "cold", page: 1, limit: 4 }, suggest.signal),
      api.peopleFacets({}, suggest.signal),
    ]).then(([recent, cold, facets]) => {
      if (!current) return;
      setSuggestions(buildAskSuggestions({
        recent: recent.people,
        cold: cold.people,
        places: facets.countries.map((facet) => facet.value),
      }));
    }).catch((reason) => {
      if (!current || isAbortError(reason)) return;
      setSuggestions(buildAskSuggestions({ recent: [], cold: [], places: [] }));
    });
    return () => {
      current = false;
      suggest.abort();
      abortRef.current?.abort();
      loadRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (liveRef.current || !threadParam) return;
    void loadThread(threadParam);
  }, [threadParam]);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages]);

  const patchMessage = (id: string, patch: Partial<AskUiMessage> | ((current: AskUiMessage) => AskUiMessage)) => {
    setMessages((current) =>
      current.map((message) => {
        if (message.id !== id) return message;
        return typeof patch === "function" ? patch(message) : { ...message, ...patch };
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
    liveRef.current = true;
    let threadId = threadParam;
    if (!threadId) {
      const created = await api.createAskThread("New chat", abort.signal);
      threadId = created.id;
      setThreads((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setThreadParam(created.id);
    }
    const contextPersonIds = messages
      .flatMap((item) => item.citations.map((citation) => citation.personId))
      .filter(Boolean)
      .filter((personId, index, all) => all.indexOf(personId) === index)
      .slice(-3);
    const payload = {
      query: next,
      threadId,
      personIds: attached.people.map((person) => person.id),
      people: attached.people.map((person) => ({ id: person.id, name: person.name })),
      ability: primaryAskAbility(attached.abilities),
      abilities: attached.abilities,
      contextPersonIds,
    };
    const userId = `local-user-${id}`;
    const assistantId = `local-assistant-${id}`;
    const now = new Date().toISOString();
    setMessages((current) => [
      ...current,
      {
        id: userId,
        role: "user",
        text: next,
        people: attached.people,
        abilities: attached.abilities,
        stages: [],
        evidence: [],
        citations: [],
        error: null,
        loading: false,
        createdAt: now,
      },
      {
        id: assistantId,
        role: "assistant",
        text: "",
        people: [],
        abilities: [],
        stages: emptyAskLiveAnswer().stages,
        evidence: [],
        citations: [],
        error: null,
        loading: true,
        createdAt: now,
      },
    ]);
    setEvidenceOpen(false);
    setCopied(false);
    try {
      let streamed = false;
      try {
        for await (const event of api.queryStream(payload, abort.signal)) {
          if (id !== requestId.current || abort.signal.aborted) return;
          streamed = true;
          if (event.type === "thread") {
            setThreads((current) => current.map((item) => (
              item.id === event.threadId ? { ...item, title: event.title, updatedAt: new Date().toISOString() } : item
            )));
            continue;
          }
          patchMessage(assistantId, (current) => {
            const nextState = applyAskStreamEvent({
              text: current.text,
              citations: current.citations,
              provider: current.provider || "local-evidence",
              note: current.note,
              stages: current.stages,
              evidence: current.evidence,
              loading: current.loading,
            }, event);
            return {
              ...current,
              text: nextState.text,
              citations: nextState.citations,
              provider: nextState.provider,
              note: nextState.note,
              stages: nextState.stages,
              evidence: nextState.evidence,
              loading: nextState.loading,
            };
          });
        }
      } catch (reason) {
        if (isAbortError(reason) || abort.signal.aborted) return;
        if (streamed) throw reason;
        const result = await api.query(payload, abort.signal);
        if (id !== requestId.current || abort.signal.aborted) return;
        patchMessage(assistantId, {
          loading: false,
          text: result.answer,
          citations: result.citations,
          provider: result.provider,
          note: result.note,
          stages: [
            { id: "search", label: "Searching records", done: true },
            { id: "write", label: "Writing from stored records", done: true },
          ],
        });
      }
      void refreshThreads();
    } catch (reason) {
      if (isAbortError(reason) || abort.signal.aborted) return;
      patchMessage(assistantId, {
        loading: false,
        error: reason instanceof Error ? reason.message : "Nett could not answer that question",
      });
    } finally {
      if (id === requestId.current) {
        liveRef.current = false;
        patchMessage(assistantId, (current) => ({
          ...current,
          loading: false,
          stages: current.stages.map((stage) => ({ ...stage, done: true })),
        }));
      }
    }
  };

  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  const people = useMemo(
    () => groupCitations(latestAssistant?.citations || []),
    [latestAssistant?.citations],
  );

  const openPerson = (personId: string) => {
    onOpen(personId);
    navigate(`/people/${personId}#recent`);
  };

  const copyAnswer = async (message: AskUiMessage) => {
    const hits = groupCitations(message.citations);
    const lines = [
      message.text,
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

  const startNewChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setDraft(emptyComposer());
    setThreadParam(null);
  };

  const toggleThreads = () => {
    setThreadsOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(THREADS_OPEN_KEY, next ? "1" : "0");
      } catch {
        /* ignore quota */
      }
      return next;
    });
  };

  const archiveAll = () => {
    if (!threads.length) return;
    if (!window.confirm(`Delete all ${threads.length} conversations? They leave this list.`)) return;
    void api.archiveAllAskThreads().then(() => {
      setThreads([]);
      startNewChat();
    });
  };

  return (
    <AskRuntimeProvider
      messages={messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        createdAt: message.createdAt,
        running: message.loading,
      }))}
      isRunning={loading}
      onNew={(text) => ask(text)}
      onCancel={() => abortRef.current?.abort()}
    >
    <section
      className={`ask ask-agent ask-workspace${threadsOpen ? "" : " is-threads-collapsed"}`}
      id="ask"
      aria-labelledby="ask-nett-title"
    >
      <AskThreadList
        threads={threads}
        activeId={threadParam}
        open={threadsOpen}
        onToggle={toggleThreads}
        onNew={startNewChat}
        onSelect={(id) => {
          abortRef.current?.abort();
          liveRef.current = false;
          setThreadParam(id);
          void loadThread(id);
        }}
        onRename={(id, title) => {
          void api.renameAskThread(id, title).then((thread) => {
            setThreads((current) => current.map((item) => item.id === id ? thread : item));
          });
        }}
        onArchive={(id) => {
          void api.archiveAskThread(id).then(() => {
            setThreads((current) => current.filter((item) => item.id !== id));
            if (threadParam === id) startNewChat();
          });
        }}
        onArchiveAll={archiveAll}
      />

      <div className="ask-main">
      <header className="ask-head">
        <div>
          <h1 id="ask-nett-title">Ask Nett</h1>
          <p className="ask-note">Any question about your people and messages. Ask does not write.</p>
        </div>
        {model.checked && <p className="ask-index">{indexNote(model)}</p>}
      </header>

      <div className="ask-thread" ref={threadRef}>
        {loadError && (
          <p className="inline-error" role="alert">{loadError}</p>
        )}

        {!messages.length && !loadError && (
          <div className="ask-empty">
            <p className="ask-empty-lead">
              Point at a person with <kbd>@</kbd>, or pick an ability with <kbd>/</kbd>.
              Ask still only reads stored records.
            </p>
            <ul className="ask-examples">
              {suggestions.map((example, index) => (
                <li key={example.text}>
                  <button type="button" onClick={() => void ask(example.text, { people: example.people, abilities: [] })}>
                    <span className="ask-example-mark" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>{example.text}</span>
                    <ArrowRight size={13} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((message) => {
          if (message.role === "user") {
            return (
              <article key={message.id} className="ask-turn ask-turn-user">
                <p className="ask-asked">
                  <span>You</span>
                  {(message.people.length > 0 || message.abilities.length > 0) && (
                    <span className="ask-asked-refs">
                      {message.people.map((person) => (
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
                      {message.abilities.map((abilityId) => (
                        <span key={abilityId} className="ask-chip ask-chip-ability">
                          <span className="ask-chip-slash" aria-hidden="true">/</span>
                          {abilityById(abilityId).label}
                        </span>
                      ))}
                    </span>
                  )}
                  {message.text}
                </p>
              </article>
            );
          }

          const hits = groupCitations(message.citations);
          const prose = message.text.trim();
          const hasResult = Boolean(prose || hits.length || message.loading);
          return (
            <article key={message.id} className="ask-turn">
              <AskThinking stages={message.stages} loading={message.loading} elapsed={message.loading ? elapsed : ""} />
              {hasResult && (
                <div
                  className="ask-answer"
                  ref={message.id === latestAssistant?.id ? (node) => { answerRef.current = node; } : undefined}
                >
                  <SelectionActions root={message.id === latestAssistant?.id ? answerRef.current : null} />
                  {prose ? (
                    <AskMarkdown
                      text={prose}
                      people={hits}
                      live={message.loading}
                      onOpen={openPerson}
                    />
                  ) : message.loading ? null : (
                    <p className="ask-prose">
                      That question came back empty. Try naming a person, a place, or a phrase you wrote down.
                    </p>
                  )}

                  {hits.length > 0 && (
                    <ol className="ask-people">
                      {hits.map((person, index) => (
                        <AskPersonCard
                          key={person.personId}
                          person={person}
                          index={index}
                          onOpen={openPerson}
                        />
                      ))}
                    </ol>
                  )}

                  {(message.evidence.length > 0 || hits.some((person) => person.excerpts.length)) && (
                    <details
                      className="ask-evidence"
                      open={message.id === latestAssistant?.id ? evidenceOpen : false}
                      onToggle={(event) => {
                        if (message.id === latestAssistant?.id) setEvidenceOpen(event.currentTarget.open);
                      }}
                    >
                      <summary>
                        {message.evidence.length ? "Sent to model" : "Evidence"}
                        <span>
                          {message.evidence.length
                            || hits.reduce((count, person) => count + person.excerpts.length, 0)}
                        </span>
                        <CaretDown size={14} aria-hidden="true" />
                      </summary>
                      {message.evidence.length > 0 ? (
                        <ul>
                          {message.evidence.map((block) => (
                            <li key={block.id}>
                              <strong>{block.title}</strong>
                              <span>{cleanExcerpt(block.text).slice(0, 320)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <ul>
                          {hits.flatMap((person) =>
                            person.excerpts.slice(0, 2).map((citation, index) => (
                              <li key={`${person.personId}:${index}`}>
                                <button type="button" onClick={() => openPerson(person.personId)}>
                                  <strong>{person.name}</strong>
                                  <small>
                                    {citation.source}
                                    {citation.field ? ` · ${citation.field.replace(/_/g, " ")}` : ""}
                                  </small>
                                  <span>{cleanExcerpt(citation.value).slice(0, 180)}</span>
                                </button>
                              </li>
                            )),
                          )}
                        </ul>
                      )}
                    </details>
                  )}

                  {!hits.length && !message.loading && prose && (
                    <p className="ask-uncited">
                      No stored record was linked to this answer. Treat it as a guess.
                    </p>
                  )}

                  {!message.loading && (
                    <div className="ask-actions">
                      <button type="button" className="text-button" onClick={() => void copyAnswer(message)}>
                        <Copy size={14} aria-hidden="true" />
                        {copied && message.id === latestAssistant?.id ? "Copied" : "Copy"}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          const source = messages.slice(0, messages.indexOf(message)).reverse().find((item) => item.role === "user");
                          if (!source) return;
                          setDraft({
                            text: source.text,
                            people: source.people,
                            abilities: source.abilities,
                          });
                          void ask(source.text, source);
                        }}
                      >
                        Retry
                      </button>
                      {message.provider && (
                        <span className="ask-path">{providerNote({ provider: message.provider, note: message.note })}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
              {message.error && (
                <p className="inline-error" role="alert">
                  <WarningCircle size={15} aria-hidden="true" />
                  {message.error}
                  <button
                    className="text-button"
                    onClick={() => {
                      const source = messages.slice(0, messages.indexOf(message)).reverse().find((item) => item.role === "user");
                      if (source) void ask(source.text, source);
                    }}
                  >
                    Try again
                  </button>
                </p>
              )}
            </article>
          );
        })}

        {latestAssistant && !latestAssistant.loading && people.length > 0 && latestUser && (
          <div className="ask-follow">
            <p>Follow-ups</p>
            {followUps(latestUser.text, people).map((item) => (
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
          ? "Checking the Ask writer…"
          : model.askWriter && model.askWriter !== "local" && model.askWriterHasKey
            ? model.askWriterDisclosure || `This question and matching records will be sent to ${model.askWriter}. Ask never writes.`
            : "Matching records stay on this Mac unless you add an OpenRouter key on Sources. Ask never writes."}
      </p>
      </div>
    </section>
    </AskRuntimeProvider>
  );
}

export function personContext(person: Pick<Person, "company" | "location" | "industry">) {
  return [person.company, person.location, person.industry].filter(Boolean).join(" / ");
}
