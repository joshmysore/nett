import { LiquidGlassCard } from "@/components/ui/liquid-glass";

type RecognitionCard = {
  id: string;
  query: string;
  name: string;
  context: string;
  whyLabel: string;
  why: string;
  evidence: string;
  counts: string[];
};

const CARDS: RecognitionCard[] = [
  {
    id: "julia",
    query:
      "Who was the researcher I met in Oxford who was working on algorithmic accountability?",
    name: "Julia Chen",
    context: "Oxford Internet Institute · met May 18, 2025",
    whyLabel: "Why you remember her",
    why: "Discussed algorithmic accountability, STS, and public-sector AI.",
    evidence: "Every line stays connected to the records that produced it.",
    counts: ["3 messages", "1 calendar event", "2 notes"],
  },
  {
    id: "marcus",
    query: "Who introduced me to the climate fund partner at that dinner in Lisbon?",
    name: "Marcus Adeyemi",
    context: "Climate Path Partners · dinner June 3, 2025",
    whyLabel: "Why you remember him",
    why: "Sat between you and the GP; walked you through their thesis on adaptation capital.",
    evidence: "Messages, calendar, and your note stay linked to the same person.",
    counts: ["5 messages", "1 calendar event", "1 note"],
  },
  {
    id: "amina",
    query: "What was the name of the product designer from Berlin who cared about craft?",
    name: "Amina Farouk",
    context: "Independent · Berlin · introduced April 2024",
    whyLabel: "Why you remember her",
    why: "Talked about slowing interfaces down so people notice what matters.",
    evidence: "Imported contacts and your own words remain distinct and inspectable.",
    counts: ["2 messages", "1 note", "1 contact"],
  },
];

function PersonCard({ card }: { card: RecognitionCard }) {
  return (
    <article className="recognition-answer">
      <h3>{card.name}</h3>
      <p>{card.context}</p>
      <dl className="recognition-facts">
        <div>
          <dt>{card.whyLabel}</dt>
          <dd>{card.why}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>{card.evidence}</dd>
        </div>
      </dl>
      <div className="recognition-evidence">
        {card.counts.map((count) => (
          <span key={count}>{count}</span>
        ))}
      </div>
    </article>
  );
}

export function RecognitionStickyCarousel() {
  return (
    <ol className="recognition-sticky-stack">
      {CARDS.map((card) => (
        <li key={card.id} className="recognition-sticky-item">
          <div className="recognition-demo recognition-sticky-pair">
            <div className="recognition-query">
              <p>“{card.query}”</p>
              <small>Example retrieval · local index</small>
            </div>
            <LiquidGlassCard
              className="recognition-glass"
              blurIntensity="lg"
              glowIntensity="xs"
              shadowIntensity="sm"
              borderRadius="var(--panel-radius, 16px)"
            >
              <PersonCard card={card} />
            </LiquidGlassCard>
          </div>
        </li>
      ))}
    </ol>
  );
}
