import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AvatarGroup, AvatarItem } from "@/components/transitions/AvatarGroup";
import { Avatar } from "@/components/Primitives";
import { api, isAbortError } from "@/lib/api";
import type { Person } from "@/types";

const RECENT_LIMIT = 8;

/**
 * Overlapping recently-contacted avatars with Transitions.dev hover lift.
 */
export function PeopleRecentContacts({
  onOpen,
}: {
  onOpen: (id: string) => void;
}) {
  const [people, setPeople] = useState<Person[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    api
      .peoplePage({ recency: "30d", page: 1, limit: 24 }, controller.signal)
      .then((result) => {
        const sorted = [...result.people]
          .filter((person) => person.last_contact)
          .sort((a, b) => String(b.last_contact).localeCompare(String(a.last_contact)))
          .slice(0, RECENT_LIMIT);
        setPeople(sorted);
      })
      .catch((error) => {
        if (isAbortError(error)) return;
        setPeople([]);
      });
    return () => controller.abort();
  }, []);

  if (!people.length) return null;

  return (
    <section className="people-recent" aria-labelledby="people-recent-heading">
      <div className="people-recent-copy">
        <h2 id="people-recent-heading">Recently contacted</h2>
        <p>People with activity in the last 30 days.</p>
      </div>
      <AvatarGroup className="people-recent-avatars" label="Recently contacted people">
        {people.map((person) => (
          <AvatarItem key={person.id} className="people-recent-avatar">
            <Link
              to={`/people/${person.id}`}
              className="people-recent-link"
              title={person.name}
              aria-label={person.name}
              onClick={(event) => {
                // Keep deep-linkable URL; also support parent drawer openers.
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onOpen(person.id);
              }}
            >
              <Avatar person={person} size="md" />
            </Link>
          </AvatarItem>
        ))}
      </AvatarGroup>
      <Link className="people-recent-more" to="/people?recency=30d">
        Browse recent
      </Link>
    </section>
  );
}
