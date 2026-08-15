import { AnimatePresence } from "motion/react";
import {
  ArrowRight,
  Clock,
  NotePencil,
  Plus,
  Quotes,
  SlidersHorizontal,
  SpinnerGap,
  Tag,
  WarningCircle,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { EditProfileDialog } from "@/components/EditProfileDialog";
import { HometownDisplay } from "@/components/PlacePicker";
import {
  ContactMethods,
  EvidenceCheck,
  InlineFacts,
  NextActionBlock,
  PersonCapture,
  RecordedBriefBlock,
  RelationshipInsights,
} from "@/components/PersonWorkspace";
import {
  AppSkeleton,
  asList,
  Avatar,
  calendarDate,
  SourceBadge,
  sourceLabel,
  type ToastKind,
} from "@/components/Primitives";
import { api, isAbortError } from "@/lib/api";
import { displayBirthday } from "@/lib/birthday";
import {
  defensibleNextAction,
  orderedMemories,
  provenanceIndex,
  recordedBrief,
  SENSITIVE_FIELDS,
} from "@/lib/person-brief";
import { hometownEntries } from "@/lib/place";
import type { Communication, FullPerson, Interaction, MemoryRecord } from "@/types";
import "@/styles/person.css";

type Signals = Awaited<ReturnType<typeof api.relationshipSignals>>;

type TimelineItem =
  | { kind: "memory"; date: string; record: MemoryRecord }
  | { kind: "interaction"; date: string; record: Interaction }
  | { kind: "communication"; date: string; record: Communication }
  | { kind: "provenance"; date: string; record: FullPerson["provenance"][number] };

const MESSAGE_CONNECTORS = ["messages", "gmail", "telegram", "whatsapp"];

/** The signals endpoint returns 0-100 numbers alongside the counts they were
 *  derived from. Only the counts are shown: an unexplained score is an invented
 *  metric, and design.md bans those. */
function signalFacts(signals: Signals | null) {
  if (!signals) return [];
  const explanation = (signals.explanation || {}) as Record<string, unknown>;
  const number = (key: string) =>
    typeof explanation[key] === "number" ? (explanation[key] as number) : null;
  const channels = Array.isArray(explanation.channels) ? (explanation.channels as string[]) : [];
  const interactions = number("interactions");
  // With nothing stored, the endpoint still returns placeholder distances.
  // Reporting those as facts would be inventing a number.
  if (!interactions) return [];
  const rows = [{ label: "Recorded exchanges", value: interactions.toLocaleString() }];
  const incoming = number("incoming");
  const outgoing = number("outgoing");
  if (incoming !== null && outgoing !== null) {
    rows.push({ label: "Received / sent", value: `${incoming.toLocaleString()} / ${outgoing.toLocaleString()}` });
  }
  const days = number("daysSinceContact");
  if (days !== null) rows.push({ label: "Days since contact", value: String(days) });
  const cadence = number("typicalCadenceDays");
  if (cadence !== null && cadence > 0) rows.push({ label: "Typical gap", value: `${cadence} days` });
  if (channels.length) {
    rows.push({ label: "Channels", value: channels.map(sourceLabel).join(", ") });
  }
  return rows;
}

export function ProfilePage({
  onChanged,
  notify,
}: {
  onChanged: () => void;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [person, setPerson] = useState<FullPerson | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [signals, setSignals] = useState<Signals | null>(null);
  const [communications, setCommunications] = useState<Communication[]>([]);
  const [communicationCursor, setCommunicationCursor] = useState<string | null>(null);
  const [loadingCommunications, setLoadingCommunications] = useState(false);
  const captureRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(
    (signal?: AbortSignal) => {
      setLoadError(null);
      return api
        .person(id, signal)
        .then(setPerson)
        .catch((error) => {
          if (isAbortError(error)) return;
          setLoadError(error instanceof Error ? error.message : "Profile could not be loaded");
        });
    },
    [id],
  );

  // Identity is fast and everything else is not, so the three requests start
  // together and each renders as it lands. Nothing waits for the slowest.
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    return () => abort.abort();
  }, [load]);

  useEffect(() => {
    const abort = new AbortController();
    setSignals(null);
    api
      .relationshipSignals(id, abort.signal)
      .then(setSignals)
      .catch((error) => {
        if (!isAbortError(error)) setSignals(null);
      });
    return () => abort.abort();
  }, [id]);

  useEffect(() => {
    const abort = new AbortController();
    setCommunications([]);
    setCommunicationCursor(null);
    setLoadingCommunications(true);
    api
      .communications(id, 50, undefined, abort.signal)
      .then((page) => {
        setCommunications(page.items);
        setCommunicationCursor(page.nextCursor);
      })
      .catch((error) => {
        if (!isAbortError(error)) setCommunications([]);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoadingCommunications(false);
      });
    return () => abort.abort();
  }, [id]);

  const loadOlderCommunications = async () => {
    if (!communicationCursor) return;
    setLoadingCommunications(true);
    try {
      const page = await api.communications(id, 50, communicationCursor);
      setCommunications((current) => [...current, ...page.items]);
      setCommunicationCursor(page.nextCursor);
    } catch (error) {
      notify(
        "error",
        error instanceof Error ? error.message : "Older messages could not be loaded",
      );
    } finally {
      setLoadingCommunications(false);
    }
  };

  const timeline = useMemo<TimelineItem[]>(() => {
    if (!person) return [];
    return [
      ...orderedMemories(person).map(
        (record): TimelineItem => ({ kind: "memory", date: record.occurred_at, record }),
      ),
      ...asList(person.interactions)
        .filter((record) => !MESSAGE_CONNECTORS.includes(record.source_connector))
        .map((record): TimelineItem => ({ kind: "interaction", date: record.occurred_at, record })),
      ...communications.map(
        (record): TimelineItem => ({ kind: "communication", date: record.occurred_at, record }),
      ),
      ...asList(person.provenance).map(
        (record): TimelineItem => ({ kind: "provenance", date: record.observed_at, record }),
      ),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [communications, person]);

  useEffect(() => {
    if (location.hash !== "#recent" || !timeline.length) return;
    document.getElementById("held-thread")?.scrollIntoView({ block: "start" });
  }, [location.hash, timeline.length]);

  const brief = useMemo(() => (person ? recordedBrief(person) : null), [person]);
  const nextAction = useMemo(() => (person ? defensibleNextAction(person) : null), [person]);
  const provenance = useMemo(
    () =>
      person
        ? [...provenanceIndex(person).values()].sort((a, b) =>
            a.field_name.localeCompare(b.field_name),
          )
        : [],
    [person],
  );
  const facts = useMemo(() => signalFacts(signals), [signals]);

  const accept = useCallback(
    (updated: FullPerson) => {
      setPerson(updated);
      onChanged();
    },
    [onChanged],
  );

  const patch = useCallback(
    async (values: Record<string, string>) => {
      accept(await api.updatePerson(id, values));
      notify("success", "Saved with Nett provenance");
    },
    [accept, id, notify],
  );

  if (loadError) {
    return (
      <div className="state-page" role="alert">
        <WarningCircle size={30} />
        <h1>Profile unavailable</h1>
        <p>{loadError}</p>
        <button className="primary-button" onClick={() => void load()}>
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
      hometown: asList(person.hometown),
      industry: person.industry || "",
      spike: person.spike || "",
      gender: person.gender || "",
      culture: person.culture || "",
      personality: person.personality || "",
      relationship: person.relationship || "",
      when_met: person.when_met || "",
      where_met: person.where_met || "",
      how_met: person.how_met || "",
      birthday: person.birthday || "",
      last_contact: person.last_contact || "",
      relationship_strength: person.relationship_strength || 0,
      warmth: person.warmth || 0,
      intro_potential: person.intro_potential || 0,
      follow_up_date: person.follow_up_date || "",
      notes: person.notes || "",
      languages: asList(person.languages),
      interests: asList(person.interests),
      foods: asList(person.foods),
      skills: asList(person.skills),
      online_personality: asList(person.online_personality),
      institutions: asList(person.institutions),
      mutuals: asList(person.mutuals),
      tags: asList(person.tags),
    });
    setEdit(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const list = (value: unknown) =>
        Array.isArray(value)
          ? value.map((entry) => String(entry).trim()).filter(Boolean)
          : String(value || "")
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean);
      const hometown = list(form.hometown);
      accept(
        await api.updatePerson(id, {
          ...form,
          hometown,
          languages: list(form.languages),
          interests: list(form.interests),
          foods: list(form.foods),
          skills: list(form.skills),
          online_personality: list(form.online_personality),
          institutions: list(form.institutions),
          mutuals: list(form.mutuals),
          tags: list(form.tags),
        }),
      );
      setEdit(false);
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
      await load();
      onChanged();
      notify("success", "Source identity separated into a new canonical person");
    } catch (error) {
      notify(
        "error",
        error instanceof Error ? error.message : "The source could not be separated",
      );
    }
  };

  const alias =
    person.nickname && person.nickname !== person.name
      ? person.nickname
      : person.preferred_name && person.preferred_name !== person.name
        ? person.preferred_name
        : "";
  const role = [person.job_title, person.company].filter(Boolean).join(" · ");
  const detail = (
    [
      ["Spike", person.spike ? [person.spike] : []],
      ["Institutions", asList(person.institutions)],
      ["Interests", asList(person.interests)],
      ["Foods", asList(person.foods)],
      ["Skills", asList(person.skills)],
      ["Mutual connections", asList(person.mutuals)],
      ["Gender", person.gender ? [person.gender] : []],
      ["Culture", person.culture ? [person.culture] : []],
      ["Personality", person.personality ? [person.personality] : []],
      ["Online personality", asList(person.online_personality)],
      ["Birthday", person.birthday ? [displayBirthday(person.birthday)] : []],
      ["When met", person.when_met ? [person.when_met] : []],
      ["Where met", person.where_met ? [person.where_met] : []],
      ["How met", person.how_met ? [person.how_met] : []],
      [
        "Relationship strength",
        person.relationship_strength ? [String(person.relationship_strength)] : [],
      ],
      ["Headline", person.headline ? [person.headline] : []],
    ] as [string, string[]][]
  ).filter(([, values]) => values.length);

  return (
    <div className="profile-page person-workspace">
      <button className="back-link" onClick={() => navigate("/people")}>
        <ArrowRight size={15} aria-hidden="true" />
        Back to people
      </button>

      <section className="profile-hero">
        <div className="profile-identity">
          <Avatar person={person} size="xl" />
          <div className="person-names">
            <h1>{person.name}</h1>
            {alias && <p className="person-alias">Known as {alias}</p>}
            {role && <p className="person-role">{role}</p>}
            <div className="person-sources">
              {asList(person.sources).map((source) => (
                <SourceBadge key={source} source={source} />
              ))}
            </div>
          </div>
        </div>
        <div className="profile-actions">
          <button className="secondary-button" onClick={startEdit}>
            <SlidersHorizontal size={17} aria-hidden="true" />
            Edit profile
          </button>
          <button className="primary-button" onClick={() => captureRef.current?.focus()}>
            <NotePencil size={17} aria-hidden="true" />
            Record a memory
          </button>
        </div>
      </section>

      {brief && <RecordedBriefBlock brief={brief} />}
      {nextAction && (
        <NextActionBlock action={nextAction} onCapture={() => captureRef.current?.focus()} />
      )}

      <div className="profile-layout">
        <div className="profile-main">
          <InlineFacts person={person} onPatch={patch} notify={notify} />

          <details className="person-more">
            <summary>More about {person.first_name || person.name}</summary>
            <div className="person-more-body">
              {hometownEntries(person.hometown).length > 0 && (
                <div className="fact-group">
                  <small>Hometown</small>
                  <HometownDisplay value={person.hometown} />
                </div>
              )}
              {detail.length ? (
                detail.map(([label, values]) => (
                  <div className="fact-group" key={label}>
                    <small>{label}</small>
                    <p>{values.join(", ")}</p>
                  </div>
                ))
              ) : hometownEntries(person.hometown).length === 0 ? (
                <p className="person-capture-note">
                  Nothing beyond the fields above has been recorded. Use Edit profile for the
                  full set — hometown, spike, languages, skills, interests, gender, culture,
                  personality, how you met, and the rest — or Fill gaps on People to work
                  through one category across many people.
                </p>
              ) : null}
              <section className="person-more-block">
                <h3>Check stored evidence for gaps</h3>
                <EvidenceCheck person={person} onPatched={accept} notify={notify} />
                <RelationshipInsights person={person} onPatched={accept} notify={notify} />
              </section>
            </div>
          </details>

          <section className="profile-section" style={{ marginTop: "var(--space-lg)" }}>
            <PersonCapture
              id="profile-memory"
              person={person}
              onSaved={accept}
              notify={notify}
              inputRef={captureRef}
            />
          </section>

          <section className="profile-section" id="held-thread">
            <div className="section-heading">
              <div>
                <h2>Held thread</h2>
                <p>Memories, messages, and field evidence on one rail.</p>
              </div>
            </div>
            {timeline.length ? (
              <div className="unified-timeline">
                {timeline.map((item) => {
                  const isMemory = item.kind === "memory";
                  const isCommunication = item.kind === "communication";
                  const isProvenance = item.kind === "provenance";
                  const key = `${item.kind}:${item.record.id}`;
                  const source = isMemory
                    ? item.record.source
                    : isCommunication
                      ? item.record.connector_id
                      : isProvenance
                        ? item.record.connector_id
                        : item.record.source_connector;
                  const body = isMemory
                    ? item.record.raw_text
                    : isCommunication
                      ? item.record.body || `${item.record.kind} communication`
                      : isProvenance
                        ? `${item.record.field_name.replace(/_/g, " ")}: ${item.record.field_value || "Cleared"}`
                        : item.record.summary || `${item.record.kind} interaction`;
                  const kindLabel = isMemory
                    ? "Memory"
                    : isProvenance
                      ? "Field evidence"
                      : item.record.kind;
                  const tags =
                    isMemory && Array.isArray(item.record.structured?.tags)
                      ? (item.record.structured.tags as string[])
                      : [];
                  return (
                    <article key={key}>
                      <span className="timeline-kind" aria-hidden="true">
                        {isMemory ? <Quotes size={15} /> : <Clock size={15} />}
                      </span>
                      <time dateTime={item.date}>{calendarDate(item.date)}</time>
                      <div>
                        <p>{body}</p>
                        <div className="timeline-meta">
                          <SourceBadge source={source} />
                          <small>{kindLabel}</small>
                          {isCommunication && item.record.thread_title && (
                            <small>{item.record.thread_title}</small>
                          )}
                        </div>
                        {tags.length > 0 && (
                          <div className="tag-field">
                            {tags.map((tag) => (
                              <span key={tag}>
                                <Tag size={12} aria-hidden="true" />
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
            ) : loadingCommunications ? (
              <p className="person-capture-note" role="status">
                Reading the message record.
              </p>
            ) : (
              <div className="section-empty">
                <Quotes size={22} aria-hidden="true" />
                <p>No memory or permissioned interaction is attached to this profile yet.</p>
              </div>
            )}
          </section>
        </div>

        <aside className="person-rail" aria-label="Supporting detail">
          <section className="person-block">
            <h2>Contact</h2>
            <ContactMethods person={person} />
          </section>

          {facts.length > 0 && (
            <section className="person-block">
              <h2>Evidence</h2>
              <dl className="signal-facts">
                {facts.map((fact) => (
                  <div key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="signal-note">Counted from locally stored messages only.</p>
            </section>
          )}

          <section className="person-block">
            <h2>Field sources</h2>
            {provenance.length ? (
              <details className="person-more is-flush">
                <summary>
                  Where {provenance.length} field{provenance.length === 1 ? "" : "s"} came from
                </summary>
                <div className="person-more-body provenance-list">
                  {provenance.map((fact) => (
                    <div key={fact.id}>
                      <SourceBadge source={fact.connector_id} />
                      <span>
                        <strong>{fact.field_name.replace(/_/g, " ")}</strong>
                        <small title={fact.field_value}>{fact.field_value || "Cleared"}</small>
                        <small>{calendarDate(fact.observed_at)}</small>
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            ) : (
              <p className="drawer-empty">No field-level provenance is recorded.</p>
            )}
          </section>

          {asList(person.identities).length > 0 && (
            <section className="person-block">
              <h2>Linked identities</h2>
              {asList(person.identities).map((identity) => (
                <div className="identity-row" key={identity.id}>
                  <span>
                    <SourceBadge source={identity.connector_id} />
                    <small>
                      {identity.linked_by} / {Math.round(identity.confidence * 100)}%
                    </small>
                  </span>
                  <button onClick={() => void separateIdentity(identity.id)}>Separate</button>
                </div>
              ))}
            </section>
          )}
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
            hiddenFields={SENSITIVE_FIELDS}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
