import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LandingGlassCta } from "@/components/LandingGlassCta";
import { TiltCard } from "@/components/transitions/TiltCard";
import { BackgroundPaths } from "@/components/ui/background-paths";
import "@/styles/landing.css";

type Ripple = { id: number; x: number; y: number };

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Whole-line fade — slow enough to read, never stuck invisible. */
function SoftLine({
  children,
  delay = 0,
  className = "",
  as: Comp = "p",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: "p" | "h1" | "div" | "span";
}) {
  return (
    <Comp
      className={`soft-line ${className}`.trim()}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </Comp>
  );
}

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

export default function DigitalSerenity() {
  const heroRef = useRef<HTMLElement>(null);
  const gridId = useId().replace(/:/g, "");
  const [reduceMotion] = useState(() =>
    typeof window !== "undefined" ? prefersReducedMotion() : false,
  );
  const [ripples, setRipples] = useState<Ripple[]>([]);

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

  useEffect(() => {
    if (reduceMotion) return;
    const nodes = document.querySelectorAll<HTMLElement>(".floating-element-animate");
    nodes.forEach((el, index) => {
      window.setTimeout(() => {
        el.style.animationPlayState = "running";
      }, 600 + index * 140);
    });
  }, [reduceMotion]);

  const spawnRipple = (event: React.MouseEvent<HTMLElement>) => {
    if (reduceMotion) return;
    const hero = heroRef.current;
    if (!hero) return;
    const bounds = hero.getBoundingClientRect();
    const ripple = {
      id: Date.now() + Math.random(),
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    setRipples((prev) => [...prev, ripple]);
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((entry) => entry.id !== ripple.id));
    }, 1000);
  };

  const stopNav = (event: React.MouseEvent) => event.stopPropagation();

  return (
    <main className={`nett-landing nett-landing-only${reduceMotion ? " reduce-motion" : ""}`}>
      <section
        ref={heroRef}
        className="landing-hero-serenity"
        aria-labelledby="landing-title"
        onClick={spawnRipple}
      >
        <div className="landing-paths-layer is-static">
          <BackgroundPaths />
        </div>

        <svg className="landing-grid is-static" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <pattern
              id={`grid-${gridId}`}
              width="60"
              height="60"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 60 0 L 0 0 0 60"
                fill="none"
                stroke="rgba(100, 116, 139, 0.1)"
                strokeWidth="0.5"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#grid-${gridId})`} />
          <line x1="0" y1="20%" x2="100%" y2="20%" className="grid-line" />
          <line x1="0" y1="80%" x2="100%" y2="80%" className="grid-line" />
          <line x1="20%" y1="0" x2="20%" y2="100%" className="grid-line" />
          <line x1="80%" y1="0" x2="80%" y2="100%" className="grid-line" />
        </svg>

        <div className="floating-element-animate" style={{ top: "25%", left: "15%", animationDelay: "0.5s" }} />
        <div className="floating-element-animate" style={{ top: "60%", left: "85%", animationDelay: "1s" }} />
        <div className="floating-element-animate" style={{ top: "40%", left: "10%", animationDelay: "1.5s" }} />
        <div className="floating-element-animate" style={{ top: "75%", left: "90%", animationDelay: "2s" }} />
        <div className="floating-element-animate" style={{ top: "18%", left: "72%", animationDelay: "1.2s" }} />
        <div className="floating-element-animate" style={{ top: "70%", left: "28%", animationDelay: "1.8s" }} />

        <div className="landing-hero-stack">
          <nav className="landing-nav" aria-label="Landing">
            <Link to="/" aria-label="Nett home" onClick={stopNav}>
              <NettLockup />
            </Link>
            <div className="landing-nav-links">
              <Link className="landing-nav-about" to="/about" onClick={stopNav}>
                About
              </Link>
              <LandingGlassCta to="/today" onClick={stopNav} />
            </div>
          </nav>

          <div className="landing-serenity-stage">
            <header className="landing-serenity-top">
              <SoftLine delay={80} className="landing-mono-line">
                Private. Local. Yours.
              </SoftLine>
              <div className="landing-rule-fade" aria-hidden="true" />
            </header>

            <div className="landing-serenity-center">
              <TiltCard className="landing-logo-tilt" maxTilt={8}>
                <div className="landing-brand-mark" aria-hidden="true">
                  <img
                    src="/brand/nett-crystal-n-wide.png"
                    alt=""
                    width={1024}
                    height={1024}
                    decoding="async"
                    fetchPriority="high"
                  />
                </div>
              </TiltCard>

              <h1 id="landing-title" className="landing-serenity-title">
                <SoftLine as="span" delay={320} className="landing-title-primary">
                  Remember everyone.
                </SoftLine>
                <SoftLine as="span" delay={620} className="landing-title-secondary">
                  Find the person. Recover the context.
                </SoftLine>
              </h1>
            </div>

            <footer className="landing-serenity-bottom">
              <div className="landing-rule-fade" aria-hidden="true" />
              <SoftLine delay={960} className="landing-mono-line">
                Ask. Remember. Find.
              </SoftLine>
              <SoftLine delay={1240} as="div" className="landing-cta-wrap">
                <LandingGlassCta to="/today" primary onClick={stopNav} />
              </SoftLine>
            </footer>
          </div>
        </div>

        {ripples.map((ripple) => (
          <div
            key={ripple.id}
            className="ripple-effect"
            style={{ left: `${ripple.x}px`, top: `${ripple.y}px` }}
          />
        ))}
      </section>
    </main>
  );
}
