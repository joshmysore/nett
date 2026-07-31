import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  At,
  Buildings,
  Clock,
  FloppyDisk,
  MapPin,
  NotePencil,
  Phone,
  Plus,
  Quotes,
  Sparkle,
  SpinnerGap,
  Tag,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  asList,
  Avatar,
  friendlyDate,
  IconButton,
  SourceBadge,
  sourceLabel,
  type ToastKind,
} from "@/components/Primitives";
import { api } from "@/lib/api";
import type { FullPerson } from "@/types";

export function PersonDrawer({
  id,
  onClose,
  onChanged,
  notify,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const [person, setPerson] = useState<FullPerson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  const reduced = useReducedMotion();

  useEffect(() => {
    setPerson(null);
    setError(null);
    api
      .person(id)
      .then(setPerson)
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "Profile unavailable"),
      );
  }, [id]);

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const drawer = drawerRef.current;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeHandler.current();
        return;
      }
      if (event.key !== "Tab" || !drawer) return;
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    drawer?.addEventListener("keydown", keydown);
    return () => {
      drawer?.removeEventListener("keydown", keydown);
      returnTo?.focus();
    };
  }, []);

  return (
    <motion.div
      className="drawer-layer"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.aside
        ref={drawerRef}
        className="person-drawer"
        initial={reduced ? false : { x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={
          reduced ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 34 }
        }
        role="dialog"
        aria-modal="true"
        aria-label="Person quick view"
      >
        <div className="drawer-top">
          <span>Quick profile</span>
          <IconButton label="Close" onClick={onClose} buttonRef={closeRef}>
            <X size={18} />
          </IconButton>
        </div>
        {!person ? (
          error ? (
            <div className="drawer-state" role="alert">
              <WarningCircle size={25} />
              <p>{error}</p>
            </div>
          ) : (
            <DrawerSkeleton />
          )
        ) : (
          <PersonQuickView
            person={person}
            onFull={() => {
              onClose();
              navigate(`/people/${person.id}`);
            }}
            onChanged={async () => {
              setPerson(await api.person(id));
              onChanged();
            }}
            notify={notify}
          />
        )}
      </motion.aside>
    </motion.div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="drawer-skeleton" aria-busy="true">
      <div className="sk-avatar shimmer" />
      <div className="sk-line wide shimmer" />
      <div className="sk-line shimmer" />
      <div className="sk-block shimmer" />
    </div>
  );
}

