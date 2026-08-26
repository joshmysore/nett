import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { LandingGlassCta } from "@/components/LandingGlassCta";
import { LandingLockup } from "@/components/LandingLockup";
import { LandingParenLink } from "@/components/LandingParenLink";
import { LandingStory } from "@/components/LandingStory";
import { LandingConstruction } from "@/components/ui/landing-construction";
import "@/styles/landing.css";

export default function DigitalSerenity() {
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
    <main className="nett-landing nett-landing-only" data-stretchy-page>
      <a className="skip-link" href="#story">
        Skip to story
      </a>
      <div className="landing-shell">
        <section className="landing-hero" aria-labelledby="landing-title">
          <LandingConstruction />
          <div className="landing-nav">
            <Link to="/" aria-label="Nett home">
              <LandingLockup />
            </Link>
          </div>
          <h1 id="landing-title">
            Remember <em>everyone.</em>
            <span className="landing-hero-kicker">Find the person. Recover the context.</span>
          </h1>
          <p className="landing-hero-desc">Private. Local. Yours.</p>
          <nav className="landing-hero-links" aria-label="Landing">
            <LandingParenLink to="/about">About</LandingParenLink>
            <LandingGlassCta to="/today" />
          </nav>
        </section>
        <div className="landing-hatch" aria-hidden="true" />
        <LandingStory titleAs="h2" />
      </div>
    </main>
  );
}
