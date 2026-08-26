import { ArrowRight } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject } from "react";
import { Link } from "react-router-dom";
import { EvidenceFolder, usePacketLift } from "@/components/EvidencePacket";
import { asList, Avatar, calendarDate, friendlyDate } from "@/components/Primitives";
import { GlowCard } from "@/components/ui/spotlight-card";
import { peekFacts, sourceLabels } from "@/lib/packet-summary";
import type { Person } from "@/types";

function personContext(person: Person) {
  const parts: string[] = [];
  const push = (value?: string | null) => {
    const text = (value || "").trim();
    if (text && !parts.includes(text)) parts.push(text);
  };
  const relationship = (person.relationship || "").trim();
  push(relationship ? relationship.charAt(0).toUpperCase() + relationship.slice(1) : "");
  push([person.job_title, person.company].filter(Boolean).join(" · ") || person.headline);
  push(person.location || asList(person.hometown)[0]);
  return parts.slice(0, 2).join(" · ");
}

function PeekFact({ label, value, detail }: { label: string; value: string; detail: string }) {
  const tipId = useId();
  return (
    <div className="person-peek-fact">
      <dt>{label}</dt>
      <dd>
        <button type="button" aria-describedby={tipId}>
          {value}
        </button>
        <span className="person-peek-tip" role="tooltip" id={tipId}>
          {detail}
        </span>
      </dd>
    </div>
  );
}

function PersonPeek({
  person,
  onKeyDown,
  folderRef,
}: {
  person: Person;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  folderRef: MutableRefObject<HTMLAnchorElement | null>;
}) {
  const lift = usePacketLift();
  const sources = sourceLabels(person.sources);
  const facts = peekFacts(person);
  const context = personContext(person);

  return (
    <div className="person-peek">
      <header className="person-glow-head">
        <Avatar person={person} size="md" />
        <div>
          <strong>{person.name}</strong>
          {context ? <small>{context}</small> : null}
        </div>
      </header>
      <dl className="person-peek-facts">
        {facts.length ? (
          facts.map((fact) => (
            <PeekFact key={fact.label} label={fact.label} value={fact.value} detail={fact.detail} />
          ))
        ) : (
          <p className="person-peek-empty">No metadata recorded yet.</p>
        )}
      </dl>
      <Link
        ref={folderRef}
        to={`/people/${person.id}`}
        className="person-peek-folder"
        aria-label={`Open full profile for ${person.name}`}
        onKeyDown={onKeyDown}
        onMouseEnter={lift.onMouseEnter}
        onMouseLeave={lift.onMouseLeave}
        onFocus={lift.onFocus}
        onBlur={lift.onBlur}
      >
        <span className="person-peek-folder-mark">
          <EvidenceFolder sources={sources} lifted={lift.lifted} scale={0.24} compact />
        </span>
        <span className="person-peek-folder-copy">
          Full record
          <small>Open profile</small>
        </span>
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </div>
  );
}

function PersonCard({
  person,
  index,
  active,
  peeking,
  term,
  onPeek,
  onActiveIndex,
  onRowKeyDown,
  rowRefs,
}: {
  person: Person;
  index: number;
  active: boolean;
  peeking: boolean;
  term: string;
  onPeek: (id: string | null) => void;
  onActiveIndex: (index: number) => void;
  onRowKeyDown: (event: ReactKeyboardEvent<HTMLElement>, index: number) => void;
  rowRefs: MutableRefObject<Array<HTMLElement | null>>;
}) {
  const folderRef = useRef<HTMLAnchorElement | null>(null);
  const context = personContext(person);
  const tags = asList(person.tags).slice(0, 3);

  useEffect(() => {
    if (!peeking) return;
    folderRef.current?.focus();
    rowRefs.current[index]?.scrollIntoView({ block: "nearest" });
  }, [peeking, index, rowRefs]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && peeking) {
      event.preventDefault();
      event.stopPropagation();
      onPeek(null);
      rowRefs.current[index]?.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      onPeek(null);
    }
    onRowKeyDown(event, index);
  };

  return (
    <GlowCard
      ref={(element) => {
        rowRefs.current[index] = element;
      }}
      className={`person-glow-card${active ? " is-active" : ""}${peeking ? " is-peeking" : ""}`}
      glowColor="blue"
      customSize
      role={peeking ? "group" : "button"}
      aria-label={peeking ? undefined : `Look at ${person.name}`}
      aria-expanded={peeking}
      tabIndex={peeking ? -1 : active ? 0 : -1}
      onClick={peeking ? undefined : () => onPeek(person.id)}
      onKeyDown={handleKeyDown}
    >
      <div className="person-glow-inner" onFocus={() => onActiveIndex(index)}>
        {peeking ? (
          <PersonPeek person={person} onKeyDown={handleKeyDown} folderRef={folderRef} />
        ) : (
          <>
            <header className="person-glow-head">
              <Avatar person={person} size="md" />
              <div>
                <strong>
                  <Highlight text={person.name} term={term} />
                </strong>
                {context ? (
                  <small>
                    <Highlight text={context} term={term} />
                  </small>
                ) : null}
              </div>
            </header>
            <p className="person-glow-memory">
              {person.quick_memories?.trim() || person.notes?.trim() || "No memory recorded yet."}
            </p>
            <footer className="person-glow-foot">
              <div className="person-glow-tags">
                {tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <span className="person-glow-when">
                {person.last_contact ? (
                  <time dateTime={person.last_contact}>
                    {calendarDate(person.last_contact)}
                    <small>{friendlyDate(person.last_contact)}</small>
                  </time>
                ) : (
                  <small>No contact recorded</small>
                )}
                <ArrowRight size={15} aria-hidden="true" />
              </span>
            </footer>
          </>
        )}
      </div>
    </GlowCard>
  );
}

export function PeopleCards({
  people,
  activeIndex,
  onActiveIndex,
  rowRefs,
  onRowKeyDown,
  term,
}: {
  people: Person[];
  activeIndex: number;
  onActiveIndex: (index: number) => void;
  rowRefs: MutableRefObject<Array<HTMLElement | null>>;
  onRowKeyDown: (event: ReactKeyboardEvent<HTMLElement>, index: number) => void;
  term: string;
}) {
  const [peekId, setPeekId] = useState<string | null>(null);
  const gridRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!peekId) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && gridRef.current?.contains(target)) {
        const card = (event.target as HTMLElement | null)?.closest(".person-glow-card");
        if (card?.classList.contains("is-peeking")) return;
      }
      setPeekId(null);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [peekId]);

  useEffect(() => {
    if (peekId && !people.some((person) => person.id === peekId)) setPeekId(null);
  }, [people, peekId]);

  return (
    <ul className="people-cards" ref={gridRef}>
      {people.map((person, index) => (
        <li key={person.id} className={person.id === peekId ? "is-peeking" : undefined}>
          <PersonCard
            person={person}
            index={index}
            active={index === activeIndex}
            peeking={person.id === peekId}
            term={term}
            onPeek={setPeekId}
            onActiveIndex={onActiveIndex}
            onRowKeyDown={onRowKeyDown}
            rowRefs={rowRefs}
          />
        </li>
      ))}
    </ul>
  );
}

function Highlight({ text, term }: { text: string; term: string }) {
  if (!text) return null;
  if (term.length < 2) return <>{text}</>;
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + term.length)}</mark>
      {text.slice(index + term.length)}
    </>
  );
}
