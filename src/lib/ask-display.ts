import type { Citation } from "../types.js";

export type AskStage = {
  id: string;
  label: string;
  detail?: string;
  done: boolean;
};

export type PersonHit = {
  personId: string;
  name: string;
  sources: string[];
  excerpts: Citation[];
};

export function cleanExcerpt(value: string) {
  return value
    .replace(/\bdirection:\s*(incoming|outgoing)\b/gi, "")
    .replace(/\b(conversation|subject):\s*/gi, "")
    .replace(/^name:\s*/i, "")
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?/g, (iso) => {
      const ms = Date.parse(iso);
      if (!Number.isFinite(ms)) return iso;
      return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function sourceLabel(source: string) {
  if (source === "messages") return "Messages";
  if (source === "whatsapp") return "WhatsApp";
  if (source === "gmail") return "Gmail";
  if (source === "telegram") return "Telegram";
  return source;
}

export function groupCitations(citations: Citation[]): PersonHit[] {
  const order: PersonHit[] = [];
  const byId = new Map<string, PersonHit>();
  for (const citation of citations) {
    if (!citation.personId) continue;
    const existing = byId.get(citation.personId);
    const excerpt = cleanExcerpt(citation.value || "");
    if (existing) {
      if (citation.source && !existing.sources.includes(citation.source)) {
        existing.sources.push(citation.source);
      }
      if (excerpt && !existing.excerpts.some((item) => item.value === citation.value)) {
        existing.excerpts.push(citation);
      }
      continue;
    }
    const next: PersonHit = {
      personId: citation.personId,
      name: citation.label,
      sources: citation.source ? [citation.source] : [],
      excerpts: excerpt ? [citation] : [],
    };
    byId.set(citation.personId, next);
    order.push(next);
  }
  return order.slice(0, 8);
}

export function upsertStage(stages: AskStage[], next: Omit<AskStage, "done"> & { done?: boolean }): AskStage[] {
  const done = next.done ?? false;
  const existing = stages.findIndex((stage) => stage.id === next.id);
  const marked = stages.map((stage, index) => (
    index === existing ? { ...stage, ...next, done } : { ...stage, done: true }
  ));
  if (existing >= 0) return marked;
  return [...stages.map((stage) => ({ ...stage, done: true })), { ...next, done }];
}

export function relativeAge(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function threadDayLabel(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "Earlier";
  const date = new Date(ms);
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startThat = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startToday - startThat) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  return "Earlier";
}
