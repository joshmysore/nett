import "@/styles/review.css";
import {
  Check,
  SpinnerGap,
  Trash,
  UsersThree,
  WarningCircle,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Avatar, SourceBadge } from "@/components/Primitives";
import { SuccessCheck } from "@/components/transitions/SuccessCheck";
import { api, isAbortError } from "@/lib/api";
import type { ToastKind } from "@/components/Primitives";

type MergeItem = Awaited<ReturnType<typeof api.mergeQueue>>[number];
type SuggestionItem = Awaited<ReturnType<typeof api.reviewInbox>>["suggestions"][number];

export function ReviewPage({
  refresh,
  notify,
}: {
  refresh: () => void;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const [merges, setMerges] = useState<MergeItem[]>([]);
  const [mergesTotal, setMergesTotal] = useState(0);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const inbox = await api.reviewInbox(signal, { limit: 40, offset: 0 });
      if (signal?.aborted) return;
      setMerges(inbox.merges);
      setMergesTotal(inbox.mergesTotal);
      setSuggestions(inbox.suggestions);
    } catch (reason) {
      if (isAbortError(reason)) return;
      setError(reason instanceof Error ? reason.message : "Review inbox unavailable");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const resolveMerge = async (identityId: string, personId?: string, createNew = false) => {
    setWorking(identityId);
    try {
      await api.resolveMerge(identityId, personId, createNew);
      await load();
      refresh();
      notify("success", createNew ? "Created a separate person" : "Identity linked");
    } catch (reason) {
      notify("error", reason instanceof Error ? reason.message : "Could not resolve merge");
    } finally {
      setWorking(null);
    }
  };

  const reviewSuggestion = async (id: string, decision: "accepted" | "rejected") => {
    setWorking(id);
    try {
      await api.reviewSuggestion(id, decision, decision === "accepted");
      setSuggestions((rows) => rows.filter((row) => row.id !== id));
      refresh();
      notify("success", decision === "accepted" ? "Suggestion applied" : "Suggestion dismissed");
    } catch (reason) {
      notify("error", reason instanceof Error ? reason.message : "Could not review suggestion");
    } finally {
      setWorking(null);
    }
  };

  if (loading) {
    return (
      <div className="review-page">
        <section className="page-heading">
          <div>
            <h1>Review</h1>
            <p>Merges and field suggestions waiting for a decision.</p>
          </div>
        </section>
        <p className="review-status" aria-busy="true">
          <SpinnerGap className="spin" size={17} /> Loading inbox…
        </p>
      </div>
    );
  }

  const empty = !merges.length && !suggestions.length;

  return (
    <div className="review-page">
      <section className="page-heading">
        <div>
          <h1>Review</h1>
          <p>Nett found evidence it cannot safely resolve on its own.</p>
        </div>
      </section>

      {!empty && (
        <dl className="review-summary">
          <div>
            <dt>Identities need confirmation</dt>
            <dd>{mergesTotal}</dd>
          </div>
          <div>
            <dt>Facts need review</dt>
            <dd>{suggestions.length}</dd>
          </div>
        </dl>
      )}

      {error && (
        <p className="inline-error" role="alert">
          <WarningCircle size={15} /> {error}
          <button type="button" className="secondary-button" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}

      {empty && !error && (
        <section className="review-clear">
          <SuccessCheck active size={22} variant="stage" />
          <div>
            <strong>Inbox is clear</strong>
            <p>Nothing in the current evidence needs a decision.</p>
          </div>
        </section>
      )}

      {merges.length > 0 && (
        <section className="review-section">
          <header>
            <UsersThree size={18} />
            <h2>Identities to confirm</h2>
            <span>{mergesTotal}</span>
          </header>
          {mergesTotal > merges.length && (
            <p className="review-page-note">Showing the next {merges.length} of {mergesTotal}. Resolve these to advance the queue.</p>
          )}
          <ul className="review-list">
            {merges.map((item) => (
              <li key={item.sourceIdentityId}>
                <div className="review-card">
                  <div className="review-card-head">
                    <SourceBadge source={item.connectorId} />
                    <strong>{item.displayName}</strong>
                    <small>Unlinked source identity</small>
                  </div>
                  <div className="review-actions">
                    {item.candidates.map((candidate) => (
                      <button
                        key={candidate.suggestionId}
                        type="button"
                        disabled={working === item.sourceIdentityId}
                        onClick={() => void resolveMerge(item.sourceIdentityId, candidate.personId)}
                      >
                        <Avatar person={{ id: candidate.personId, name: candidate.name }} size="sm" />
                        <span>
                          Link to {candidate.name}
                          <small>
                            {candidate.reason === "ambiguous-exact-name"
                              ? "Same name"
                              : `${Math.min(99, Math.round(candidate.confidence * 100))}% similar`}
                          </small>
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={working === item.sourceIdentityId}
                      onClick={() => void resolveMerge(item.sourceIdentityId, undefined, true)}
                    >
                      Create separate
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {suggestions.length > 0 && (
        <section className="review-section">
          <header>
            <h2>Facts to review</h2>
            <span>{suggestions.length}</span>
          </header>
          <ul className="review-list">
            {suggestions.map((item) => (
              <li key={item.id}>
                <div className="review-card">
                  <div className="review-card-head">
                    <Link to={`/people/${item.personId}`}>{item.personName}</Link>
                    <strong>{item.fieldName.replace(/_/g, " ")}</strong>
                    <small>
                      {item.confidence != null
                        ? `${Math.round(item.confidence * 100)}% · `
                        : ""}
                      {item.rationale || "Suggested from stored evidence"}
                    </small>
                  </div>
                  <p className="review-proposed">
                    <span>Proposed</span>
                    <strong>{formatValue(item.proposedValue)}</strong>
                  </p>
                  <div className="review-actions compact">
                    <button
                      type="button"
                      className="primary-button"
                      disabled={working === item.id}
                      onClick={() => void reviewSuggestion(item.id, "accepted")}
                    >
                      <Check size={16} /> Accept
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={working === item.id}
                      onClick={() => void reviewSuggestion(item.id, "rejected")}
                    >
                      <Trash size={16} /> Skip
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function formatValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