function PersonQuickView({
  person,
  onFull,
  onChanged,
  notify,
}: {
  person: FullPerson;
  onFull: () => void;
  onChanged: () => void | Promise<void>;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const [memory, setMemory] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [quickForm, setQuickForm] = useState({
    headline: person.headline || "",
    job_title: person.job_title || "",
    company: person.company || "",
    location: person.location || "",
    follow_up_date: person.follow_up_date || "",
  });
  const [stagedSuggestionIds, setStagedSuggestionIds] = useState<string[]>([]);
  useEffect(() => {
    setQuickForm({
      headline: person.headline || "",
      job_title: person.job_title || "",
      company: person.company || "",
      location: person.location || "",
      follow_up_date: person.follow_up_date || "",
    });
  }, [person.company, person.follow_up_date, person.headline, person.job_title, person.location]);
  const save = async () => {
    if (!memory.trim()) return;
    setSaving(true);
    try {
      await api.saveMemory(person.id, memory, {});
      setMemory("");
      onChanged();
      notify("success", "Memory saved");
    } catch (error) {
      notify(
        "error",
        error instanceof Error ? error.message : "The memory could not be saved",
      );
    } finally {
      setSaving(false);
    }
  };
  const saveQuickEdit = async () => {
    setSaving(true);
    try {
      await api.updatePerson(person.id, quickForm);
      await Promise.all(stagedSuggestionIds.map((id) => api.reviewSuggestion(id, "accepted").catch(() => undefined)));
      setStagedSuggestionIds([]);
      setEditing(false);
      await onChanged();
      notify("success", "Essential metadata updated");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Metadata could not be updated");
    } finally {
      setSaving(false);
    }
  };
  const suggestGaps = async () => {
    setSuggesting(true);
    try {
      const { suggestions } = await api.autofill(person.id);
      const supported = new Set(Object.keys(quickForm));
      const usable = suggestions.filter((suggestion) =>
        supported.has(suggestion.field)
        && suggestion.confidence >= 0.65
        && !String(quickForm[suggestion.field as keyof typeof quickForm] || "").trim()
      );
      setQuickForm((current) => ({
        ...current,
        ...Object.fromEntries(usable.map((suggestion) => [suggestion.field, String(suggestion.value ?? "")])),
      }));
      setStagedSuggestionIds(usable.flatMap((suggestion) => suggestion.id ? [suggestion.id] : []));
      notify(
        "success",
        usable.length ? `${usable.length} evidence-backed gap${usable.length === 1 ? "" : "s"} staged` : "No supported gaps found"
      );
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Could not inspect profile evidence");
    } finally {
      setSuggesting(false);
    }
  };
  const recentEvidence = [
    ...asList(person.memories).map((record) => ({
      id: `memory:${record.id}`,
      date: record.occurred_at,
      text: record.raw_text,
      source: record.source,
    })),
    ...asList(person.interactions).map((record) => ({
      id: `interaction:${record.id}`,
      date: record.occurred_at,
      text: record.summary || `${record.kind} interaction`,
      source: record.source_connector,
    })),
  ]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 5);

  return (
    <div className="quick-profile">
      <section className="quick-identity">
        <Avatar person={person} size="xl" />
        <div className="quick-name">
          <h1>{person.name}</h1>
          <p>
            {[person.company, person.industry].filter(Boolean).join(" / ") ||
              "Professional context not recorded"}
          </p>
          <div className="source-stack">
            {asList(person.sources).map((source) => (
              <SourceBadge key={source} source={source} />
            ))}
          </div>
        </div>
      </section>
      <div className="quick-signals">
        <div>
          <span>Strength</span>
          <strong>{person.relationship_strength || 0}</strong>
        </div>
        <div>
          <span>Warmth</span>
          <strong>{person.warmth || 0}</strong>
        </div>
        <div>
          <span>Intro</span>
          <strong>{person.intro_potential || 0}</strong>
        </div>
      </div>
      <section className="quick-facts">
        <div>
          <MapPin size={16} />
          <span>
            <small>Based in</small>
            <strong>{person.location || "Not recorded"}</strong>
          </span>
        </div>
        <div>
          <Clock size={16} />
          <span>
            <small>Last contact</small>
            <strong>{friendlyDate(person.last_contact)}</strong>
          </span>
        </div>
        <div>
          <Buildings size={16} />
          <span>
            <small>Institutions</small>
            <strong>{asList(person.institutions).join(", ") || "Not recorded"}</strong>
          </span>
        </div>
      </section>
      <section className="drawer-quick-edit">
        <div>
          <span>
            <strong>Essential metadata</strong>
            <small>Edit in place or stage evidence-backed gaps.</small>
          </span>
          <button onClick={() => setEditing((current) => !current)}>
            <NotePencil size={15} /> {editing ? "Close" : "Quick edit"}
          </button>
        </div>
        {editing && (
          <div className="drawer-edit-fields">
            {[
              ["headline", "Headline"],
              ["job_title", "Job title"],
              ["company", "Company"],
              ["location", "Location"],
              ["follow_up_date", "Follow-up"],
            ].map(([key, label]) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  type={key === "follow_up_date" ? "date" : "text"}
                  value={quickForm[key as keyof typeof quickForm]}
                  onChange={(event) => setQuickForm({ ...quickForm, [key]: event.target.value })}
                />
              </label>
            ))}
            <div className="drawer-edit-actions">
              <button onClick={() => void suggestGaps()} disabled={suggesting || saving}>
                {suggesting ? <SpinnerGap className="spin" /> : <Sparkle />}
                Autofill gaps
              </button>
              <button onClick={() => void saveQuickEdit()} disabled={saving}>
                {saving ? <SpinnerGap className="spin" /> : <FloppyDisk />}
                Save
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="drawer-contact-methods" aria-label="Contact methods">
        {asList(person.methods).length ? (
          asList(person.methods).map((method, index) => (
            <a
              href={`${method.kind === "email" ? "mailto" : "tel"}:${method.value}`}
              key={`${method.kind}:${method.value}:${index}`}
            >
              {method.kind === "email" ? <At size={15} /> : <Phone size={15} />}
              <span>{method.value}</span>
              <small>{method.label || (method.is_primary ? "Primary" : method.kind)}</small>
            </a>
          ))
        ) : (
          <p>No contact methods are linked to this profile.</p>
        )}
      </section>

      <section className="memory-highlight">
        <Quotes size={20} />
        <p>
          {person.quick_memories ||
            person.memories?.[0]?.raw_text ||
            "No relationship context captured yet."}
        </p>
      </section>
      <section className="tag-field">
        {asList(person.tags).map((tag) => (
          <span key={tag}>
            <Tag size={12} />
            {tag}
          </span>
        ))}
      </section>
      <section className="quick-capture">
        <label htmlFor="drawer-memory">Add a memory</label>
        <div>
          <textarea
            id="drawer-memory"
            value={memory}
            onChange={(event) => setMemory(event.target.value)}
            placeholder={`Remember something about ${person.first_name || person.name}`}
          />
          <button
            onClick={() => void save()}
            disabled={saving || !memory.trim()}
            aria-label="Save memory"
          >
            {saving ? <SpinnerGap className="spin" /> : <Plus />}
          </button>
        </div>
      </section>
      <section className="mini-timeline">
        <div className="section-heading compact">
          <div>
            <h2>Recent evidence</h2>
            <p>{recentEvidence.length} latest items</p>
          </div>
        </div>
        {recentEvidence.map((item) => (
          <div className="timeline-item" key={item.id}>
            <i />
            <span>
              <p>{item.text}</p>
              <small>
                {friendlyDate(item.date)} / {sourceLabel(item.source)}
              </small>
            </span>
          </div>
        ))}
        {!recentEvidence.length && (
          <p className="aside-empty">No memories or interactions are linked.</p>
        )}
      </section>
      <button className="full-profile-button" onClick={onFull}>
        Open full profile <ArrowRight size={16} />
      </button>
    </div>
  );
}
