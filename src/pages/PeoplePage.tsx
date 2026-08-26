import "@/styles/people.css";
import {
  ArrowLeft,
  ArrowRight,
  FunnelSimple,
  List,
  ListChecks,
  MagnifyingGlass,
  SquaresFour,
  SpinnerGap,
  Table,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { differenceInCalendarDays, isValid, parseISO } from "date-fns";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ActiveFilters,
  FACET_PARAMS,
  type FacetParam,
  type FacetValues,
  PeopleFilters,
} from "@/components/PeopleFilters";
import { FillGapsDialog } from "@/components/FillGapsDialog";
import { PeopleCards } from "@/components/PeopleCards";
import { PeopleRecentContacts } from "@/components/PeopleRecentContacts";
import { PeopleSheet } from "@/components/PeopleSheet";
import {
  asList,
  Avatar,
  calendarDate,
  EmptyState,
  friendlyDate,
} from "@/components/Primitives";
import { api, isAbortError, type PeopleFacets } from "@/lib/api";
import { MASS_FILL_FIELDS } from "@/lib/person-fields";
import type { Person } from "@/types";

const PAGE_SIZE = 50;
/** Long enough that a settled search never flashes a spinner, short enough that
 *  a genuinely slow request still explains itself. */
const SLOW_REQUEST_MS = 250;
/** Measured: /api/people/page answers a search in 11–31 ms against the real
 *  1,616-person database, so a short debounce keeps the whole keystroke-to-
 *  results path inside the 150 ms budget while still coalescing fast typing. */
const SEARCH_DEBOUNCE_MS = 70;

const filters = ["all", "strong", "due", "cold"] as const;
type Filter = (typeof filters)[number];

/** Narrow screens get the short label. Only one of the two is in the document,
 *  so the accessible name always matches what is on screen. */
const filterTabs: { value: Filter; short: string; long: string }[] = [
  { value: "all", short: "All", long: "All people" },
  { value: "strong", short: "Close", long: "Close ties" },
  { value: "due", short: "Saved", long: "Saved for later" },
  { value: "cold", short: "Quiet", long: "Quiet lately" },
];

const emptyFilterCopy: Record<Filter, string> = {
  all: "Nothing matches this combination. Remove a filter to widen the search.",
  strong:
    "No relationship strength has been recorded yet, so nobody qualifies as a close tie.",
  due: "Nobody is marked to revisit. People appear here once you save them for later.",
  cold: "Nobody in this view has been quiet lately.",
};

function isFilter(value: string | null): value is Filter {
  return filters.includes(value as Filter);
}

/** Compact, tabular age of the last contact. The column header and the
 *  screen-reader text carry the meaning; this is the scannable form. */
function compactAge(value: string) {
  const date = parseISO(value);
  if (!isValid(date)) return "";
  const days = differenceInCalendarDays(new Date(), date);
  if (days <= 0) return "today";
  if (days < 7) return `${days}d`;
  if (days < 31) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}

/** The most identifying facts Nett actually holds for this person, best first.
 *  Absent fields are omitted rather than announced. */
function personDetail(person: Person) {
  const parts: string[] = [];
  const push = (value?: string | null) => {
    const text = (value || "").trim();
    if (text && !parts.includes(text)) parts.push(text);
  };
  const relationship = (person.relationship || "").trim();
  push(relationship && relationship.charAt(0).toUpperCase() + relationship.slice(1));
  const role = [person.job_title, person.company].filter(Boolean).join(" at ");
  push(role || person.headline);
  push(asList(person.institutions)[0]);
  push(person.location || asList(person.hometown)[0]);
  push(person.industry);
  if (parts.length < 2) push(asList(person.languages).join(", "));
  return parts.slice(0, 3).join(" · ");
}

function personReach(person: Person) {
  const methods = asList(person.methods).filter((method) => method.value);
  const email = methods.find((method) => method.kind === "email");
  return (email || methods[0])?.value || "";
}

function Highlight({ text, term }: { text: string; term: string }) {
  if (!text) return null;
  if (term.length < 2) return <>{text}</>;
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + term.length)}</mark>
      {text.slice(index + term.length)}
    </>
  );
}

