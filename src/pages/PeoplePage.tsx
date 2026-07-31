import {
  ArrowLeft,
  ArrowRight,
  List,
  MagnifyingGlass,
  Network,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { NetworkField } from "@/components/NetworkField";
import {
  asList,
  Avatar,
  EmptyState,
  friendlyDate,
  IconButton,
  SignalRing,
  SourceBadge,
} from "@/components/Primitives";
import { api } from "@/lib/api";
import type { Person } from "@/types";

const PAGE_SIZE = 50;
const filters = ["all", "strong", "due", "cold"] as const;
type Filter = (typeof filters)[number];
type View = "list" | "map";

const filterLabels: Record<Filter, string> = {
  all: "All people",
  strong: "Strong ties",
  due: "Follow-up due",
  cold: "Going cold",
};

function isFilter(value: string | null): value is Filter {
  return filters.includes(value as Filter);
}

export function PeoplePage({
  onOpen,
}: {
  onOpen: (id: string) => void;
}) {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") || "";
  const requestedFilter = params.get("filter");
  const filter: Filter = isFilter(requestedFilter) ? requestedFilter : "all";
  const view: View = params.get("view") === "map" ? "map" : "list";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [serverResults, setServerResults] = useState<Person[]>([]);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const requestId = useRef(0);

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(updates).forEach(([key, value]) => {
      if (!value || value === "all" || (key === "page" && value === "1")) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    });
    setParams(next, { replace: true });
  };

  useEffect(() => {
    const currentRequest = ++requestId.current;
    setSearching(true);
    setSearchError(null);
    const timeout = window.setTimeout(() => {
      api
        .peoplePage({ query: query.trim(), filter, page, limit: PAGE_SIZE })
        .then((result) => {
          if (currentRequest === requestId.current) {
            setServerResults(asList(result.people));
            setTotal(result.total);
          }
        })
        .catch((error) => {
          if (currentRequest === requestId.current) {
            setServerResults([]);
            setTotal(0);
            setSearchError(
              error instanceof Error ? error.message : "Search is unavailable",
            );
          }
        })
        .finally(() => {
          if (currentRequest === requestId.current) setSearching(false);
        });
    }, query.trim() ? 180 : 0);
    return () => window.clearTimeout(timeout);
  }, [query, filter, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = serverResults;

  useEffect(() => {
    if (page > totalPages) updateParams({ page: String(totalPages) });
    // URL correction should only run when the page count changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, totalPages]);

  return (
    <div className="people-page">
      <section className="page-heading">
        <div>
          <p className="section-kicker">People</p>
          <h1>Find anyone without scanning.</h1>
          <p>
            Search runs against server-indexed people, memories, locations, and source
            evidence.
          </p>
        </div>
        <div className="heading-count">
          <strong>{total}</strong>
          <span>people</span>
        </div>
      </section>

      <div className="people-toolbar">
        <label className="filter-search">
          {searching ? (
            <SpinnerGap size={17} className="spin" />
          ) : (
            <MagnifyingGlass size={17} />
          )}
          <span className="sr-only">Search people</span>
          <input
            value={query}
            onChange={(event) =>
              updateParams({ q: event.target.value, page: null })
            }
            placeholder="Name, company, memory, mutual..."
            type="search"
            autoComplete="off"
          />
        </label>
        <div className="filter-tabs" role="group" aria-label="Filter people">
          {filters.map((item) => (
            <button
              className={filter === item ? "is-active" : ""}
              onClick={() => updateParams({ filter: item, page: null })}
              key={item}
              aria-pressed={filter === item}
            >
              {filterLabels[item]}
            </button>
          ))}
        </div>
        <div className="view-switch">
          <IconButton
            label="List view"
            active={view === "list"}
            onClick={() => updateParams({ view: null })}
          >
            <List size={17} />
          </IconButton>
          <IconButton
            label="Relationship map"
            active={view === "map"}
            onClick={() => updateParams({ view: "map" })}
          >
            <Network size={17} />
          </IconButton>
        </div>
      </div>

      <div className="people-result-status" aria-live="polite">
        {searching
          ? "Searching all indexed records..."
          : `${total} ${total === 1 ? "person" : "people"} in this view`}
      </div>

      {searchError && (
        <p className="inline-error" role="alert">
          <WarningCircle size={15} />
          {searchError}
        </p>
      )}

      {view === "map" ? (
        <div className="people-map-shell glass-panel">
          <NetworkField people={visible.slice(0, 12)} onOpen={onOpen} />
          <div>
            <h2>Current selection</h2>
            <p>
              The map shows up to 12 people from the active server search and filter.
              Open a node for source details.
            </p>
          </div>
        </div>
      ) : visible.length ? (
        <>
          <div className="people-table">
            <div className="people-table-head" aria-hidden="true">
              <span>Person</span>
              <span>Context</span>
              <span>Relationship</span>
              <span>Last contact</span>
              <span>Sources</span>
              <span />
            </div>
            {visible.map((person) => (
              <button
                className="person-row"
                key={person.id}
                onClick={() => onOpen(person.id)}
              >
                <span className="person-cell">
                  <Avatar person={person} size="sm" />
                  <span>
                    <strong>{person.name}</strong>
                    <small>{person.company || "Company not recorded"}</small>
                  </span>
                </span>
                <span className="context-cell">
                  <strong>{person.location || "Location not recorded"}</strong>
                  <small>{person.industry || "Industry not recorded"}</small>
                </span>
                <span className="relationship-cell">
                  <SignalRing value={person.relationship_strength || 0} />
                  <small>{person.relationship || "Unclassified"}</small>
                </span>
                <span className="date-cell">
                  <strong>{friendlyDate(person.last_contact)}</strong>
                  <small>
                    {person.follow_up_date
                      ? `Follow up ${person.follow_up_date}`
                      : "No follow-up set"}
                  </small>
                </span>
                <span className="source-cell">
                  {asList(person.sources)
                    .slice(0, 2)
                    .map((source) => (
                      <SourceBadge source={source} key={source} />
                    ))}
                </span>
                <ArrowRight size={16} className="row-arrow" />
              </button>
            ))}
          </div>
          <nav className="people-pagination" aria-label="People pages">
            <button
              className="secondary-button"
              disabled={safePage === 1}
              onClick={() => updateParams({ page: String(safePage - 1) })}
            >
              <ArrowLeft size={15} />
              Previous
            </button>
            <span>
              {safePage} of {totalPages}
              <small>
                Showing {(safePage - 1) * PAGE_SIZE + 1}-
                {Math.min(safePage * PAGE_SIZE, total)}
              </small>
            </span>
            <button
              className="secondary-button"
              disabled={safePage === totalPages}
              onClick={() => updateParams({ page: String(safePage + 1) })}
            >
              Next
              <ArrowRight size={15} />
            </button>
          </nav>
        </>
      ) : (
        <EmptyState
          title={searching ? "Searching the network" : "No people match this view"}
          message={
            searching
              ? "Nett is checking indexed people and relationship context."
              : "Clear the search or choose a different relationship filter."
          }
          action={
            !searching ? (
              <button
                className="secondary-button"
                onClick={() => setParams(new URLSearchParams(), { replace: true })}
              >
                Clear filters
              </button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
