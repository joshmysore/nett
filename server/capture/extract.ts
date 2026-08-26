/** Deterministic extraction of reviewable operations from a capture transcript.
 *
 *  Every proposal carries the exact span of source text it came from. A
 *  proposal without a span is not produced: absence of evidence is not
 *  evidence. Nothing here writes to the database — the caller shows these to
 *  the user for approval first.
 *
 *  This runs with no model available, so capture keeps working when the hosted
 *  writer is unset. When a model is available it can propose more, but it may
 *  never bypass the same review step.
 */

export type { CaptureField, CaptureProposal } from "../../src/lib/contracts.js";
import type { CaptureField, CaptureProposal } from "../../src/lib/contracts.js";

export type CaptureExtraction = {
  /** The transcript exactly as supplied. Never normalised, never discarded. */
  transcript: string;
  /** A name mentioned in the text, used only to seed identity matching. */
  nameHint: string | null;
  proposals: CaptureProposal[];
};

/** Sentence-initial words and connectors that are never part of a place or
 *  person name, used to stop a capture group at a natural boundary. */
const STOP_WORDS = new Set([
  "and", "but", "then", "she", "he", "they", "we", "i", "who", "which", "that",
  "about", "with", "for", "from", "into", "onto", "after", "before", "while",
  "her", "his", "their", "our", "my", "the", "a", "an", "also", "plus",
  "through", "via", "by", "because", "when", "where", "so", "during", "since",
  "though", "thanks", "introduced", "now", "still", "again",
]);

const LANGUAGE_WORDS = new Set([
  "english", "spanish", "portuguese", "french", "german", "italian", "dutch",
  "swedish", "norwegian", "danish", "finnish", "polish", "czech", "greek",
  "russian", "ukrainian", "turkish", "arabic", "hebrew", "farsi", "persian",
  "hindi", "urdu", "bengali", "punjabi", "tamil", "telugu", "mandarin",
  "cantonese", "chinese", "japanese", "korean", "vietnamese", "thai", "indonesian",
  "malay", "tagalog", "filipino", "swahili", "romanian", "hungarian", "bulgarian",
  "serbian", "croatian", "slovak", "slovenian", "lithuanian", "latvian", "estonian",
  "catalan", "basque", "galician", "afrikaans", "amharic", "somali", "khmer",
  "cambodian", "lao", "burmese", "nepali", "sinhala", "pashto", "kurdish",
]);

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12,
};

/** Cue words that mark a preference as food/drink rather than a general interest. */
const FOOD_CUES = new Set([
  "pizza", "sushi", "ramen", "pasta", "taco", "tacos", "biryani", "curry", "dosa",
  "idli", "coffee", "tea", "matcha", "wine", "beer", "whiskey", "whisky", "cocktail",
  "cocktails", "vegan", "vegetarian", "gluten", "chocolate", "burger", "steak",
  "seafood", "pho", "kimchi", "falafel", "hummus", "bagel", "croissant", "brunch",
  "food", "foods", "cuisine", "dish", "dishes", "drink", "drinks", "cheese", "bread",
  "soup", "salad", "dessert", "desserts", "sake", "champagne", "gin", "vodka", "rum",
  "latte", "espresso", "cider", "ipa", "ale", "stout", "mezcal", "tequila", "bourbon",
  "scotch", "port", "sherry", "vermouth", "negroni", "martini", "spritz",
  "riesling", "pinot", "cabernet", "chardonnay", "malbec",
]);

