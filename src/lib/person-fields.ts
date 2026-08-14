/**
 * Canonical person categories Nett stores on `nett_metadata`.
 * Identity (name) lives on `people`; everything below is relationship context.
 *
 * Fields marked `infer: false` may be typed by the user but must never be
 * proposed from messages, imports, or the local model.
 */

export type PersonFieldKind = "text" | "list" | "date" | "number";

export type PersonField = {
  key: string;
  label: string;
  kind: PersonFieldKind;
  hint?: string;
  /** Shown in the All-fields editor. */
  editable: boolean;
  /** May appear as an autofill / mass-fill proposal. */
  infer: boolean;
  /** Offered in the Fill gaps queue. */
  massFill: boolean;
  /** Shown on the person workspace when present. */
  display: boolean;
};

export const PERSON_FIELDS: PersonField[] = [
  { key: "hometown", label: "Hometown", kind: "list", hint: "main place, then sub-areas chosen from cities in the same state", editable: true, infer: true, massFill: true, display: true },
  { key: "location", label: "Location", kind: "text", hint: "country → state → city", editable: true, infer: true, massFill: true, display: true },
  { key: "industry", label: "Industry", kind: "text", editable: true, infer: true, massFill: true, display: true },
  { key: "company", label: "Company", kind: "text", editable: true, infer: true, massFill: true, display: true },
  { key: "spike", label: "Spike", kind: "text", hint: "what makes them distinctive", editable: true, infer: true, massFill: true, display: true },
  { key: "languages", label: "Languages", kind: "list", hint: "add one at a time", editable: true, infer: true, massFill: true, display: true },
  { key: "skills", label: "Skills", kind: "list", hint: "add one at a time", editable: true, infer: true, massFill: true, display: true },
  { key: "interests", label: "Interests", kind: "list", hint: "add one at a time", editable: true, infer: true, massFill: true, display: true },
  { key: "foods", label: "Foods", kind: "list", hint: "dishes, drinks, diets — add one at a time", editable: true, infer: true, massFill: true, display: true },
  { key: "gender", label: "Gender", kind: "text", hint: "male or female — auto-filled from name when the name is unambiguous", editable: true, infer: true, massFill: true, display: true },
  { key: "culture", label: "Culture", kind: "text", hint: "multi-label OK when mixed — auto-filled from surnames via local model; edit if wrong", editable: true, infer: true, massFill: true, display: true },
  { key: "personality", label: "Personality", kind: "text", hint: "how they are in person — typed by you only", editable: true, infer: false, massFill: false, display: true },
  {
    key: "online_personality",
    label: "Online personality",
    kind: "list",
    hint: "adjectives from how they write — add one at a time",
    editable: true,
    infer: true,
    massFill: true,
    display: true,
  },
  { key: "birthday", label: "Birthday", kind: "date", hint: "month, day, and year", editable: true, infer: true, massFill: true, display: true },
  { key: "relationship_strength", label: "Relationship strength", kind: "number", editable: true, infer: true, massFill: false, display: true },
  { key: "relationship", label: "Relationship", kind: "text", hint: "friend, colleague, sister", editable: true, infer: true, massFill: true, display: true },
  { key: "when_met", label: "When you met", kind: "text", editable: true, infer: true, massFill: true, display: true },
  { key: "where_met", label: "Where you met", kind: "text", editable: true, infer: true, massFill: true, display: true },
  { key: "how_met", label: "How you met", kind: "text", editable: true, infer: true, massFill: true, display: true },
  { key: "institutions", label: "Institutions", kind: "list", hint: "add one at a time", editable: true, infer: true, massFill: true, display: true },
  { key: "mutuals", label: "Mutual connections", kind: "list", hint: "add one at a time", editable: true, infer: true, massFill: true, display: true },
  { key: "last_contact", label: "Last contact", kind: "date", editable: true, infer: false, massFill: false, display: true },
  { key: "tags", label: "Categories", kind: "list", hint: "topics and relationship categories — add one at a time", editable: true, infer: true, massFill: true, display: true },
];

export const LIST_FIELD_KEYS = PERSON_FIELDS.filter((field) => field.kind === "list").map(
  (field) => field.key,
);

/** Never inferred — user may still type them. */
export const NEVER_INFER_FIELDS = new Set(
  PERSON_FIELDS.filter((field) => !field.infer).map((field) => field.key).concat([
    "ethnicity",
    "religion",
    "politics",
    "sexuality",
    "health",
  ]),
);

export const MASS_FILL_FIELDS = PERSON_FIELDS.filter((field) => field.massFill);

export const EDIT_TEXT_FIELDS = PERSON_FIELDS.filter(
  (field) => field.editable && field.kind !== "number",
);

export const fieldLabel = (key: string) =>
  PERSON_FIELDS.find((field) => field.key === key)?.label
  || key.replace(/_/g, " ");

export const isListField = (key: string) =>
  PERSON_FIELDS.find((field) => field.key === key)?.kind === "list";

/** Keys the people list / facets accept as `missing=`. */
export const MISSING_FILTER_KEYS = [
  "context",
  ...PERSON_FIELDS.filter((field) => field.massFill || field.key === "last_contact").map((field) => field.key),
] as const;

export type MissingFilterKey = (typeof MISSING_FILTER_KEYS)[number];

export const isMissingFilterKey = (value: string): value is MissingFilterKey =>
  (MISSING_FILTER_KEYS as readonly string[]).includes(value);

export const missingFilterLabel = (key: string) => {
  if (key === "context") return "No relationship context";
  return `No ${fieldLabel(key).toLowerCase()}`;
};
