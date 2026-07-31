import { AnimatePresence } from "motion/react";
import {
  ArrowRight,
  At,
  CalendarBlank,
  CheckCircle,
  Clock,
  MapPin,
  NotePencil,
  PaperPlaneTilt,
  Phone,
  Plus,
  Quotes,
  SpinnerGap,
  Tag,
  WarningCircle,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EditProfileDialog } from "@/components/EditProfileDialog";
import {
  AppSkeleton,
  asList,
  Avatar,
  calendarDate,
  friendlyDate,
  isDue,
  SourceBadge,
  sourceLabel,
  type ToastKind,
} from "@/components/Primitives";
import { api } from "@/lib/api";
import type { Communication, FullPerson, Interaction, MemoryRecord } from "@/types";

function buildRecommendations(person: FullPerson) {
  const recommendations: { title: string; detail: string; action: string }[] = [];
  if (isDue(person.follow_up_date)) {
    recommendations.push({
      title: "Follow up now",
      detail: `A follow-up was scheduled for ${calendarDate(person.follow_up_date)}.`,
      action: "Capture the outcome after reaching out.",
    });
  } else if (person.follow_up_date) {
    recommendations.push({
      title: "Prepare the next touch",
      detail: `A follow-up is scheduled for ${calendarDate(person.follow_up_date)}.`,
      action: person.quick_memories || "Review recent context before reaching out.",
    });
  }
  if ((person.warmth || 0) < 50 && (person.relationship_strength || 0) >= 60) {
    recommendations.push({
      title: "Rebuild warmth",
      detail: "Relationship strength is high, but current warmth is lower.",
      action: "Use a specific shared memory instead of a generic check-in.",
    });
  }
  if (!asList(person.methods).length) {
    recommendations.push({
      title: "Add a contact route",
      detail: "No email or phone number is attached to this canonical profile.",
      action: "Sync a contact source or add the detail to Nett metadata.",
    });
  }
  if (!person.location || !person.industry || !person.how_met) {
    const gaps = [
      !person.location && "location",
      !person.industry && "industry",
      !person.how_met && "how you met",
    ].filter(Boolean);
    recommendations.push({
      title: "Close a knowledge gap",
      detail: `Missing ${gaps.join(", ")}.`,
      action: "Inspect source evidence or run evidence suggestions.",
    });
  }
  if (!recommendations.length) {
    recommendations.push({
      title: "Context is in good shape",
      detail: "No urgent follow-up or common profile gap is visible.",
      action: "Add the next meaningful exchange when it happens.",
    });
  }
  return recommendations.slice(0, 3);
}

type TimelineItem =
  | { kind: "memory"; date: string; record: MemoryRecord }
  | { kind: "interaction"; date: string; record: Interaction }
  | { kind: "communication"; date: string; record: Communication };

