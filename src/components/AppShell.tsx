import {
  Circle,
  Command,
  GearSix,
  House,
  MagnifyingGlass,
  Tray,
  Moon,
  Plus,
  SidebarSimple,
  Sun,
  Users,
  X,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { IconButton } from "@/components/Primitives";
import { api, isAbortError } from "@/lib/api";
import { useTheme } from "@/lib/theme";

const navigation = [
  { to: "/today", label: "Home", icon: House, end: true },
  { to: "/people", label: "People", icon: Users, end: false },
  { to: "/review", label: "Review", icon: Tray, end: false },
  { to: "/settings/connectors", label: "Sources", icon: GearSix, end: false },
];

export function AppShell({
  children,
  onSearch,
  onCapture,
}: {
  children: ReactNode;
  onSearch: () => void;
  onCapture: () => void;
}) {
  const [railOpen, setRailOpen] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const [freshLabel, setFreshLabel] = useState("Ready");
  const location = useLocation();
  const { preference, cycle } = useTheme();

  useEffect(() => {
    document.documentElement.classList.remove("on-landing");
    document.body.classList.remove("on-landing");
    document.documentElement.style.removeProperty("background");
  }, []);

  useEffect(() => setRailOpen(false), [location.pathname]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const [counts, freshness] = await Promise.all([
          api.reviewCounts(),
          api.freshness(),
        ]);
        if (cancelled) return;
        setReviewCount(counts.total);
        if (freshness.running) {
          setFreshLabel(`Syncing ${freshness.running}…`);
        } else {
          const stamps = Object.values(freshness.lastResults)
            .map((row) => row.at)
            .filter(Boolean)
            .sort()
            .at(-1);
          setFreshLabel(stamps ? `Updated ${relativeShort(stamps)}` : "Ready");
        }
      } catch (error) {
        if (!isAbortError(error) && !cancelled) setFreshLabel("Status unavailable");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [location.pathname]);

  const themeLabel = preference === "system"
    ? "Appearance: match system. Activate for light."
    : preference === "light"
      ? "Appearance: light. Activate for dark."
      : "Appearance: dark. Activate to match system.";
  const ThemeIcon = preference === "light" ? Sun : preference === "dark" ? Moon : Circle;

  return (
    <div className={`app-frame ${railOpen ? "rail-open" : ""}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      {railOpen && (
        <button
          className="rail-scrim"
          onClick={() => setRailOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className="side-rail" aria-label="Primary navigation">
        <NavLink className="brand-mark" to="/" title="Nett home">
          <svg className="brand-mark-glyph" viewBox="0 0 30 30" aria-hidden="true">
            <path d="M5 25V7.2C5 3.6 8.8 3.1 10.6 6.2L19.6 22.7C21.6 26.4 25 25.6 25 21.5V5" />
          </svg>
          <span>Nett</span>
        </NavLink>
        <nav className="rail-nav">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `rail-link ${isActive ? "is-active" : ""}`
              }
            >
              <Icon size={20} weight="regular" />
              <span>{label}</span>
              {label === "Review" && reviewCount > 0 && (
                <i className="nav-badge" aria-label={`${reviewCount} unresolved review items`} />
              )}
            </NavLink>
          ))}
        </nav>
        <div className="rail-bottom">
          <span className="local-status">
            <i aria-hidden="true" />
            <span>
              <strong>Local</strong>
              <small>{freshLabel}</small>
            </span>
          </span>
          <IconButton label={themeLabel} onClick={cycle}>
            <ThemeIcon size={18} weight={preference === "system" ? "duotone" : "regular"} />
          </IconButton>
          <IconButton
            label="Close navigation"
            className="rail-close"
            onClick={() => setRailOpen(false)}
          >
            <X size={19} />
          </IconButton>
        </div>
      </aside>

      <div className="workbench">
        <header className="top-bar">
          <button
            className="mobile-rail-toggle"
            onClick={() => setRailOpen((open) => !open)}
            aria-label="Open navigation"
            aria-expanded={railOpen}
          >
            <SidebarSimple size={21} />
          </button>
          <button className="global-search" onClick={onSearch}>
            <MagnifyingGlass size={17} />
            <span>Find a person or run a command</span>
            <kbd>
              <Command size={12} />K
            </kbd>
          </button>
          <div className="top-actions">
            <button className="capture-action" onClick={onCapture} aria-label="Remember relationship context">
              <Plus size={17} weight="bold" />
              <span>Remember</span>
            </button>
          </div>
        </header>
        <main className="page-stage" id="main-content">
          {children}
        </main>
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon size={20} />
              <span>{label}</span>
              {label === "Review" && reviewCount > 0 && (
                <i className="nav-badge" aria-label={`${reviewCount} unresolved review items`} />
              )}
            </NavLink>
          ))}
          <button onClick={onCapture}>
            <Plus size={20} />
            <span>Remember</span>
          </button>
        </nav>
      </div>
    </div>
  );
}

function relativeShort(iso: string) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 45_000) return "just now";
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))}m ago`;
  if (ms < 86_400_000) return `${Math.max(1, Math.round(ms / 3_600_000))}h ago`;
  return `${Math.max(1, Math.round(ms / 86_400_000))}d ago`;
}
