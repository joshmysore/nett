import {
  At,
  Check,
  MagnifyingGlass,
  NotePencil,
  PaperPlaneTilt,
  Phone,
  Plus,
  SpinnerGap,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { type FormEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { PlacePicker } from "@/components/PlacePicker";
import {
  asList,
  calendarDate,
  friendlyDate,
  SourceBadge,
  sourceLabel,
  type ToastKind,
} from "@/components/Primitives";
import { api, isAbortError } from "@/lib/api";
import { displayBirthday } from "@/lib/birthday";
import {
  defensibleNextAction,
  EDITABLE_FIELDS,
  orderedMemories,
  provenanceIndex,
  SENSITIVE_FIELDS,
  type EditableField,
  type NextAction,
  type RecordedBrief,
} from "@/lib/person-brief";
import { groupHometownEntries, hometownEntries } from "@/lib/place";
import type { FullPerson } from "@/types";

const text = (value: unknown) => String(value ?? "").trim();

const capitalise = (value: string) =>
  value.replace(/(^|[,/]\s*)([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase());

type ReadRow = { key: string; label: string; display: string; mono?: boolean };

function readRows(person: FullPerson): Record<string, ReadRow> {
  const met = [text(person.when_met), text(person.where_met), text(person.how_met)].filter(Boolean);
  const languages = asList(person.languages).filter(Boolean);
  const skills = asList(person.skills).filter(Boolean);
  const interests = asList(person.interests).filter(Boolean);
  const foods = asList(person.foods).filter(Boolean);
  const online = asList(person.online_personality).filter(Boolean);
  const rows: Record<string, ReadRow> = {};
  if (met.length) rows.met = { key: "met", label: "Met", display: capitalise(met.join(" / ")) };
  if (text(person.industry)) {
    rows.industry = { key: "industry", label: "Industry", display: capitalise(text(person.industry)) };
  }
  const hometownGroups = groupHometownEntries(hometownEntries(person.hometown));
  if (hometownGroups.length) {
    rows.hometown = {
      key: "hometown",
      label: "Hometown",
      display: hometownGroups
        .map((group) => (
          group.subareas.length
            ? `${group.main} (⊏ ${group.subareas.join(", ")})`
            : group.main
        ))
        .join(" · "),
    };
  }
  if (text(person.spike)) {
    rows.spike = { key: "spike", label: "Spike", display: text(person.spike) };
  }
  if (languages.length) {
    rows.languages = { key: "languages", label: "Languages", display: capitalise(languages.join(", ")) };
  }
  if (skills.length) {
    rows.skills = { key: "skills", label: "Skills", display: capitalise(skills.join(", ")) };
  }
  if (interests.length) {
    rows.interests = { key: "interests", label: "Interests", display: capitalise(interests.join(", ")) };
  }
  if (foods.length) {
    rows.foods = { key: "foods", label: "Foods", display: capitalise(foods.join(", ")) };
  }
  if (text(person.gender)) {
    rows.gender = { key: "gender", label: "Gender", display: text(person.gender) };
  }
  if (text(person.culture)) {
    rows.culture = { key: "culture", label: "Culture", display: text(person.culture) };
  }
  if (text(person.personality)) {
    rows.personality = { key: "personality", label: "Personality", display: text(person.personality) };
  }
  if (online.length) {
    rows.online_personality = {
      key: "online_personality",
      label: "Online personality",
      display: capitalise(online.join(", ")),
    };
  }
  if (text(person.birthday)) {
    rows.birthday = {
      key: "birthday",
      label: "Birthday",
      display: displayBirthday(person.birthday),
    };
  }
  if (text(person.last_contact)) {
    rows.last_contact = {
      key: "last_contact",
      label: "Last contact",
      display: friendlyDate(person.last_contact),
      mono: true,
    };
  }
  return rows;
}

const ROW_ORDER = [
  "relationship",
  "met",
  "job_title",
  "company",
  "industry",
  "location",
  "hometown",
  "spike",
  "languages",
  "skills",
  "interests",
  "foods",
  "gender",
  "culture",
  "personality",
  "online_personality",
  "birthday",
  "last_contact",
  "follow_up_date",
] as const;

export { SENSITIVE_FIELDS, EDITABLE_FIELDS, defensibleNextAction, orderedMemories, provenanceIndex, recordedBrief } from "@/lib/person-brief";
export type { EditableField, NextAction, RecordedBrief } from "@/lib/person-brief";

export function RecordedBriefBlock({ brief }: { brief: RecordedBrief }) {
  return (
    <section className="person-brief">
      <h2>What matters</h2>
      <p>{brief.text}</p>
      <p className="person-brief-source">
        <SourceBadge source={brief.source} />
        <span>{brief.kind}, recorded verbatim</span>
        {brief.occurredAt && <time dateTime={brief.occurredAt}>{calendarDate(brief.occurredAt)}</time>}
      </p>
    </section>
  );
}

export function NextActionBlock({
  action,
  onCapture,
}: {
  action: NextAction;
  onCapture?: () => void;
}) {
  return (
    <section className={`person-next ${action.tone === "due" ? "is-due" : ""}`.trim()}>
      <div>
        <strong>{action.headline}</strong>
        <span>{action.detail}</span>
      </div>
      {onCapture && (
        <button type="button" className="secondary-button" onClick={onCapture}>
          <NotePencil size={16} aria-hidden="true" />
          Record a memory
        </button>
      )}
    </section>
  );
}

export function InlineFacts({
  person,
  onPatch,
  notify,
}: {
  person: FullPerson;
  onPatch: (patch: Record<string, string>) => Promise<void>;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const fieldId = useId();
  const provenance = useMemo(() => provenanceIndex(person), [person]);
  const derived = useMemo(() => readRows(person), [person]);

  const start = (field: EditableField) => {
    setDraft(text(person[field.key]));
    setEditing(field.key);
  };
  const cancel = () => {
    setEditing(null);
    setDraft("");
  };
  const commit = async (event: FormEvent, field: EditableField) => {
    event.preventDefault();
    const next = draft.trim();
    if (next === text(person[field.key])) {
      cancel();
      return;
    }
    setSaving(true);
    try {
      await onPatch({ [field.key]: next });
      cancel();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : `${field.label} could not be saved`);
    } finally {
      setSaving(false);
    }
  };

  const editable = new Map(EDITABLE_FIELDS.map((field) => [field.key as string, field]));
  const visible = ROW_ORDER.filter((key) => {
    const field = editable.get(key);
    if (field) return Boolean(text(person[field.key])) || editing === key;
    return Boolean(derived[key]);
  });
  const missing = EDITABLE_FIELDS.filter(
    (field) => !text(person[field.key]) && editing !== field.key,
  );

  return (
    <>
      <dl className="person-facts">
        {visible.map((key) => {
          const field = editable.get(key);
          if (!field) {
            const row = derived[key];
            return (
              <div key={key}>
                <dt>{row.label}</dt>
                <dd>
                  <span className={`fact-text ${row.mono ? "is-mono" : ""}`.trim()}>{row.display}</span>
                  {provenance.get(key) && <SourceBadge source={provenance.get(key)!.connector_id} />}
                </dd>
              </div>
            );
          }
          const value = text(person[field.key]);
          const origin = provenance.get(field.key);
          const inputId = `${fieldId}-${field.key}`;
          if (editing === field.key) {
            return (
              <div key={key}>
                <dt>
                  <label htmlFor={inputId}>{field.label}</label>
                </dt>
                <dd>
                  <form className="fact-form" onSubmit={(event) => void commit(event, field)}>
                    <div className={`fact-form-row ${field.key === "location" ? "is-place" : ""}`.trim()}>
                      {field.key === "location" ? (
                        <PlacePicker
                          id={inputId}
                          value={draft}
                          showClear
                          onChange={setDraft}
                          disabled={saving}
                        />
                      ) : (
                        <input
                          id={inputId}
                          type={field.type}
                          value={draft}
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                          onChange={(event) => setDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.stopPropagation();
                              cancel();
                            }
                          }}
                        />
                      )}
                      <button type="submit" data-variant="commit" disabled={saving}>
                        {saving ? <SpinnerGap className="spin" size={15} /> : <Check size={15} />}
                        Save
                      </button>
                      <button type="button" onClick={cancel} disabled={saving}>
                        Cancel
                      </button>
                    </div>
                    {origin ? (
                      <p className="fact-origin">
                        Currently &ldquo;{origin.field_value}&rdquo; from {sourceLabel(origin.connector_id)},
                        recorded {calendarDate(origin.observed_at)}. Saving replaces it and records Nett
                        as the source.
                      </p>
                    ) : (
                      <p className="fact-origin">
                        Saved values are attributed to Nett and keep their own provenance entry.
                      </p>
                    )}
                  </form>
                </dd>
              </div>
            );
          }
          const display = field.key === "follow_up_date" ? calendarDate(value) : value;
          return (
            <div key={key}>
              <dt>{field.label}</dt>
              <dd>
                <button
                  type="button"
                  className="fact-edit"
                  onClick={() => start(field)}
                  aria-label={`${field.label}: ${display}. Edit`}
                >
                  <span
                    className={`fact-text ${field.key === "follow_up_date" ? "is-mono" : ""}`.trim()}
                  >
                    {field.key === "relationship" ? capitalise(display) : display}
                  </span>
                  <NotePencil className="fact-pencil" size={13} aria-hidden="true" />
                </button>
                {origin && <SourceBadge source={origin.connector_id} />}
              </dd>
            </div>
          );
        })}
      </dl>
      {missing.length > 0 && (
        <div className="fact-add">
          {missing.map((field) => (
            <button key={field.key} type="button" onClick={() => start(field)}>
              <Plus size={13} aria-hidden="true" />
              Add {field.label.toLowerCase()}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

type Suggestion = {
  id?: string;
  field: string;
  value: unknown;
  confidence: number;
  reason: string;
  source: string;
  evidence?: { sourceType?: string; excerpt?: string; quote?: string }[];
};

type Decision = "accept" | "keep";

/** Reads stored evidence and proposes field values. Nothing is written until a
 *  decision is made per suggestion, and a suggestion that contradicts a stored
 *  value has no default: the user must pick a side. */
export function EvidenceCheck({
  person,
  onPatched,
  notify,
}: {
  person: FullPerson;
  onPatched: (updated: FullPerson) => void;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const [running, setRunning] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [status, setStatus] = useState<{ tone: "info" | "degraded" | "error"; message: string } | null>(
    null,
  );
  const [applying, setApplying] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const run = async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setSuggestions(null);
    setDecisions({});
    setStatus({ tone: "info", message: "Reading stored evidence…" });
    try {
      // Phase 1: deterministic evidence only — should answer in milliseconds.
      const quick = await api.autofill(person.id, abort.signal, { generate: false });
      const first = asList(quick.suggestions).filter(
        (suggestion) => !SENSITIVE_FIELDS.has(suggestion.field),
      );
      setSuggestions(first);
      setStatus({
        tone: quick.degraded ? "degraded" : "info",
        message: quick.note
          || (first.length
            ? "Showing evidence-backed suggestions. Asking the local model for more…"
            : "No direct evidence yet. Asking the local model…"),
      });

      // Phase 2: optional model enrichment; cancellable independently.
      try {
        const result = await api.autofill(person.id, abort.signal, { generate: true });
        const usable = asList(result.suggestions).filter(
          (suggestion) => !SENSITIVE_FIELDS.has(suggestion.field),
        );
        setSuggestions(usable);
        if (result.note || result.degraded) {
          setStatus({
            tone: result.degraded ? "degraded" : "info",
            message: result.note || "Suggestions came back without local model enrichment.",
          });
        } else if (!usable.length) {
          setStatus({ tone: "info", message: "No evidence-backed suggestion was found." });
        } else {
          setStatus(null);
        }
      } catch (error) {
        if (isAbortError(error)) {
          if (first.length) setStatus(null);
          else setStatus({ tone: "info", message: "Evidence check cancelled. Nothing was written." });
        } else if (first.length) {
          setStatus({
            tone: "degraded",
            message: "Local inference was unavailable, so only directly recorded evidence was considered.",
          });
        } else {
          throw error;
        }
      }
    } catch (error) {
      if (isAbortError(error)) {
        setStatus({ tone: "info", message: "Evidence check cancelled. Nothing was written." });
      } else {
        setStatus({
          tone: "error",
          message: error instanceof Error ? error.message : "Stored evidence could not be read.",
        });
      }
    } finally {
      if (controller.current === abort) controller.current = null;
      setRunning(false);
    }
  };

  const cancel = () => controller.current?.abort();

  const conflictOf = (suggestion: Suggestion) => {
    const stored = person[suggestion.field as keyof FullPerson];
    const current = Array.isArray(stored) ? stored.join(", ") : text(stored);
    const proposed = Array.isArray(suggestion.value)
      ? suggestion.value.join(", ")
      : text(suggestion.value);
    return { current, proposed, conflicting: Boolean(current) && current !== proposed };
  };

  const apply = async () => {
    if (!suggestions) return;
    const accepted = suggestions.filter((suggestion) => decisions[suggestion.field] === "accept");
    const kept = suggestions.filter((suggestion) => decisions[suggestion.field] === "keep");
    if (!accepted.length && !kept.length) return;
    setApplying(true);
    try {
      if (accepted.length) {
        const patch = Object.fromEntries(
          accepted.map((suggestion) => [suggestion.field, conflictOf(suggestion).proposed]),
        );
        onPatched(await api.updatePerson(person.id, patch));
      }
      await Promise.all([
        ...accepted.map((suggestion) =>
          suggestion.id ? api.reviewSuggestion(suggestion.id, "accepted").catch(() => undefined) : undefined,
        ),
        ...kept.map((suggestion) =>
          suggestion.id ? api.reviewSuggestion(suggestion.id, "rejected").catch(() => undefined) : undefined,
        ),
      ]);
      const remaining = suggestions.filter((suggestion) => !decisions[suggestion.field]);
      setSuggestions(remaining.length ? remaining : null);
      setDecisions({});
      notify(
        "success",
        `${accepted.length} field${accepted.length === 1 ? "" : "s"} written, ${kept.length} kept as recorded`,
      );
      if (!remaining.length) setStatus({ tone: "info", message: "Every suggestion has been reviewed." });
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "The decision could not be saved");
    } finally {
      setApplying(false);
    }
  };

  const decided = suggestions?.filter((suggestion) => decisions[suggestion.field]).length || 0;

  return (
    <div className="evidence-check">
      <div className="evidence-check-bar">
        <button type="button" onClick={() => void run()} disabled={running}>
          {running ? <SpinnerGap className="spin" size={15} /> : <MagnifyingGlass size={15} />}
          {running ? "Reading evidence" : "Check evidence for gaps"}
        </button>
        {running && (
          <button type="button" data-variant="cancel" onClick={cancel}>
            <X size={15} aria-hidden="true" />
            Cancel
          </button>
        )}
      </div>
      <p className="evidence-status" data-tone={status?.tone} role="status" aria-live="polite">
        {status?.tone === "error" && <WarningCircle size={14} aria-hidden="true" />}
        {status?.message ||
          "Suggestions are proposals. Nothing is written until you choose, per field."}
      </p>
      {suggestions && suggestions.length > 0 && (
        <>
          <div className="suggestion-set">
            {suggestions.map((suggestion) => {
              const { current, proposed, conflicting } = conflictOf(suggestion);
              const name = `${person.id}-${suggestion.field}`;
              return (
                <div
                  className={`suggestion-card ${conflicting ? "is-conflict" : ""}`.trim()}
                  key={suggestion.field}
                >
                  <div className="suggestion-head">
                    <strong>{suggestion.field.replace(/_/g, " ")}</strong>
                    <span>
                      {sourceLabel(suggestion.source)} · {Math.round((suggestion.confidence || 0) * 100)}%
                    </span>
                  </div>
                  <p className="suggestion-reason">{suggestion.reason}</p>
                  {suggestion.evidence?.[0]?.excerpt && (
                    <small className="person-capture-note">{suggestion.evidence[0].excerpt}</small>
                  )}
                  <div className="suggestion-choice">
                    {conflicting && (
                      <label>
                        <input
                          type="radio"
                          name={name}
                          checked={decisions[suggestion.field] === "keep"}
                          onChange={() =>
                            setDecisions((current) => ({ ...current, [suggestion.field]: "keep" }))
                          }
                        />
                        <span>
                          {current}
                          <small>Keep what is recorded</small>
                        </span>
                      </label>
                    )}
                    <label>
                      <input
                        type={conflicting ? "radio" : "checkbox"}
                        name={conflicting ? name : undefined}
                        checked={decisions[suggestion.field] === "accept"}
                        onChange={(event) =>
                          setDecisions((current) => {
                            const next = { ...current };
                            if (event.target.checked) next[suggestion.field] = "accept";
                            else delete next[suggestion.field];
                            return next;
                          })
                        }
                      />
                      <span>
                        {proposed || "No value"}
                        <small>{conflicting ? "Replace with the suggestion" : "Add this value"}</small>
                      </span>
                    </label>
                  </div>
                  {conflicting && !decisions[suggestion.field] && (
                    <p className="suggestion-unresolved">
                      This contradicts a recorded value. Choose one before applying.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="suggestion-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => void apply()}
              disabled={!decided || applying}
            >
              {applying && <SpinnerGap className="spin" size={15} />}
              Apply {decided} decision{decided === 1 ? "" : "s"}
            </button>
            <span className="person-capture-note">
              Undecided suggestions stay pending and are never written.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/** Messaging-pattern briefing + reviewable suggestions from owned communications. */
export function RelationshipInsights({
  person,
  onPatched,
  notify,
}: {
  person: FullPerson;
  onPatched: (updated: FullPerson) => void;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [insight, setInsight] = useState<Awaited<ReturnType<typeof api.personInsights>> | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const run = async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setStatus("Reading message patterns…");
    try {
      const result = await api.personInsights(person.id, abort.signal);
      setInsight(result);
      setStatus(result.note || null);
    } catch (error) {
      if (isAbortError(error)) setStatus("Insights cancelled. Nothing was written.");
      else setStatus(error instanceof Error ? error.message : "Insights could not be generated");
    } finally {
      if (controller.current === abort) controller.current = null;
      setRunning(false);
    }
  };

  const accept = async (suggestion: NonNullable<typeof insight>["suggestions"][number]) => {
    if (!suggestion.field || applying) return;
    setApplying(suggestion.id || suggestion.field);
    try {
      let patch: Record<string, unknown> = { [suggestion.field]: suggestion.value };
      if (suggestion.field === "tags") {
        const next = String(suggestion.value);
        const merged = [...new Set([...(person.tags || []), next])];
        patch = { tags: merged };
      }
      onPatched(await api.updatePerson(person.id, patch));
      if (suggestion.id) {
        await api.reviewSuggestion(suggestion.id, "accepted").catch(() => undefined);
      }
      setInsight((current) =>
        current
          ? {
              ...current,
              suggestions: current.suggestions.filter((item) => item.id !== suggestion.id),
            }
          : current,
      );
      notify("success", `Accepted ${suggestion.field.replace(/_/g, " ")}`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Could not accept suggestion");
    } finally {
      setApplying(null);
    }
  };

  const reject = async (suggestion: NonNullable<typeof insight>["suggestions"][number]) => {
    if (suggestion.id) {
      await api.reviewSuggestion(suggestion.id, "rejected").catch(() => undefined);
    }
    setInsight((current) =>
      current
        ? {
            ...current,
            suggestions: current.suggestions.filter((item) => item.id !== suggestion.id),
          }
        : current,
    );
  };

  return (
    <div className="relationship-insights evidence-check">
      <div className="relationship-insights-bar evidence-check-bar">
        <button type="button" onClick={() => void run()} disabled={running}>
          {running ? <SpinnerGap className="spin" size={15} /> : <MagnifyingGlass size={15} />}
          {running ? "Reading messages" : "Suggest from messages"}
        </button>
        {running && (
          <button type="button" data-variant="cancel" onClick={() => controller.current?.abort()}>
            <X size={15} aria-hidden="true" />
            Cancel
          </button>
        )}
      </div>
      <p className="evidence-status" role="status" aria-live="polite">
        {status || "Uses stored messages only. Suggestions stay reviewable — nothing writes until you accept."}
      </p>
      {insight && (
        <>
          <p className="insight-briefing">{insight.briefing}</p>
          {insight.mode && (
            <p className="person-capture-note">
              Relationship mode looks <strong>{insight.mode}</strong>
              {insight.degraded ? " (signals only)" : ""}.
            </p>
          )}
          {insight.themes.length > 0 && (
            <ul className="insight-themes" aria-label="Content themes">
              {insight.themes.map((theme) => (
                <li key={theme.label} title={theme.evidence.join(" · ")}>
                  {theme.label}
                </li>
              ))}
            </ul>
          )}
          {insight.suggestions.length > 0 && (
            <div className="suggestion-set">
              {insight.suggestions.map((suggestion) => (
                <div className="suggestion-card" key={suggestion.id || `${suggestion.kind}-${suggestion.value}`}>
                  <div className="suggestion-head">
                    <strong>{suggestion.kind === "tag" ? "Category" : suggestion.kind.replace(/_/g, " ")}</strong>
                    <span>{Math.round(suggestion.confidence * 100)}%</span>
                  </div>
                  <p className="suggestion-reason">{suggestion.reason}</p>
                  <p className="fact-text">{Array.isArray(suggestion.value) ? suggestion.value.join(", ") : String(suggestion.value)}</p>
                  {suggestion.evidence[0] && (
                    <small className="person-capture-note">{suggestion.evidence[0]}</small>
                  )}
                  <div className="suggestion-actions">
                    {suggestion.field ? (
                      <button
                        type="button"
                        className="primary-button"
                        disabled={applying === (suggestion.id || suggestion.field)}
                        onClick={() => void accept(suggestion)}
                      >
                        Accept
                      </button>
                    ) : null}
                    <button type="button" className="secondary-button" onClick={() => void reject(suggestion)}>
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function PersonCapture({
  person,
  onSaved,
  notify,
  inputRef,
  id,
}: {
  person: FullPerson;
  onSaved: (updated: FullPerson) => void;
  notify: (kind: ToastKind, message: string) => void;
  inputRef?: React.RefObject<HTMLTextAreaElement>;
  id: string;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const save = async () => {
    const raw = value.trim();
    if (!raw) return;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setSaving(true);
    try {
      // The transcript is the record. Structure is only ever a later proposal.
      onSaved(await api.saveMemory(person.id, raw, {}, "manual", abort.signal));
      if (abort.signal.aborted) return;
      setValue("");
      notify("success", "Saved as written");
    } catch (error) {
      if (isAbortError(error)) return;
      notify("error", error instanceof Error ? error.message : "The memory could not be saved");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="person-capture">
      <label htmlFor={id}>Record a memory about {person.first_name || person.name}</label>
      <div className="person-capture-shell">
        <textarea
          id={id}
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void save();
          }}
          placeholder="A note on this person, stored as written."
        />
        <button type="button" onClick={() => void save()} disabled={saving || !value.trim()}>
          {saving ? <SpinnerGap className="spin" size={15} /> : <PaperPlaneTilt size={15} />}
          Save as written
        </button>
      </div>
      <p className="person-capture-note">
        Not turned into fields. Use Remember (⌘M) to structure a sentence onto someone.
      </p>
    </div>
  );
}

export function ContactMethods({ person }: { person: FullPerson }) {
  const methods = asList(person.methods);
  if (!methods.length) return <p className="drawer-empty">No email or phone is linked.</p>;
  return (
    <div className="contact-methods">
      {methods.map((method, index) => (
        <a
          key={`${method.kind}:${method.value}:${index}`}
          href={`${method.kind === "email" ? "mailto" : "tel"}:${method.value}`}
        >
          {method.kind === "email" ? <At size={16} /> : <Phone size={16} />}
          <span>
            <strong>{method.value}</strong>
            <small>
              {method.label || method.kind}
              {method.is_primary ? " / primary" : ""}
            </small>
          </span>
        </a>
      ))}
    </div>
  );
}

