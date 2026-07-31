import {
  ArrowRight,
  Brain,
  Buildings,
  CalendarBlank,
  Clock,
  Database,
  MapPin,
  ShieldCheck,
  Users,
} from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { format, isValid, parseISO } from "date-fns";
import { useMemo, useState } from "react";
import { AskNett, personContext } from "@/components/AskNett";
import { NetworkField } from "@/components/NetworkField";
import {
  asList,
  Avatar,
  calendarDate,
  EmptyState,
  friendlyDate,
  isDue,
  isThisWeek,
  SourceBadge,
} from "@/components/Primitives";
import type { Overview, Person } from "@/types";

type QueueRange = "today" | "week";

function nextBirthday(person: Person) {
  if (!person.birthday) return null;
  const birthday = parseISO(person.birthday);
  if (!isValid(birthday)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let next = new Date(today.getFullYear(), birthday.getMonth(), birthday.getDate());
  if (next < today) {
    next = new Date(today.getFullYear() + 1, birthday.getMonth(), birthday.getDate());
  }
  return {
    person,
    next,
    days: Math.ceil((next.getTime() - today.getTime()) / 86_400_000),
  };
}

function missingFields(person: Person) {
  return [
    ["Location", person.location],
    ["Industry", person.industry],
    ["How you met", person.how_met],
    ["Interests", asList(person.interests).length],
    ["Contact method", asList(person.methods).length],
  ]
    .filter(([, value]) => !value)
    .map(([label]) => label as string);
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
  const reduced = useReducedMotion();
  const people = asList(overview.people);
  const [range, setRange] = useState<QueueRange>("today");

  const actionQueue = useMemo(() => {
    const explicit = people.filter((person) =>
      range === "today"
        ? isDue(person.follow_up_date)
        : isDue(person.follow_up_date) || isThisWeek(person.follow_up_date),
    );
    const fallback = [...people]
      .filter((person) => !explicit.some((item) => item.id === person.id))
      .filter((person) =>
        (person.priority || 0) > 0
        || (person.relationship_strength || 0) > 0
        || Boolean(person.quick_memories)
      )
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return [...explicit, ...fallback].slice(0, 7);
  }, [people, range]);

  const recent = useMemo(
    () =>
      [...people]
        .filter((person) => person.last_contact)
        .sort((a, b) =>
          String(b.last_contact).localeCompare(String(a.last_contact)),
        )
        .slice(0, 6),
    [people],
  );
  const drift = useMemo(
    () =>
      [...people]
        .filter((person) => {
          if (!person.last_contact) return false;
          const days = (Date.now() - Date.parse(person.last_contact)) / 86_400_000;
          return days > 75 && (person.relationship_strength || 0) >= 55;
        })
        .sort(
          (a, b) =>
            (b.relationship_strength || 0) - (a.relationship_strength || 0),
        )
        .slice(0, 5),
    [people],
  );
  const gaps = useMemo(
    () =>
      people
        .map((person) => ({ person, missing: missingFields(person) }))
        .filter(({ missing }) => missing.length)
        .sort((a, b) => b.missing.length - a.missing.length)
        .slice(0, 5),
    [people],
  );
  const birthdays = useMemo(
    () =>
      people
        .map(nextBirthday)
        .filter(
          (
            item,
          ): item is { person: Person; next: Date; days: number } => Boolean(item),
        )
        .filter((item) => item.days <= 45)
        .sort((a, b) => a.days - b.days)
        .slice(0, 5),
    [people],
  );
  const locations = asList(overview.locations).slice(0, 5);
  const institutions = useMemo(
    () =>
      Object.entries(
        people.reduce<Record<string, number>>((counts, person) => {
          asList(person.institutions).forEach((institution) => {
            counts[institution] = (counts[institution] || 0) + 1;
          });
          return counts;
        }, {}),
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    [people],
  );
  const averageWarmth = people.length
    ? Math.round(
        people.reduce((sum, person) => sum + (person.warmth || 0), 0) /
          people.length,
      )
    : 0;
  const queueDue = people.filter((person) => isDue(person.follow_up_date)).length;
  const queueWeek = people.filter((person) => isThisWeek(person.follow_up_date)).length;
  const topLocations = locations.map(([label]) => label).filter(Boolean).slice(0, 2);

  return (
    <motion.div
      className="dashboard relationship-console"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <section className="dashboard-heading">
        <div>
          <p className="section-kicker">{format(new Date(), "EEEE, MMMM d")}</p>
          <h1>Relationship desk</h1>
          <p className="heading-note">
            {queueDue
              ? `${queueDue} ${queueDue === 1 ? "follow-up needs" : "follow-ups need"} attention today.`
              : "No scheduled follow-ups are overdue."}{" "}
            {drift.length
              ? `${drift.length} valuable ${drift.length === 1 ? "tie is" : "ties are"} drifting.`
              : "No high-value ties are currently drifting."}
          </p>
        </div>
        <div className="local-seal">
          <ShieldCheck size={18} weight="duotone" />
          <span>
            <strong>Local intelligence</strong>
            Evidence remains on this device
          </span>
        </div>
      </section>

      <section className="action-window glass-panel" aria-labelledby="action-title">
        <header className="action-window-header">
          <div>
            <h2 id="action-title">What needs attention</h2>
            <p>Scheduled follow-ups first, then relationships with high priority.</p>
          </div>
          <div className="queue-switch" role="group" aria-label="Queue timeframe">
            <button
              className={range === "today" ? "is-active" : ""}
              onClick={() => setRange("today")}
              aria-pressed={range === "today"}
            >
              Today <span>{queueDue}</span>
            </button>
            <button
              className={range === "week" ? "is-active" : ""}
              onClick={() => setRange("week")}
              aria-pressed={range === "week"}
            >
              Next 7 days <span>{queueDue + queueWeek}</span>
            </button>
          </div>
        </header>
        {actionQueue.length ? (
          <div className="priority-list action-list">
            {actionQueue.map((person) => {
              const scheduled =
                isDue(person.follow_up_date) || isThisWeek(person.follow_up_date);
              return (
                <button
                  className="priority-row"
                  key={person.id}
                  onClick={() => onOpen(person.id)}
                >
                  <Avatar person={person} size="sm" />
                  <span className="priority-person">
                    <strong>{person.name}</strong>
                    <small>{personContext(person) || "Context not recorded"}</small>
                  </span>
                  <span className="priority-context">
                    {person.quick_memories ||
                      (scheduled
                        ? "Scheduled follow-up"
                        : "High-priority relationship")}
                  </span>
                  <span className={`follow-state ${isDue(person.follow_up_date) ? "is-due" : ""}`}>
                    <CalendarBlank size={14} />
                    {person.follow_up_date
                      ? calendarDate(person.follow_up_date, "Open")
                      : "Open"}
                  </span>
                  <ArrowRight size={16} className="row-arrow" />
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="Nothing is queued"
            message="Add a memory with a follow-up date to build an action queue."
            action={
              <button className="secondary-button" onClick={onCapture}>
                Add memory
              </button>
            }
          />
        )}
      </section>

      <section className="metric-ribbon" aria-label="Relationship health">
        <div>
          <span>People</span>
          <strong>{overview.total || people.length}</strong>
          <small>canonical profiles</small>
        </div>
        <div>
          <span>Warmth</span>
          <strong>{averageWarmth}</strong>
          <small>network average</small>
        </div>
        <div>
          <span>With context</span>
          <strong>
            {people.length
              ? Math.round(
                  (people.filter((person) => (person.memory_count || 0) > 0).length /
                    people.length) *
                    100,
                )
              : 0}
            %
          </strong>
          <small>memory coverage</small>
        </div>
        <div>
          <span>Top clusters</span>
          <strong>{topLocations.length || 0}</strong>
          <small>{topLocations.join(", ") || "none yet"}</small>
        </div>
      </section>

      <div className="dashboard-columns console-columns">
        <div className="console-main">
          <section className="recent-strip">
            <div className="section-heading">
              <div>
                <h2>Recent exchanges</h2>
                <p>Latest contact evidence across connected sources.</p>
              </div>
            </div>
            {recent.length ? (
              <div className="recent-grid">
                {recent.map((person) => (
                  <button key={person.id} onClick={() => onOpen(person.id)}>
                    <Avatar person={person} size="sm" />
                    <span>
                      <strong>{person.name}</strong>
                      <small>{friendlyDate(person.last_contact)}</small>
                    </span>
                    <SourceBadge
                      source={
                        asList(person.sources).includes("messages")
                          ? "messages"
                          : person.sources?.[0] || "nett"
                      }
                    />
                  </button>
                ))}
              </div>
            ) : (
              <div className="section-empty">
                <Clock size={22} />
                <p>Connect an interaction source or record a memory to see recent exchanges.</p>
              </div>
            )}
          </section>

          <section className="drift-section">
            <div className="section-heading">
              <div>
                <h2>Drift and cold ties</h2>
                <p>Strong relationships whose latest recorded contact is aging.</p>
              </div>
            </div>
            <div className="drift-list">
              {drift.length ? (
                drift.map((person) => (
                  <button key={person.id} onClick={() => onOpen(person.id)}>
                    <span>
                      <strong>{person.name}</strong>
                      <small>{personContext(person) || "Context incomplete"}</small>
                    </span>
                    <span>
                      <b>{person.relationship_strength || 0}</b>
                      <small>{friendlyDate(person.last_contact)}</small>
                    </span>
                    <ArrowRight size={15} />
                  </button>
                ))
              ) : (
                <p className="quiet-empty">No strong ties are currently in the drift window.</p>
              )}
            </div>
          </section>

          <section className="opportunity-grid" aria-label="Relationship opportunities">
            <article>
              <header>
                <CalendarBlank size={19} />
                <div>
                  <h2>Birthday moments</h2>
                  <p>Recorded birthdays in the next 45 days.</p>
                </div>
              </header>
              <div>
                {birthdays.length ? (
                  birthdays.map(({ person, next, days }) => (
                    <button key={person.id} onClick={() => onOpen(person.id)}>
                      <span>
                        <strong>{person.name}</strong>
                        <small>{format(next, "MMMM d")}</small>
                      </span>
                      <i>{days === 0 ? "Today" : `${days}d`}</i>
                    </button>
                  ))
                ) : (
                  <p>No upcoming birthdays are available from current sources.</p>
                )}
              </div>
            </article>
            <article>
              <header>
                <MapPin size={19} />
                <div>
                  <h2>Location opportunities</h2>
                  <p>Places with enough context for a focused outreach pass.</p>
                </div>
              </header>
              <div>
                {locations.length ? (
                  locations.map(([location, count]) => {
                    const person = people.find((item) => item.location === location);
                    return (
                      <button
                        key={location}
                        onClick={() => person && onOpen(person.id)}
                        disabled={!person}
                      >
                        <span>
                          <strong>{location}</strong>
                          <small>{count} {count === 1 ? "person" : "people"}</small>
                        </span>
                        <ArrowRight size={15} />
                      </button>
                    );
                  })
                ) : (
                  <p>Add profile locations to surface place-based opportunities.</p>
                )}
              </div>
            </article>
          </section>

          <section className="intelligence-spectrum">
            <div className="section-heading">
              <div>
                <h2>Knowledge and clusters</h2>
                <p>Incomplete profiles and shared relationship context.</p>
              </div>
            </div>
            <div className="spectrum-grid compact-spectrum">
              <article>
                <header>
                  <Brain size={18} />
                  <span>
                    <strong>Knowledge gaps</strong>
                    <small>Profiles worth enriching</small>
                  </span>
                </header>
                <div>
                  {gaps.map(({ person, missing }) => (
                    <button key={person.id} onClick={() => onOpen(person.id)}>
                      <span>
                        {person.name}
                        <small>{missing.slice(0, 2).join(", ")}</small>
                      </span>
                      <i>{missing.length}</i>
                    </button>
                  ))}
                  {!gaps.length && <p className="quiet-empty">No common profile gaps found.</p>}
                </div>
              </article>
              <article>
                <header>
                  <Buildings size={18} />
                  <span>
                    <strong>Shared institutions</strong>
                    <small>Affiliation density</small>
                  </span>
                </header>
                <div>
                  {institutions.map(([institution, count]) => (
                    <div key={institution}>
                      <span>{institution}</span>
                      <i>{count}</i>
                    </div>
                  ))}
                  {!institutions.length && <p className="quiet-empty">No institutions recorded.</p>}
                </div>
              </article>
              <article>
                <header>
                  <Users size={18} />
                  <span>
                    <strong>Industry clusters</strong>
                    <small>Current network concentration</small>
                  </span>
                </header>
                <div>
                  {asList(overview.industries)
                    .slice(0, 5)
                    .map(([industry, count]) => (
                      <div key={industry}>
                        <span>{industry}</span>
                        <i>{count}</i>
                      </div>
                    ))}
                  {!overview.industries?.length && (
                    <p className="quiet-empty">No industries recorded.</p>
                  )}
                </div>
              </article>
            </div>
          </section>
        </div>

        <aside className="signal-column console-aside">
          <AskNett overview={overview} onOpen={onOpen} />
          <section className="mini-network glass-panel">
            <div className="section-heading compact">
              <div>
                <h2>Relationship field</h2>
                <p>High-priority people in the current network.</p>
              </div>
            </div>
            <NetworkField
              people={[...people]
                .sort((a, b) => (b.priority || 0) - (a.priority || 0))
                .slice(0, 12)}
              onOpen={onOpen}
            />
          </section>
        </aside>
      </div>
    </motion.div>
  );
}
