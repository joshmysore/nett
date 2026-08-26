import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { LandingGlassCta } from "@/components/LandingGlassCta";
import { LandingLockup } from "@/components/LandingLockup";
import { LandingStory } from "@/components/LandingStory";
import { LandingConstruction } from "@/components/ui/landing-construction";
import "@/styles/landing.css";

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
    <main className="nett-landing nett-about-page" data-stretchy-page>
      <a className="skip-link" href="#story">
        Skip to story
      </a>
      <div className="landing-shell">
        <header className="landing-hero landing-hero--compact">
          <LandingConstruction />
          <nav className="landing-nav" aria-label="About">
            <Link to="/" aria-label="Nett home">
              <LandingLockup />
            </Link>
            <div className="landing-hero-links">
              <LandingGlassCta to="/today" />
            </div>
          </nav>
        </header>
        <LandingStory titleAs="h1" />
      </div>
    </main>
  );
}
