/**
 * Guess a hometown label from a school / institution name already in owned
 * evidence. Returns null when the name does not look like early education or
 * does not carry a place cue. Callers must emit reviewable suggestions only.
 */

const earlyEducation =
  /\b(high school|secondary school|prep school|preparatory|gymnasium|lyc[eé]e|colegio|college\b.*\bschool|middle school|elementary)\b/i;

export function hometownFromInstitution(institution: string): string | null {
  const text = institution.replace(/\s+/g, " ").trim();
  if (!text || text.length < 4 || text.length > 160) return null;
  if (!earlyEducation.test(text)) return null;

  const afterComma = text
    .split(",")
    .slice(1)
    .join(",")
    .replace(/\([^)]*\)/g, "")
    .trim();
  if (afterComma.length >= 2 && afterComma.length <= 80 && !earlyEducation.test(afterComma)) {
    return afterComma;
  }

  const paren = text.match(/\(([^)]+)\)/);
  if (paren?.[1]) {
    const place = paren[1].replace(/\s+/g, " ").trim();
    if (place.length >= 2 && place.length <= 80 && !earlyEducation.test(place)) return place;
  }

  const prefix = text.match(
    /^([\p{L}][\p{L} .'-]{1,60}?)\s+(?:senior\s+)?(?:high school|secondary school|prep school|preparatory school)\b/iu,
  );
  if (prefix?.[1]) {
    const place = prefix[1].replace(/\s+/g, " ").trim();
    if (place.length >= 2 && !/^(the|st\.?|saint|our|holy)$/i.test(place)) return place;
  }

  return null;
}

export function hometownSuggestionsFromInstitutions(
  institutions: unknown,
  existingHometown: unknown,
): { value: string; institution: string; confidence: number; reason: string }[] {
  const existing = new Set(
    (Array.isArray(existingHometown) ? existingHometown : [existingHometown])
      .map((value) => String(value ?? "").trim().toLocaleLowerCase())
      .filter(Boolean),
  );
  const list = Array.isArray(institutions)
    ? institutions.map((value) => String(value ?? "").trim()).filter(Boolean)
    : String(institutions ?? "")
        .split(/[;|]/)
        .map((value) => value.trim())
        .filter(Boolean);

  const out: { value: string; institution: string; confidence: number; reason: string }[] = [];
  const seen = new Set<string>();
  for (const institution of list) {
    const value = hometownFromInstitution(institution);
    if (!value) continue;
    const key = value.toLocaleLowerCase();
    if (existing.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({
      value,
      institution,
      confidence: 0.62,
      reason: `Likely hometown from early education listed as “${institution}”.`,
    });
  }
  return out;
}
