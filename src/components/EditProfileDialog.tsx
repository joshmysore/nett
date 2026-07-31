import {
  ArrowSquareOut,
  Brain,
  Check,
  LinkSimple,
  Sparkle,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Modal, sourceLabel } from "@/components/Primitives";
import { api, type PublicProfileSuggestion } from "@/lib/api";
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

const textFields = [
  ["name", "Name"],
  ["headline", "Headline"],
  ["job_title", "Job title"],
  ["company", "Company"],
  ["location", "Location"],
  ["linkedin_url", "LinkedIn profile"],
  ["industry", "Industry"],
  ["relationship", "Relationship"],
  ["follow_up_date", "Follow-up date"],
  ["interests", "Interests, comma separated"],
  ["skills", "Skills, comma separated"],
  ["institutions", "Institutions, comma separated"],
] as const;

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
}: {
  person: FullPerson;
  form: Record<string, unknown>;
  setForm: (value: Record<string, unknown>) => void;
  saving: boolean;
  onSave: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [finding, setFinding] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
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
    setFinding(true);
    setSuggestionError(null);
    try {
      const result = await api.autofill(person.id);
      const next = Array.isArray(result.suggestions) ? result.suggestions : [];
      setSuggestions(next);
      setSelected(new Set(next.map((suggestion) => suggestion.field)));
    } catch (error) {
      setSuggestionError(
        error instanceof Error ? error.message : "Could not inspect profile evidence",
      );
    } finally {
      setFinding(false);
    }
  };

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
        <button onClick={() => void findSuggestions()} disabled={finding}>
          {finding ? <SpinnerGap className="spin" /> : <Brain />}
          {finding ? "Inspecting" : "Find evidence"}
        </button>
      </div>

      {suggestionError && (
        <p className="inline-error" role="alert">
          <WarningCircle size={15} />
          {suggestionError}
        </p>
      )}

      {suggestions.length > 0 && (
        <div className="autofill-panel suggestion-review">
          <div>
            {comparable.map((suggestion) => (
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
                <p>{suggestion.reason}</p>
              </label>
            ))}
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
        {textFields.map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            <input
              type={key === "follow_up_date" ? "date" : "text"}
              value={displayValue(form[key])}
              onChange={(event) => setForm({ ...form, [key]: event.target.value })}
            />
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
