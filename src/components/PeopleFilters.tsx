import { X } from "@phosphor-icons/react";
import { useState } from "react";
import type { Facet, PeopleFacets } from "@/lib/api";
import { missingFilterLabel } from "@/lib/person-fields";

/** URL parameters that carry a facet selection. Each one holds a single value,
 *  matching the server contract in /api/people/facets. */
export const FACET_PARAMS = [
  "recency",
  "relationship",
  "country",
  "industry",
  "language",
  "tag",
  "missing",
] as const;

export type FacetParam = (typeof FACET_PARAMS)[number];
export type FacetValues = Record<FacetParam, string>;

type Group = {
  param: FacetParam;
  label: string;
  key: keyof PeopleFacets;
};

const GROUPS: Group[] = [
  { param: "recency", label: "Last contact", key: "recency" },
  { param: "relationship", label: "Relationship", key: "relationships" },
  { param: "country", label: "Country", key: "countries" },
  { param: "industry", label: "Industry", key: "industries" },
  { param: "language", label: "Language", key: "languages" },
  { param: "tag", label: "Tag", key: "tags" },
  { param: "missing", label: "Gaps to fill", key: "missing" },
];

const RECENCY_LABELS: Record<string, string> = {
  "30d": "Past 30 days",
  "90d": "Past 90 days",
  year: "Past year",
  never: "Never contacted",
};

const sentenceCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);

/** Human label for a facet value. Stored values are shown as stored except for
 *  the two coded groups, which would otherwise read as "30d" and "location". */
export function facetLabel(param: FacetParam, value: string) {
  if (param === "recency") return RECENCY_LABELS[value] || value;
  if (param === "missing") return missingFilterLabel(value);
  return sentenceCase(value);
}

export const facetGroupLabel = (param: FacetParam) =>
  GROUPS.find((group) => group.param === param)?.label || param;

const VISIBLE_LIMIT = 8;

function FacetGroup({
  group,
  options,
  active,
  onToggle,
}: {
  group: Group;
  options: Facet[];
  active: string;
  onToggle: (param: FacetParam, value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? options : options.slice(0, VISIBLE_LIMIT);
  const hidden = options.length - visible.length;

  return (
    <div className="facet-group" role="group" aria-label={group.label}>
      <p>{group.label}</p>
      <div className="facet-options">
        {visible.map((option) => {
          const isActive = active === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className="facet-option"
              aria-pressed={isActive}
              onClick={() => onToggle(group.param, option.value)}
            >
              <em>{facetLabel(group.param, option.value)}</em>
              <b>{option.count.toLocaleString()}</b>
            </button>
          );
        })}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          className="text-button facet-more"
          onClick={() => setExpanded(true)}
        >
          Show {hidden} more
        </button>
      )}
    </div>
  );
}

export function PeopleFilters({
  id,
  hidden,
  facets,
  values,
  onToggle,
}: {
  id: string;
  hidden?: boolean;
  facets: PeopleFacets | null;
  values: FacetValues;
  onToggle: (param: FacetParam, value: string) => void;
}) {
  const groups = GROUPS.map((group) => {
    const options = facets ? facets[group.key] : [];
    const active = values[group.param];
    // Keep a selected value visible even when it is the only remaining option.
    const withActive =
      active && !options.some((option) => option.value === active)
        ? [...options, { value: active, count: 0 }]
        : options;
    return { group, options: withActive };
  }).filter((entry) => entry.options.length > 0);

  if (!groups.length) {
    return (
      <div className="people-facets" id={id} hidden={hidden}>
        <p className="facet-empty">
          {facets
            ? "No locations, industries, languages, or tags are recorded here."
            : "Loading filters"}
        </p>
      </div>
    );
  }

  return (
    <div className="people-facets" id={id} hidden={hidden}>
      {groups.map(({ group, options }) => (
        <FacetGroup
          key={group.param}
          group={group}
          options={options}
          active={values[group.param]}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

export function ActiveFilters({
  values,
  onToggle,
  onClear,
}: {
  values: FacetValues;
  onToggle: (param: FacetParam, value: string) => void;
  onClear: () => void;
}) {
  const active = FACET_PARAMS.filter((param) => values[param]);
  if (!active.length) return null;

  return (
    <div className="people-active-filters">
      <span>Filtered by</span>
      {active.map((param) => (
        <button
          key={param}
          type="button"
          className="active-filter"
          onClick={() => onToggle(param, values[param])}
        >
          <span>
            {facetGroupLabel(param)}: {facetLabel(param, values[param])}
          </span>
          <X size={14} aria-hidden="true" />
          <span className="sr-only">Remove filter</span>
        </button>
      ))}
      <button type="button" className="text-button" onClick={onClear}>
        Clear all
      </button>
    </div>
  );
}