export function PeoplePage({ onOpen }: { onOpen: (id: string) => void }) {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") || "";
  const requestedFilter = params.get("filter");
  const filter: Filter = isFilter(requestedFilter) ? requestedFilter : "all";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const country = params.get("country") || "";
  const industry = params.get("industry") || "";
  const language = params.get("language") || "";
  const relationship = params.get("relationship") || "";
  const tag = params.get("tag") || "";
  const recency = params.get("recency") || "";
  const missing = params.get("missing") || "";
  const viewParam = params.get("view");
  const view =
    viewParam === "sheet" ? "sheet" : viewParam === "list" ? "list" : "cards";
  const facetValues: FacetValues = {
    recency,
    relationship,
    country,
    industry,
    language,
    tag,
    missing,
  };
  const activeFacetCount = FACET_PARAMS.filter((param) => facetValues[param]).length;

  const [draft, setDraft] = useState(query);
  const draftRef = useRef(query);
  const [rows, setRows] = useState<Person[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(true);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facets, setFacets] = useState<PeopleFacets | null>(null);
  const [refineOpen, setRefineOpen] = useState(activeFacetCount > 0);
  const [fillGapsOpen, setFillGapsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Array<HTMLElement | null>>([]);
  const facetsId = useId();
  const hintId = useId();
  const searchId = useId();

  const commit = useCallback(
    (updates: Record<string, string | null>) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          for (const [key, value] of Object.entries(updates)) {
            if (
              !value ||
              (key === "filter" && value === "all") ||
              (key === "page" && value === "1")
            ) {
              next.delete(key);
            } else {
              next.set(key, value);
            }
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // The input is never driven by the URL, so typing can never wait on a route
  // update. The URL catches up once typing pauses.
  useEffect(() => {
    if (query === draftRef.current) return;
    draftRef.current = query;
    setDraft(query);
  }, [query]);

  useEffect(() => {
    if (draft === query) return;
    const timeout = window.setTimeout(
      () => commit({ q: draft, page: null }),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [draft, query, commit]);

  useEffect(() => {
    const controller = new AbortController();
    setPending(true);
    api
      .peoplePage(
        {
          query: query.trim(),
          filter,
          country,
          industry,
          language,
          relationship,
          tag,
          recency,
          missing,
          page,
          limit: PAGE_SIZE,
        },
        controller.signal,
      )
      .then((result) => {
        setRows(asList(result.people));
        setTotal(result.total);
        setError(null);
        setLoaded(true);
        setPending(false);
      })
      .catch((reason) => {
        if (isAbortError(reason)) return;
        setRows([]);
        setTotal(0);
        setLoaded(true);
        setPending(false);
        setError(reason instanceof Error ? reason.message : "Search is unavailable");
      });
    return () => controller.abort();
  }, [
    query,
    filter,
    country,
    industry,
    language,
    relationship,
    tag,
    recency,
    missing,
    page,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    api
      .peopleFacets(
        { query: query.trim(), filter, country, industry, language, relationship, tag, recency, missing },
        controller.signal,
      )
      .then(setFacets)
      .catch((reason) => {
        if (!isAbortError(reason)) setFacets(null);
      });
    return () => controller.abort();
  }, [query, filter, country, industry, language, relationship, tag, recency, missing]);

  useEffect(() => {
    if (!pending) {
      setSlow(false);
      return;
    }
    const timeout = window.setTimeout(() => setSlow(true), SLOW_REQUEST_MS);
    return () => window.clearTimeout(timeout);
  }, [pending]);

  useEffect(() => {
    setActiveIndex(0);
  }, [rows]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(
          "input, textarea, select, [contenteditable='true'], [role='dialog']",
        )
      ) {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (loaded && page > totalPages) commit({ page: String(totalPages) });
  }, [loaded, page, totalPages, commit]);

  const focusRow = (index: number) => {
    if (!rows.length) return;
    const clamped = Math.max(0, Math.min(index, rows.length - 1));
    setActiveIndex(clamped);
    const row = rowRefs.current[clamped];
    row?.focus();
    row?.scrollIntoView({ block: "nearest" });
  };

  const onRowKeyDown = (event: ReactKeyboardEvent<HTMLElement>, index: number) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index === 0) searchRef.current?.focus();
      else focusRow(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusRow(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusRow(rows.length - 1);
    }
  };

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusRow(rows.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit({ q: draft, page: null });
    }
  };

  const toggleFacet = (param: FacetParam, value: string) => {
    commit({ [param]: facetValues[param] === value ? null : value, page: null });
  };

  const clearSearch = () => {
    setDraft("");
    draftRef.current = "";
    commit({ q: null, page: null });
    searchRef.current?.focus();
  };

  const clearAll = () => {
    setDraft("");
    draftRef.current = "";
    setParams(new URLSearchParams(), { replace: true });
  };

  const term = query.trim();
  const narrowed = Boolean(term) || filter !== "all" || activeFacetCount > 0;
  const rangeStart = total ? (safePage - 1) * PAGE_SIZE + 1 : 0;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, total);
  const status = !loaded
    ? "Loading people"
    : `${total.toLocaleString()} ${total === 1 ? "person" : "people"}${
        narrowed ? " match this view" : ""
      }${total > PAGE_SIZE ? ` · showing ${rangeStart}–${rangeEnd}` : ""}`;

  return (
    <div className="people-page">
      <section className="page-heading">
        <div>
          <h1>People</h1>
          <p>Find the person. Recover the context.</p>
        </div>
      </section>

      <PeopleRecentContacts onOpen={onOpen} />

      {fillGapsOpen && (
        <FillGapsDialog
          initialField={
            MASS_FILL_FIELDS.some((entry) => entry.key === missing) ? missing : undefined
          }
          onClose={() => setFillGapsOpen(false)}
          onApplied={() => {
            // Refresh the current page so accepted values leave the gap view.
            setPending(true);
            void (async () => {
              try {
                const pageResult = await api.peoplePage({
                  query: query.trim(),
                  filter,
                  country,
                  industry,
                  language,
                  relationship,
                  tag,
                  recency,
                  missing,
                  page: safePage,
                  limit: PAGE_SIZE,
                });
                setRows(pageResult.people);
                setTotal(pageResult.total);
              } catch {
                /* keep existing rows */
              } finally {
                setPending(false);
              }
            })();
          }}
        />
      )}

      <div className="people-toolbar">
        <div className="filter-search">
          {slow ? (
            <SpinnerGap size={20} className="spin" aria-hidden="true" />
          ) : (
            <MagnifyingGlass size={20} aria-hidden="true" />
          )}
          <label className="sr-only" htmlFor={searchId}>
            Search people, places, memories, and messages
          </label>
          <input
            id={searchId}
            ref={searchRef}
            value={draft}
            onChange={(event) => {
              draftRef.current = event.target.value;
              setDraft(event.target.value);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder="Who are you looking for?"
            type="search"
            autoComplete="off"
            aria-describedby={hintId}
          />
          {draft ? (
            <button
              type="button"
              className="icon-button search-clear"
              onClick={clearSearch}
              aria-label="Clear search"
            >
              <X size={15} aria-hidden="true" />
            </button>
          ) : (
            <kbd aria-hidden="true">/</kbd>
          )}
          <span className="sr-only" id={hintId}>
            Press slash to return here. Press the down arrow to step into the
            results, and Enter to open a person.
          </span>
        </div>
        <div className="people-view-actions" aria-label="People view">
          <button
            type="button"
            className="quiet-action"
            aria-pressed={view === "cards"}
            onClick={() => commit({ view: null, page: null })}
          >
            <SquaresFour size={17} aria-hidden="true" />
            Cards
          </button>
          <button
            type="button"
            className="quiet-action"
            aria-pressed={view === "list"}
            onClick={() => commit({ view: "list", page: null })}
          >
            <List size={17} aria-hidden="true" />
            List
          </button>
          <button
            type="button"
            className="quiet-action"
            aria-pressed={view === "sheet"}
            onClick={() => commit({ view: "sheet", page: null })}
          >
            <Table size={17} aria-hidden="true" />
            Sheet
          </button>
          <button
            type="button"
            className="quiet-action"
            onClick={() => setFillGapsOpen(true)}
          >
            <ListChecks size={17} aria-hidden="true" />
            Fill gaps
          </button>
        </div>
        <div className="filter-tabs" role="group" aria-label="Filter people">
          {filterTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={filter === tab.value ? "is-active" : ""}
              onClick={() => commit({ filter: tab.value, page: null })}
              aria-pressed={filter === tab.value}
            >
              <span className="tab-short">{tab.short}</span>
              <span className="tab-long">{tab.long}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="quiet-action people-refine"
          onClick={() => setRefineOpen((open) => !open)}
          aria-expanded={refineOpen}
          aria-controls={facetsId}
        >
          <FunnelSimple size={16} aria-hidden="true" />
          Refine
          {activeFacetCount > 0 && (
            <span className="refine-count">{activeFacetCount}</span>
          )}
        </button>
      </div>

      <PeopleFilters
        id={facetsId}
        hidden={!refineOpen}
        facets={facets}
        values={facetValues}
        onToggle={toggleFacet}
      />

      <ActiveFilters values={facetValues} onToggle={toggleFacet} onClear={clearAll} />

      <p className="people-result-status" aria-live="polite" aria-busy={pending}>
        {status}
      </p>

      {error && (
        <p className="inline-error" role="alert">
          <WarningCircle size={15} aria-hidden="true" />
          {error}
        </p>
      )}

      {!loaded ? (
        <div className="people-index">
          {view === "cards" ? (
            <ul className="people-cards" aria-hidden="true">
              {Array.from({ length: 8 }).map((_, index) => (
                <li key={index}>
                  <span className="people-cards-placeholder" />
                </li>
              ))}
            </ul>
          ) : (
            <ul className="people-list" aria-hidden="true">
              {Array.from({ length: 12 }).map((_, index) => (
                <li key={index}>
                  <span className="person-row is-placeholder">
                    <span />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : rows.length ? (
        <>
          {view === "sheet" ? (
            <PeopleSheet
              people={rows}
              onPatched={(updated) => {
                setRows((current) =>
                  current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)),
                );
              }}
            />
          ) : view === "cards" ? (
            <PeopleCards
              people={rows}
              activeIndex={activeIndex}
              onActiveIndex={setActiveIndex}
              rowRefs={rowRefs}
              onRowKeyDown={onRowKeyDown}
              term={term}
            />
          ) : (
            <div className="people-index">
              <div className="people-table-head" aria-hidden="true">
                <span>Person</span>
                <span>Email or phone</span>
                <span>Last contact</span>
                <span />
              </div>
              <ul className="people-list">
                {rows.map((person, index) => {
                  const detail = personDetail(person);
                  const reach = personReach(person);
                  const age = person.last_contact ? compactAge(person.last_contact) : "";
                  return (
                    <li key={person.id}>
                      <button
                        type="button"
                        className="person-row"
                        ref={(element) => {
                          rowRefs.current[index] = element;
                        }}
                        tabIndex={index === activeIndex ? 0 : -1}
                        onFocus={() => setActiveIndex(index)}
                        onKeyDown={(event) => onRowKeyDown(event, index)}
                        onClick={() => onOpen(person.id)}
                      >
                        <span className="person-cell">
                          <Avatar person={person} size="sm" />
                          <span>
                            <strong>
                              <Highlight text={person.name} term={term} />
                            </strong>
                            {detail && (
                              <small>
                                <Highlight text={detail} term={term} />
                              </small>
                            )}
                          </span>
                        </span>
                        <span className="person-reach">
                          <Highlight text={reach} term={term} />
                        </span>
                        <span className="person-last">
                          {age && person.last_contact && (
                            <time
                              dateTime={person.last_contact}
                              title={calendarDate(person.last_contact)}
                            >
                              <span aria-hidden="true">{age}</span>
                              <span className="sr-only">
                                Last contact {friendlyDate(person.last_contact)}
                              </span>
                            </time>
                          )}
                        </span>
                        <ArrowRight size={16} className="row-arrow" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {totalPages > 1 && (
            <nav className="people-pagination" aria-label="People pages">
              <button
                type="button"
                className="secondary-button"
                disabled={safePage === 1}
                onClick={() => commit({ page: String(safePage - 1) })}
              >
                <ArrowLeft size={15} aria-hidden="true" />
                Previous
              </button>
              <span>
                {safePage} of {totalPages}
                <small>
                  Showing {rangeStart}–{rangeEnd} of {total.toLocaleString()}
                </small>
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={safePage === totalPages}
                onClick={() => commit({ page: String(safePage + 1) })}
              >
                Next
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            </nav>
          )}
        </>
      ) : narrowed ? (
        <EmptyState
          title="Nobody matches this view"
          message={term ? `Nothing matches “${term}” here.` : emptyFilterCopy[filter]}
          action={
            <div className="people-empty-actions">
              {term && (
                <button type="button" className="secondary-button" onClick={clearSearch}>
                  Clear the search
                </button>
              )}
              <button type="button" className="primary-button" onClick={clearAll}>
                Clear every filter
              </button>
            </div>
          }
        />
      ) : (
        <EmptyState
          title="No people yet"
          message="Nett reads Apple Contacts and Messages locally, or imports a spreadsheet you own. Nothing leaves this Mac."
          action={
            <div className="people-empty-actions">
              <Link className="secondary-button" to="/settings/connectors">
                Connect a source
              </Link>
            </div>
          }
        />
      )}
    </div>
  );
}
