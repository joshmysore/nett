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
import { api } from "@/lib/api";
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
    setSearching(true);
    setError(null);
    const timeout = window.setTimeout(() => {
      api
        .search(query.trim())
        .then((next) => {
          if (current !== requestId.current) return;
          setResults(asList(next).slice(0, 30));
          setActiveIndex(0);
        })
        .catch((reason) => {
          if (current !== requestId.current) return;
          setResults([]);
          setError(reason instanceof Error ? reason.message : "Search unavailable");
        })
        .finally(() => {
          if (current === requestId.current) setSearching(false);
        });
    }, 120);
    return () => window.clearTimeout(timeout);
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
          placeholder="Name, company, city, memory, mutual..."
          aria-label="Search your network"
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
            className={index === activeIndex ? "is-active" : ""}
            key={person.id}
            onMouseMove={() => setActiveIndex(index)}
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

export function CaptureDialog({
  onClose,
  onSaved,
}: {
  people: Person[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedMemory | null>(null);
  const [personId, setPersonId] = useState("");
  const [stage, setStage] = useState<"write" | "review">("write");
  const [working, setWorking] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<any>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(
    () => () => {
      recognition.current?.stop();
    },
    [],
  );

  const parse = async () => {
    if (!text.trim()) return;
    setWorking(true);
    setError(null);
    try {
      const result = await api.parseMemory(text);
      setParsed(result);
      setPersonId(result.ambiguous ? "" : result.candidates?.[0]?.id || "");
      setStage("review");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "The memory could not be structured",
      );
    } finally {
      setWorking(false);
    }
  };

  const toggleVoice = () => {
    if (listening) {
      recognition.current?.stop();
      setListening(false);
      return;
    }
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Speech recognition is unavailable in this browser. You can still type.");
      return;
    }
    const instance = new SpeechRecognition();
    recognition.current = instance;
    instance.continuous = true;
    instance.interimResults = true;
    instance.onresult = (event: any) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
      }
      setText((current) => `${current}${current ? " " : ""}${transcript}`);
    };
    instance.onerror = () => {
      setError("Voice transcription stopped. Review the text captured so far.");
      setListening(false);
    };
    instance.onend = () => setListening(false);
    instance.start();
    setListening(true);
  };

  const save = async () => {
    if (!parsed || !personId) return;
    setWorking(true);
    setError(null);
    try {
      await api.saveMemory(
        personId,
        parsed.extracted.memory,
        parsed.extracted,
        listening ? "voice" : "manual",
      );
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The memory could not be saved");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal
      title={stage === "write" ? "Remember this" : "Review the memory"}
      subtitle={
        stage === "write"
          ? "Capture the thought naturally. Nett will structure it before saving."
          : "Confirm the person and extracted fields. Nothing is saved until you approve."
      }
      onClose={onClose}
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
            >
              {listening ? <MicrophoneSlash size={20} /> : <Microphone size={20} />}
            </button>
            {listening && (
              <span className="voice-state" role="status">
                <i />
                <i />
                <i />
                Listening
              </span>
            )}
          </div>
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
            <button className="secondary-button" onClick={onClose}>
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
              <div>
                <span>Extracted tags</span>
                <div className="tag-field">
                  {asList(parsed.extracted.tags).length ? (
                    parsed.extracted.tags.map((tag) => (
                      <span key={tag}>
                        <Tag size={12} />
                        {tag}
                      </span>
                    ))
                  ) : (
                    <small>No tags extracted</small>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setStage("write")}>
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
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{
    rows: number;
    merged: number;
    created: number;
    review: number;
    invalid: number;
    conflicts: number;
    duplicate: boolean;
  } | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async () => {
    if (!file) return;
    setWorking(true);
    setError(null);
    try {
      const data = await api.importCsv(file);
      setResult(data);
      onImported();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Import failed");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal
      title="Import Nett metadata"
      subtitle="Exact email, phone, or one unique identical name merges automatically. Ambiguous or similar names stay in review."
      onClose={onClose}
      wide
    >
      {!result ? (
        <>
          <label className="file-drop">
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            <FileCsv size={32} weight="duotone" />
            <strong>{file ? file.name : "Choose a CSV or Excel file"}</strong>
            <span>
              {file
                ? `${Math.ceil(file.size / 1024)} KB ready to import`
                : "Headers are matched by name. Raw rows remain auditable."}
            </span>
          </label>
          <div className="import-rules">
            <div>
              <Check size={16} />
              <span>
                <strong>Exact match</strong>
                Exact email, phone, or a unique identical name merges automatically
              </span>
            </div>
            <div>
              <WarningCircle size={16} />
              <span>
                <strong>Review match</strong>
                Similar names require confirmation
              </span>
            </div>
            <div>
              <Database size={16} />
              <span>
                <strong>Preserved</strong>
                Every source row remains auditable
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
              Import spreadsheet
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
