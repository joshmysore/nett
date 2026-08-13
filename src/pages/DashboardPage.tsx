import { ArrowRight, Tray, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AskNett, personContext } from "@/components/AskNett";
import { asList, Avatar, calendarDate, friendlyDate } from "@/components/Primitives";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { api, isAbortError } from "@/lib/api";
import type { Overview, Person } from "@/types";
import "@/styles/dashboard.css";

function FirstRun({ onCapture }: { onCapture: () => void }) {
  return (
    <div className="desk desk-first-run">
      <h1>Start with who you are, then your conversations</h1>
      <p className="desk-status">
        Nett keeps one SQLite file on this Mac. There is no account and nothing is sent
        anywhere unless you connect a source you already own.
      </p>
      <ol className="desk-start-steps">
        <li>
          <h2>Tell Nett a couple of hometowns and interests</h2>
          <p>
            Speak or type them. They stay yours. Nett uses them only as a prior when
            suggesting who might know each other.
          </p>
          <Link className="secondary-button" to="/setup">
            Open setup
          </Link>
        </li>
        <li>
          <h2>Connect Messages, WhatsApp, or Gmail</h2>
          <p>
            Read-only. People link by phone or email. Hometowns and interests are
            proposed later, never silently filled.
          </p>
          <Link className="secondary-button" to="/settings/connectors">
            Open sources
          </Link>
        </li>
        <li>
          <h2>Remember someone in a sentence</h2>
          <p>
            Plain language. Nett proposes the person and the fields it thinks it found,
            and waits for you to accept them.
          </p>
          <button className="secondary-button" onClick={onCapture}>
            Remember someone
          </button>
        </li>
      </ol>
    </div>
  );
}

function PeopleRows({
  people,
  onOpen,
  empty,
}: {
  people: Person[];
  onOpen: (id: string) => void;
  empty: string;
}) {
  if (!people.length) return <p className="desk-empty">{empty}</p>;
  return (
    <ul className="desk-people">
      {people.map((person) => (
        <li key={person.id}>
          <button
            className="desk-person spotlight-row"
            onClick={() => onOpen(person.id)}
            onMouseMove={(event) => {
              const target = event.currentTarget;
              const bounds = target.getBoundingClientRect();
              target.style.setProperty("--spot-x", `${event.clientX - bounds.left}px`);
              target.style.setProperty("--spot-y", `${event.clientY - bounds.top}px`);
            }}
          >
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
  const [review, setReview] = useState<{ merges: number; suggestions: number; total: number } | null>(
    null,
  );
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const total = overview.total;

  useEffect(() => {
    if (!total) return;
    const controller = new AbortController();
    setFailed(null);
    api
      .reviewCounts(controller.signal)
      .then(setReview)
      .catch((error) => {
        if (isAbortError(error)) return;
        setFailed(error instanceof Error ? error.message : "Review status is unavailable");
      });
    return () => controller.abort();
  }, [total, attempt]);

  if (!total) return <FirstRun onCapture={onCapture} />;

  const recent = asList(overview.people)
    .filter((person) => person.last_contact)
    .sort((a, b) => String(b.last_contact).localeCompare(String(a.last_contact)))
    .slice(0, 6);
  const savedForLater = asList(overview.duePeople).slice(0, 5);
  const remembered = asList(overview.people)
    .filter((person) => person.quick_memories || person.notes)
    .slice(0, 5);

  return (
    <div className="desk">
      <header className="desk-head">
        <h1>Home</h1>
        <p className="desk-status">
          What is worth remembering right now? Recently resurfaced people, new memories, and
          anything Nett cannot resolve alone.
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

      <section className="desk-search" aria-label="Ask or search Nett">
        <SpotlightCard className="desk-ask-spotlight" spotlightColor="91, 140, 255">
          <AskNett onOpen={onOpen} />
        </SpotlightCard>
      </section>

      <div className="home-grid">
        <div className="desk-primary">
          <section className="desk-section" aria-labelledby="recently-resurfaced">
            <h2 id="recently-resurfaced">Recently resurfaced</h2>
            <p className="desk-section-note">
              People connected to the latest activity Nett has indexed.
            </p>
            <PeopleRows
              people={recent}
              onOpen={onOpen}
              empty="Recent source activity will appear here."
            />
            <Link className="desk-more" to="/people?recency=30d">
              Browse recent people
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </section>

          <section className="desk-section" aria-labelledby="recent-memories">
            <h2 id="recent-memories">Recent memories</h2>
            <p className="desk-section-note">
              Context already attached to people in your local record.
            </p>
            <PeopleRows
              people={remembered}
              onOpen={onOpen}
              empty="Memories you record will stay connected to their people here."
            />
          </section>
        </div>

        <aside className="home-aside" aria-label="Nett continuity">
          <SpotlightCard className="home-signal-spotlight" spotlightColor="91, 140, 255">
            <section className="home-signal">
              <Tray size={18} aria-hidden="true" />
              <div>
                <h2>Needs your eye</h2>
                <p>Nett only asks when evidence cannot be resolved safely.</p>
              </div>
              {review?.total ? (
                <dl>
                  <div>
                    <dt>Identities to confirm</dt>
                    <dd>{review.merges}</dd>
                  </div>
                  <div>
                    <dt>Facts to review</dt>
                    <dd>{review.suggestions}</dd>
                  </div>
                </dl>
              ) : (
                <p className="quiet-empty">No unresolved evidence right now.</p>
              )}
              <Link className="desk-more" to="/review">
                Open Review
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </section>
          </SpotlightCard>

          {savedForLater.length > 0 && (
            <section className="desk-section" aria-labelledby="saved-later">
              <h2 id="saved-later">Saved for later</h2>
              <p className="desk-section-note">
                People you explicitly marked to revisit.
              </p>
              <PeopleRows people={savedForLater} onOpen={onOpen} empty="" />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
