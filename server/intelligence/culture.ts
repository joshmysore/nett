/**
 * Culture labels are cultural / linguistic context suggested by naming patterns
 * (and optionally company/location hints). They are not race, religion, or a
 * claim about how someone identifies. Mixed heritage may carry several labels.
 */

/** Allowed atomic labels. Longer multi-word labels are matched first. */
export const CULTURE_VOCAB: string[] = [
  "Tamil / South Indian",
  "Brazilian / Portuguese",
  "Arabic / Middle Eastern",
  "Persian / Iranian",
  "Jewish / Hebrew",
  "Polish / Slavic",
  "Russian / Slavic",
  "Hispanic / Latino",
  "African American",
  "Iranian / Palestinian",
  "Central Asian",
  "South Asian",
  "East Asian",
  "West African",
  "East African",
  "South Slavic",
  "Pakistani",
  "Punjabi",
  "Bengali",
  "Chinese",
  "Korean",
  "Japanese",
  "Vietnamese",
  "Filipino",
  "Indonesian",
  "Thai",
  "Malaysian",
  "Cambodian",
  "Turkish",
  "Greek",
  "Italian",
  "Irish",
  "Scottish",
  "English",
  "German",
  "French",
  "Dutch",
  "Nordic",
  "Danish",
  "Ukrainian",
  "Serbian",
  "Bulgarian",
  "Slavic",
  "Armenian",
  "Georgian",
  "Romanian",
  "Albanian",
  "Lithuanian",
  "Kazakh",
  "Syrian",
  "Colombian",
  "Peruvian",
  "Costa Rican",
  "Jamaican",
  "Haitian",
  "Canadian",
  "Singaporean",
  "Hong Kong",
  "Okinawan",
  "Toishanese",
  "Anglo",
  "Mormon",
];

/** Exact / near-exact aliases → canonical label(s). */
const ALIASES: Record<string, string[]> = {
  indian: ["South Asian"],
  hindi: ["South Asian"],
  hindu: ["South Asian"],
  "south indian": ["Tamil / South Indian"],
  tamil: ["Tamil / South Indian"],
  ashkenazi: ["Jewish / Hebrew"],
  hebrew: ["Jewish / Hebrew"],
  jewish: ["Jewish / Hebrew"],
  spanish: ["Hispanic / Latino"],
  hispanic: ["Hispanic / Latino"],
  latino: ["Hispanic / Latino"],
  latina: ["Hispanic / Latino"],
  portuguese: ["Brazilian / Portuguese"],
  brazilian: ["Brazilian / Portuguese"],
  arabic: ["Arabic / Middle Eastern"],
  "middle eastern": ["Arabic / Middle Eastern"],
  persian: ["Persian / Iranian"],
  iranian: ["Persian / Iranian"],
  polish: ["Polish / Slavic"],
  russian: ["Russian / Slavic"],
  nigerian: ["West African"],
  ghanaian: ["West African"],
  scandinavian: ["Nordic"],
  european: ["Anglo"],
  "western european": ["Anglo"],
  american: ["Anglo"],
  western: ["Anglo"],
  white: ["Anglo"],
  wasp: ["Anglo"],
  caucasian: ["Anglo"],
  wasian: ["East Asian", "Anglo"],
  waisan: ["Toishanese", "Chinese"],
  "waisan (chinese)": ["Toishanese", "Chinese"],
  "singapore (chinese)": ["Chinese", "Singaporean"],
  "hong kong": ["Hong Kong", "Chinese"],
  "costa rica": ["Costa Rican"],
  "half indian, half white": ["South Asian", "Anglo"],
  "half indian half white": ["South Asian", "Anglo"],
  "latina, white": ["Hispanic / Latino", "Anglo"],
  "latina white": ["Hispanic / Latino", "Anglo"],
  "african-american": ["African American"],
  "african american": ["African American"],
  "iranian-palestianian": ["Iranian / Palestinian"],
  "iranian-palestinian": ["Iranian / Palestinian"],
  chinese: ["Chinese"],
  korean: ["Korean"],
  japanese: ["Japanese"],
  vietnamese: ["Vietnamese"],
  filipino: ["Filipino"],
  french: ["French"],
  georgian: ["Georgian"],
  jamaican: ["Jamaican"],
  kazakh: ["Kazakh"],
  lithuanian: ["Lithuanian"],
  malaysian: ["Malaysian"],
  cambodian: ["Cambodian"],
  colombian: ["Colombian"],
  pakistani: ["Pakistani"],
  albanian: ["Albanian"],
  syrian: ["Syrian"],
  canadian: ["Canadian"],
  hatian: ["Haitian"],
  haitian: ["Haitian"],
  peruvian: ["Peruvian"],
  okinawan: ["Okinawan", "Japanese"],
  mormon: ["Mormon"],
};

/** When a label is accepted, also include these companions (same index family). */
const EXPAND: Record<string, string[]> = {
  Okinawan: ["Japanese"],
};

