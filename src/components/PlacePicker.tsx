import { Plus, X } from "@phosphor-icons/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, isAbortError, type GeoOption } from "@/lib/api";
import {
  composeSubareaLabel,
  flattenHometownGroups,
  formatPlace,
  groupHometownEntries,
  hometownEntries,
  splitPlaceLabel,
  type HometownGroup,
  type Place,
} from "@/lib/place";

type Draft = {
  countryCode: string;
  regionCode: string;
  city: string;
};

function emptyDraft(): Draft {
  return { countryCode: "", regionCode: "", city: "" };
}

function draftFromLabel(label: string, countries: GeoOption[]): Draft {
  const parts = splitPlaceLabel(label);
  const country = countries.find(
    (entry) => entry.name.toLowerCase() === (parts.country || "").toLowerCase(),
  );
  return {
    countryCode: country?.code || "",
    regionCode: (parts.region || "").toUpperCase(),
    city: parts.city || "",
  };
}

function labelFromDraft(draft: Draft, countries: GeoOption[], states: GeoOption[]): string {
  const country = countries.find((entry) => entry.code === draft.countryCode);
  if (!country) return "";
  const region = states.find((entry) => entry.code === draft.regionCode)?.name
    || draft.regionCode
    || undefined;
  const place: Place = {
    country: country.name,
    countryCode: country.code,
    region,
    regionCode: draft.regionCode || undefined,
    city: draft.city.trim() || undefined,
  };
  return formatPlace(place);
}

