import { useEffect } from "react";
import { Link } from "react-router-dom";
import { LandingGlassCta } from "@/components/LandingGlassCta";
import { RecognitionStickyCarousel } from "@/components/AboutRecognitionSticky";
import TextAnimation from "@/components/ui/scroll-text";
import "@/styles/landing.css";

function NettLockup() {
  return (
    <span className="landing-lockup">
      <img
        className="landing-crystal-mark"
        src="/brand/nett-crystal-n.png"
        alt=""
        width={40}
        height={40}
        decoding="async"
      />
      <span className="landing-wordmark">Nett</span>
    </span>
  );
}

export function AboutPage() {
  useEffect(() => {
    document.documentElement.classList.add("on-landing");
    document.body.classList.add("on-landing");
    return () => {
      queueMicrotask(() => {
        if (!document.querySelector(".nett-landing-only, .nett-about-page")) {
          document.documentElement.classList.remove("on-landing");
          document.body.classList.remove("on-landing");
        }
      });
    };
  }, []);

  return (
    <main className="nett-landing nett-about-page">
      <header className="about-topbar">
        <nav className="landing-nav" aria-label="About">
          <Link to="/" aria-label="Nett home">
            <NettLockup />
          </Link>
          <div className="landing-nav-links">
            <Link className="landing-nav-about" to="/">
              Home
            </Link>
            <LandingGlassCta to="/today" />
          </div>
        </nav>
      </header>

      <section className="landing-about" aria-labelledby="about-title">
        <div className="landing-about-intro">
          <p className="landing-about-kicker">About Nett</p>
          <TextAnimation
            as="h1"
            id="about-title"
            classname="about-scroll-title"
            text="A private relationship memory for one person on one Mac."
            direction="up"
            lineAnime
          />
          <p>
            Nett is for recognition and retrieval — find someone, understand why they
            matter, and keep the evidence that produced each fact. It is not a CRM.
          </p>
        </div>

        <div className="landing-about-block" aria-labelledby="recognition-title">
          <header className="landing-section-head">
            <TextAnimation
              as="h2"
              id="recognition-title"
              classname="about-scroll-heading"
              text="Recognition, not record keeping"
              direction="up"
            />
            <p>
              Ask in the language you remember. Nett follows names, places, messages, and
              notes back to the person you meant.
            </p>
          </header>
          <RecognitionStickyCarousel />
        </div>

        <div className="landing-about-block provenance-section" aria-labelledby="provenance-title">
          <div className="provenance-layout">
            <div className="provenance-statement">
              <TextAnimation
                as="h2"
                id="provenance-title"
                classname="about-scroll-heading"
                text="Nothing here is magic"
                direction="up"
              />
              <p>
                Every remembered fact points back to where it came from. Open the source,
                inspect the evidence, and decide what belongs in the record.
              </p>
            </div>
            <ol className="evidence-thread">
              <li>
                <time>Message · May 18</time>
                <strong>Algorithmic accountability in public services</strong>
                <p>The original exchange stays attached, unchanged.</p>
              </li>
              <li>
                <time>Calendar · May 18</time>
                <strong>Oxford Internet Institute</strong>
                <p>The meeting supplies time and place, not an invented story.</p>
              </li>
              <li>
                <time>Note · May 19</time>
                <strong>Follow up on public-sector AI research</strong>
                <p>Your own words remain distinct from imported evidence.</p>
              </li>
            </ol>
          </div>
        </div>

        <div className="landing-about-block local-section" aria-labelledby="local-title">
          <div className="local-layout">
            <div className="local-copy">
              <TextAnimation
                as="h2"
                id="local-title"
                classname="about-scroll-heading"
                text="Your relationships stay yours"
                direction="up"
              />
              <p>
                Nett reads permissioned sources into one local SQLite file. No account, no
                cloud sync, no telemetry.
              </p>
            </div>
            <div className="about-panel local-diagram" aria-label="Sources flow into Nett on your Mac">
              <div className="local-sources">
                {["Messages", "Contacts", "Calendar", "Notes"].map((source) => (
                  <div className="local-source" key={source}>
                    <strong>{source}</strong>
                    <small>Read only</small>
                  </div>
                ))}
              </div>
              <span className="local-lines" aria-hidden="true" />
              <div className="local-machine">
                <strong>Nett</strong>
                <span>
                  Your Mac
                  <br />
                  Local SQLite
                  <br />
                  Provenance intact
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="landing-about-close">
          <figure className="crystal-mark">
            <img
              src="/brand/nett-crystal-n-wide.png"
              alt=""
              width={1024}
              height={1024}
              loading="lazy"
              decoding="async"
            />
          </figure>
          <div className="crystal-copy">
            <TextAnimation
              as="h2"
              classname="about-scroll-heading"
              text="Hold on to the thread."
              direction="up"
              lineAnime
            />
            <p>
              Find the person. Recover the context. Keep the evidence that makes memory
              trustworthy.
            </p>
            <LandingGlassCta to="/today" primary />
          </div>
        </div>

        <footer className="landing-footer">
          <NettLockup />
          <span>Private relationship memory, on your Mac.</span>
        </footer>
      </section>
    </main>
  );
}
