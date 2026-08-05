import {
  formatHometownEntry,
  HOMETOWN_OF,
  hometownEntries,
  type HometownEntry,
} from "../../src/lib/place.js";
import { normalizePlaceText } from "./catalog.js";

/**
 * Re-pair a flattened hometown array like ["Boston","MA","Dallas","TX"] into
 * place phrases before catalog normalisation. Leaves already-canonical labels
 * alone.
 */
function looksLikeStateCode(value: string): boolean {
  return /^[A-Za-z]{2}$/.test(value);
}

function looksLikeCountryWord(value: string): boolean {
  return /\b(land|stan|Kingdom|States|Republic|Emirates|Federation)\b/i.test(value)
    || /^(USA|US|UK|UAE|Canada|India|China|Japan|Korea|Singapore|Australia|Germany|France|Ireland|Poland|Mexico|Brazil|Spain|Italy|Sweden|Norway|Denmark|Finland|Switzerland|Netherlands|Belgium|Austria|Portugal|Greece|Turkey|Israel|Egypt|Nigeria|Kenya|Pakistan|Bangladesh|Vietnam|Thailand|Indonesia|Malaysia|Philippines|Taiwan|Hong Kong|Palestine)$/i.test(value);
}

function regroupHometownTokens(tokens: string[]): string[] {
  if (tokens.length <= 1) return tokens;
  // Already look like full labels (contain commas) — keep as-is.
  if (tokens.some((token) => token.includes(","))) return tokens;

  const grouped: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    const a = tokens[index]!;
    const b = tokens[index + 1];
    const c = tokens[index + 2];
    // City, ST, Country — only when the third token is a country word.
    if (b && c && looksLikeStateCode(b) && looksLikeCountryWord(c)) {
      grouped.push(`${a}, ${b}, ${c}`);
      index += 3;
      continue;
    }
    // City, ST
    if (b && looksLikeStateCode(b)) {
      grouped.push(`${a}, ${b}`);
      index += 2;
      continue;
    }
    // City, Country
    if (b && looksLikeCountryWord(b)) {
      grouped.push(`${a}, ${b}`);
      index += 2;
      continue;
    }
    grouped.push(a);
    index += 1;
  }
  return grouped;
}

/** Detect "specific, metro" pairs written as adjacent custom labels. */
function inferHierarchy(entries: HometownEntry[]): HometownEntry[] {
  if (entries.length !== 2) return entries;
  const [first, second] = entries;
  if (!first || !second || first.of || second.of) return entries;
  const a = first.label.toLowerCase();
  const b = second.label.toLowerCase();
  // Explicit metro wording: Mysore + Bangalore metro
  if (/\bmetro\b|\barea\b|\bbay\b/.test(b) && !/\bmetro\b|\barea\b/.test(a)) {
    return [{ label: first.label, of: second.label }, { label: second.label }];
  }
  if (/\bmetro\b|\barea\b|\bbay\b/.test(a) && !/\bmetro\b|\barea\b/.test(b)) {
    return [{ label: first.label }, { label: second.label, of: first.label }];
  }
  return entries;
}

export async function normalizeLocationValue(value: unknown): Promise<string> {
  return normalizePlaceText(String(value ?? ""));
}

export async function normalizeHometownValue(value: unknown): Promise<string[]> {
  const rawList = Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : String(value ?? "").trim()
      ? [String(value).trim()]
      : [];
  if (!rawList.length) return [];

  // Expand JSON-array accidents and semicolon / newline multi-place strings.
  const flat: string[] = [];
  for (const item of rawList) {
    if (item.startsWith("[") && item.endsWith("]")) {
      try {
        const parsed = JSON.parse(item) as unknown;
        if (Array.isArray(parsed)) {
          flat.push(...parsed.map((entry) => String(entry ?? "").trim()).filter(Boolean));
          continue;
        }
      } catch {
        // fall through
      }
    }
    if (/[;\n]/.test(item) && !item.includes(HOMETOWN_OF.trim())) {
      flat.push(...item.split(/[;\n]+/).map((entry) => entry.trim()).filter(Boolean));
      continue;
    }
    flat.push(item);
  }

  const regrouped = regroupHometownTokens(flat);
  const parsed = hometownEntries(regrouped);
  const hierarchical = inferHierarchy(parsed);

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of hierarchical) {
    const label = await normalizePlaceText(entry.label);
    const of = entry.of ? await normalizePlaceText(entry.of) : undefined;
    const encoded = formatHometownEntry({ label, of: of && of !== label ? of : undefined });
    if (!encoded || seen.has(encoded)) continue;
    seen.add(encoded);
    normalized.push(encoded);
  }
  // Ensure parent metros exist as their own entry when referenced via ⊏.
  for (const entry of hometownEntries(normalized)) {
    if (!entry.of) continue;
    if (normalized.some((item) => hometownEntries([item])[0]?.label === entry.of)) continue;
    if (seen.has(entry.of)) continue;
    normalized.push(entry.of);
    seen.add(entry.of);
  }
  return normalized;
}
