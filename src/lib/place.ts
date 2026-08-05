/**
 * Canonical place labels and hometown hierarchy.
 *
 * Location is a single label: "City, Region, Country".
 * Hometown is a list of labels; a suburb under a metro uses " ⊏ ":
 *   "Plano, TX, United States ⊏ Dallas, TX, United States"
 */

export const HOMETOWN_OF = " ⊏ ";

export type Place = {
  country: string;
  countryCode?: string;
  /** Display region — US state code (TX) or full province name. */
  region?: string;
  regionCode?: string;
  city?: string;
};

export type HometownEntry = {
  label: string;
  /** Parent metro / broader area this place sits under. */
  of?: string;
};

export function formatPlace(place: Place | null | undefined): string {
  if (!place?.country) return "";
  const region = (place.region || place.regionCode || "").trim();
  const city = (place.city || "").trim();
  const country = place.country.trim();
  if (city && region) return `${city}, ${region}, ${country}`;
  if (city) return `${city}, ${country}`;
  if (region) return `${region}, ${country}`;
  return country;
}

export function parseHometownEntry(raw: string): HometownEntry {
  const text = String(raw ?? "").trim();
  if (!text) return { label: "" };
  const index = text.indexOf(HOMETOWN_OF);
  if (index === -1) return { label: text };
  return {
    label: text.slice(0, index).trim(),
    of: text.slice(index + HOMETOWN_OF.length).trim() || undefined,
  };
}

export function formatHometownEntry(entry: HometownEntry): string {
  const label = String(entry.label ?? "").trim();
  if (!label) return "";
  const of = String(entry.of ?? "").trim();
  return of ? `${label}${HOMETOWN_OF}${of}` : label;
}

/** Split a stored hometown list into structured entries. Pass arrays from the API. */
export function hometownEntries(value: unknown): HometownEntry[] {
  const list = Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : String(value ?? "").trim()
      ? [String(value).trim()]
      : [];
  return list.map(parseHometownEntry).filter((entry) => entry.label);
}

/** US/CA/AU postal codes — used so "TX, United States" is region+country, not city+country. */
const REGION_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
  "VA", "WA", "WV", "WI", "WY", "DC",
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
  "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA",
]);

/** Best-effort parse of a free-text place into city / region / country parts. */
export function splitPlaceLabel(label: string): { city?: string; region?: string; country?: string } {
  const parts = String(label ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return {};
  if (parts.length === 1) return { country: parts[0] };
  if (parts.length === 2) {
    const [first, second] = parts as [string, string];
    // "TX, United States" — region only, not a city named TX.
    if (REGION_CODES.has(first.toUpperCase())) {
      return { region: first.toUpperCase(), country: second };
    }
    return { city: first, country: second };
  }
  return {
    city: parts[0],
    region: parts.slice(1, -1).join(", "),
    country: parts[parts.length - 1],
  };
}

/**
 * Order hometowns so metros come first and suburbs follow their parent.
 * Entries whose parent is missing stay at the end.
 */
export function orderHometownEntries(entries: HometownEntry[]): HometownEntry[] {
  const groups = groupHometownEntries(entries);
  const ordered: HometownEntry[] = [];
  for (const group of groups) {
    if (group.main) ordered.push({ label: group.main });
    for (const sub of group.subareas) {
      ordered.push({
        label: composeSubareaLabel(sub, group.main) || sub,
        of: group.main || undefined,
      });
    }
  }
  return ordered;
}

/** One hometown with optional nested sub-areas (suburbs / towns). */
export type HometownGroup = {
  main: string;
  /** Short display names (usually just the town), not full place labels. */
  subareas: string[];
};

/** Town name for display under a parent — drops shared region/country. */
export function subareaDisplayName(subLabel: string, parentLabel: string): string {
  const sub = splitPlaceLabel(subLabel);
  const parent = splitPlaceLabel(parentLabel);
  if (sub.city && sub.region === parent.region && sub.country === parent.country) {
    return sub.city;
  }
  if (sub.city && sub.country === parent.country && !sub.region) return sub.city;
  if (sub.city) return sub.city;
  return String(subLabel ?? "").trim();
}

/** Build a full sub-area label inheriting region/country from the parent metro. */
export function composeSubareaLabel(subCity: string, parentLabel: string): string {
  const city = String(subCity ?? "").trim();
  if (!city) return "";
  // Already a full label — keep the city head, inherit the rest from parent.
  const typed = splitPlaceLabel(city);
  const parent = splitPlaceLabel(parentLabel);
  const country = parent.country || typed.country || "";
  if (!country) return typed.city || city;
  return formatPlace({
    city: typed.city || city,
    region: parent.region || typed.region,
    country,
  });
}

/** Collapse flat ⊏ entries into main → sub-area groups for editing/display. */
export function groupHometownEntries(entries: HometownEntry[]): HometownGroup[] {
  const mains = entries.filter((entry) => !entry.of);
  const orphans = entries.filter(
    (entry) => entry.of && !mains.some((main) => main.label === entry.of),
  );
  const groups: HometownGroup[] = mains.map((main) => ({
    main: main.label,
    subareas: entries
      .filter((entry) => entry.of === main.label)
      .map((entry) => subareaDisplayName(entry.label, main.label)),
  }));
  // A suburb whose parent was never stored still needs a home — promote the parent.
  for (const orphan of orphans) {
    const parent = String(orphan.of);
    const existing = groups.find((group) => group.main === parent);
    if (existing) {
      existing.subareas.push(subareaDisplayName(orphan.label, parent));
      continue;
    }
    groups.push({
      main: parent,
      subareas: [subareaDisplayName(orphan.label, parent)],
    });
  }
  return groups;
}

/** Flatten editor groups back to the stored string list. */
export function flattenHometownGroups(groups: HometownGroup[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    const main = String(group.main ?? "").trim();
    if (main && !seen.has(main)) {
      out.push(main);
      seen.add(main);
    }
    for (const sub of group.subareas) {
      const town = String(sub ?? "").trim();
      if (!town || !main) continue;
      const label = composeSubareaLabel(town, main);
      const encoded = formatHometownEntry({ label, of: main });
      if (!encoded || seen.has(encoded)) continue;
      out.push(encoded);
      seen.add(encoded);
    }
  }
  return out;
}
