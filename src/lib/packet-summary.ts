/** Fields the packet caption may cite. Absence stays absence. */
export type PacketFields = {
  relationship?: string;
  job_title?: string;
  company?: string;
  headline?: string;
  location?: string;
  hometown?: string[];
  quick_memories?: string;
  notes?: string;
  sources: string[];
};

export const SOURCE_LABEL: Record<string, string> = {
  "apple-contacts": "Contacts",
  messages: "Messages",
  whatsapp: "WhatsApp",
  gmail: "Gmail",
  telegram: "Telegram",
  "linkedin-public": "LinkedIn",
  csv: "Import",
  manual: "Written",
  nett: "Nett",
};

export function sourceLabels(sources: string[]) {
  return [...new Set(sources)]
    .filter((source) => source && source !== "nett")
    .map((source) => SOURCE_LABEL[source] || source)
    .slice(0, 3);
}

export type PeekFact = { label: string; value: string; detail: string };

function capitalise(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** Compact facts for the card peek. Empty fields stay off the surface. */
export function peekFacts(person: PacketFields & {
  last_contact?: string;
  languages?: string[];
  methods?: { kind: string; value: string }[];
}): PeekFact[] {
  const facts: PeekFact[] = [];
  const relationship = (person.relationship || "").trim();
  if (relationship) {
    facts.push({
      label: "Relationship",
      value: capitalise(relationship),
      detail: "Why they matter — stored on this person.",
    });
  }
  const role = [person.job_title, person.company].filter(Boolean).join(" at ") || (person.headline || "").trim();
  if (role) {
    facts.push({
      label: "Role",
      value: role,
      detail: [person.job_title, person.company, person.headline].filter(Boolean).join(" · "),
    });
  }
  const hometown = Array.isArray(person.hometown) ? person.hometown.filter(Boolean) : [];
  const place = (person.location || hometown[0] || "").trim();
  if (place) {
    facts.push({
      label: "Place",
      value: place,
      detail: hometown.length ? hometown.join(" · ") : place,
    });
  }
  const memory = (person.quick_memories || person.notes || "").trim().replace(/\s+/g, " ");
  if (memory) {
    facts.push({
      label: "Memory",
      value: memory.length > 88 ? `${memory.slice(0, 85).trimEnd()}…` : memory,
      detail: memory,
    });
  }
  const held = sourceLabels(person.sources);
  if (held.length) {
    facts.push({
      label: "Sources",
      value: held.join(" · "),
      detail: `Held in ${held.join(", ")}.`,
    });
  }
  const methods = (person.methods || []).map((method) => method.value).filter(Boolean);
  if (methods.length) {
    facts.push({
      label: methods.length === 1 ? "Contact" : "Contacts",
      value: methods[0],
      detail: methods.join(" · "),
    });
  }
  const languages = (person.languages || []).filter(Boolean).slice(0, 4);
  if (languages.length) {
    facts.push({
      label: "Languages",
      value: languages.join(" · "),
      detail: languages.join(", "),
    });
  }
  return facts.slice(0, 5);
}

/** Owned fields only. Absence stays absence. */
export function packetSummary(person: PacketFields) {
  const relationship = (person.relationship || "").trim();
  const role = [person.job_title, person.company].filter(Boolean).join(" at ") || (person.headline || "").trim();
  const hometown = Array.isArray(person.hometown) ? person.hometown : [];
  const place = (person.location || hometown[0] || "").trim();
  const lead = [
    relationship ? relationship.charAt(0).toUpperCase() + relationship.slice(1) : "",
    role,
    place,
  ].filter(Boolean).slice(0, 2);
  const memory = (person.quick_memories || person.notes || "").trim().replace(/\s+/g, " ");
  const snippet = memory.length > 140 ? `${memory.slice(0, 137).trimEnd()}…` : memory;
  const held = sourceLabels(person.sources);
  const parts: string[] = [];
  if (lead.length) parts.push(lead.join(" · "));
  if (snippet) parts.push(snippet);
  else if (held.length) parts.push(`Held in ${held.join(", ")}.`);
  else parts.push("No memory recorded yet.");
  return parts.join(". ");
}
