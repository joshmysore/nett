import type { PersonHit } from "@/lib/ask-display";

function StreamingWords({ text, live }: { text: string; live: boolean }) {
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((part, index) =>
        part.trim() ? (
          <span key={`${index}:${part}`} className={live ? "ask-word" : undefined}>
            {part}
          </span>
        ) : (
          <span key={`s${index}`}>{part}</span>
        ),
      )}
    </>
  );
}

function Inline({
  text,
  people,
  live,
  onOpen,
}: {
  text: string;
  people: PersonHit[];
  live: boolean;
  onOpen: (id: string) => void;
}) {
  type Piece =
    | { type: "text"; value: string }
    | { type: "strong"; value: string }
    | { type: "link"; label: string; href: string }
    | { type: "cite"; person: PersonHit; index: number };
  const pieces: Piece[] = [];
  const pattern = /(\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)]+)\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) pieces.push({ type: "text", value: text.slice(cursor, match.index) });
    if (match[2]) pieces.push({ type: "strong", value: match[2] });
    else if (match[3] && match[4]) pieces.push({ type: "link", label: match[3], href: match[4] });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) pieces.push({ type: "text", value: text.slice(cursor) });
  if (!pieces.length) pieces.push({ type: "text", value: text });

  const withCites: Piece[] = [];
  const used = new Set<string>();
  for (const piece of pieces) {
    if (piece.type !== "text" && piece.type !== "strong") {
      withCites.push(piece);
      continue;
    }
    let remaining = piece.value;
    const kind = piece.type;
    while (remaining) {
      const found = people
        .map((person, index) => ({
          person,
          index,
          at: remaining.toLocaleLowerCase().indexOf(person.name.toLocaleLowerCase()),
        }))
        .filter((item) => item.at >= 0 && !used.has(item.person.personId))
        .sort((a, b) => a.at - b.at)[0];
      if (!found) {
        withCites.push({ type: kind, value: remaining });
        break;
      }
      if (found.at > 0) withCites.push({ type: kind, value: remaining.slice(0, found.at) });
      withCites.push({ type: kind, value: remaining.slice(found.at, found.at + found.person.name.length) });
      withCites.push({ type: "cite", person: found.person, index: found.index });
      used.add(found.person.personId);
      remaining = remaining.slice(found.at + found.person.name.length);
    }
  }

  return (
    <>
      {withCites.map((piece, i) => {
        if (piece.type === "cite") {
          return (
            <button
              key={`c${i}`}
              type="button"
              className="ask-cite"
              onClick={() => onOpen(piece.person.personId)}
              aria-label={`Open ${piece.person.name}`}
            >
              {piece.index + 1}
            </button>
          );
        }
        if (piece.type === "link") {
          return (
            <a key={`l${i}`} href={piece.href} target="_blank" rel="noreferrer">
              {piece.label}
            </a>
          );
        }
        const node = <StreamingWords text={piece.value} live={live} />;
        return piece.type === "strong" ? <strong key={`s${i}`}>{node}</strong> : <span key={`t${i}`}>{node}</span>;
      })}
    </>
  );
}

function blocks(text: string): Array<{ type: "heading" | "list" | "ordered" | "paragraph"; lines: string[] }> {
  const chunks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return chunks.filter(Boolean).map((chunk) => {
    const lines = chunk.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim());
    if (lines.every((line) => /^#{1,3}\s+/.test(line)) && lines.length === 1) {
      return { type: "heading" as const, lines };
    }
    if (lines.length > 0 && lines.every((line) => /^[-*]\s+/.test(line))) {
      return { type: "list" as const, lines };
    }
    if (lines.length > 0 && lines.every((line) => /^\d+\.\s+/.test(line))) {
      return { type: "ordered" as const, lines };
    }
    return { type: "paragraph" as const, lines };
  });
}

export function AskMarkdown({
  text,
  people,
  live,
  onOpen,
}: {
  text: string;
  people: PersonHit[];
  live: boolean;
  onOpen: (id: string) => void;
}) {
  const parsed = blocks(text.trim());
  if (!parsed.length) return null;
  return (
    <div className="ask-markdown">
      {parsed.map((block, index) => {
        if (block.type === "heading") {
          const label = block.lines[0].replace(/^#{1,3}\s+/, "");
          return (
            <h3 key={index}>
              <Inline text={label} people={people} live={live} onOpen={onOpen} />
            </h3>
          );
        }
        if (block.type === "list") {
          return (
            <ul key={index}>
              {block.lines.map((line, lineIndex) => (
                <li key={lineIndex}>
                  <Inline text={line.replace(/^[-*]\s+/, "")} people={people} live={live} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === "ordered") {
          return (
            <ol key={index}>
              {block.lines.map((line, lineIndex) => (
                <li key={lineIndex}>
                  <Inline text={line.replace(/^\d+\.\s+/, "")} people={people} live={live} onOpen={onOpen} />
                </li>
              ))}
            </ol>
          );
        }
        return (
          <p key={index} className="ask-prose">
            <Inline text={block.lines.join(" ")} people={people} live={live} onOpen={onOpen} />
          </p>
        );
      })}
    </div>
  );
}
