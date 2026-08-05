import { differenceInCalendarDays, isValid, parseISO } from "date-fns";
import { asList, calendarDate, sourceLabel } from "@/components/Primitives";
import type { FullPerson, Provenance } from "@/types";

import { NEVER_INFER_FIELDS } from "@/lib/person-fields";

/**
 * Fields that must never be proposed from evidence or a model.
 * The user may still type gender / culture / personality themselves —
 * those are editable, just never inferred.
 */
export const SENSITIVE_FIELDS = NEVER_INFER_FIELDS;

export type EditableField = {
  key: "relationship" | "job_title" | "company" | "location" | "follow_up_date";
  label: string;
  type: "text" | "date";
  hint: string;
};

export const EDITABLE_FIELDS: EditableField[] = [
  { key: "relationship", label: "Relationship", type: "text", hint: "friend, colleague, sister" },
  { key: "job_title", label: "Role", type: "text", hint: "job title" },
  { key: "company", label: "Company", type: "text", hint: "organisation" },
  { key: "location", label: "Location", type: "text", hint: "country → state → city" },
  { key: "follow_up_date", label: "Follow-up", type: "date", hint: "date" },
];

const text = (value: unknown) => String(value ?? "").trim();

export function provenanceIndex(person: FullPerson): Map<string, Provenance> {
  const index = new Map<string, Provenance>();
  asList(person.provenance).forEach((entry) => {
    if (SENSITIVE_FIELDS.has(entry.field_name)) return;
    const existing = index.get(entry.field_name);
    if (!existing || String(entry.observed_at) > String(existing.observed_at)) {
      index.set(entry.field_name, entry);
    }
  });
  return index;
}

export function orderedMemories(person: FullPerson) {
  return [...asList(person.memories)].sort((a, b) =>
    String(b.occurred_at).localeCompare(String(a.occurred_at)),
  );
}

export type RecordedBrief = {
  text: string;
  kind: string;
  source: string;
  occurredAt?: string;
};

/** Why this person matters — verbatim from recorded evidence only. */
export function recordedBrief(person: FullPerson): RecordedBrief | null {
  const summary = text(person.quick_memories);
  if (summary) return { text: summary, kind: "Recorded summary", source: "nett" };
  const memory = orderedMemories(person)[0];
  if (memory && text(memory.raw_text)) {
    return {
      text: text(memory.raw_text),
      kind: "Memory",
      source: memory.source,
      occurredAt: memory.occurred_at,
    };
  }
  const note = text(person.notes);
  if (note) return { text: note, kind: "Note", source: "nett" };
  return null;
}

export type NextAction = {
  tone: "due" | "neutral";
  headline: string;
  detail: string;
};

/** One next step derived only from stored values. */
export function defensibleNextAction(person: FullPerson): NextAction | null {
  const today = new Date();
  const followUp = parseISO(text(person.follow_up_date));
  if (text(person.follow_up_date) && isValid(followUp)) {
    const overdue = differenceInCalendarDays(today, followUp);
    const scheduled = `Scheduled for ${calendarDate(person.follow_up_date)}.`;
    if (overdue > 0) {
      return {
        tone: "due",
        headline: `Follow-up was due ${overdue} day${overdue === 1 ? "" : "s"} ago`,
        detail: scheduled,
      };
    }
    if (overdue === 0) return { tone: "due", headline: "Follow-up is due today", detail: scheduled };
    if (overdue >= -30) {
      return {
        tone: "neutral",
        headline: `Follow-up in ${-overdue} day${overdue === -1 ? "" : "s"}`,
        detail: scheduled,
      };
    }
  }

  const memories = orderedMemories(person);
  const lastContact = parseISO(text(person.last_contact));
  if (text(person.last_contact) && isValid(lastContact)) {
    const days = differenceInCalendarDays(today, lastContact);
    if (days >= 120) {
      return {
        tone: "neutral",
        headline: `No recorded contact for ${Math.floor(days / 30)} months`,
        detail: `The last exchange Nett stores is ${calendarDate(person.last_contact)}.`,
      };
    }
  }

  if (text(person.when_met) && !memories.length) {
    const where = text(person.where_met);
    return {
      tone: "neutral",
      headline: "No context recorded since you met",
      detail: `You met ${text(person.when_met)}${where ? ` in ${where}` : ""}. Nothing has been recorded since.`,
    };
  }

  if (!memories.length && !text(person.quick_memories) && !text(person.notes)) {
    const sources = asList(person.sources);
    return {
      tone: "neutral",
      headline: "Nothing is recorded about why this person matters",
      detail: sources.length
        ? `${sources.map(sourceLabel).join(", ")} supplied the identity. No note or memory is stored.`
        : "No note or memory is stored.",
    };
  }

  return null;
}