/** Broader label dropped when a more specific one is also present. */
const SUBSUMED: Record<string, string[]> = {
  "South Asian": ["Tamil / South Indian", "Punjabi", "Bengali", "Pakistani"],
  "East Asian": ["Chinese", "Korean", "Japanese", "Vietnamese", "Toishanese", "Hong Kong"],
  Slavic: ["Polish / Slavic", "Russian / Slavic", "Ukrainian", "South Slavic", "Serbian", "Bulgarian"],
  Nordic: ["Danish"],
  "Persian / Iranian": ["Iranian / Palestinian"],
  Anglo: ["English", "Irish", "Scottish"],
};

function titleCaseWord(word: string): string {
  if (!word) return word;
  if (word === word.toUpperCase() && word.length <= 3) return word;
  return word[0]!.toUpperCase() + word.slice(1).toLowerCase();
}

function flattenSeparators(raw: string): string {
  return raw
    .replace(/[\n\r]+/g, " · ")
    .replace(/,/g, " · ")
    .replace(/\s+&\s+/g, " · ")
    .replace(/\s*\/\s*/g, " · ")
    .replace(/\s+/g, " ")
    .trim();
}

function aliasLookup(key: string): string[] | undefined {
  const lower = key.toLowerCase().trim();
  return ALIASES[lower] || ALIASES[lower.replace(/[()]/g, " ").replace(/\s+/g, " ").trim()];
}

/**
 * Extract ordered canonical culture labels from free text.
 * Multi-word vocab labels (including those that contain "/") are matched
 * greedily on the full string so "Iranian / Palestinian" is never split apart.
 */
export function parseCultureLabels(raw: string): string[] {
  const text = String(raw ?? "").trim();
  if (!text) return [];

  type Hit = { label: string; index: number };
  const hits: Hit[] = [];
  const seen = new Set<string>();
  const pushAt = (label: string, index: number) => {
    if (seen.has(label)) return;
    seen.add(label);
    hits.push({ label, index });
    for (const [offset, extra] of (EXPAND[label] || []).entries()) {
      if (seen.has(extra)) continue;
      seen.add(extra);
      hits.push({ label: extra, index: index + 0.01 * (offset + 1) });
    }
  };

  const wholeAlias = aliasLookup(text);
  if (wholeAlias) {
    for (const [offset, label] of wholeAlias.entries()) pushAt(label, offset);
  }

  // Flatten separators, then greedily match longest vocab/alias phrases while
  // recording their start index so owner-entered order is preserved.
  let working = ` ${flattenSeparators(text).toLowerCase()} `;
  const vocabByLength = [...CULTURE_VOCAB].sort((a, b) => b.length - a.length);
  for (const label of vocabByLength) {
    const needle = ` ${label.toLowerCase().replace(/\s*\/\s*/g, " · ")} `;
    let from = 0;
    while (from < working.length) {
      const at = working.indexOf(needle, from);
      if (at < 0) break;
      pushAt(label, at);
      working = `${working.slice(0, at)} · ${working.slice(at + needle.length)}`;
      from = at + 3;
    }
  }

  const aliasKeys = Object.keys(ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of aliasKeys) {
    const needle = ` ${alias.replace(/[()]/g, " ").replace(/\s+/g, " ").trim()} `;
    if (!needle.trim()) continue;
    let from = 0;
    while (from < working.length) {
      const at = working.indexOf(needle, from);
      if (at < 0) break;
      for (const [offset, label] of ALIASES[alias]!.entries()) pushAt(label, at + offset);
      working = `${working.slice(0, at)} · ${working.slice(at + needle.length)}`;
      from = at + 3;
    }
  }

  for (const token of working.split("·").map((part) => part.trim()).filter(Boolean)) {
    if (token.length < 2 || token.length > 28) continue;
    if (!/^[a-z][a-z '-]*$/i.test(token)) continue;
    const titled = token.split(" ").map(titleCaseWord).join(" ");
    if (/^(White|Black|Asian|Race|Caste|Western|American|Half|Unknown|None|Na|N\/A)$/i.test(titled)) continue;
    if (CULTURE_VOCAB.includes(titled) || ALIASES[token.toLowerCase()]) continue;
    const at = working.indexOf(token);
    pushAt(titled, at < 0 ? 9999 : at);
  }

  hits.sort((a, b) => a.index - b.index);
  const ordered = hits.map((hit) => hit.label);
  const set = new Set(ordered);
  for (const [broad, specifics] of Object.entries(SUBSUMED)) {
    if (set.has(broad) && specifics.some((specific) => set.has(specific))) set.delete(broad);
  }
  if (set.has("English") && set.has("Anglo")) set.delete("Anglo");

  return ordered.filter((label) => set.has(label)).slice(0, 6);
}

/** Normalise a culture write to a canonical multi-label string, or "". */
export function normalizeCultureValue(value: unknown): string {
  if (Array.isArray(value)) {
    return parseCultureLabels(value.map(String).join(" / ")).join(" / ");
  }
  return parseCultureLabels(String(value ?? "")).join(" / ");
}
