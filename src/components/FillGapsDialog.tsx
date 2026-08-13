import {
  ArrowRight,
  Check,
  SpinnerGap,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { asChipValues, ChipInput } from "@/components/ChipInput";
import { HometownEditor, PlacePicker } from "@/components/PlacePicker";
import { Avatar, Modal } from "@/components/Primitives";
import { api, isAbortError } from "@/lib/api";
import {
  fieldLabel,
  isListField,
  MASS_FILL_FIELDS,
  missingFilterLabel,
  type MissingFilterKey,
} from "@/lib/person-fields";
import { formatHometownEntry, hometownEntries } from "@/lib/place";
import type { Person } from "@/types";

type QueueItem = {
  person: Person;
  suggestion: {
    id?: string;
    field: string;
    value: unknown;
    confidence: number;
    reason: string;
    source: string;
  } | null;
  status: "loading" | "ready" | "empty" | "error";
  message?: string;
};

function displayValue(value: unknown) {
  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
}

function toWriteValue(field: string, raw: string) {
  if (field === "hometown") {
    return hometownEntries(raw.split("\n").map((entry) => entry.trim()).filter(Boolean))
      .map(formatHometownEntry)
      .filter(Boolean);
  }
  return raw.trim();
}

/**
 * Field-first mass fill: pick a category, walk people who lack it, and accept
 * or edit evidence-backed suggestions one at a time. Nothing writes until the
 * user confirms.
 */
export function FillGapsDialog({
  initialField,
  onClose,
  onApplied,
}: {
  initialField?: string;
  onClose: () => void;
  onApplied?: () => void;
}) {
  const [field, setField] = useState(
    MASS_FILL_FIELDS.some((entry) => entry.key === initialField)
      ? String(initialField)
      : MASS_FILL_FIELDS[0]?.key || "industry",
  );
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState("");
  const [hometownDraft, setHometownDraft] = useState<string[]>([]);
  const [listDraft, setListDraft] = useState<string[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [ownerInterests, setOwnerInterests] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const inputId = useId();
  const current = queue[index] ?? null;

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const abort = new AbortController();
    api.setupStatus()
      .then((setup) => {
        if (!abort.signal.aborted) setOwnerInterests(setup.ownerInterests || []);
      })
      .catch(() => {
        if (!abort.signal.aborted) setOwnerInterests([]);
      });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setLoadingList(true);
    setListError(null);
    setQueue([]);
    setIndex(0);
    setAccepted(0);
    setSkipped(0);
    setDraft("");

    void (async () => {
      try {
        const page = await api.peoplePage(
          { missing: field as MissingFilterKey, page: 1, limit: 40 },
          abort.signal,
        );
        if (abort.signal.aborted) return;
        const items: QueueItem[] = page.people.map((person) => ({
          person,
          suggestion: null,
          status: "loading",
        }));
        setQueue(items);
        setLoadingList(false);

        // Prefetch suggestions sequentially so we stay gentle on SQLite and
        // the user always has the current card ready.
        for (let i = 0; i < items.length; i += 1) {
          if (abort.signal.aborted) return;
          try {
            const result = await api.autofill(items[i].person.id, abort.signal, {
              generate: false,
            });
            const match = (result.suggestions || []).find(
              (suggestion) => suggestion.field === field,
            );
            setQueue((prev) => {
              const next = [...prev];
              if (!next[i] || next[i].person.id !== items[i].person.id) return prev;
              next[i] = match
                ? { person: items[i].person, suggestion: match, status: "ready" }
                : {
                    person: items[i].person,
                    suggestion: null,
                    status: "empty",
                    message: "No stored evidence for this field yet. Type a value or skip.",
                  };
              return next;
            });
          } catch (error) {
            if (isAbortError(error)) return;
            setQueue((prev) => {
              const next = [...prev];
              if (!next[i]) return prev;
              next[i] = {
                person: items[i].person,
                suggestion: null,
                status: "error",
                message: error instanceof Error ? error.message : "Could not read evidence",
              };
              return next;
            });
          }
        }
      } catch (error) {
        if (isAbortError(error)) return;
        setListError(error instanceof Error ? error.message : "Could not load people");
        setLoadingList(false);
      }
    })();

    return () => abort.abort();
  }, [field]);

  // Key the draft off the stable person + field + status so prefetch updates
  // to later queue items cannot flash a wrong suggestion into the current card.
  const draftKey = current
    ? `${field}:${current.person.id}:${current.status}:${current.suggestion?.id || ""}`
    : "";
  useEffect(() => {
    if (!current) {
      setDraft("");
      setHometownDraft([]);
      setListDraft([]);
      return;
    }
    if (field === "hometown") {
      const suggested = current.suggestion
        ? hometownEntries(current.suggestion.value).map(formatHometownEntry)
        : [];
      setHometownDraft(suggested);
      setListDraft([]);
      setDraft("");
      return;
    }
    if (isListField(field)) {
      setHometownDraft([]);
      setListDraft(current.suggestion ? asChipValues(current.suggestion.value) : []);
      setDraft("");
      return;
    }
    setHometownDraft([]);
    setListDraft([]);
    setDraft(current.suggestion ? displayValue(current.suggestion.value) : "");
  }, [draftKey, current, field]);

  const advance = (didAccept: boolean) => {
    if (didAccept) setAccepted((count) => count + 1);
    else setSkipped((count) => count + 1);
    setIndex((value) => value + 1);
  };

  const accept = async () => {
    if (!current || saving) return;
    const value = field === "hometown"
      ? hometownDraft.map((entry) => entry.trim()).filter(Boolean)
      : isListField(field)
        ? listDraft.map((entry) => entry.trim()).filter(Boolean)
      : toWriteValue(field, draft);
    if (Array.isArray(value) ? !value.length : !String(value)) return;
    setSaving(true);
    try {
      await api.updatePerson(current.person.id, { [field]: value });
      if (current.suggestion?.id) {
        try {
          await api.reviewSuggestion(current.suggestion.id, "accepted", false);
        } catch {
          // Feedback is best-effort; the write already succeeded.
        }
      }
      onApplied?.();
      advance(true);
    } catch (error) {
      setQueue((prev) => {
        const next = [...prev];
        if (!next[index]) return prev;
        next[index] = {
          ...next[index],
          status: "error",
          message: error instanceof Error ? error.message : "Could not save",
        };
        return next;
      });
    } finally {
      setSaving(false);
    }
  };

  const skip = async () => {
    if (!current || saving) return;
    if (current.suggestion?.id) {
      try {
        await api.reviewSuggestion(current.suggestion.id, "rejected", false);
      } catch {
        /* ignore */
      }
    }
    advance(false);
  };

  const done = index >= queue.length && !loadingList;
  const progress = queue.length
    ? `Person ${Math.min(index + 1, queue.length)} of ${queue.length}`
    : "";

  return (
    <Modal
      title="Fill gaps"
      subtitle="One category at a time. Each value is reviewed before it is written, with provenance attributed to Nett."
      onClose={onClose}
      wide
    >
      <div className="fill-gaps">
        <label className="fill-gaps-field">
          <span>Category</span>
          <select
            value={field}
            onChange={(event) => setField(event.target.value)}
            disabled={saving}
          >
            {MASS_FILL_FIELDS.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        {listError && (
          <p className="fill-gaps-banner is-error" role="alert">
            <WarningCircle size={16} aria-hidden="true" />
            {listError}
          </p>
        )}

        {loadingList && (
          <p className="fill-gaps-banner">
            <SpinnerGap className="spin" size={16} aria-hidden="true" />
            Loading people with {missingFilterLabel(field).toLowerCase()}…
          </p>
        )}

        {!loadingList && !listError && !queue.length && (
          <p className="fill-gaps-banner">
            Everyone already has a {fieldLabel(field).toLowerCase()} recorded.
          </p>
        )}

        {done && queue.length > 0 && (
          <div className="fill-gaps-done">
            <Check size={22} aria-hidden="true" />
            <div>
              <strong>Queue finished</strong>
              <p>
                Accepted {accepted}, skipped {skipped}. Nothing else was written.
              </p>
            </div>
            <button type="button" className="primary-button" onClick={onClose}>
              Done
            </button>
          </div>
        )}

        {current && !done && (
          <article className="fill-gaps-card" aria-live="polite">
            <header>
              <Avatar person={current.person} size="lg" />
              <div>
                <h3>{current.person.name}</h3>
                <p>
                  {[current.person.job_title, current.person.company]
                    .filter(Boolean)
                    .join(" · ") || "No role recorded"}
                </p>
                <small>{progress}</small>
              </div>
            </header>

            {current.status === "loading" && (
              <p className="fill-gaps-banner">
                <SpinnerGap className="spin" size={16} aria-hidden="true" />
                Reading stored evidence…
              </p>
            )}

            {(current.status === "empty" || current.status === "error") && current.message && (
              <p className={`fill-gaps-banner ${current.status === "error" ? "is-error" : ""}`}>
                {current.status === "error" && <WarningCircle size={16} aria-hidden="true" />}
                {current.message}
              </p>
            )}

            {current.suggestion && (
              <p className="fill-gaps-evidence">
                <strong>{Math.round((current.suggestion.confidence || 0) * 100)}%</strong>
                {" · "}
                {current.suggestion.reason}
              </p>
            )}

            <div className="fill-gaps-value" id={inputId}>
              <span>{fieldLabel(field)}</span>
              {field === "gender" ? (
                <select
                  value={draft === "male" || draft === "female" ? draft : ""}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={saving || current.status === "loading"}
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                >
                  <option value="">Not recorded</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              ) : field === "location" ? (
                <PlacePicker
                  value={draft}
                  onChange={setDraft}
                  disabled={saving || current.status === "loading"}
                />
              ) : field === "hometown" ? (
                <HometownEditor
                  value={hometownDraft}
                  onChange={setHometownDraft}
                  disabled={saving || current.status === "loading"}
                />
              ) : isListField(field) ? (
                <ChipInput
                  values={listDraft}
                  onChange={setListDraft}
                  placeholder="Type and press Enter"
                  suggestions={field === "interests" ? ownerInterests : []}
                  disabled={saving || current.status === "loading"}
                />
              ) : (
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void accept();
                    }
                  }}
                  placeholder="Type or edit the value"
                  disabled={saving || current.status === "loading"}
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                />
              )}
            </div>

            <div className="fill-gaps-actions">
              <button type="button" className="secondary-button" onClick={() => void skip()} disabled={saving}>
                <X size={15} aria-hidden="true" />
                Skip
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void accept()}
                disabled={
                  saving
                  || current.status === "loading"
                  || (field === "hometown"
                    ? !hometownDraft.some((entry) => entry.trim())
                    : isListField(field)
                      ? !listDraft.some((entry) => entry.trim())
                      : !draft.trim())
                }
              >
                {saving ? <SpinnerGap className="spin" size={15} /> : <Check size={15} />}
                Accept
                <kbd>⌘↵</kbd>
              </button>
            </div>
            <p className="fill-gaps-hint">
              <ArrowRight size={14} aria-hidden="true" />
              Accepted values are attributed to Nett with field-level provenance.
              Offline personality is never proposed here — open All fields to type that.
              Gender is limited to male or female and auto-fills from names; culture is a
              suggestion you must accept.
            </p>
          </article>
        )}
      </div>
    </Modal>
  );
}
