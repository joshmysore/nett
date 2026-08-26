import { LandingGlassCta } from "@/components/LandingGlassCta";
import { LandingLockup } from "@/components/LandingLockup";
import { LANDING_TAGLINE, LANDING_TAGLINE_SUB, TaglineReveal } from "@/components/TaglineReveal";

const FAQ = [
  {
    q: "Does anything leave this Mac?",
    a: "No. Nett runs locally. There is no account, no cloud sync, and no telemetry. Optional enrichment is off until you turn it on and approve what leaves.",
  },
  {
    q: "How heavy is setup?",
    a: "Name yourself, then connect what you already have: Contacts, Messages, or a spreadsheet. Skip any step. Sources can be added later.",
  },
  {
    q: "Will it invent facts about people?",
    a: "No. Suggestions are reviewable. Every accepted fact points at stored evidence. Absence of evidence is not filled in.",
  },
  {
    q: "Is this a CRM?",
    a: "No. Nett is for recognition and retrieval: find the person, recover why they matter, keep the source. It is not a pipeline or a dashboard.",
  },
  {
    q: "What does Open Nett do?",
    a: "It opens Ask on this machine. From there you can find someone, remember a fact, or continue setup.",
  },
  {
    q: "What about Messages and Contacts?",
    a: "Those sources are read only. Nett never writes back to Apple Contacts or Messages.",
  },
] as const;

type LandingStoryProps = {
  titleAs: "h1" | "h2";
};

export function LandingStory({ titleAs }: LandingStoryProps) {
  return (
    <div className="landing-about" id="story">
      <section className="landing-tagline-section" aria-labelledby="landing-tagline">
        <TaglineReveal as={titleAs} id="landing-tagline" text={LANDING_TAGLINE} />
        <p className="landing-tagline-sub">{LANDING_TAGLINE_SUB}</p>
      </section>

      <div className="landing-hatch" aria-hidden="true" />

      <section className="landing-about-block" aria-labelledby="recognition-title">
        <h2 id="recognition-title">
          Recognition, <em>not</em> record keeping
        </h2>
        <p className="landing-section-copy">
          Ask in the language you remember. Nett follows names, places, messages, and
          notes back to the person you meant.
        </p>
        <RecognitionIndex />
      </section>

      <div className="landing-hatch" aria-hidden="true" />

      <section className="landing-about-block landing-faq-section" aria-labelledby="faq-title">
        <h2 id="faq-title">
          Questions before you <em>open</em> it
        </h2>
        <div className="landing-faq">
          {FAQ.map((item) => (
            <details key={item.q} className="landing-faq-item">
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <div className="landing-hatch" aria-hidden="true" />

      <section className="landing-about-close" aria-labelledby="close-title">
        <h2 id="close-title">
          Hold on to the <em>thread.</em>
        </h2>
        <p>
          Find the person. Recover the context. Keep the evidence that makes memory
          trustworthy.
        </p>
        <LandingGlassCta to="/today" primary />
      </section>

      <footer className="landing-footer">
        <p className="landing-footer-meta">
          <LandingLockup />
          <span>No account. Nothing leaves this Mac.</span>
        </p>
      </footer>
    </div>
  );
}

const EXAMPLES = [
  {
    name: "Julia Chen",
    detail: "Who was the researcher I met in Oxford working on algorithmic accountability?",
    meta: "3 messages",
  },
  {
    name: "Marcus Adeyemi",
    detail: "Who introduced me to the climate fund partner at that dinner in Lisbon?",
    meta: "5 messages",
  },
  {
    name: "Amina Farouk",
    detail: "What was the name of the product designer from Berlin who cared about craft?",
    meta: "2 notes",
  },
] as const;

function RecognitionIndex() {
  return (
    <ul className="landing-index">
      {EXAMPLES.map((item) => (
        <li key={item.name}>
          <span className="landing-index__mark" aria-hidden="true" />
          <p>
            {item.name} <span>{item.detail}</span>
          </p>
          <span className="landing-index__rule" aria-hidden="true" />
          <span className="landing-index__meta">{item.meta}</span>
        </li>
      ))}
    </ul>
  );
}
