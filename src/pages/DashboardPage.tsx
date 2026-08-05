import { ArrowRight, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AskNett, personContext } from "@/components/AskNett";
import { asList, Avatar, calendarDate, friendlyDate } from "@/components/Primitives";
import { api, isAbortError, type Facet, type PeopleFacets } from "@/lib/api";
import type { Overview } from "@/types";
import "@/styles/dashboard.css";

const numbers = new Intl.NumberFormat();
const count = (value: number) => numbers.format(value);
const plural = (value: number, one: string, many: string) => (value === 1 ? one : many);

/** A number the page is willing to show: it has a stored definition, a real
 *  count, and a list that reproduces it. */
type Aggregate = {
  key: string;
  label: string;
  definition: string;
  value: number | null;
  to: string;
};

const facetValue = (facets: Facet[] | undefined, value: string) =>
  facets?.find((entry) => entry.value === value)?.count ?? 0;

const facetTotal = (facets: Facet[] | undefined) =>
  (facets || []).reduce((total, entry) => total + entry.count, 0);

function share(value: number, total: number) {
  if (!total) return null;
  const percent = (value / total) * 100;
  if (percent > 0 && percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

function AggregateList({
  aggregates,
  total,
  pending,
}: {
  aggregates: Aggregate[];
  total: number;
  pending: string;
}) {
  return (
    <ul className="desk-aggregates">
      {aggregates.map((aggregate) => {
        const proportion = aggregate.value === null ? null : share(aggregate.value, total);
        return (
          <li key={aggregate.key}>
            <Link className="desk-aggregate" to={aggregate.to}>
              <span className="desk-aggregate-label">{aggregate.label}</span>
              <span className="desk-aggregate-value">
                {aggregate.value === null ? "--" : count(aggregate.value)}
              </span>
              <span className="desk-aggregate-definition">{aggregate.definition}</span>
              <span className="desk-aggregate-share">
                {proportion ? `${proportion} of ${count(total)}` : pending}
              </span>
              <span className="desk-bar" aria-hidden="true">
                <i
                  style={{
                    width:
                      aggregate.value && total
                        ? `${Math.max((aggregate.value / total) * 100, 0.5)}%`
                        : "0%",
                  }}
                />
              </span>
              <ArrowRight className="desk-aggregate-go" size={15} aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function RecordedValues({
  title,
  note,
  facets,
  href,
  empty,
}: {
  title: string;
  note: string;
  facets: Facet[] | undefined;
  href: (value: string) => string;
  empty: string;
}) {
  const visible = (facets || []).slice(0, 6);
  const remaining = (facets || []).length - visible.length;
  return (
    <div className="desk-recorded-group">
      <h3>{title}</h3>
      <p>{facets && !facets.length ? empty : note}</p>
      <ul>
        {visible.map((entry) => (
          <li key={entry.value}>
            <Link to={href(entry.value)}>
              <span>{entry.value}</span>
              <b>{count(entry.count)}</b>
            </Link>
          </li>
        ))}
      </ul>
      {remaining > 0 && (
        <p className="desk-recorded-more">
          {count(remaining)} further {plural(remaining, "value", "values")} recorded.
        </p>
      )}
    </div>
  );
}

function FirstRun({ onCapture }: { onCapture: () => void }) {
  return (
    <div className="desk desk-first-run">
      <h1>Nothing has been imported yet</h1>
      <p className="desk-status">
        Nett keeps one SQLite file on this Mac. There is no account and nothing is sent
        anywhere. Three ways to start:
      </p>
      <ol className="desk-start-steps">
        <li>
          <h2>Read your Apple Contacts</h2>
          <p>
            Read-only. Nett copies names and contact methods into its own database and
            records where each value came from.
          </p>
          <Link className="secondary-button" to="/settings/connectors">
            Open connectors
          </Link>
        </li>
        <li>
          <h2>Import a spreadsheet you already keep</h2>
          <p>
            A CSV of people, one row each. Every raw row is kept so an import can be
            traced or repeated without creating duplicates.
          </p>
          <Link className="secondary-button" to="/settings/connectors">
            Import a file
          </Link>
        </li>
        <li>
          <h2>Write down one thing you remember</h2>
          <p>
            Plain language. Nett proposes the person and the fields it thinks it found,
            and waits for you to accept them.
          </p>
          <button className="secondary-button" onClick={onCapture}>
            Remember someone
          </button>
        </li>
      </ol>
      <p className="desk-note">
        Guided setup is still available at <Link to="/setup">/setup</Link>.
      </p>
    </div>
  );
}

export function DashboardPage({
  overview,
  onOpen,
  onCapture,
}: {
  overview: Overview;
  onOpen: (id: string) => void;
  onCapture: () => void;
}) {
  const [facets, setFacets] = useState<PeopleFacets | null>(null);
  const [withoutContext, setWithoutContext] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const total = overview.total;

  useEffect(() => {
    if (!total) return;
    const controller = new AbortController();
    setFailed(null);
    Promise.all([
      api.peopleFacets({}, controller.signal),
      api.peoplePage({ missing: "context", page: 1, limit: 1 }, controller.signal),
    ])
      .then(([nextFacets, contextGap]) => {
        setFacets(nextFacets);
        setWithoutContext(contextGap.total);
      })
      .catch((error) => {
        if (isAbortError(error)) return;
        setFailed(error instanceof Error ? error.message : "Counts are unavailable");
      });
    return () => controller.abort();
  }, [total, attempt]);

  if (!total) return <FirstRun onCapture={onCapture} />;

  const stale = asList(overview.coldPeople).slice(0, 6);

  const contact: Aggregate[] = [
    {
      key: "recent",
      label: "Contacted in the last 30 days",
      definition: "Most recent recorded interaction is 30 days old or less.",
      value: facets ? facetValue(facets.recency, "30d") : null,
      to: "/people?recency=30d",
    },
    {
      key: "due",
      label: "Follow-up due",
      definition: "A follow-up date is set for today or earlier.",
      value: overview.due,
      to: "/people?filter=due",
    },
    {
      key: "cold",
      label: "Going quiet",
      definition: "An interaction is recorded, but the most recent one is over 90 days old.",
      value: overview.cold,
      to: "/people?filter=cold",
    },
    {
      key: "never",
      label: "No contact ever recorded",
      definition: "No message, call, or interaction from any connected source.",
      value: facets ? facetValue(facets.recency, "never") : null,
      to: "/people?recency=never",
    },
  ];

  const gaps: Aggregate[] = [
    {
      key: "context",
      label: "Nothing about the relationship",
      definition: "No relationship label, no note, and no memory written down.",
      value: withoutContext,
      to: "/people?missing=context",
    },
    {
      key: "industry",
      label: "No industry",
      definition: "The industry field is empty.",
      value: facets ? facetValue(facets.missing, "industry") : null,
      to: "/people?missing=industry",
    },
    {
      key: "location",
      label: "No location",
      definition: "The location field is empty.",
      value: facets ? facetValue(facets.missing, "location") : null,
      to: "/people?missing=location",
    },
    {
      key: "company",
      label: "No company",
      definition: "The company field is empty.",
      value: facets ? facetValue(facets.missing, "company") : null,
      to: "/people?missing=company",
    },
    {
      key: "tags",
      label: "No categories",
      definition: "No tags or categories have been recorded yet.",
      value: facets ? facetValue(facets.missing, "tags") : null,
      to: "/people?missing=tags",
    },
  ];

  const pending = failed ? "Unavailable" : "Counting";
  const recordedNote = (values: Facet[] | undefined, subject: string) =>
    values
      ? `${count(facetTotal(values))} of ${count(total)} people have ${subject}.`
      : `${pending}.`;

  return (
    <div className="desk">
      <header className="desk-head">
        <h1>Today</h1>
        <p className="desk-status">
          {count(total)} people in this local database.{" "}
          {overview.due
            ? `${count(overview.due)} ${plural(overview.due, "follow-up is", "follow-ups are")} due today or earlier.`
            : "No follow-up is due."}{" "}
          {overview.cold
            ? `${count(overview.cold)} ${plural(overview.cold, "person has", "people have")} no recorded contact in over 90 days.`
            : "No recorded relationship has been quiet for more than 90 days."}
        </p>
      </header>

      {failed && (
        <p className="inline-error" role="alert">
          <WarningCircle size={15} aria-hidden="true" />
          {failed}
          <button className="text-button" onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </button>
        </p>
      )}

      <div className="desk-columns">
        <div className="desk-primary">
          <section className="desk-section" aria-labelledby="desk-contact">
            <h2 id="desk-contact">Contact</h2>
            <p className="desk-section-note">
              Counted across all {count(total)} people. Last contact is the most recent
              message, call, or interaction stored from a connected source. Open a count to
              see exactly who it contains.
            </p>
            <AggregateList aggregates={contact} total={total} pending={pending} />
          </section>

          <section className="desk-section" aria-labelledby="desk-quiet">
            <h2 id="desk-quiet">Longest without contact</h2>
            <p className="desk-section-note">
              People whose most recent recorded contact is over 90 days old, oldest first.
            </p>
            {stale.length ? (
              <>
                <ul className="desk-people">
                  {stale.map((person) => (
                    <li key={person.id}>
                      <button className="desk-person" onClick={() => onOpen(person.id)}>
                        <Avatar person={person} size="sm" />
                        <span className="desk-person-name">{person.name}</span>
                        <span className="desk-person-context">
                          {person.quick_memories || personContext(person) || "No context recorded"}
                        </span>
                        <span className="desk-person-when">
                          <b>{calendarDate(person.last_contact)}</b>
                          <small>{friendlyDate(person.last_contact)}</small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <Link className="desk-more" to="/people?filter=cold">
                  All {count(overview.cold)} people who have gone quiet
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </>
            ) : (
              <p className="desk-empty">
                Every person with a recorded interaction has been contacted in the last 90
                days.
              </p>
            )}
          </section>

          <section className="desk-section" aria-labelledby="desk-gaps">
            <h2 id="desk-gaps">What Nett does not know</h2>
            <p className="desk-section-note">
              Empty fields across all {count(total)} people. Nett will not guess them: each
              one has to arrive from a source or from you. These lists are where an
              afternoon of filling in goes furthest.
            </p>
            <AggregateList aggregates={gaps} total={total} pending={pending} />
          </section>

          <section className="desk-section" aria-labelledby="desk-recorded">
            <h2 id="desk-recorded">What is recorded</h2>
            <p className="desk-section-note">
              Only values that actually occur are listed. Nothing here is inferred, and
              there is no bucket for the people a field is empty for.
            </p>
            <div className="desk-recorded">
              <RecordedValues
                title="Relationship"
                note={recordedNote(facets?.relationships, "a relationship recorded")}
                facets={facets?.relationships}
                href={(value) => `/people?relationship=${encodeURIComponent(value)}`}
                empty="No relationship has been recorded yet."
              />
              <RecordedValues
                title="Language"
                note="Counted once per language, so a person can appear in more than one row."
                facets={facets?.languages}
                href={(value) => `/people?language=${encodeURIComponent(value)}`}
                empty="No languages have been recorded yet."
              />
              <RecordedValues
                title="Country"
                note={`Read from the end of the recorded location text. ${recordedNote(
                  facets?.countries,
                  "a location that names one",
                )}`}
                facets={facets?.countries}
                href={(value) => `/people?country=${encodeURIComponent(value)}`}
                empty="No location names a country yet."
              />
              <RecordedValues
                title="Industry"
                note={recordedNote(facets?.industries, "an industry recorded")}
                facets={facets?.industries}
                href={(value) => `/people?industry=${encodeURIComponent(value)}`}
                empty="No industry has been recorded yet."
              />
            </div>
          </section>
        </div>

        <aside className="desk-aside" aria-label="Ask Nett">
          <AskNett onOpen={onOpen} />
        </aside>
      </div>
    </div>
  );
}
