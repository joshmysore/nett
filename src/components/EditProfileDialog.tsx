import {
  ArrowSquareOut,
  Brain,
  Check,
  LinkSimple,
  Sparkle,
  SpinnerGap,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { HometownEditor, PlacePicker } from "@/components/PlacePicker";
import { Modal, sourceLabel } from "@/components/Primitives";
import { api, isAbortError, type PublicProfileSuggestion } from "@/lib/api";
import { EDIT_TEXT_FIELDS } from "@/lib/person-fields";
import type { FullPerson } from "@/types";

type Suggestion = {
  id?: string;
  field: string;
  value: unknown;
  confidence: number;
  reason: string;
  source: string;
  evidenceIds?: string[];
};

const PLACE_FIELDS = new Set(["location", "hometown"]);

const textFields: [string, string][] = [
  ["name", "Name"],
  ["headline", "Headline"],
  ["job_title", "Job title"],
  ["linkedin_url", "LinkedIn profile"],
  ...EDIT_TEXT_FIELDS.filter((field) => !PLACE_FIELDS.has(field.key)).map((field) => [
    field.key,
    field.kind === "list" ? `${field.label}, comma separated` : field.label,
  ] as [string, string]),
  ["follow_up_date", "Follow-up date"],
];

function displayValue(value: unknown) {
  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
}

export function EditProfileDialog({
  person,
  form,
  setForm,
  saving,
  onSave,
  onClose,
  hiddenFields,
}: {
  person: FullPerson;
  form: Record<string, unknown>;
  setForm: (value: Record<string, unknown>) => void;
  saving: boolean;
  onSave: () => void | Promise<void>;
  onClose: () => void;
  /** Fields Nett must never propose or display. */
  hiddenFields?: ReadonlySet<string>;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [finding, setFinding] = useState(false);
  const [suggestionNote, setSuggestionNote] = useState<string | null>(null);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const findController = useRef<AbortController | null>(null);
  const [stagedSuggestionIds, setStagedSuggestionIds] = useState<string[]>([]);
  const [publicUrl, setPublicUrl] = useState(person.linkedin_url || "");
  const [publicText, setPublicText] = useState("");
  const [publicSuggestions, setPublicSuggestions] = useState<PublicProfileSuggestion[]>([]);
  const [publicSelected, setPublicSelected] = useState<Set<string>>(new Set());
  const [publicFinding, setPublicFinding] = useState(false);
  const [pendingPublic, setPendingPublic] = useState<{
    profileUrl: string;
    publicText: string;
    acceptedFields: string[];
  } | null>(null);

  const selectedCount = selected.size;
  const comparable = useMemo(
    () =>
      suggestions.map((suggestion) => ({
        ...suggestion,
        current: displayValue(form[suggestion.field]),
        proposed: displayValue(suggestion.value),
      })),
    [form, suggestions],
  );
  const linkedInSearchUrl = useMemo(() => {
    const terms = [person.name, person.company, person.location].filter(Boolean).join(" ");
    return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(terms)}`;
  }, [person.company, person.location, person.name]);

  const findSuggestions = async () => {
    findController.current?.abort();
    const abort = new AbortController();
    findController.current = abort;
    setFinding(true);
    setSuggestionError(null);
    setSuggestionNote(null);
    try {
      const quick = await api.autofill(person.id, abort.signal, { generate: false });
      let next = (Array.isArray(quick.suggestions) ? quick.suggestions : []).filter(
        (suggestion) => !hiddenFields?.has(suggestion.field),
      );
      setSuggestions(next);
      setSelected(
        new Set(
          next
            .filter((suggestion) => !displayValue(form[suggestion.field]).trim())
            .map((suggestion) => suggestion.field),
        ),
      );
      setSuggestionNote(
        quick.note
          || (next.length
            ? "Showing evidence-backed suggestions. Asking the local model for more…"
            : "No direct evidence yet. Asking the local model…"),
      );

      try {
        const result = await api.autofill(person.id, abort.signal, { generate: true });
        next = (Array.isArray(result.suggestions) ? result.suggestions : []).filter(
          (suggestion) => !hiddenFields?.has(suggestion.field),
        );
        setSuggestions(next);
        setSelected(
          new Set(
            next
              .filter((suggestion) => !displayValue(form[suggestion.field]).trim())
              .map((suggestion) => suggestion.field),
          ),
        );
        if (result.note) setSuggestionNote(result.note);
        else if (!next.length) setSuggestionNote("No evidence-backed suggestion was found.");
        else setSuggestionNote(null);
      } catch (error) {
        if (isAbortError(error)) {
          if (!next.length) setSuggestionNote("Evidence check cancelled. Nothing was written.");
          else setSuggestionNote(null);
        } else if (next.length) {
          setSuggestionNote(
            "Local inference was unavailable, so only directly recorded evidence was considered.",
          );
        } else {
          throw error;
        }
      }
    } catch (error) {
      if (isAbortError(error)) setSuggestionNote("Evidence check cancelled. Nothing was written.");
      else {
        setSuggestionError(
          error instanceof Error ? error.message : "Could not inspect profile evidence",
        );
      }
    } finally {
      if (findController.current === abort) findController.current = null;
      setFinding(false);
    }
  };

  useEffect(() => () => findController.current?.abort(), []);

  const toggleSuggestion = (field: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const applySelected = async () => {
    const next = { ...form };
    comparable.forEach((suggestion) => {
      if (selected.has(suggestion.field)) {
        next[suggestion.field] = suggestion.value;
      }
    });
    const accepted = comparable.filter((suggestion) => selected.has(suggestion.field) && suggestion.id).map((suggestion) => suggestion.id!);
    const rejected = comparable.filter((suggestion) => !selected.has(suggestion.field) && suggestion.id).map((suggestion) => suggestion.id!);
    await Promise.all(rejected.map((id) => api.reviewSuggestion(id, "rejected").catch(() => undefined)));
    setStagedSuggestionIds((current) => [...new Set([...current, ...accepted])]);
    setForm(next);
    setSuggestions([]);
    setSelected(new Set());
  };
  const previewPublicProfile = async () => {
    setPublicFinding(true);
    setSuggestionError(null);
    try {
      const result = await api.previewLinkedIn(person.id, { profileUrl: publicUrl, publicText });
      setPublicUrl(result.profileUrl);
      setPublicSuggestions(result.suggestions);
      setPublicSelected(new Set(result.suggestions.map((suggestion) => suggestion.field)));
    } catch (error) {
      setSuggestionError(error instanceof Error ? error.message : "Could not inspect public profile text");
    } finally {
      setPublicFinding(false);
    }
  };
  const stagePublicProfile = () => {
    const accepted = publicSuggestions.filter((suggestion) => publicSelected.has(suggestion.field));
    if (!accepted.length) return;
    setForm({
      ...form,
      ...Object.fromEntries(accepted.map((suggestion) => [suggestion.field, suggestion.value])),
    });
    setPendingPublic({
      profileUrl: publicUrl,
      publicText,
      acceptedFields: accepted.map((suggestion) => suggestion.field),
    });
    setPublicSuggestions([]);
    setPublicSelected(new Set());
  };
  const saveWithFeedback = async () => {
    try {
      if (pendingPublic) await api.applyLinkedIn(person.id, pendingPublic);
      await Promise.all(stagedSuggestionIds.map((id) => api.reviewSuggestion(id, "accepted").catch(() => undefined)));
      await onSave();
    } catch (error) {
      setSuggestionError(error instanceof Error ? error.message : "Could not save profile evidence");
    }
  };

  return (
    <Modal
      title="Edit Nett metadata"
      subtitle="Review source-backed changes before they are written to Nett fields. Connected source records remain untouched."
      onClose={onClose}
      wide
    >
      <div className="autofill-control">
        <div>
          <Sparkle size={18} weight="fill" />
          <span>
            <strong>Evidence suggestions</strong>
            <small>Compare proposed values one field at a time.</small>
          </span>
        </div>
        <span className="evidence-check-bar">
          <button onClick={() => void findSuggestions()} disabled={finding}>
            {finding ? <SpinnerGap className="spin" /> : <Brain />}
            {finding ? "Reading evidence" : "Find evidence"}
          </button>
          {finding && (
            <button data-variant="cancel" onClick={() => findController.current?.abort()}>
              <X size={15} aria-hidden="true" />
              Cancel
            </button>
          )}
        </span>
      </div>

      <p className="evidence-status" role="status" aria-live="polite">
        {finding
          ? "Reading stored evidence. This can take a few seconds."
          : suggestionNote || ""}
      </p>

      {suggestionError && (
        <p className="inline-error" role="alert">
          <WarningCircle size={15} />
          {suggestionError}
        </p>
      )}

      {suggestions.length > 0 && (
        <div className="autofill-panel suggestion-review">
          <div>
            {comparable.map((suggestion) => {
              const conflicting =
                Boolean(suggestion.current.trim()) && suggestion.current !== suggestion.proposed;
              return (
                <label
                  className={selected.has(suggestion.field) ? "is-selected" : ""}
                  key={suggestion.id || `${suggestion.field}:${suggestion.proposed}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(suggestion.field)}
                    onChange={() => toggleSuggestion(suggestion.field)}
                  />
                  <span className="suggestion-field">
                    <strong>{suggestion.field.replace(/_/g, " ")}</strong>
                    <small>{sourceLabel(suggestion.source)}</small>
                  </span>
                  <span className="suggestion-diff">
                    <span>
                      <small>Current</small>
                      <b>{suggestion.current || "Not recorded"}</b>
                    </span>
                    <span>
                      <small>Suggested</small>
                      <b>{suggestion.proposed || "No value"}</b>
                    </span>
                  </span>
                  <i>{Math.round((suggestion.confidence || 0) * 100)}%</i>
                  <p>
                    {conflicting && (
                      <strong className="suggestion-unresolved">
                        Replaces a recorded value.{" "}
                      </strong>
                    )}
                    {suggestion.reason}
                  </p>
                </label>
              );
            })}
          </div>
          <button onClick={() => void applySelected()} disabled={!selectedCount}>
            <Check size={15} />
            Apply {selectedCount} selected
          </button>
          <small className="bulk-api-note">
            Selected values remain staged until you choose Save profile. Accept/reject
            feedback improves future local suggestions.
          </small>
        </div>
      )}

      {!finding && !suggestions.length && !suggestionError && (
        <p className="autofill-note">
          Suggestions are never applied automatically.
        </p>
      )}

      <section className="public-profile-assist">
        <div className="public-profile-heading">
          <span>
            <LinkSimple size={17} />
            <span>
              <strong>Public profile assist</strong>
              <small>Paste visible profile text. Nett parses it locally and waits for your approval.</small>
            </span>
          </span>
          <a href={linkedInSearchUrl} target="_blank" rel="noreferrer">
            Find on LinkedIn <ArrowSquareOut size={14} />
          </a>
        </div>
        <div className="public-profile-inputs">
          <label>
            <span>Public profile URL</span>
            <input
              type="url"
              value={publicUrl}
              onChange={(event) => setPublicUrl(event.target.value)}
              placeholder="https://www.linkedin.com/in/..."
            />
          </label>
          <label>
            <span>Visible public profile text</span>
            <textarea
              value={publicText}
              onChange={(event) => setPublicText(event.target.value)}
              placeholder={`Paste the visible name, headline, and location for ${person.name}`}
            />
          </label>
        </div>
        <div className="public-profile-actions">
          <small>No background scraping, cookies, or automatic overwrites.</small>
          <button onClick={() => void previewPublicProfile()} disabled={publicFinding || !publicUrl.trim()}>
            {publicFinding ? <SpinnerGap className="spin" /> : <Sparkle />}
            {publicFinding ? "Inspecting" : "Preview facts"}
          </button>
        </div>
        {publicSuggestions.length > 0 && (
          <div className="public-profile-results">
            {publicSuggestions.map((suggestion) => (
              <label key={suggestion.field}>
                <input
                  type="checkbox"
                  checked={publicSelected.has(suggestion.field)}
                  onChange={() => setPublicSelected((current) => {
                    const next = new Set(current);
                    if (next.has(suggestion.field)) next.delete(suggestion.field);
                    else next.add(suggestion.field);
                    return next;
                  })}
                />
                <span>
                  <strong>{suggestion.field.replace(/_/g, " ")}</strong>
                  <b>{suggestion.value}</b>
                  <small>{suggestion.reason}</small>
                </span>
                <i>{Math.round(suggestion.confidence * 100)}%</i>
              </label>
            ))}
            <button onClick={stagePublicProfile} disabled={!publicSelected.size}>
              <Check size={15} /> Stage selected facts
            </button>
          </div>
        )}
        {pendingPublic && (
          <p className="public-profile-staged">
            <Check size={14} /> Public evidence is staged and will be saved with the profile.
          </p>
        )}
      </section>

      <div className="edit-grid">
        <label className="full-field">
          <span>Location</span>
          <PlacePicker
            value={displayValue(form.location)}
            showClear
            onChange={(location) => setForm({ ...form, location })}
          />
        </label>
        <div className="full-field hometown-field">
          <span>Hometowns</span>
          <HometownEditor
            value={Array.isArray(form.hometown)
              ? form.hometown.map((entry) => String(entry))
              : displayValue(form.hometown)
                  .split(/\n|,/)
                  .map((entry) => entry.trim())
                  .filter(Boolean)}
            onChange={(hometown) => setForm({ ...form, hometown })}
          />
        </div>
        {textFields.map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            {key === "gender" ? (
              <select
                value={displayValue(form.gender)}
                onChange={(event) => setForm({ ...form, gender: event.target.value })}
              >
                <option value="">Not recorded</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            ) : (
              <input
                type={key === "follow_up_date" || key === "last_contact" ? "date" : "text"}
                value={displayValue(form[key])}
                onChange={(event) => setForm({ ...form, [key]: event.target.value })}
              />
            )}
          </label>
        ))}
        {[
          ["relationship_strength", "Relationship strength"],
          ["warmth", "Warmth"],
          ["intro_potential", "Introduction potential"],
        ].map(([key, label]) => (
          <label className="range-field" key={key}>
            <span>
              {label}
              <strong>{String(form[key] || 0)}</strong>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              value={Number(form[key] || 0)}
              onChange={(event) =>
                setForm({ ...form, [key]: Number(event.target.value) })
              }
            />
          </label>
        ))}
        <label className="full-field">
          <span>Notes</span>
          <textarea
            value={displayValue(form.notes)}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </label>
      </div>
      <div className="modal-actions">
        <button className="secondary-button" onClick={onClose}>
          Cancel
        </button>
        <button className="primary-button" onClick={() => void saveWithFeedback()} disabled={saving}>
          {saving && <SpinnerGap className="spin" />}
          Save profile
        </button>
      </div>
    </Modal>
  );
}
