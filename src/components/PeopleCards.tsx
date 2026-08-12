import { ArrowRight } from "@phosphor-icons/react";
import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from "react";
import { asList, Avatar, calendarDate, friendlyDate } from "@/components/Primitives";
import { GlowCard } from "@/components/ui/spotlight-card";
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

export function PeopleCards({
  people,
  onOpen,
  activeIndex,
  onActiveIndex,
  rowRefs,
  onRowKeyDown,
  term,
}: {
  people: Person[];
  onOpen: (id: string) => void;
  activeIndex: number;
  onActiveIndex: (index: number) => void;
  rowRefs: MutableRefObject<Array<HTMLElement | null>>;
  onRowKeyDown: (event: ReactKeyboardEvent<HTMLElement>, index: number) => void;
  term: string;
}) {
  return (
    <ul className="people-cards">
      {people.map((person, index) => {
        const context = personContext(person);
        const tags = asList(person.tags).slice(0, 3);
        return (
          <li key={person.id}>
            <GlowCard
              ref={(element) => {
                rowRefs.current[index] = element;
              }}
              className={`person-glow-card${index === activeIndex ? " is-active" : ""}`}
              glowColor="blue"
              customSize
              aria-label={`Open ${person.name}`}
              tabIndex={index === activeIndex ? 0 : -1}
              onClick={() => onOpen(person.id)}
              onKeyDown={(event) => onRowKeyDown(event, index)}
            >
              <div className="person-glow-inner" onFocus={() => onActiveIndex(index)}>
                <header className="person-glow-head">
                  <Avatar person={person} size="md" />
                  <div>
                    <strong>
                      <Highlight text={person.name} term={term} />
                    </strong>
                    {context && (
                      <small>
                        <Highlight text={context} term={term} />
                      </small>
                    )}
                  </div>
                </header>
                <p className="person-glow-memory">
                  {person.quick_memories?.trim() ||
                    person.notes?.trim() ||
                    "No memory recorded yet."}
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
              </div>
            </GlowCard>
          </li>
        );
      })}
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
