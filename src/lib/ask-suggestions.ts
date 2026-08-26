import type { AskPersonRef } from "@/components/AskComposer";
import type { Person } from "@/types";

export type AskSuggestion = {
  text: string;
  people: AskPersonRef[];
};

function cityHint(value?: string | null): string {
  if (!value) return "";
  const city = value.split(",")[0]?.trim() || "";
  return city.length > 1 && city.length < 40 ? city : "";
}

function ref(person: Pick<Person, "id" | "name" | "company" | "location">): AskPersonRef {
  return { id: person.id, name: person.name, company: person.company, location: person.location };
}

export function buildAskSuggestions(input: {
  recent: Person[];
  cold: Person[];
  places: string[];
}): AskSuggestion[] {
  const suggestions: AskSuggestion[] = [];
  const used = new Set<string>();
  const add = (text: string, people: AskPersonRef[] = []) => {
    if (!text || used.has(text) || suggestions.length >= 4) return;
    used.add(text);
    suggestions.push({ text, people });
  };

  const recent = input.recent.filter((person) => person.name);
  const first = recent[0];
  const second = recent.find((person) => person.id !== first?.id);
  if (first) {
    add(`What do I know about ${first.name}?`, [ref(first)]);
    add(`What have ${first.name} and I talked about recently?`, [ref(first)]);
  }
  if (second) {
    add(`What else should I remember about ${second.name}?`, [ref(second)]);
  }

  const place = input.places.map(cityHint).find(Boolean)
    || recent.map((person) => cityHint(person.location) || cityHint(person.hometown?.[0])).find(Boolean);
  if (place) add(`Who do I know in ${place}?`);

  const cold = input.cold.find((person) => person.name && person.id !== first?.id && person.id !== second?.id);
  if (cold) add(`What do I still know about ${cold.name}?`, [ref(cold)]);

  add("Who have I talked to recently?");
  add("What group chats am I in?");
  return suggestions;
}
