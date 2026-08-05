import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  NotePencil,
  SpinnerGap,
  Tag,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  asList,
  Avatar,
  friendlyDate,
  IconButton,
  SourceBadge,
  sourceLabel,
  type ToastKind,
} from "@/components/Primitives";
import { api, isAbortError } from "@/lib/api";
import {
  defensibleNextAction,
  orderedMemories,
  recordedBrief,
} from "@/lib/person-brief";
import type { FullPerson } from "@/types";
import "@/styles/person.css";

// Re-export shared workspace pieces for any legacy import sites.
export {
  ContactMethods,
  EvidenceCheck,
  InlineFacts,
  NextActionBlock,
  PersonCapture,
  RecordedBriefBlock,
  RelationshipInsights,
} from "@/components/PersonWorkspace";
export {
  SENSITIVE_FIELDS,
  EDITABLE_FIELDS,
  defensibleNextAction,
  orderedMemories,
  provenanceIndex,
  recordedBrief,
} from "@/lib/person-brief";
export type { EditableField, NextAction, RecordedBrief } from "@/lib/person-brief";

/* ------------------------------------------------------------------ *
 * Drawer
 * ------------------------------------------------------------------ */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function focusableWithin(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.hasAttribute("hidden") && element.offsetParent !== null,
  );
}

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
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  const reduced = useReducedMotion();
  const titleId = useId();

  useEffect(() => {
    const abort = new AbortController();
    setPerson(null);
    setError(null);
    api
      .person(id, abort.signal)
      .then(setPerson)
      .catch((reason) => {
        if (isAbortError(reason)) return;
        setError(reason instanceof Error ? reason.message : "Profile unavailable");
      });
    return () => abort.abort();
  }, [id]);

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    const drawer = drawerRef.current;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeHandler.current();
        return;
      }
      if (event.key !== "Tab" || !drawer) return;
      const focusable = focusableWithin(drawer);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !drawer.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (drawer && !drawer.contains(event.target as Node)) closeRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
      returnTo?.focus();
    };
  }, []);

  return (
    <motion.div
      className="drawer-layer"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.16 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.aside
        ref={drawerRef}
        className="person-drawer"
        // A short, small slide. Content is in the DOM and legible on the first
        // painted frame; motion never gates access.
        initial={reduced ? false : { x: 18, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 18, opacity: 0 }}
        transition={{ duration: reduced ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={person ? titleId : undefined}
        aria-label={person ? undefined : "Person quick view"}
      >
        <div className="drawer-top">
          <span>Quick profile</span>
          <IconButton label="Close quick profile" onClick={onClose} buttonRef={closeRef}>
            <X size={18} />
          </IconButton>
        </div>
        {person ? (
          <DrawerContent
            person={person}
            titleId={titleId}
            onClose={onClose}
            onChanged={onChanged}
            setPerson={setPerson}
            notify={notify}
          />
        ) : error ? (
          <div className="drawer-state" role="alert">
            <WarningCircle size={25} />
            <p>{error}</p>
          </div>
        ) : (
          <DrawerSkeleton />
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

function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="drawer-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function DrawerContent({
  person,
  titleId,
  onClose,
  onChanged,
  setPerson,
  notify,
}: {
  person: FullPerson;
  titleId: string;
  onClose: () => void;
  onChanged: () => void;
  setPerson: (person: FullPerson) => void;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const navigate = useNavigate();
  const captureRef = useRef<HTMLTextAreaElement>(null);
  const captureId = useId();
  const brief = useMemo(() => recordedBrief(person), [person]);
  const action = useMemo(() => defensibleNextAction(person), [person]);
  const tags = asList(person.tags);

  const accept = useCallback(
    (updated: FullPerson) => {
      setPerson(updated);
      onChanged();
    },
    [onChanged, setPerson],
  );

  const patch = useCallback(
    async (values: Record<string, string>) => {
      accept(await api.updatePerson(person.id, values));
      notify("success", "Saved with Nett provenance");
    },
    [accept, notify, person.id],
  );

  const evidence = useMemo(
    () =>
      [
        ...orderedMemories(person).map((record) => ({
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
        .slice(0, 4),
    [person],
  );

  const alias =
    person.nickname && person.nickname !== person.name
      ? person.nickname
      : person.preferred_name && person.preferred_name !== person.name
        ? person.preferred_name
        : "";
  const role = [person.job_title, person.company].filter(Boolean).join(" · ");

  return (
    <div className="drawer-body">
      <div className="drawer-identity">
        <Avatar person={person} size="lg" />
        <div className="person-names">
          <h2 id={titleId} data-drawer-name>
            {person.name}
          </h2>
          {alias && <p className="person-alias">Known as {alias}</p>}
          {role && <p className="person-role">{role}</p>}
          <div className="person-sources">
            {asList(person.sources).map((source) => (
              <SourceBadge key={source} source={source} />
            ))}
          </div>
        </div>
      </div>

      {brief && <RecordedBriefBlock brief={brief} />}
      {action && (
        <NextActionBlock action={action} onCapture={() => captureRef.current?.focus()} />
      )}

      <InlineFacts person={person} onPatch={patch} notify={notify} />

      <DrawerSection title="Contact">
        <ContactMethods person={person} />
      </DrawerSection>

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

      <PersonCapture
        id={captureId}
        person={person}
        onSaved={accept}
        notify={notify}
        inputRef={captureRef}
      />

      <DrawerSection title="Recent evidence">
        {evidence.length ? (
          <div className="drawer-evidence">
            {evidence.map((item) => (
              <div key={item.id}>
                <p>{item.text}</p>
                <small>
                  {friendlyDate(item.date)} · {sourceLabel(item.source)}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <p className="drawer-empty">No memory or interaction is linked yet.</p>
        )}
      </DrawerSection>

      <details className="person-more">
        <summary>Check stored evidence for gaps</summary>
        <div className="person-more-body">
          <EvidenceCheck person={person} onPatched={accept} notify={notify} />
          <RelationshipInsights person={person} onPatched={accept} notify={notify} />
        </div>
      </details>

      <div className="drawer-foot">
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            onClose();
            navigate(`/people/${person.id}`);
          }}
        >
          Open full profile
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
