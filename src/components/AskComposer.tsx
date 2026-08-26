import { PaperPlaneTilt, Stop, X } from "@phosphor-icons/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Avatar } from "@/components/Primitives";
import {
  abilityById,
  composerPlaceholder,
  detectComposerTrigger,
  filterAbilities,
  replaceTriggerRange,
  type AskAbility,
  type AskAbilityId,
  type ComposerTrigger,
} from "@/lib/ask-composer";
import { api, isAbortError } from "@/lib/api";
import type { Person } from "@/types";

export type AskPersonRef = {
  id: string;
  name: string;
  company?: string;
  location?: string;
};

export type AskComposerValue = {
  text: string;
  people: AskPersonRef[];
  abilities: AskAbilityId[];
};

function personHint(person: Pick<Person, "company" | "location" | "job_title"> | AskPersonRef) {
  return [person.company, person.location].filter(Boolean).join(" · ");
}

export function AskComposer({
  value,
  loading,
  describedBy,
  onChange,
  onSubmit,
  onStop,
}: {
  value: AskComposerValue;
  loading: boolean;
  describedBy?: string;
  onChange: (next: AskComposerValue) => void;
  onSubmit: () => void;
  onStop: () => void;
}) {
  const listId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchId = useRef(0);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [peopleHits, setPeopleHits] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const trigger = detectComposerTrigger(value.text, caret);

  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    setCaret(document.activeElement === field ? field.selectionStart ?? value.text.length : value.text.length);
  }, [value.text]);

  useEffect(() => {
    if (trigger?.kind !== "mention") {
      setPeopleHits([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const id = ++searchId.current;
    const timeout = window.setTimeout(() => {
      setSearching(true);
      api
        .search(trigger.query, controller.signal)
        .then((people) => {
          if (id !== searchId.current) return;
          const taken = new Set(value.people.map((person) => person.id));
          setPeopleHits(people.filter((person) => !taken.has(person.id)).slice(0, 8));
        })
        .catch((reason) => {
          if (isAbortError(reason) || id !== searchId.current) return;
          setPeopleHits([]);
        })
        .finally(() => {
          if (id === searchId.current) setSearching(false);
        });
    }, 90);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [trigger?.kind, trigger?.query, value.people]);

  const abilities = trigger?.kind === "ability" ? filterAbilities(trigger.query) : [];
  const open = Boolean(trigger && (trigger.kind === "ability" ? abilities.length : true));
  const optionCount = trigger?.kind === "ability" ? abilities.length : peopleHits.length;

  useEffect(() => {
    setActive(0);
  }, [trigger?.kind, trigger?.query, optionCount]);

  useEffect(() => {
    itemRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const setText = (text: string, nextCaret?: number) => {
    onChange({ ...value, text });
    if (nextCaret == null) return;
    requestAnimationFrame(() => {
      const field = fieldRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(nextCaret, nextCaret);
      setCaret(nextCaret);
    });
  };

  const applyTrigger = (next: AskComposerValue, insert: string, current: ComposerTrigger) => {
    const text = replaceTriggerRange(value.text, current, insert);
    onChange({ ...next, text });
    const caretAt = current.start + insert.length;
    requestAnimationFrame(() => {
      const field = fieldRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(caretAt, caretAt);
      setCaret(caretAt);
    });
  };

  const pickPerson = (person: Person) => {
    if (!trigger || value.people.some((item) => item.id === person.id)) return;
    applyTrigger({
      ...value,
      people: [...value.people, {
        id: person.id,
        name: person.name,
        company: person.company,
        location: person.location,
      }],
    }, "", trigger);
  };

  const pickAbility = (ability: AskAbility) => {
    if (!trigger) return;
    const abilitiesNext = value.abilities.includes(ability.id)
      ? value.abilities
      : [...value.abilities, ability.id];
    applyTrigger({ ...value, abilities: abilitiesNext }, "", trigger);
  };

  const removePerson = (id: string) => {
    onChange({ ...value, people: value.people.filter((person) => person.id !== id) });
    fieldRef.current?.focus();
  };

  const removeAbility = (id: AskAbilityId) => {
    const prompt = abilityById(id).prompt.trim();
    const text = value.text.trim() === prompt || value.text === abilityById(id).prompt
      ? ""
      : value.text;
    onChange({
      ...value,
      text,
      abilities: value.abilities.filter((item) => item !== id),
    });
    fieldRef.current?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (open && optionCount) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((index) => Math.min(index + 1, optionCount - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setActive(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setActive(optionCount - 1);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        if (trigger?.kind === "mention" && peopleHits[active]) pickPerson(peopleHits[active]);
        if (trigger?.kind === "ability" && abilities[active]) pickAbility(abilities[active]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setText(replaceTriggerRange(value.text, trigger!), trigger!.start);
        return;
      }
    }
    if (event.key === "Backspace" && caret === 0 && !value.text) {
      if (value.abilities.length) {
        event.preventDefault();
        removeAbility(value.abilities[value.abilities.length - 1]);
        return;
      }
      if (value.people.length) {
        event.preventDefault();
        removePerson(value.people[value.people.length - 1].id);
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  const canSend = Boolean(value.text.trim() || value.people.length);
  const activeId = open && optionCount ? `${listId}-${active}` : undefined;

  return (
    <form
      className="ask-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="ask-composer">
      {(value.people.length > 0 || value.abilities.length > 0) && (
        <ul className="ask-chips" aria-label="Attached to this question">
          {value.people.map((person) => (
            <li key={person.id}>
              <span className="ask-chip">
                <Avatar person={person} size="sm" />
                <span>{person.name}</span>
                <button type="button" onClick={() => removePerson(person.id)} aria-label={`Remove ${person.name}`}>
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
          {value.abilities.map((id) => {
            const ability = abilityById(id);
            return (
              <li key={id}>
                <span className="ask-chip ask-chip-ability">
                  <span className="ask-chip-slash" aria-hidden="true">/</span>
                  <span>{ability.label}</span>
                  <button type="button" onClick={() => removeAbility(id)} aria-label={`Remove ${ability.label}`}>
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <label className="sr-only" htmlFor="ask-nett-query">
        Ask a question about your records
      </label>
      <textarea
        id="ask-nett-query"
        ref={fieldRef}
        value={value.text}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-describedby={describedBy}
        placeholder={composerPlaceholder(value.people, value.abilities)}
        onChange={(event) => {
          const next = event.target.value;
          onChange({ ...value, text: next });
          setCaret(event.target.selectionStart ?? next.length);
        }}
        onClick={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyUp={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
      />

      <p className="ask-composer-hint">
        <span><kbd>@</kbd> person</span>
        <span><kbd>/</kbd> ability</span>
      </p>

      {loading ? (
        <button type="button" className="ask-send" onClick={onStop} aria-label="Stop asking">
          <Stop size={16} aria-hidden="true" />
        </button>
      ) : (
        <button className="ask-send" disabled={!canSend}>
          <PaperPlaneTilt size={16} aria-hidden="true" />
          <span className="sr-only">Ask</span>
        </button>
      )}
      </div>

      {open && (
        <div className="ask-suggest" id={listId} role="listbox" aria-label={trigger?.kind === "mention" ? "People" : "Abilities"}>
          {trigger?.kind === "mention" && searching && !peopleHits.length && (
            <p className="ask-suggest-empty" role="status">Looking up people…</p>
          )}
          {trigger?.kind === "mention" && !searching && !peopleHits.length && (
            <p className="ask-suggest-empty" role="status">
              {trigger.query ? `No one matches “${trigger.query}”.` : "Type a name to attach someone."}
            </p>
          )}
          {trigger?.kind === "mention" && peopleHits.map((person, index) => (
            <button
              key={person.id}
              id={`${listId}-${index}`}
              ref={(node) => { itemRefs.current[index] = node; }}
              type="button"
              role="option"
              aria-selected={index === active}
              className={index === active ? "is-active" : undefined}
              onMouseEnter={() => setActive(index)}
              onClick={() => pickPerson(person)}
            >
              <Avatar person={person} size="sm" />
              <span>
                <strong>{person.name}</strong>
                <small>{personHint(person) || "Stored person"}</small>
              </span>
            </button>
          ))}
          {trigger?.kind === "ability" && abilities.map((ability, index) => (
            <button
              key={ability.id}
              id={`${listId}-${index}`}
              ref={(node) => { itemRefs.current[index] = node; }}
              type="button"
              role="option"
              aria-selected={index === active}
              className={index === active ? "is-active" : undefined}
              onMouseEnter={() => setActive(index)}
              onClick={() => pickAbility(ability)}
            >
              <span className="ask-suggest-mark" aria-hidden="true">/</span>
              <span>
                <strong>{ability.label}</strong>
                <small>{ability.hint}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