function InlineMemory({
  person,
  onSaved,
  notify,
}: {
  person: FullPerson;
  onSaved: () => void;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      const parsed = await api.parseMemory(text);
      await api.saveMemory(person.id, parsed.extracted.memory, parsed.extracted);
      setText("");
      onSaved();
      notify("success", "Memory parsed and saved");
    } catch (error) {
      notify(
        "error",
        error instanceof Error ? error.message : "The memory could not be saved",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="inline-memory">
      <label className="sr-only" htmlFor="profile-memory">
        Add a memory about {person.name}
      </label>
      <textarea
        id="profile-memory"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={`Add context, a follow-up, or something to remember about ${person.first_name || person.name}`}
      />
      <button onClick={() => void save()} disabled={!text.trim() || saving}>
        {saving ? (
          <SpinnerGap className="spin" size={17} />
        ) : (
          <PaperPlaneTilt size={17} />
        )}
        Save
      </button>
    </div>
  );
}

export function ProfilePage({
  onChanged,
  notify,
}: {
  onChanged: () => void;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [person, setPerson] = useState<FullPerson | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [signals, setSignals] = useState<Awaited<ReturnType<typeof api.relationshipSignals>> | null>(null);
  const [communications, setCommunications] = useState<Communication[]>([]);
  const [communicationCursor, setCommunicationCursor] = useState<string | null>(null);
  const [loadingCommunications, setLoadingCommunications] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    api
      .person(id)
      .then(setPerson)
      .catch((error) =>
        setLoadError(
          error instanceof Error ? error.message : "Profile could not be loaded",
        ),
      );
  }, [id]);

  useEffect(() => load(), [load]);
  useEffect(() => {
    api.relationshipSignals(id).then(setSignals).catch(() => setSignals(null));
  }, [id]);
  useEffect(() => {
    setLoadingCommunications(true);
    api.communications(id, 50)
      .then((page) => {
        setCommunications(page.items);
        setCommunicationCursor(page.nextCursor);
      })
      .catch(() => {
        setCommunications([]);
        setCommunicationCursor(null);
      })
      .finally(() => setLoadingCommunications(false));
  }, [id]);

  const loadOlderCommunications = async () => {
    if (!communicationCursor) return;
    setLoadingCommunications(true);
    try {
      const page = await api.communications(id, 50, communicationCursor);
      setCommunications((current) => [...current, ...page.items]);
      setCommunicationCursor(page.nextCursor);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Older messages could not be loaded");
    } finally {
      setLoadingCommunications(false);
    }
  };

  const timeline = useMemo<TimelineItem[]>(() => {
    if (!person) return [];
    return [
      ...asList(person.memories).map(
        (record): TimelineItem => ({
          kind: "memory",
          date: record.occurred_at,
          record,
        }),
      ),
      ...asList(person.interactions)
        .filter((record) => !["messages", "gmail", "telegram", "whatsapp"].includes(record.source_connector))
        .map(
        (record): TimelineItem => ({
          kind: "interaction",
          date: record.occurred_at,
          record,
        }),
      ),
      ...communications.map(
        (record): TimelineItem => ({
          kind: "communication",
          date: record.occurred_at,
          record,
        }),
      ),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [communications, person]);

  if (loadError) {
    return (
      <div className="state-page" role="alert">
        <WarningCircle size={30} />
        <h1>Profile unavailable</h1>
        <p>{loadError}</p>
        <button className="primary-button" onClick={load}>
          Try again
        </button>
      </div>
    );
  }
  if (!person) return <AppSkeleton />;

  const startEdit = () => {
    setForm({
      name: person.name,
      headline: person.headline || "",
      job_title: person.job_title || "",
      linkedin_url: person.linkedin_url || "",
      company: person.company || "",
      location: person.location || "",
      industry: person.industry || "",
      relationship: person.relationship || "",
      relationship_strength: person.relationship_strength || 0,
      warmth: person.warmth || 0,
      intro_potential: person.intro_potential || 0,
      follow_up_date: person.follow_up_date || "",
      notes: person.notes || "",
      interests: asList(person.interests).join(", "),
      skills: asList(person.skills).join(", "),
      institutions: asList(person.institutions).join(", "),
    });
    setEdit(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const normalized = {
        ...form,
        interests: String(form.interests || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        skills: String(form.skills || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        institutions: String(form.institutions || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      };
      setPerson(await api.updatePerson(id, normalized));
      setEdit(false);
      onChanged();
      notify("success", "Profile updated with Nett provenance");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  const separateIdentity = async (identityId: string) => {
    try {
      await api.unmerge(identityId);
      load();
      onChanged();
      notify("success", "Source identity separated into a new canonical person");
    } catch (error) {
      notify(
        "error",
        error instanceof Error ? error.message : "The source could not be separated",
      );
    }
  };

  const recommendations = buildRecommendations(person);

  return (
    <div className="profile-page">
      <button className="back-link" onClick={() => navigate("/people")}>
        <ArrowRight size={15} />
        Back to people
      </button>
      <section className="profile-hero">
        <div className="profile-identity">
          <Avatar person={person} size="xl" />
          <div>
            <div className="source-stack">
              {asList(person.sources).map((source) => (
                <SourceBadge key={source} source={source} />
              ))}
            </div>
            <h1>{person.name}</h1>
            <p>
              {[person.company, person.industry].filter(Boolean).join(" / ") ||
                "Professional context not recorded"}
            </p>
            <span>
              <MapPin size={15} />
              {person.location || "Location not recorded"}
            </span>
          </div>
        </div>
        <div className="profile-actions">
          <button className="secondary-button" onClick={startEdit}>
            <NotePencil size={17} />
            Edit fields
          </button>
          <button
            className="primary-button"
            onClick={() => document.getElementById("profile-memory")?.focus()}
          >
            <Plus size={17} />
            Add memory
          </button>
        </div>
      </section>

      <div className="profile-signal-line">
        <div>
          <span>Relationship strength</span>
          <strong>{person.relationship_strength || 0}</strong>
        </div>
        <div>
          <span>Warmth</span>
          <strong>{person.warmth || 0}</strong>
        </div>
        <div>
          <span>Introduction potential</span>
          <strong>{person.intro_potential || 0}</strong>
        </div>
        <div>
          <span>Source confidence</span>
          <strong>{Math.round((person.source_confidence || 0) * 100)}%</strong>
        </div>
      </div>

      <div className="profile-layout">
        <div className="profile-main">
          <section className="profile-section">
            <div className="section-heading">
              <div>
                <h2>Quick capture</h2>
                <p>Write naturally. Nett structures the memory before saving.</p>
              </div>
            </div>
            <InlineMemory person={person} onSaved={load} notify={notify} />
          </section>

          <section className="profile-section">
            <div className="section-heading">
              <div>
                <h2>Chronological record</h2>
                <p>Memories, messages, and interactions in one evidence stream.</p>
              </div>
            </div>
            {timeline.length ? (
              <div className="unified-timeline">
                {timeline.map((item) => {
                  const isMemory = item.kind === "memory";
                  const isCommunication = item.kind === "communication";
                  const key = `${item.kind}:${item.record.id}`;
                  const source = isMemory
                    ? item.record.source
                    : isCommunication
                      ? item.record.connector_id
                      : item.record.source_connector;
                  const text = isMemory
                    ? item.record.raw_text
                    : isCommunication
                      ? item.record.body || `${item.record.kind} communication`
                      : item.record.summary || `${item.record.kind} interaction`;
                  const tags =
                    isMemory && Array.isArray(item.record.structured?.tags)
                      ? (item.record.structured.tags as string[])
                      : [];
                  return (
                    <article key={key}>
                      <span className="timeline-kind" aria-hidden="true">
                        {isMemory ? <Quotes size={15} /> : <Clock size={15} />}
                      </span>
                      <time>{calendarDate(item.date)}</time>
                      <div>
                        <p>{text}</p>
                        <div className="timeline-meta">
                          <SourceBadge source={source} />
                          <small>{isMemory ? "Memory" : item.record.kind}</small>
                          {isCommunication && item.record.thread_title && (
                            <small>{item.record.thread_title}</small>
                          )}
                        </div>
                        {tags.length > 0 && (
                          <div className="tag-field">
                            {tags.map((tag) => (
                              <span key={tag}>
                                <Tag size={12} />
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
                {communicationCursor && (
                  <button
                    className="secondary-button timeline-more"
                    onClick={() => void loadOlderCommunications()}
                    disabled={loadingCommunications}
                  >
                    {loadingCommunications ? <SpinnerGap className="spin" /> : <Plus />}
                    Load older communications
                  </button>
                )}
              </div>
            ) : (
              <div className="section-empty">
                <Quotes size={22} />
                <p>
                  No memories or permissioned interactions are attached to this profile.
                </p>
              </div>
            )}
          </section>

          <section className="profile-section">
            <div className="section-heading">
              <div>
                <h2>Source-attributed facts</h2>
                <p>Each field remains linked to the connector that supplied it.</p>
              </div>
            </div>
            {asList(person.provenance).length ? (
              <div className="fact-evidence-grid">
                {asList(person.provenance).map((fact) => (
                  <article key={fact.id}>
                    <span>
                      <strong>{fact.field_name.replace(/_/g, " ")}</strong>
                      <small>{calendarDate(fact.observed_at)}</small>
                    </span>
                    <p>{fact.field_value || "Empty value"}</p>
                    <SourceBadge source={fact.connector_id} />
                  </article>
                ))}
              </div>
            ) : (
              <div className="section-empty">
                <CheckCircle size={22} />
                <p>No field-level provenance has been recorded for this profile.</p>
              </div>
            )}
          </section>
        </div>

        <aside className="profile-aside">
          <section className="contact-card">
            <h2>Contact methods</h2>
            {asList(person.methods).length ? (
              <div className="contact-methods">
                {asList(person.methods).map((method, index) => (
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
            ) : (
              <p className="aside-empty">No contact method is linked.</p>
            )}
          </section>

          <section className="relationship-pulse-card">
            <h2>Relationship pulse</h2>
            <p className="recommendation-note">
              Explainable signals derived from local communication timing and direction.
            </p>
            <dl>
              <div><dt>Recency</dt><dd>{signals?.recency ?? 0}</dd></div>
              <div><dt>Cadence drift</dt><dd>{signals?.cadenceDrift ?? 0}</dd></div>
              <div><dt>Reciprocity</dt><dd>{signals?.reciprocity ?? 0}</dd></div>
              <div><dt>Channel diversity</dt><dd>{signals?.channelDiversity ?? 0}</dd></div>
            </dl>
          </section>

          <section className="recommendation-card">
            <h2>Recommended next steps</h2>
            <p className="recommendation-note">
              Suggestions use only recorded dates, strength, warmth, and profile gaps.
            </p>
            <div className="recommendation-list">
              {recommendations.map((item) => (
                <article key={item.title}>
                  <CalendarBlank size={16} />
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                    <small>{item.action}</small>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section>
            <h2>Relationship context</h2>
            <dl>
              <div>
                <dt>Relationship</dt>
                <dd>{person.relationship || "Not classified"}</dd>
              </div>
              <div>
                <dt>Met</dt>
                <dd>
                  {[person.when_met, person.where_met].filter(Boolean).join(" / ") ||
                    "Not recorded"}
                </dd>
              </div>
              <div>
                <dt>How</dt>
                <dd>{person.how_met || "Not recorded"}</dd>
              </div>
              <div>
                <dt>Hometown</dt>
                <dd>{person.hometown || "Not recorded"}</dd>
              </div>
            </dl>
          </section>

          <section>
            <h2>Knowledge surface</h2>
            {[
              ["Interests", asList(person.interests)],
              ["Skills", asList(person.skills)],
              ["Institutions", asList(person.institutions)],
              ["Mutuals", asList(person.mutuals)],
            ].map(([label, values]) => (
              <div className="fact-group" key={label as string}>
                <small>{label as string}</small>
                <p>{(values as string[]).join(", ") || "None recorded"}</p>
              </div>
            ))}
          </section>

          <section>
            <h2>Linked identities</h2>
            {asList(person.identities).length ? (
              <div className="identity-links">
                {asList(person.identities).map((identity) => (
                  <div key={identity.id}>
                    <span>
                      <SourceBadge source={identity.connector_id} />
                      <small>
                        {identity.linked_by} / {Math.round(identity.confidence * 100)}%
                      </small>
                    </span>
                    <button onClick={() => void separateIdentity(identity.id)}>
                      Separate
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="aside-empty">No linked source identities.</p>
            )}
          </section>
        </aside>
      </div>

      <AnimatePresence>
        {edit && (
          <EditProfileDialog
            person={person}
            form={form}
            setForm={setForm}
            saving={saving}
            onSave={() => void save()}
            onClose={() => setEdit(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
