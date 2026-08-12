import {
  Brain,
  CalendarBlank,
  Check,
  Database,
  FileCsv,
  MagnifyingGlass,
  Microphone,
  MicrophoneSlash,
  Network,
  SpinnerGap,
  Tag,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Avatar, asList, Modal } from "@/components/Primitives";
import { api, isAbortError } from "@/lib/api";
import {
  createDictationSession,
  detectDictationCapability,
  type DictationSession,
  type DictationState,
} from "@/lib/dictation";
import type { ParsedMemory, Person } from "@/types";

export function CommandPalette({
  people,
  onClose,
  onOpen,
}: {
  people: Person[];
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const initial = [...asList(people)]
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    .slice(0, 8);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>(initial);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const requestId = useRef(0);

  useEffect(() => {
    if (!query.trim()) {
      requestId.current += 1;
      setResults(initial);
      setActiveIndex(0);
      setSearching(false);
      setError(null);
      return;
    }
    const current = ++requestId.current;
    const controller = new AbortController();
    setSearching(true);
    setError(null);
    const timeout = window.setTimeout(() => {
      api
        .search(query.trim(), controller.signal)
        .then((next) => {
          if (current !== requestId.current) return;
          setResults(asList(next).slice(0, 30));
          setActiveIndex(0);
        })
        .catch((reason) => {
          if (isAbortError(reason) || current !== requestId.current) return;
          setResults([]);
          setError(reason instanceof Error ? reason.message : "Search unavailable");
        })
        .finally(() => {
          if (current === requestId.current) setSearching(false);
        });
    }, 90);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
    // Initial results intentionally update when the source list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, query]);

  useEffect(() => {
    resultRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (results.length) {
        setActiveIndex((index) => Math.min(index + 1, results.length - 1));
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && results[activeIndex]) {
      event.preventDefault();
      onOpen(results[activeIndex].id);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, results.length - 1));
    }
  };

  return (
    <Modal onClose={onClose} bare initialFocusRef={input}>
      <div className="command-input">
        {searching ? (
          <SpinnerGap className="spin" size={20} />
        ) : (
          <MagnifyingGlass size={20} />
        )}
        <input
          ref={input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Who are you looking for?"
          aria-label="Ask or find anything"
          role="combobox"
          aria-expanded="true"
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-controls="command-results"
          aria-activedescendant={
            results[activeIndex] ? `command-result-${results[activeIndex].id}` : undefined
          }
          autoComplete="off"
        />
        <kbd>ESC</kbd>
      </div>
      <div
        className="command-results"
        id="command-results"
        role="listbox"
        aria-label="People search results"
      >
        <span className="result-caption">
          {searching
            ? "Searching indexed records"
            : query
              ? `${results.length} closest matches`
              : "Priority people"}
        </span>
        {results.map((person, index) => (
          <button
            ref={(element) => {
              resultRefs.current[index] = element;
            }}
            id={`command-result-${person.id}`}
            role="option"
            aria-selected={index === activeIndex}
            className={`spotlight-row${index === activeIndex ? " is-active" : ""}`}
            key={person.id}
            onMouseMove={(event) => {
              setActiveIndex(index);
              const target = event.currentTarget;
              const bounds = target.getBoundingClientRect();
              target.style.setProperty("--spot-x", `${event.clientX - bounds.left}px`);
              target.style.setProperty("--spot-y", `${event.clientY - bounds.top}px`);
            }}
            onClick={() => onOpen(person.id)}
          >
            <Avatar person={person} size="sm" />
            <span>
              <strong>{person.name}</strong>
              <small>
                {[person.company, person.location].filter(Boolean).join(" / ") ||
                  "Context not recorded"}
              </small>
            </span>
            <div>
              {asList(person.tags)
                .slice(0, 2)
                .map((tag) => (
                  <i key={tag}>{tag}</i>
                ))}
            </div>
            {index === activeIndex && <kbd>↵</kbd>}
          </button>
        ))}
        {!searching && !results.length && (
          <div className="command-empty">
            <MagnifyingGlass size={24} />
            <p>No person or memory matches “{query}”.</p>
          </div>
        )}
        {error && (
          <p className="inline-error" role="alert">
            <WarningCircle size={15} />
            {error}
          </p>
        )}
      </div>
      <div className="command-footer">
        <span>
          <kbd>↑↓</kbd> Navigate
        </span>
        <span>
          <kbd>↵</kbd> Open
        </span>
        <span>Local server search</span>
      </div>
    </Modal>
  );
}

type ProposalDecision = "accept" | "reject";

export function CaptureDialog({
  onClose,
  onSaved,
}: {
  people: Person[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const capability = detectDictationCapability();
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedMemory | null>(null);
  const [personId, setPersonId] = useState("");
  const [stage, setStage] = useState<"write" | "review">("write");
  const [working, setWorking] = useState(false);
  const [dictationState, setDictationState] = useState<DictationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [usedVoice, setUsedVoice] = useState(false);
  const [proposalEdits, setProposalEdits] = useState<Record<string, string>>({});
  const [proposalDecisions, setProposalDecisions] = useState<Record<string, ProposalDecision>>({});
  const session = useRef<DictationSession | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const listening = dictationState === "listening" || dictationState === "requesting-permission";
  const dirty = Boolean(text.trim() || stage === "review");

  useEffect(
    () => () => {
      session.current?.cancel();
      abortRef.current?.abort();
    },
    [],
  );

  const requestClose = () => {
    if (dirty && working) return;
    if (dirty && !window.confirm("Discard this memory? Nothing has been saved yet.")) return;
    abortRef.current?.abort();
    onClose();
  };

  const parse = async () => {
    if (!text.trim() || working) return;
    session.current?.stop();
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const id = ++requestId.current;
    setWorking(true);
    setError(null);
    try {
      const result = await api.parseMemory(text, abort.signal);
      if (id !== requestId.current || abort.signal.aborted) return;
      setParsed(result);
      setPersonId(result.ambiguous ? "" : result.candidates?.[0]?.id || "");
      const decisions: Record<string, ProposalDecision> = {};
      const edits: Record<string, string> = {};
      for (const proposal of asList(result.proposals)) {
        const key = `${proposal.field}-${proposal.evidenceStart}`;
        decisions[key] = "accept";
        edits[key] = proposal.values?.join(", ") || proposal.value;
      }
      setProposalDecisions(decisions);
      setProposalEdits(edits);
      setStage("review");
    } catch (reason) {
      if (isAbortError(reason) || abort.signal.aborted) return;
      setError(
        reason instanceof Error ? reason.message : "The memory could not be structured",
      );
    } finally {
      if (abortRef.current === abort) abortRef.current = null;
      if (id === requestId.current) setWorking(false);
    }
  };

  const toggleVoice = () => {
    if (listening) {
      session.current?.stop();
      return;
    }
    if (!capability.available) {
      setError(capability.disclosure);
      return;
    }
    setError(null);
    const next = createDictationSession({
      onState: setDictationState,
      onTranscript: (chunk, isFinal) => {
        if (!isFinal) return;
        setUsedVoice(true);
        setText((current) => `${current}${current ? " " : ""}${chunk.trim()}`);
      },
      onError: (message) => setError(message),
    });
    session.current = next;
    next.start();
  };

  const save = async () => {
    if (!parsed || !personId || working) return;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const id = ++requestId.current;
    setWorking(true);
    setError(null);
    try {
      const accepted = asList(parsed.proposals).filter((proposal) => {
        const key = `${proposal.field}-${proposal.evidenceStart}`;
        return proposalDecisions[key] !== "reject";
      });
      const proposals = Object.fromEntries(
        accepted.map((proposal) => {
          const key = `${proposal.field}-${proposal.evidenceStart}`;
          const edited = proposalEdits[key] ?? (proposal.values?.join(", ") || proposal.value);
          if (proposal.values || proposal.field === "tags" || proposal.field === "languages"
            || proposal.field === "interests" || proposal.field === "mutuals") {
            return [proposal.field, edited.split(",").map((part) => part.trim()).filter(Boolean)];
          }
          return [proposal.field, edited];
        }),
      );
      const tags = Array.isArray(proposals.tags)
        ? proposals.tags as string[]
        : asList(parsed.extracted.tags).filter((tag) =>
          accepted.some((proposal) => proposal.field === "tags" && (
            proposal.values?.includes(tag) || proposal.value.includes(tag)
          )));
      const followUp = typeof proposals.follow_up_date === "string"
        ? proposals.follow_up_date
        : parsed.extracted.followUpDate;
      await api.saveMemory(
        personId,
        parsed.extracted.memory,
        {
          memory: parsed.extracted.memory,
          tags,
          followUpDate: followUp || null,
          relationship: typeof proposals.relationship === "string"
            ? proposals.relationship
            : parsed.extracted.relationship,
          interests: Array.isArray(proposals.interests)
            ? proposals.interests
            : parsed.extracted.interests,
          ...proposals,
          transcript: parsed.transcript || text,
        },
        usedVoice ? "voice" : "manual",
        abort.signal,
      );
      if (id !== requestId.current || abort.signal.aborted) return;
      onSaved();
    } catch (reason) {
      if (isAbortError(reason) || abort.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : "The memory could not be saved");
    } finally {
      if (abortRef.current === abort) abortRef.current = null;
      if (id === requestId.current) setWorking(false);
    }
  };

  return (
    <Modal
      title={stage === "write" ? "Remember this" : "Review the memory"}
      subtitle={
        stage === "write"
          ? "Capture the thought naturally. Nett will structure it before saving."
          : "Accept, edit, or reject each proposed fact. Nothing is saved until you approve."
      }
      onClose={requestClose}
      wide
      initialFocusRef={stage === "write" ? composer : undefined}
    >
      {stage === "write" ? (
        <>
          <div className={`memory-composer ${listening ? "is-listening" : ""}`}>
            <textarea
              ref={composer}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Record what happened, what matters, and any follow-up you want to remember."
            />
            <button
              className="voice-button"
              onClick={toggleVoice}
              aria-label={listening ? "Stop voice capture" : "Start voice capture"}
              aria-pressed={listening}
              title={capability.disclosure}
              disabled={!capability.available && dictationState === "idle"}
            >
              {listening ? <MicrophoneSlash size={20} /> : <Microphone size={20} />}
            </button>
            {listening && (
              <span className="voice-state" role="status">
                <i />
                <i />
                <i />
                {dictationState === "requesting-permission" ? "Requesting mic" : "Listening"}
              </span>
            )}
          </div>
          {capability.mayUseRemoteService && (
            <p className="capture-privacy" role="note">
              {capability.disclosure}
            </p>
          )}
          {!capability.available && (
            <p className="capture-privacy" role="note">
              {capability.disclosure}
            </p>
          )}
          <div className="capture-hints" aria-label="Memory fields Nett can detect">
            <span>
              <Brain size={15} />
              Person
            </span>
            <span>
              <Tag size={15} />
              Context
            </span>
            <span>
              <CalendarBlank size={15} />
              Follow-up
            </span>
            <span>
              <Network size={15} />
              Relationship
            </span>
          </div>
          <div className="modal-actions">
            <button className="secondary-button" onClick={requestClose}>
              Cancel
            </button>
            <button
              className="primary-button"
              onClick={() => void parse()}
              disabled={working || !text.trim()}
            >
              {working ? <SpinnerGap className="spin" /> : <Brain />}
              Structure memory
            </button>
          </div>
        </>
      ) : (
        parsed && (
          <>
            <div className="review-block">
              <label>Attach to person</label>
              <div className="candidate-grid">
                {asList(parsed.candidates).map((candidate) => (
                  <button
                    key={candidate.id}
                    className={personId === candidate.id ? "is-selected" : ""}
                    onClick={() => setPersonId(candidate.id)}
                    aria-pressed={personId === candidate.id}
                  >
                    <Avatar
                      person={{ id: candidate.id, name: candidate.name }}
                      size="sm"
                    />
                    <span>
                      <strong>{candidate.name}</strong>
                      <small>{candidate.company || "Company not recorded"}</small>
                    </span>
                    <i>{Math.round(candidate.score * 100)}%</i>
                    {personId === candidate.id && <Check size={16} weight="bold" />}
                  </button>
                ))}
              </div>
              {parsed.ambiguous && !personId && (
                <p className="review-warning">
                  <WarningCircle size={15} />
                  More than one person is plausible. Choose one before saving.
                </p>
              )}
            </div>
            <div className="extracted-grid">
              <label>
                <span>Memory</span>
                <textarea
                  value={parsed.extracted.memory}
                  onChange={(event) =>
                    setParsed({
                      ...parsed,
                      extracted: {
                        ...parsed.extracted,
                        memory: event.target.value,
                      },
                    })
                  }
                />
              </label>
              <label>
                <span>Follow-up date</span>
                <input
                  type="date"
                  value={parsed.extracted.followUpDate || ""}
                  onChange={(event) =>
                    setParsed({
                      ...parsed,
                      extracted: {
                        ...parsed.extracted,
                        followUpDate: event.target.value,
                      },
                    })
                  }
                />
              </label>
              {asList(parsed.proposals).length > 0 && (
                <div className="capture-proposals">
                  <span>Proposed facts — accept, edit, or reject each one</span>
                  <ul>
                    {parsed.proposals!.map((proposal) => {
                      const key = `${proposal.field}-${proposal.evidenceStart}`;
                      const accepted = proposalDecisions[key] !== "reject";
                      return (
                        <li
                          key={key}
                          className={accepted ? "is-accepted" : "is-rejected"}
                        >
                          <div className="capture-proposal-head">
                            <strong>{proposal.field.replace(/_/g, " ")}</strong>
                            <span className="capture-proposal-actions">
                              <button
                                type="button"
                                className={accepted ? "is-active" : ""}
                                aria-pressed={accepted}
                                onClick={() =>
                                  setProposalDecisions((current) => ({
                                    ...current,
                                    [key]: "accept",
                                  }))
                                }
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                className={!accepted ? "is-active" : ""}
                                aria-pressed={!accepted}
                                onClick={() =>
                                  setProposalDecisions((current) => ({
                                    ...current,
                                    [key]: "reject",
                                  }))
                                }
                              >
                                Reject
                              </button>
                            </span>
                          </div>
                          <input
                            value={proposalEdits[key] ?? ""}
                            disabled={!accepted}
                            onChange={(event) =>
                              setProposalEdits((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                            aria-label={`Edit ${proposal.field.replace(/_/g, " ")}`}
                          />
                          <small title={proposal.evidence}>
                            {Math.round(proposal.confidence * 100)}% · {proposal.evidence}
                          </small>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  abortRef.current?.abort();
                  setStage("write");
                }}
              >
                Back
              </button>
              <button
                className="primary-button"
                onClick={() => void save()}
                disabled={working || !personId}
              >
                {working ? <SpinnerGap className="spin" /> : <Check />}
                Approve and save
              </button>
            </div>
          </>
        )
      )}
      {error && (
        <p className="inline-error" role="alert">
          <WarningCircle size={15} />
          {error}
        </p>
      )}
    </Modal>
  );
}

export function ImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [mode, setMode] = useState<"spreadsheet" | "linkedin">("spreadsheet");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{
    rows: number;
    merged: number;
    created: number;
    review: number;
    invalid: number;
    conflicts: number;
    duplicate: boolean;
    source?: "spreadsheet" | "linkedin";
  } | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async () => {
    if (!file) return;
    setWorking(true);
    setError(null);
    try {
      if (mode === "linkedin") {
        const data = await api.importLinkedInArchive(file);
        setResult({ ...data, source: "linkedin" });
      } else {
        const data = await api.importCsv(file);
        setResult({ ...data, source: "spreadsheet" });
      }
      onImported();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Import failed");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal
      title={mode === "linkedin" ? "Import LinkedIn archive" : "Import Nett metadata"}
      subtitle={
        mode === "linkedin"
          ? "Use your official LinkedIn “Download your data” archive or Connections.csv. Nett never scrapes LinkedIn or reuses cookies."
          : "Exact email, phone, or one unique identical name merges automatically. Ambiguous or similar names stay in review."
      }
      onClose={onClose}
      wide
    >
      {!result ? (
        <>
          <div className="import-mode" role="tablist" aria-label="Import source">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "spreadsheet"}
              className={mode === "spreadsheet" ? "is-selected" : ""}
              onClick={() => {
                setMode("spreadsheet");
                setFile(null);
                setError(null);
              }}
            >
              Spreadsheet
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "linkedin"}
              className={mode === "linkedin" ? "is-selected" : ""}
              onClick={() => {
                setMode("linkedin");
                setFile(null);
                setError(null);
              }}
            >
              LinkedIn archive
            </button>
          </div>
          <label className="file-drop">
            <input
              type="file"
              accept={
                mode === "linkedin"
                  ? ".zip,.csv,application/zip,text/csv"
                  : ".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              }
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            <FileCsv size={32} weight="duotone" />
            <strong>
              {file
                ? file.name
                : mode === "linkedin"
                  ? "Choose a LinkedIn zip or Connections.csv"
                  : "Choose a CSV or Excel file"}
            </strong>
            <span>
              {file
                ? `${Math.ceil(file.size / 1024)} KB ready to import`
                : mode === "linkedin"
                  ? "Only Connections fields are imported. Location, languages, and interests are never invented."
                  : "Headers are matched by name. Raw rows remain auditable."}
            </span>
          </label>
          <div className="import-rules">
            <div>
              <Check size={16} />
              <span>
                <strong>Exact match</strong>
                {mode === "linkedin"
                  ? "Exact email or normalized profile URL links automatically"
                  : "Exact email, phone, or a unique identical name merges automatically"}
              </span>
            </div>
            <div>
              <WarningCircle size={16} />
              <span>
                <strong>Review match</strong>
                Uncertain or conflicting rows stay in the merge queue
              </span>
            </div>
            <div>
              <Database size={16} />
              <span>
                <strong>Preserved</strong>
                Every source row remains auditable; re-importing the same file is a no-op
              </span>
            </div>
          </div>
          {working && (
            <div className="import-progress" role="status" aria-live="polite">
              <SpinnerGap className="spin" />
              Uploading and resolving rows...
            </div>
          )}
          <div className="modal-actions">
            <button className="secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary-button"
              onClick={() => void upload()}
              disabled={!file || working}
            >
              {working ? <SpinnerGap className="spin" /> : <FileCsv />}
              {mode === "linkedin" ? "Import archive" : "Import spreadsheet"}
            </button>
          </div>
        </>
      ) : (
        <div className="import-result">
          <h2><Check size={22} weight="bold" /> {result.rows} rows processed</h2>
          <div>
            <span>
              <strong>{result.merged}</strong>
              Exact merges
            </span>
            <span>
              <strong>{result.created}</strong>
              New people
            </span>
            <span>
              <strong>{result.review}</strong>
              Need review
            </span>
          </div>
          <p>
            {result.duplicate
              ? "This exact file was already committed, so Nett made no duplicate changes."
              : `${result.invalid} invalid rows were skipped. ${result.conflicts} existing field values were preserved instead of overwritten.`}
          </p>
          <button className="primary-button" onClick={onClose}>
            Done
          </button>
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          <WarningCircle size={15} />
          {error}
        </p>
      )}
    </Modal>
  );
}