const ORIGIN_ADJECTIVES: Record<string, string> = {
  spain: "Spanish", spanish: "Spanish",
  france: "French", french: "French",
  italy: "Italian", italian: "Italian",
  portugal: "Portuguese", portuguese: "Portuguese",
  germany: "German", german: "German",
  japan: "Japanese", japanese: "Japanese",
  china: "Chinese", chinese: "Chinese",
  korea: "Korean", korean: "Korean",
  india: "Indian", indian: "Indian",
  mexico: "Mexican", mexican: "Mexican",
  greece: "Greek", greek: "Greek",
  turkey: "Turkish", turkish: "Turkish",
  lebanon: "Lebanese", lebanese: "Lebanese",
  thailand: "Thai", thai: "Thai",
  vietnam: "Vietnamese", vietnamese: "Vietnamese",
  ethiopia: "Ethiopian", ethiopian: "Ethiopian",
  morocco: "Moroccan", moroccan: "Moroccan",
  argentina: "Argentine", argentine: "Argentine",
  chile: "Chilean", chilean: "Chilean",
  australia: "Australian", australian: "Australian",
  scotland: "Scottish", scottish: "Scottish",
  ireland: "Irish", irish: "Irish",
  england: "English", english: "English",
  georgia: "Georgian", georgian: "Georgian",
};

const PREFERENCE_STOP = new Set([
  "and", "but", "then", "she", "he", "they", "we", "i", "who", "which", "that",
  "about", "with", "for", "into", "onto", "after", "before", "while",
  "her", "his", "their", "our", "my", "the", "a", "an", "also", "plus",
  "through", "via", "by", "because", "when", "where", "so", "during", "since",
  "though", "thanks", "now", "still", "again", "to",
]);

/** Trims a captured phrase at the first connector or clause boundary so
 *  "Lisbon through Maya" yields "Lisbon". */
function trimPhrase(raw: string): string {
  const cleaned = raw.replace(/[.,;!?]+\s*$/u, "").trim();
  if (!cleaned) return "";
  const words = cleaned.split(/\s+/u);
  const kept: string[] = [];
  for (const word of words) {
    const bare = word.replace(/[.,;!?]+$/u, "");
    if (kept.length && STOP_WORDS.has(bare.toLowerCase())) break;
    kept.push(bare);
    if (kept.length >= 6) break;
  }
  return kept.join(" ").replace(/[.,;!?]+$/u, "").trim();
}

/** Preference phrases keep "from Spain" so food origin stays attached. */
function trimPreference(raw: string): string {
  const cleaned = raw.replace(/[.,;!?]+\s*$/u, "").trim();
  // "likes to hike" is an activity clause, not a structured preference item.
  if (!cleaned || /^to\b/iu.test(cleaned)) return "";
  const words = cleaned.split(/\s+/u);
  const kept: string[] = [];
  for (const word of words) {
    const bare = word.replace(/[.,;!?]+$/u, "");
    if (!bare) continue;
    if (kept.length && PREFERENCE_STOP.has(bare.toLowerCase())) break;
    kept.push(bare);
    if (kept.length >= 8) break;
  }
  return kept.join(" ").replace(/[.,;!?]+$/u, "").trim();
}

function looksLikeFood(phrase: string): boolean {
  const lower = phrase.toLowerCase();
  if (/\bfrom\b/u.test(lower) && /\b(wine|beer|cheese|coffee|tea|whiskey|whisky|sake|gin|vodka|rum|cuisine|food)\b/u.test(lower)) {
    return true;
  }
  return lower.split(/[^a-z0-9+]+/u).some((token) => FOOD_CUES.has(token));
}

