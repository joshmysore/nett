import { useEffect, useRef, useState } from "react";
import { api, isAbortError } from "@/lib/api";
import type { Person } from "@/types";

type ColumnKey =
  | "name"
  | "company"
  | "job_title"
  | "location"
  | "hometown"
  | "relationship"
  | "follow_up_date"
  | "notes";

const COLUMNS: { key: ColumnKey; label: string; wide?: boolean }[] = [
  { key: "name", label: "Name", wide: true },
  { key: "company", label: "Company" },
  { key: "job_title", label: "Role" },
  { key: "location", label: "Location" },
  { key: "hometown", label: "Hometown" },
  { key: "relationship", label: "Relationship" },
  { key: "follow_up_date", label: "Follow-up" },
  { key: "notes", label: "Notes", wide: true },
];

function cellText(person: Person, key: ColumnKey): string {
  if (key === "hometown") return (person.hometown || []).join(", ");
  const value = person[key];
  return value == null ? "" : String(value);
}

export function PeopleSheet({
  people,
  onPatched,
}: {
  people: Person[];
  onPatched: (person: Person) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<Map<string, number>>(new Map());
  const controllers = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    for (const controller of controllers.current.values()) controller.abort();
  }, []);

  const draftKey = (personId: string, key: ColumnKey) => `${personId}:${key}`;

  const scheduleSave = (person: Person, key: ColumnKey, raw: string) => {
    const id = draftKey(person.id, key);
    setDrafts((current) => ({ ...current, [id]: raw }));
    const existingTimer = timers.current.get(id);
    if (existingTimer) window.clearTimeout(existingTimer);
    timers.current.set(
      id,
      window.setTimeout(() => {
        void persist(person, key, raw);
      }, 320),
    );
  };

  const persist = async (person: Person, key: ColumnKey, raw: string) => {
    const id = draftKey(person.id, key);
    const previous = cellText(person, key);
    const next = raw.trim();
    if (previous === next) {
      setDrafts((current) => {
        const copy = { ...current };
        delete copy[id];
        return copy;
      });
      return;
    }
    controllers.current.get(id)?.abort();
    const controller = new AbortController();
    controllers.current.set(id, controller);
    setSaving(id);
    setError(null);
    try {
      const patch =
        key === "hometown"
          ? { hometown: next ? next.split(",").map((part) => part.trim()).filter(Boolean) : [] }
          : { [key]: next || null };
      const updated = await api.updatePerson(person.id, patch, controller.signal);
      onPatched(updated);
      setDrafts((current) => {
        const copy = { ...current };
        delete copy[id];
        return copy;
      });
    } catch (reason) {
      if (isAbortError(reason)) return;
      setError(reason instanceof Error ? reason.message : "Could not save cell");
    } finally {
      setSaving((current) => (current === id ? null : current));
      controllers.current.delete(id);
    }
  };

  return (
    <div className="people-sheet" role="region" aria-label="Spreadsheet people view">
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="people-sheet-scroll">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th key={column.key} className={column.wide ? "is-wide" : undefined}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.id}>
                {COLUMNS.map((column) => {
                  const id = draftKey(person.id, column.key);
                  const value = drafts[id] ?? cellText(person, column.key);
                  return (
                    <td key={column.key} className={column.wide ? "is-wide" : undefined}>
                      <input
                        value={value}
                        aria-label={`${person.name} ${column.label}`}
                        aria-busy={saving === id}
                        onChange={(event) => scheduleSave(person, column.key, event.target.value)}
                        onBlur={(event) => {
                          const timer = timers.current.get(id);
                          if (timer) window.clearTimeout(timer);
                          void persist(person, column.key, event.target.value);
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
