/**
 * Thin wrapper around the local country/state/city catalog.
 * Server-only — keeps the ~city dataset out of the client bundle.
 */

import {
  getAllCitiesOfCountry,
  getCitiesOfState,
  getCountries,
  getStatesOfCountry,
} from "@countrystatecity/countries";
import { formatPlace, type Place } from "../../src/lib/place.js";

export type GeoOption = { code: string; name: string };

/** Display names that differ from the catalog's official name. */
const COUNTRY_DISPLAY: Record<string, string> = {
  "Hong Kong S.A.R.": "Hong Kong",
  "Palestinian Territory Occupied": "Palestine",
  "United States": "United States",
  "United Kingdom": "United Kingdom",
};

const COUNTRY_ALIASES: Record<string, string> = {
  us: "US",
  usa: "US",
  "united states": "US",
  "united states of america": "US",
  america: "US",
  uk: "GB",
  "u.k.": "GB",
  "united kingdom": "GB",
  "great britain": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "hong kong": "HK",
  "hong kong sar": "HK",
  "hong kong s.a.r.": "HK",
  singapore: "SG",
  korea: "KR",
  "south korea": "KR",
  "republic of korea": "KR",
  palestine: "PS",
  "palestinian territory occupied": "PS",
  schweiz: "CH",
  deutschland: "DE",
  germany: "DE",
};

const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
  "VA", "WA", "WV", "WI", "WY", "DC",
]);

const US_STATE_ALIASES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "district of columbia": "DC", "washington dc": "DC", "washington d.c.": "DC",
};

let countriesCache: GeoOption[] | null = null;

export function displayCountryName(catalogName: string): string {
  return COUNTRY_DISPLAY[catalogName] || catalogName;
}

export async function listCountries(): Promise<GeoOption[]> {
  if (countriesCache) return countriesCache;
  const rows = await getCountries();
  countriesCache = rows
    .map((country) => ({
      code: country.iso2,
      name: displayCountryName(country.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return countriesCache;
}

export async function listStates(countryCode: string): Promise<GeoOption[]> {
  const code = countryCode.trim().toUpperCase();
  if (!code) return [];
  const rows = await getStatesOfCountry(code);
  return rows
    .map((state) => ({
      code: state.iso2,
      // US/CA/AU are universally recognised by postal codes in Nett labels.
      name: code === "US" || code === "CA" || code === "AU" ? state.iso2 : state.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listCities(countryCode: string, stateCode?: string): Promise<GeoOption[]> {
  const country = countryCode.trim().toUpperCase();
  if (!country) return [];
  const state = (stateCode || "").trim().toUpperCase();
  const rows = state
    ? await getCitiesOfState(country, state)
    : await getAllCitiesOfCountry(country);
  const names = new Set<string>();
  const options: GeoOption[] = [];
  for (const city of rows) {
    if (names.has(city.name)) continue;
    names.add(city.name);
    options.push({ code: city.name, name: city.name });
  }
  return options.sort((a, b) => a.name.localeCompare(b.name));
}

export async function resolveCountryCode(nameOrCode: string): Promise<string | null> {
  const raw = nameOrCode.trim();
  if (!raw) return null;
  const alias = COUNTRY_ALIASES[raw.toLowerCase()];
  if (alias) return alias;
  const countries = await listCountries();
  const upper = raw.toUpperCase();
  const byCode = countries.find((country) => country.code === upper);
  if (byCode) return byCode.code;
  const lower = raw.toLowerCase();
  const byName = countries.find((country) => country.name.toLowerCase() === lower);
  return byName?.code ?? null;
}

export async function resolveStateCode(countryCode: string, nameOrCode: string): Promise<string | null> {
  const raw = nameOrCode.trim();
  if (!raw) return null;
  if (countryCode === "US") {
    const alias = US_STATE_ALIASES[raw.toLowerCase()];
    if (alias) return alias;
    if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  }
  const states = await getStatesOfCountry(countryCode);
  const upper = raw.toUpperCase();
  const byCode = states.find((state) => state.iso2 === upper);
  if (byCode) return byCode.iso2;
  const lower = raw.toLowerCase();
  const byName = states.find((state) => state.name.toLowerCase() === lower);
  return byName?.iso2 ?? null;
}

export async function placeFromParts(input: {
  countryCode?: string;
  country?: string;
  regionCode?: string;
  region?: string;
  city?: string;
}): Promise<Place | null> {
  const countryCode =
    (input.countryCode && input.countryCode.trim().toUpperCase())
    || (input.country ? await resolveCountryCode(input.country) : null);
  if (!countryCode) return null;
  const countries = await listCountries();
  const country = countries.find((entry) => entry.code === countryCode);
  if (!country) return null;

  const regionCode =
    (input.regionCode && input.regionCode.trim().toUpperCase())
    || (input.region ? await resolveStateCode(countryCode, input.region) : null)
    || undefined;

  let region: string | undefined;
  if (regionCode) {
    const states = await listStates(countryCode);
    region = states.find((state) => state.code === regionCode)?.name || regionCode;
  } else if (input.region?.trim()) {
    region = input.region.trim();
  }

  const city = input.city?.trim() || undefined;
  return {
    country: country.name,
    countryCode,
    region,
    regionCode: regionCode || undefined,
    city,
  };
}

export async function labelFromParts(input: {
  countryCode?: string;
  country?: string;
  regionCode?: string;
  region?: string;
  city?: string;
}): Promise<string> {
  return formatPlace(await placeFromParts(input));
}

/**
 * Resolve free-form place text against the catalog.
 * Prefers exact city+state+country matches; falls back to best-effort labels.
 */
export async function normalizePlaceText(raw: string): Promise<string> {
  const text = String(raw ?? "").trim();
  if (!text) return "";

  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return "";

  // "United States" / "Singapore"
  if (parts.length === 1) {
    const code = await resolveCountryCode(parts[0]!);
    if (code) {
      const countries = await listCountries();
      return countries.find((country) => country.code === code)?.name || parts[0]!;
    }
    return parts[0]!;
  }

  // "Dallas, TX" | "Dublin, Ireland" | "Plano, TX, United States"
  let countryHint = "";
  let regionHint = "";
  let cityHint = parts[0]!;

  if (parts.length >= 3) {
    countryHint = parts[parts.length - 1]!;
    regionHint = parts.slice(1, -1).join(", ");
  } else {
    // Two parts: second may be state or country. Prefer explicit country
    // aliases (UK, UAE), then US state codes/names (MA is Massachusetts, not
    // Morocco), then full country names.
    const second = parts[1]!;
    const lower = second.toLowerCase();
    if (COUNTRY_ALIASES[lower]) {
      countryHint = second;
    } else if (US_STATE_ALIASES[lower] || US_STATE_CODES.has(second.toUpperCase())) {
      regionHint = second;
      countryHint = "United States";
    } else if (await resolveCountryCode(second)) {
      countryHint = second;
    } else {
      countryHint = second;
    }
  }

  const countryCode = (await resolveCountryCode(countryHint)) || (regionHint ? "US" : null);
  if (!countryCode) {
    // Keep original text rather than inventing structure.
    return text;
  }

  const regionCode = regionHint ? await resolveStateCode(countryCode, regionHint) : null;
  const cities = await listCities(countryCode, regionCode || undefined);
  const cityMatch = cities.find((city) => city.name.toLowerCase() === cityHint.toLowerCase());

  const place = await placeFromParts({
    countryCode,
    regionCode: regionCode || undefined,
    region: regionCode ? undefined : regionHint || undefined,
    city: cityMatch?.name || cityHint,
  });
  return formatPlace(place) || text;
}
