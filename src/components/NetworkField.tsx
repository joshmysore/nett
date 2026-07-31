import { Network } from "@phosphor-icons/react";
import type { Person } from "@/types";
import { asList, initials } from "@/components/Primitives";

const positions = [
  [50, 50],
  [25, 24],
  [72, 20],
  [82, 54],
  [66, 79],
  [33, 78],
  [12, 53],
  [45, 13],
  [91, 29],
  [88, 82],
  [8, 83],
  [20, 7],
];

export function NetworkField({
  people,
  onOpen,
  label = "Relationship map",
}: {
  people: Person[];
  onOpen: (id: string) => void;
  label?: string;
}) {
  const nodes = asList(people).slice(0, positions.length);
  return (
    <div className="network-field" aria-label={label}>
      <div className="field-orbit orbit-a" aria-hidden="true" />
      <div className="field-orbit orbit-b" aria-hidden="true" />
      {nodes.map((person, index) => (
        <button
          key={person.id}
          className={`network-node node-${index}`}
          style={{
            left: `${positions[index][0]}%`,
            top: `${positions[index][1]}%`,
          }}
          onClick={() => onOpen(person.id)}
          aria-label={`Open ${person.name}`}
          title={[person.name, person.company, person.location]
            .filter(Boolean)
            .join(", ")}
        >
          <span>{initials(person.name)}</span>
        </button>
      ))}
      <div className="field-caption">
        <Network size={15} />
        <span>{nodes.length ? `${nodes.length} visible relationships` : "No relationships to map"}</span>
      </div>
    </div>
  );
}