/** Cascading country → state → city picker. City is a filterable typeahead. */
export function PlacePicker({
  value,
  onChange,
  disabled,
  id,
  showClear = false,
}: {
  value: string;
  onChange: (label: string) => void;
  disabled?: boolean;
  id?: string;
  /** Show an inline clear control. Prefer a parent remove button for lists. */
  showClear?: boolean;
}) {
  const autoId = useId();
  const baseId = id || autoId;
  const listId = `${baseId}-cities`;
  const [countries, setCountries] = useState<GeoOption[]>([]);
  const [states, setStates] = useState<GeoOption[]>([]);
  const [cities, setCities] = useState<GeoOption[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [cityQuery, setCityQuery] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastEmitted = useRef(value);

  useEffect(() => {
    const abort = new AbortController();
    void api.geoCountries(abort.signal)
      .then((rows) => {
        if (!abort.signal.aborted) setCountries(rows);
      })
      .catch((error) => {
        if (!isAbortError(error)) {
          setLoadError(error instanceof Error ? error.message : "Could not load countries");
        }
      });
    return () => abort.abort();
  }, []);

  // Sync from outside only when the parent value wasn't the one we just emitted.
  useEffect(() => {
    if (!countries.length) return;
    if (value === lastEmitted.current) {
      // Still refresh region codes once states are known via the states effect.
      setDraft((current) => {
        const next = draftFromLabel(value, countries);
        if (
          current.countryCode === next.countryCode
          && current.regionCode === next.regionCode
          && current.city === next.city
        ) {
          return current;
        }
        return next;
      });
      setCityQuery(splitPlaceLabel(value).city || "");
      return;
    }
    lastEmitted.current = value;
    const next = draftFromLabel(value, countries);
    setDraft(next);
    setCityQuery(next.city);
  }, [value, countries]);

  useEffect(() => {
    if (!draft.countryCode) {
      setStates([]);
      return;
    }
    const abort = new AbortController();
    void api.geoStates(draft.countryCode, abort.signal)
      .then((rows) => {
        if (abort.signal.aborted) return;
        // Drop military/territory codes that clutter US state picking.
        const cleaned = draft.countryCode === "US"
          ? rows.filter((row) => !["AA", "AE", "AP"].includes(row.code))
          : rows;
        setStates(cleaned);
      })
      .catch(() => {
        if (!abort.signal.aborted) setStates([]);
      });
    return () => abort.abort();
  }, [draft.countryCode]);

  useEffect(() => {
    if (!draft.countryCode) {
      setCities([]);
      return;
    }
    const abort = new AbortController();
    void api.geoCities(draft.countryCode, draft.regionCode || undefined, abort.signal)
      .then((rows) => {
        if (!abort.signal.aborted) setCities(rows);
      })
      .catch(() => {
        if (!abort.signal.aborted) setCities([]);
      });
    return () => abort.abort();
  }, [draft.countryCode, draft.regionCode]);

  // Map "Texas" → "TX" once states load.
  useEffect(() => {
    if (!states.length || !draft.regionCode) return;
    if (states.some((state) => state.code === draft.regionCode)) return;
    const match = states.find(
      (state) => state.name.toLowerCase() === draft.regionCode.toLowerCase()
        || state.code.toLowerCase() === draft.regionCode.toLowerCase(),
    );
    if (match) setDraft((current) => ({ ...current, regionCode: match.code }));
  }, [states, draft.regionCode]);

  const filteredCities = useMemo(() => {
    const q = cityQuery.trim().toLowerCase();
    if (!q) return cities.slice(0, 80);
    return cities.filter((city) => city.name.toLowerCase().includes(q)).slice(0, 80);
  }, [cities, cityQuery]);

  const emit = (next: Draft) => {
    setDraft(next);
    const label = labelFromDraft(next, countries, states);
    lastEmitted.current = label;
    onChange(label);
  };

  const pickCity = (name: string) => {
    setCityQuery(name);
    emit({ ...draft, city: name });
  };

  return (
    <div className="place-picker" id={baseId}>
      {loadError && <p className="inline-error" role="alert">{loadError}</p>}
      <div className="place-picker-row">
        <label>
          <span className="sr-only">Country</span>
          <select
            value={draft.countryCode}
            disabled={disabled}
            onChange={(event) => {
              setCityQuery("");
              emit({ countryCode: event.target.value, regionCode: "", city: "" });
            }}
          >
            <option value="">Country</option>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>{country.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">State or region</span>
          <select
            value={draft.regionCode}
            disabled={disabled || !draft.countryCode || states.length === 0}
            onChange={(event) => {
              setCityQuery("");
              emit({ ...draft, regionCode: event.target.value, city: "" });
            }}
          >
            <option value="">{states.length ? "State / region" : "No regions"}</option>
            {states.map((state) => (
              <option key={state.code} value={state.code}>{state.name}</option>
            ))}
          </select>
        </label>
        <label className="place-city">
          <span className="sr-only">City</span>
          <input
            type="text"
            list={listId}
            placeholder={draft.countryCode ? "City or metro" : "Choose a country first"}
            value={cityQuery}
            disabled={disabled || !draft.countryCode}
            onChange={(event) => {
              const text = event.target.value;
              setCityQuery(text);
              // Exact catalog match commits immediately; free text commits as custom city.
              const exact = cities.find((city) => city.name.toLowerCase() === text.trim().toLowerCase());
              emit({ ...draft, city: exact?.name || text.trim() });
            }}
            onBlur={() => {
              const exact = cities.find((city) => city.name.toLowerCase() === cityQuery.trim().toLowerCase());
              if (exact && exact.name !== draft.city) pickCity(exact.name);
            }}
          />
          <datalist id={listId}>
            {filteredCities.map((city) => (
              <option key={city.name} value={city.name} />
            ))}
          </datalist>
        </label>
        {showClear && value && (
          <button
            type="button"
            className="icon-button"
            aria-label="Clear place"
            disabled={disabled}
            onClick={() => {
              setCityQuery("");
              lastEmitted.current = "";
              setDraft(emptyDraft());
              onChange("");
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Sub-area picker: city typeahead locked to the main hometown's state (or country
 * when no region). The geo catalog lists official cities — not metro boundaries.
 */
export function SubareaCityPicker({
  parentLabel,
  value,
  onChange,
  disabled,
  excludeCities = [],
}: {
  parentLabel: string;
  value: string;
  onChange: (cityName: string) => void;
  disabled?: boolean;
  /** City names already used as sub-areas or the main hometown. */
  excludeCities?: string[];
}) {
  const autoId = useId();
  const listId = `${autoId}-sub-cities`;
  const [countries, setCountries] = useState<GeoOption[]>([]);
  const [cities, setCities] = useState<GeoOption[]>([]);
  const [cityQuery, setCityQuery] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastEmitted = useRef(value);

  const parentParts = splitPlaceLabel(parentLabel);
  const parentDraft = useMemo(
    () => (countries.length ? draftFromLabel(parentLabel, countries) : emptyDraft()),
    [parentLabel, countries],
  );
  const scopeLabel = parentParts.region && parentParts.country
    ? `${parentParts.region}, ${parentParts.country}`
    : parentParts.country || "";

  useEffect(() => {
    const abort = new AbortController();
    void api.geoCountries(abort.signal)
      .then((rows) => {
        if (!abort.signal.aborted) setCountries(rows);
      })
      .catch((error) => {
        if (!isAbortError(error)) {
          setLoadError(error instanceof Error ? error.message : "Could not load countries");
        }
      });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    setCityQuery(value);
  }, [value]);

  useEffect(() => {
    if (!parentDraft.countryCode) {
      setCities([]);
      return;
    }
    const abort = new AbortController();
    void api.geoCities(
      parentDraft.countryCode,
      parentDraft.regionCode || undefined,
      abort.signal,
    )
      .then((rows) => {
        if (!abort.signal.aborted) setCities(rows);
      })
      .catch(() => {
        if (!abort.signal.aborted) setCities([]);
      });
    return () => abort.abort();
  }, [parentDraft.countryCode, parentDraft.regionCode]);

  const blocked = useMemo(() => {
    const names = new Set(
      excludeCities.map((name) => name.trim().toLowerCase()).filter(Boolean),
    );
    const mainCity = parentParts.city?.trim().toLowerCase();
    if (mainCity) names.add(mainCity);
    return names;
  }, [excludeCities, parentParts.city]);

  const filteredCities = useMemo(() => {
    const q = cityQuery.trim().toLowerCase();
    return cities
      .filter((city) => !blocked.has(city.name.toLowerCase()))
      .filter((city) => !q || city.name.toLowerCase().includes(q))
      .slice(0, 80);
  }, [cities, cityQuery, blocked]);

  const pick = (name: string) => {
    const trimmed = name.trim();
    setCityQuery(trimmed);
    lastEmitted.current = trimmed;
    onChange(trimmed);
  };

  if (!parentDraft.countryCode) {
    return (
      <p className="subarea-hint">Choose the main hometown above before adding a sub-area.</p>
    );
  }

  return (
    <div className="subarea-city-picker">
      {loadError && <p className="inline-error" role="alert">{loadError}</p>}
      {scopeLabel && (
        <p className="subarea-hint">Cities in {scopeLabel}</p>
      )}
      <label>
        <span className="sr-only">Sub-area city in {scopeLabel}</span>
        <input
          type="text"
          list={listId}
          placeholder="Search cities…"
          value={cityQuery}
          disabled={disabled || !cities.length}
          onChange={(event) => {
            const text = event.target.value;
            setCityQuery(text);
            const exact = cities.find((city) => city.name.toLowerCase() === text.trim().toLowerCase());
            if (exact && !blocked.has(exact.name.toLowerCase())) pick(exact.name);
          }}
          onBlur={() => {
            const exact = cities.find((city) => city.name.toLowerCase() === cityQuery.trim().toLowerCase());
            if (exact && !blocked.has(exact.name.toLowerCase())) pick(exact.name);
          }}
        />
        <datalist id={listId}>
          {filteredCities.map((city) => (
            <option key={city.name} value={city.name} />
          ))}
        </datalist>
      </label>
    </div>
  );
}

/**
 * Hometowns as main places with nested sub-areas.
 * Storage uses "Plano ⊏ Dallas, …"; the editor never asks for Plano as a peer.
 */
export function HometownEditor({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (entries: string[]) => void;
  disabled?: boolean;
}) {
  const fromValue = () => groupHometownEntries(hometownEntries(value.filter(Boolean)));
  const [groups, setGroups] = useState<HometownGroup[]>(fromValue);
  const skipSync = useRef(false);
  const valueKey = JSON.stringify(value);

  useEffect(() => {
    if (skipSync.current) {
      skipSync.current = false;
      return;
    }
    setGroups(fromValue());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueKey]);

  const commit = (next: HometownGroup[]) => {
    setGroups(next);
    skipSync.current = true;
    onChange(flattenHometownGroups(next));
  };

  return (
    <div className="hometown-editor">
      {groups.map((group, index) => (
        <div className="hometown-group" key={`hometown-${index}`}>
          <div className="hometown-group-main">
            <PlacePicker
              value={group.main}
              disabled={disabled}
              onChange={(main) => {
                const oldParts = splitPlaceLabel(group.main);
                const newParts = splitPlaceLabel(main);
                const regionChanged = oldParts.region !== newParts.region
                  || oldParts.country !== newParts.country;
                const subareas = regionChanged
                  ? group.subareas.filter((sub) => {
                    const full = composeSubareaLabel(sub, main);
                    const subParts = splitPlaceLabel(full);
                    if (newParts.region) {
                      return subParts.region === newParts.region
                        && subParts.country === newParts.country;
                    }
                    return subParts.country === newParts.country;
                  })
                  : group.subareas;
                commit(groups.map((entry, i) => (
                  i === index ? { ...entry, main, subareas } : entry
                )));
              }}
            />
            <button
              type="button"
              className="icon-button"
              aria-label="Remove hometown"
              disabled={disabled}
              onClick={() => commit(groups.filter((_, i) => i !== index))}
            >
              <X size={16} />
            </button>
          </div>

          {group.main.trim() && (
            <div className="hometown-subareas">
              {group.subareas.map((town, subIndex) => (
                <div className="hometown-subarea" key={`sub-${index}-${subIndex}`}>
                  <span className="hometown-nest" aria-hidden="true">⊏</span>
                  <SubareaCityPicker
                    parentLabel={group.main}
                    value={town}
                    disabled={disabled}
                    excludeCities={[
                      ...group.subareas.filter((_, j) => j !== subIndex),
                      splitPlaceLabel(group.main).city || "",
                    ].filter(Boolean)}
                    onChange={(cityName) => {
                      const subareas = group.subareas.map((entry, j) => (
                        j === subIndex ? cityName : entry
                      ));
                      commit(groups.map((entry, i) => (
                        i === index ? { ...entry, subareas } : entry
                      )));
                    }}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Remove sub-area"
                    disabled={disabled}
                    onClick={() => {
                      const subareas = group.subareas.filter((_, j) => j !== subIndex);
                      commit(groups.map((entry, i) => (
                        i === index ? { ...entry, subareas } : entry
                      )));
                    }}
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-button hometown-add-sub"
                disabled={disabled}
                onClick={() => {
                  setGroups(groups.map((entry, i) => (
                    i === index ? { ...entry, subareas: [...entry.subareas, ""] } : entry
                  )));
                }}
              >
                <Plus size={14} />
                Add sub-area
              </button>
            </div>
          )}
        </div>
      ))}

      <button
        type="button"
        className="secondary-button hometown-add"
        disabled={disabled}
        onClick={() => setGroups([...groups, { main: "", subareas: [] }])}
      >
        <Plus size={16} />
        Add hometown
      </button>
    </div>
  );
}

/** Compact read-only hometown list with suburb nesting under each main. */
export function HometownDisplay({ value }: { value: unknown }) {
  const groups = groupHometownEntries(hometownEntries(value));
  if (!groups.length) return null;
  return (
    <ul className="hometown-display">
      {groups.map((group) => (
        <li key={group.main}>
          <span>{group.main}</span>
          {group.subareas.length > 0 && (
            <ul>
              {group.subareas.map((town) => (
                <li key={`${group.main}:${town}`} className="is-suburb">
                  <span className="hometown-nest" aria-hidden="true">⊏</span>
                  <span>{town}</span>
                  <span className="sr-only">, part of {group.main}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
