export const ASK_ABILITY_IDS = [
  "who",
  "about",
  "talked",
  "recent",
  "place",
  "notes",
  "messages",
  "email",
  "whatsapp",
] as const;

export type AskAbilityId = (typeof ASK_ABILITY_IDS)[number];

export type AskAbility = {
  id: AskAbilityId;
  slash: string;
  label: string;
  hint: string;
  prompt: string;
};

export const ASK_ABILITIES: readonly AskAbility[] = [
  {
    id: "who",
    slash: "who",
    label: "Who",
    hint: "Find people who match a place, topic, or trait",
    prompt: "Who do I know who ",
  },
  {
    id: "about",
    slash: "about",
    label: "About",
    hint: "A brief from stored records about someone",
    prompt: "What do I know about ",
  },
  {
    id: "talked",
    slash: "talked",
    label: "Talked",
    hint: "What you discussed in messages or email",
    prompt: "What have we talked about ",
  },
  {
    id: "recent",
    slash: "recent",
    label: "Recent",
    hint: "People with contact in the last 90 days",
    prompt: "Who have I talked to recently about ",
  },
  {
    id: "place",
    slash: "place",
    label: "Place",
    hint: "Who you know in a city or hometown",
    prompt: "Who do I know in ",
  },
  {
    id: "notes",
    slash: "notes",
    label: "Notes",
    hint: "Search memories you wrote down",
    prompt: "What notes do I have about ",
  },
  {
    id: "messages",
    slash: "messages",
    label: "Messages",
    hint: "Only Apple Messages",
    prompt: "In Messages, ",
  },
  {
    id: "email",
    slash: "email",
    label: "Email",
    hint: "Only Gmail",
    prompt: "In email, ",
  },
  {
    id: "whatsapp",
    slash: "whatsapp",
    label: "WhatsApp",
    hint: "Only WhatsApp",
    prompt: "In WhatsApp, ",
  },
];

export function isAskAbilityId(value: unknown): value is AskAbilityId {
  return typeof value === "string" && (ASK_ABILITY_IDS as readonly string[]).includes(value);
}

export function abilityById(id: AskAbilityId): AskAbility {
  return ASK_ABILITIES.find((ability) => ability.id === id) ?? ASK_ABILITIES[0];
}

export function filterAbilities(query: string): AskAbility[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...ASK_ABILITIES];
  return ASK_ABILITIES.filter((ability) => (
    ability.slash.startsWith(needle)
    || ability.label.toLocaleLowerCase().includes(needle)
    || ability.hint.toLocaleLowerCase().includes(needle)
  ));
}

export type ComposerTrigger = {
  kind: "mention" | "ability";
  query: string;
  start: number;
  end: number;
};

const MENTION = /(^|[\s\u00A0])@([^\s\u00A0]*(?:\s[^\s\u00A0]+){0,2})$/u;
const ABILITY = /(^|[\s\u00A0])\/([^\s\u00A0]*)$/u;

export function detectComposerTrigger(text: string, caret: number): ComposerTrigger | null {
  if (caret < 0 || caret > text.length) return null;
  const before = text.slice(0, caret);
  const mention = before.match(MENTION);
  if (mention) {
    const query = mention[2] ?? "";
    return { kind: "mention", query, start: before.length - 1 - query.length, end: caret };
  }
  const ability = before.match(ABILITY);
  if (!ability) return null;
  const query = ability[2] ?? "";
  return { kind: "ability", query, start: before.length - 1 - query.length, end: caret };
}

export function replaceTriggerRange(text: string, trigger: ComposerTrigger, insert = ""): string {
  const next = `${text.slice(0, trigger.start)}${insert}${text.slice(trigger.end)}`;
  return insert ? next : next.replace(/\s{2,}/g, " ").replace(/^\s+|\s+$/g, "");
}

export type MentionedPerson = { id: string; name: string };

export function composeAskQuestion(
  text: string,
  people: readonly MentionedPerson[],
  ability?: AskAbility | null,
): string {
  const names = people.map((person) => person.name.trim()).filter(Boolean);
  let question = text.replace(/\s+/g, " ").trim();
  if (!question && ability) question = ability.prompt.trim();
  if (!question && names.length) {
    const mention = names.length === 1 ? names[0] : names.join(" and ");
    return `What do I know about ${mention}?`;
  }
  if (names.length) {
    const missing = names.filter((name) => !question.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
    if (missing.length) {
      const mention = missing.length === 1 ? missing[0] : missing.join(" and ");
      question = `${question} (${mention})`;
    }
  }
  return question;
}

export function primaryAskAbility(ids: readonly AskAbilityId[]): AskAbilityId | null {
  const mode = ids.find((id) => id === "about" || id === "talked" || id === "notes" || id === "who" || id === "recent" || id === "place");
  return mode ?? ids[0] ?? null;
}

export function composerPlaceholder(
  people: readonly MentionedPerson[],
  abilities: readonly AskAbilityId[],
): string {
  const id = primaryAskAbility(abilities);
  if (id) return `${abilityById(id).prompt.trim()}…`;
  if (people.length === 1) return `Ask about ${people[0].name}…`;
  if (people.length > 1) return "Ask about them…";
  return "Ask who you know, or what you talked about…";
}
