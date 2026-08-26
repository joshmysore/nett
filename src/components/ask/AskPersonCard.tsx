import { ArrowSquareOut } from "@phosphor-icons/react";
import { Avatar } from "@/components/Primitives";
import { cleanExcerpt, sourceLabel, type PersonHit } from "@/lib/ask-display";

export function AskPersonCard({
  person,
  index,
  onOpen,
}: {
  person: PersonHit;
  index: number;
  onOpen: (id: string) => void;
}) {
  const quote = person.excerpts[0] ? cleanExcerpt(person.excerpts[0].value) : "";
  const sources = person.sources.map(sourceLabel).filter(Boolean);
  return (
    <li>
      <div className="ask-person">
        <button type="button" className="ask-person-main" onClick={() => onOpen(person.personId)}>
          <span className="ask-cite" aria-hidden="true">{index + 1}</span>
          <Avatar person={{ id: person.personId, name: person.name }} size="sm" />
          <span>
            <strong>{person.name}</strong>
            {quote ? <small>“{quote.slice(0, 160)}”</small> : (
              <small>{sources.join(" · ") || "Stored record"}</small>
            )}
          </span>
        </button>
        <div className="ask-person-actions">
          {sources.length > 0 && <span>{sources.join(" · ")}</span>}
          <button type="button" className="text-button" onClick={() => onOpen(person.personId)}>
            View
          </button>
          <button type="button" className="text-button" onClick={() => onOpen(person.personId)}>
            Open evidence
            <ArrowSquareOut size={12} aria-hidden="true" />
          </button>
        </div>
      </div>
    </li>
  );
}
