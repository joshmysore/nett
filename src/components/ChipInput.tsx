import { X } from "@phosphor-icons/react";
import {
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

function normalizeToken(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function splitTokens(raw: string) {
  return raw
    .split(/[,;\n]+/)
    .map(normalizeToken)
    .filter(Boolean);
}

function dedupe(values: string[]) {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(value);
  }
  return next;
}

/**
 * Multi-value editor: chips + a small typeahead input.
 * Enter, comma, or paste creates chips. Backspace removes the last chip.
 */
export function ChipInput({
  values,
  onChange,
  placeholder = "Type and press Enter",
  label,
  suggestions = [],
  disabled = false,
  id,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  label?: string;
  suggestions?: string[];
  disabled?: boolean;
  id?: string;
}) {
  const autoId = useId();
  const inputId = id || autoId;
  const listId = `${inputId}-suggestions`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const parts = splitTokens(raw);
    if (!parts.length) return;
    onChange(dedupe([...values, ...parts]));
    setDraft("");
  };

  const removeAt = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
    inputRef.current?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === "Backspace" && !draft && values.length) {
      event.preventDefault();
      removeAt(values.length - 1);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text");
    if (!text || (!text.includes(",") && !text.includes("\n") && !text.includes(";"))) {
      return;
    }
    event.preventDefault();
    commit(`${draft} ${text}`);
  };

  const filteredSuggestions = suggestions
    .filter((entry) => {
      const needle = draft.trim().toLowerCase();
      if (!needle) return false;
      if (values.some((value) => value.toLowerCase() === entry.toLowerCase())) return false;
      return entry.toLowerCase().includes(needle);
    })
    .slice(0, 6);

  return (
    <div className="chip-input">
      {label && (
        <label className="chip-input-label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <div
        className={`chip-input-shell${disabled ? " is-disabled" : ""}`}
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((value, index) => (
          <span className="chip" key={`${value}-${index}`}>
            <span>{value}</span>
            <button
              type="button"
              className="chip-remove"
              disabled={disabled}
              aria-label={`Remove ${value}`}
              onClick={(event) => {
                event.stopPropagation();
                removeAt(index);
              }}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          ref={inputRef}
          value={draft}
          disabled={disabled}
          placeholder={values.length ? "" : placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => {
            if (draft.trim()) commit(draft);
          }}
          list={filteredSuggestions.length ? listId : undefined}
          autoComplete="off"
        />
      </div>
      {filteredSuggestions.length > 0 && (
        <datalist id={listId}>
          {filteredSuggestions.map((entry) => (
            <option value={entry} key={entry} />
          ))}
        </datalist>
      )}
      <p className="chip-input-hint">Enter or comma to add. Backspace removes the last.</p>
    </div>
  );
}

export function asChipValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return dedupe(value.map((entry) => normalizeToken(String(entry))).filter(Boolean));
  }
  if (value == null || value === "") return [];
  return dedupe(splitTokens(String(value)));
}