/** "red wine from Spain" → "Spanish red wine" when the origin is known. */
function normaliseFoodPreference(phrase: string): string {
  const match = phrase.match(/^(.*?)\s+from\s+([\p{L}][\p{L}\s'’-]{1,30})$/u);
  if (!match) return phrase;
  const item = match[1].trim();
  const origin = match[2].trim();
  const adjective = ORIGIN_ADJECTIVES[origin.toLowerCase()];
  if (!item || !adjective) return phrase;
  if (item.toLowerCase().startsWith(adjective.toLowerCase())) return item;
  return `${adjective} ${item}`;
}

function splitPreferenceItems(phrase: string): string[] {
  return phrase
    .split(/\s*(?:,|;|&|\band\b)\s*/u)
    .map((part) => trimPreference(part))
    .filter(Boolean);
}

function titleish(value: string): boolean {
  return /^[\p{Lu}]/u.test(value);
}

function push(
  proposals: CaptureProposal[],
  transcript: string,
  field: CaptureField,
  value: string,
  match: RegExpExecArray,
  confidence: number,
  values?: string[],
) {
  if (!value) return;
  if (proposals.some((proposal) => proposal.field === field)) return;
  const evidence = sentenceAround(transcript, match.index);
  proposals.push({
    field,
    value,
    values,
    evidence: evidence.text,
    evidenceStart: evidence.start,
    evidenceEnd: evidence.end,
    confidence,
  });
}

/** The sentence containing an offset, so the user reviews a readable span
 *  rather than a bare fragment. */
function sentenceAround(text: string, index: number) {
  let start = 0;
  let end = text.length;
  for (let i = index; i > 0; i -= 1) {
    if (/[.!?\n]/u.test(text[i - 1])) { start = i; break; }
  }
  for (let i = index; i < text.length; i += 1) {
    if (/[.!?\n]/u.test(text[i])) { end = i + 1; break; }
  }
  return { text: text.slice(start, end).trim(), start, end };
}

function nextOccurrence(month: number, day: number, today: Date): string {
  const year = today.getUTCFullYear();
  const candidate = Date.UTC(year, month - 1, day);
  const shift = candidate < Date.UTC(year, today.getUTCMonth(), today.getUTCDate()) ? 1 : 0;
  const target = new Date(Date.UTC(year + shift, month - 1, day));
  return target.toISOString().slice(0, 10);
}

export function extractCapture(transcript: string, today = new Date()): CaptureExtraction {
  const text = String(transcript ?? "");
  const proposals: CaptureProposal[] = [];
  let nameHint: string | null = null;

  const run = (pattern: RegExp, handle: (match: RegExpExecArray) => void) => {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) handle(match);
  };

  // Keyword alternations spell out both cases: the `i` flag cannot be used
  // here because these patterns also rely on \p{Lu} to require a capitalised
  // value, and `i` would make that class match lowercase too.

  // Identity hint: "Met Ana ...", "Spoke to Ana ...", "Ana mentioned ..."
  run(/\b(?:[Mm]et|[Mm]eeting|[Ss]poke (?:to|with)|[Tt]alked (?:to|with)|[Cc]all(?:ed)? with|[Ii]ntro(?:duced)? to)\s+([\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)?)/u, (match) => {
    nameHint = match[1].trim();
  });
  if (!nameHint) {
    run(/^([\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)?)\s+(?:is|works|lives|said|mentioned|runs|joined|speaks|likes|loves|enjoys|prefers|drinks|eats)\b/u, (match) => {
      nameHint = match[1].trim();
    });
  }
  if (!nameHint) {
    run(/\b([\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)?)\s+(?:likes|loves|enjoys|prefers|drinks|eats)\b/u, (match) => {
      nameHint = match[1].trim();
    });
  }

  // Where met / current location: "in Lisbon", "at the Berlin conference"
  run(/\b(?:[Mm]et|[Mm]eeting|[Rr]an into|[Bb]umped into)\s+(?:[\p{Lu}][\p{L}'’-]+\s+)?(?:in|at)\s+([\p{L}][\p{L}\s'’-]{1,40})/u, (match) => {
    const place = trimPhrase(match[1]);
    if (place && titleish(place)) {
      push(proposals, text, "where_met", place, match, 0.6);
      push(proposals, text, "location", place, match, 0.5);
    }
  });
  run(/\b(?:[Ll]ives|[Ll]iving|[Bb]ased|[Nn]ow)\s+in\s+([\p{L}][\p{L}\s'’-]{1,40})/u, (match) => {
    const place = trimPhrase(match[1]);
    if (place && titleish(place)) push(proposals, text, "location", place, match, 0.75);
  });

  // Hometown: "grew up in Porto", "originally from Porto", "from Porto originally"
  run(/\b(?:[Gg]rew up in|[Oo]riginally from|[Hh]ometown is|[Cc]omes from)\s+([\p{L}][\p{L}\s'’-]{1,40})/u, (match) => {
    const place = trimPhrase(match[1]);
    if (place && titleish(place)) push(proposals, text, "hometown", place, match, 0.75);
  });
  if (!proposals.some((proposal) => proposal.field === "hometown")) {
    run(/\bfrom\s+([\p{Lu}][\p{L}\s'’-]{1,40})\s+originally\b/u, (match) => {
      const place = trimPhrase(match[1]);
      if (place) push(proposals, text, "hometown", place, match, 0.7);
    });
  }

  // Introduction path: "through Maya", "via Maya", "introduced by Maya"
  run(/\b(?:[Tt]hrough|[Vv]ia|[Ii]ntroduced by|[Ii]ntro'?d by|[Tt]hanks to)\s+([\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)?)/u, (match) => {
    const person = trimPhrase(match[1]);
    if (person) {
      push(proposals, text, "mutuals", person, match, 0.7, [person]);
      push(proposals, text, "how_met", `Introduced by ${person}`, match, 0.65);
    }
  });

  // Industry / field: "works in climate finance", "in fintech"
  run(/\b(?:[Ww]orks? in|[Ww]orking in|[Cc]areer in|[Ff]ield of|[Ii]ndustry is)\s+([\p{L}][\p{L}\s&/'’-]{1,40})/u, (match) => {
    const industry = trimPhrase(match[1]);
    if (industry) push(proposals, text, "industry", industry, match, 0.7);
  });

  // Company: "works at Stripe", "at Stripe", "joined Stripe"
  run(/\b(?:[Ww]orks? at|[Ww]orking at|[Jj]oined|[Nn]ow at|[Ee]mployed at)\s+([\p{Lu}][\p{L}\p{N}&.'’-]*(?:\s+[\p{Lu}][\p{L}\p{N}&.'’-]*)?)/u, (match) => {
    const company = trimPhrase(match[1]);
    if (company) push(proposals, text, "company", company, match, 0.7);
  });

  // Role: "is a designer", "works as a product manager", "title is Counsel"
  run(/\b(?:is an?|works as(?: an?)?|title is)\s+([\p{L}][\p{L}\s&/'’-]{1,40})/u, (match) => {
    const title = trimPhrase(match[1]);
    if (
      title
      && !/^(from|in|at|the|close|best|old|friend|colleague|coworker|partner)\b/i.test(title)
    ) {
      push(proposals, text, "job_title", title.replace(/\s+at\s+.*$/u, "").trim(), match, 0.65);
    }
  });

  // Birthday: "birthday is March 4", "born on 1990-03-04"
  run(/\b(?:birthday is|born on|date of birth is)\s+(\d{4}-\d{2}-\d{2})\b/iu, (match) => {
    push(proposals, text, "birthday", match[1], match, 0.85);
  });
  if (!proposals.some((proposal) => proposal.field === "birthday")) {
    run(new RegExp(`\\b(?:birthday is|born on|turns)\\s+(${Object.keys(MONTHS).join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "iu"), (match) => {
      const month = MONTHS[match[1].toLowerCase()];
      const day = Number(match[2]);
      if (month && day >= 1 && day <= 31) {
        push(proposals, text, "birthday", `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, match, 0.7);
      }
    });
  }

  // Languages: "speaks Portuguese, Spanish and English"
  run(/\b(?:[Ss]peaks?|[Ff]luent in|[Bb]ilingual in|[Tt]alks)\s+([\p{L}\s,&]+?)(?:[.;]|$)/u, (match) => {
    const found = match[1]
      .split(/,|\band\b|&/u)
      .map((part) => part.trim().replace(/[.,;]+$/u, ""))
      .filter((part) => LANGUAGE_WORDS.has(part.toLowerCase()));
    const languages = [...new Set(found)];
    if (languages.length) {
      push(proposals, text, "languages", languages.join(", "), match, 0.8, languages);
    }
  });

  // Relationship
  run(/\b(close friend|best friend|old friend|friend|colleague|coworker|co-worker|classmate|mentor|mentee|neighbour|neighbor|cousin|brother|sister|father|mother|partner|manager|investor|client|teammate)\b/iu, (match) => {
    const label = match[1].toLowerCase();
    push(proposals, text, "relationship", label.charAt(0).toUpperCase() + label.slice(1), match, 0.55);
  });

  // Preferences: "Sam Weil likes red wine from Spain", "favourite food is dosa"
  run(/\b(?:favourite|favorite)\s+(?:food|foods|dish|dishes|drink|drinks|wine|coffee|tea)\s+(?:is|are)\s+([\p{L}][\p{L}\s'’-]{1,60})/iu, (match) => {
    const items = splitPreferenceItems(match[1]).map(normaliseFoodPreference);
    if (items.length) {
      push(proposals, text, "foods", items.join(", "), match, 0.85, items);
    }
  });
  if (!proposals.some((proposal) => proposal.field === "foods" || proposal.field === "interests")) {
    run(/\b(?:likes|loves|enjoys|prefers|drinks|eats)\s+([\p{L}][\p{L}\s'’-]{1,60})/iu, (match) => {
      const items = splitPreferenceItems(match[1]);
      if (!items.length) return;
      const foods = items.filter(looksLikeFood).map(normaliseFoodPreference);
      const interests = items.filter((item) => !looksLikeFood(item));
      if (foods.length) {
        push(proposals, text, "foods", foods.join(", "), match, 0.8, foods);
      }
      if (interests.length) {
        push(proposals, text, "interests", interests.join(", "), match, 0.7, interests);
      }
    });
  }

  // Follow-up: "follow up in September", "follow up on 2026-09-01"
  run(/\bfollow[ -]?up\b[^.]*?\b(\d{4}-\d{2}-\d{2})\b/iu, (match) => {
    push(proposals, text, "follow_up_date", match[1], match, 0.9);
  });
  if (!proposals.some((proposal) => proposal.field === "follow_up_date")) {
    run(new RegExp(`\\bfollow[ -]?up\\b[^.]*?\\b(${Object.keys(MONTHS).join("|")})\\b`, "iu"), (match) => {
      const month = MONTHS[match[1].toLowerCase()];
      if (month) push(proposals, text, "follow_up_date", nextOccurrence(month, 1, today), match, 0.6);
    });
  }
  if (!proposals.some((proposal) => proposal.field === "follow_up_date")) {
    run(/\bfollow[ -]?up\b[^.]*?\bin\s+(\d{1,2})\s+(day|week|month)s?\b/iu, (match) => {
      const amount = Number(match[1]);
      const unit = match[2].toLowerCase();
      const days = unit === "day" ? amount : unit === "week" ? amount * 7 : amount * 30;
      const target = new Date(today.getTime() + days * 86_400_000);
      push(proposals, text, "follow_up_date", target.toISOString().slice(0, 10), match, 0.7);
    });
  }

  // When met: an explicit date or month reference tied to meeting
  run(new RegExp(`\\bmet\\b[^.]*?\\b(${Object.keys(MONTHS).join("|")})\\b`, "iu"), (match) => {
    push(proposals, text, "when_met", match[1], match, 0.5);
  });

  // Category tags from well-known topic words in the transcript.
  const tagWords = [
    "finance", "policy", "fundraising", "AI", "robotics", "health", "travel",
    "founder", "investor", "climate", "design", "product", "research",
  ];
  const foundTags: string[] = [];
  let tagEvidenceStart = -1;
  let tagEvidenceEnd = -1;
  for (const tag of tagWords) {
    const match = new RegExp(`\\b${tag}\\b`, "i").exec(text);
    if (!match) continue;
    foundTags.push(tag);
    if (tagEvidenceStart < 0) {
      tagEvidenceStart = match.index;
      tagEvidenceEnd = match.index + match[0].length;
    } else {
      tagEvidenceEnd = Math.max(tagEvidenceEnd, match.index + match[0].length);
    }
  }
  if (foundTags.length) {
    const evidence = sentenceAround(text, tagEvidenceStart);
    proposals.push({
      field: "tags",
      value: foundTags.join(", "),
      values: foundTags,
      evidence: evidence.text,
      evidenceStart: evidence.start,
      evidenceEnd: evidence.end,
      confidence: 0.55,
    });
  }

  return { transcript: text, nameHint, proposals };
}
