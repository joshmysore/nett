import Fuse from "fuse.js";
import { randomUUID } from "node:crypto";
import { db, getPeople } from "./db.js";
import { answerRelationshipQuestion } from "./intelligence/service.js";
import type { AskAbilityId } from "./intelligence/ask.js";

export type Citation = { personId: string; label: string; field: string; value: string; source: string };
export type AgentAnswer = { answer: string; citations: Citation[]; provider: string };

export type AgentQueryScope = {
  personIds?: readonly string[];
  ability?: AskAbilityId | null;
  contextPersonIds?: readonly string[];
};

export interface LlmProvider {
  id: string;
  answer(query: string, signal?: AbortSignal, scope?: AgentQueryScope): Promise<AgentAnswer>;
}

const daysSince = (date?: string) => date ? Math.floor((Date.now() - Date.parse(date)) / 86400000) : 9999;
const cite = (person: any, field: string, value: unknown, source = "Nett"): Citation => ({ personId: person.id, label: person.name, field, value: Array.isArray(value) ? value.join(", ") : String(value ?? "Unknown"), source });

export class LocalEvidenceProvider implements LlmProvider {
  id = "local-evidence";
  async answer(query: string): Promise<AgentAnswer> {
    const people = getPeople() as any[];
    const q = query.toLowerCase().trim();
    const fuse = new Fuse(people, { threshold: 0.38, includeScore: true, keys: ["name", "nickname", "company", "industry", "location", "hometown", "tags", "interests", "institutions", "mutuals", "quick_memories", "notes"] });
    let selected: any[] = [];
    let framing = "Here are the closest evidence-backed matches in your network.";

    const companyMatch = people.find((p) => p.company && q.includes(String(p.company).toLowerCase()));
    const cityMatch = [...new Set(people.map((p) => p.location).filter(Boolean))].find((city) => q.includes(String(city).toLowerCase()));
    if (/not contacted|reconnect|going cold|dormant/.test(q)) {
      selected = people.filter((p) => daysSince(p.last_contact) > 75).sort((a, b) => daysSince(b.last_contact) - daysSince(a.last_contact)).slice(0, 5);
      framing = "These relationships have the longest gaps since a recorded interaction.";
    } else if (/strongest|strong ties/.test(q)) {
      selected = people.filter((p) => !cityMatch || p.location === cityMatch).sort((a, b) => b.relationship_strength - a.relationship_strength).slice(0, 5);
      framing = cityMatch ? `These are your strongest recorded ties in ${cityMatch}.` : "These are your strongest recorded ties.";
    } else if (/fundrais|startup|investor|intro/.test(q)) {
      selected = people.filter((p) => p.intro_potential >= 75 || p.tags.some((t: string) => /investor|fundraising|founder/.test(t))).sort((a, b) => b.intro_potential - a.intro_potential).slice(0, 5);
      framing = "These people have the strongest combination of introduction potential and relevant context.";
    } else if (companyMatch) {
      selected = people.filter((p) => p.company === companyMatch.company);
      framing = `You have ${selected.length} person${selected.length === 1 ? "" : "s"} associated with ${companyMatch.company}.`;
    } else if (cityMatch || /visiting|in san|new york|chicago|london|paris/.test(q)) {
      selected = people.filter((p) => !cityMatch || p.location === cityMatch).sort((a, b) => b.relationship_strength - a.relationship_strength).slice(0, 5);
      framing = cityMatch ? `These are the most relevant people in ${cityMatch}.` : framing;
    } else {
      selected = fuse.search(query).slice(0, 5).map((result) => result.item);
      if (!selected.length) selected = people.slice(0, 4);
    }

    const lines = selected.map((p) => {
      const context = p.quick_memories || p.notes || `${p.relationship || "Contact"} at ${p.company || "an unknown company"}`;
      return `${p.name}: ${p.company ? `${p.company}, ` : ""}${p.location || "location unknown"}. ${context}`;
    });
    const citations = selected.flatMap((p) => [cite(p, "profile", `${p.company || "Unknown company"}; ${p.location || "Unknown location"}`), cite(p, "relationship_strength", p.relationship_strength), cite(p, "memory", p.quick_memories || "No memory captured")]);
    const answer = `${framing}\n\n${lines.join("\n\n")}`;
    db.prepare("INSERT INTO ai_queries (id, query, response, citations_json, provider, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))").run(randomUUID(), query, answer, JSON.stringify(citations), this.id);
    return { answer, citations, provider: this.id };
  }
}

export function getProvider(): LlmProvider {
  return {
    id: "local-relationship-intelligence",
    async answer(query, signal, scope) {
      const result = await answerRelationshipQuestion(query, {
        signal,
        personIds: scope?.personIds,
        ability: scope?.ability,
        contextPersonIds: scope?.contextPersonIds,
      });
      db.prepare("INSERT INTO ai_queries (id, query, response, citations_json, provider, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
        .run(randomUUID(), query, result.answer, JSON.stringify(result.citations), result.provider);
      return result;
    }
  };
}

