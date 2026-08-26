import {
  CaretLeft,
  Circle,
  Command,
  Moon,
  Plus,
  SidebarSimple,
  Sun,
  X,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { IconButton } from "@/components/Primitives";
import { api, isAbortError } from "@/lib/api";
import { useTheme } from "@/lib/theme";

const ITEMS = [
  { key: "ask", to: "/today", label: "Ask", end: true },
  { key: "review", to: "/review", label: "Review", count: true, end: true },
  { key: "people", to: "/people", label: "People", plus: true, end: false },
  { key: "sources", to: "/settings/connectors", label: "Sources", end: false },
] as const;

const RAIL_COLLAPSED_KEY = "nett.railCollapsed";

function readRailCollapsed() {
  try {
    return localStorage.getItem(RAIL_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function NavIcon({ kind }: { kind: string }) {
  const paths: Record<string, ReactNode> = {
    ask: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
    review: (
      <g>
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </g>
    ),
    people: (
      <g>
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
      </g>
    ),
    sources: (
      <g>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </g>
    ),
  };
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[kind]}
    </svg>
  );
}

function itemKeyFromPath(pathname: string) {
  if (pathname === "/today" || pathname === "/") return "ask";
  if (pathname.startsWith("/review")) return "review";
  if (pathname.startsWith("/people")) return "people";
  if (pathname.startsWith("/settings") || pathname.startsWith("/connectors") || pathname.startsWith("/sources")) {
    return "sources";
  }
  return "ask";
}

export function AppShell({
  children,
  onSearch,
  onCapture,
  ownerName,
}: {
  children: ReactNode;
  onSearch: () => void;
  onCapture: () => void;
  ownerName?: string | null;
}) {
  const [railOpen, setRailOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(readRailCollapsed);
  const [reviewCount, setReviewCount] = useState(0);
  const [freshLabel, setFreshLabel] = useState("Ready");
  const [hovered, setHovered] = useState<string | null>(null);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const location = useLocation();
  const { preference, cycle } = useTheme();
  const active = itemKeyFromPath(location.pathname);
  const askHome = location.pathname === "/today";
  const workspaceName = ownerName?.trim() || "Nett";
  const workspaceInitial = workspaceName.slice(0, 1).toLocaleUpperCase();

  useEffect(() => {
    document.documentElement.classList.remove("on-landing");
    document.body.classList.remove("on-landing");
    document.documentElement.style.removeProperty("background");
  }, []);

  useEffect(() => setRailOpen(false), [location.pathname]);

  useLayoutEffect(() => {
    const container = navRef.current;
    const target = itemRefs.current[hovered ?? active];
    if (!container || !target) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    setBox({
      top: targetRect.top - containerRect.top,
      height: targetRect.height,
    });
  }, [hovered, active, reviewCount, railOpen, railCollapsed]);

  const toggleRailCollapsed = () => {
    setRailCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        localStorage.setItem(RAIL_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Ignore storage failures; in-memory toggle still applies.
      }
      return next;
    });
  };

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
    <div className={`app-frame ${railOpen ? "rail-open" : ""} ${railCollapsed ? "rail-collapsed" : ""} ${askHome ? "is-ask-home" : ""}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      {railOpen && (
        <button
          className="rail-scrim"
          onClick={() => setRailOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className="side-rail" aria-label="Primary navigation">
        <NavLink className="workspace-switch" to="/today" title="Ask">
          <span className="workspace-mark" aria-hidden="true">{workspaceInitial}</span>
          <span className="workspace-copy">
            <span className="workspace-name">{workspaceName}</span>
            <span className="workspace-meta">On this Mac</span>
          </span>
        </NavLink>

        <button
          type="button"
          className="rail-search"
          onClick={onSearch}
          aria-label="Find a person or command"
          aria-keyshortcuts="Meta+K Control+K Slash"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <span>Quick search</span>
          <kbd>
            <Command size={10} />K
          </kbd>
        </button>

        <button
          type="button"
          className="rail-remember"
          onClick={onCapture}
          aria-label="Remember — turn a sentence into fields on a person"
          aria-keyshortcuts="Meta+M Control+M"
        >
          <span>Remember</span>
          <span className="rail-remember-plus" aria-hidden="true">
            <Plus size={10} weight="bold" />
          </span>
        </button>

        <nav
          className="rail-nav"
          id="primary-rail-nav"
          ref={navRef}
          onMouseLeave={() => setHovered(null)}
        >
          <span
            aria-hidden
            className="rail-glide"
            style={{
              top: box?.top ?? 0,
              height: box?.height ?? 0,
              opacity: box ? 1 : 0,
            }}
          />
          <div className="rail-section-items">
            {ITEMS.map((item) => (
              <div
                key={item.key}
                className="rail-row"
                onMouseEnter={() => setHovered(item.key)}
                onMouseLeave={() => setHovered(null)}
              >
                <NavLink
                  to={item.to}
                  end={item.end}
                  ref={(el) => {
                    itemRefs.current[item.key] = el;
                  }}
                  className={({ isActive }) => `rail-link ${isActive ? "is-active" : ""}`}
                  onFocus={() => setHovered(item.key)}
                  onBlur={() => setHovered(null)}
                  aria-current={item.key === active ? "page" : undefined}
                  title={railCollapsed ? item.label : undefined}
                >
                  <span className="rail-link-icon">
                    <NavIcon kind={item.key} />
                  </span>
                  <span className="rail-link-label">{item.label}</span>
                  {"count" in item && item.count && reviewCount > 0 && (
                    <span
                      className="rail-count"
                      aria-label={`${reviewCount} unresolved review items`}
                    >
                      {reviewCount > 99 ? "99+" : reviewCount}
                    </span>
                  )}
                </NavLink>
                {"plus" in item && item.plus && (
                  <button
                    type="button"
                    className="rail-plus"
                    aria-label="Remember someone"
                    onClick={onCapture}
                  >
                    <Plus size={10} weight="bold" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </nav>

        <div className="rail-bottom">
          <button
            type="button"
            className="rail-collapse-toggle"
            onClick={toggleRailCollapsed}
            aria-expanded={!railCollapsed}
            aria-controls="primary-rail-nav"
            aria-label={railCollapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {railCollapsed ? <SidebarSimple size={18} aria-hidden="true" /> : <CaretLeft size={16} aria-hidden="true" />}
            <span className="rail-collapse-label">{railCollapsed ? "Expand" : "Collapse"}</span>
          </button>
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
          <button
            className="global-search"
            onClick={onSearch}
            aria-label="Find a person or command"
            aria-keyshortcuts="Meta+K Control+K"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <span>Find a person or command</span>
            <kbd>
              <Command size={12} />K
            </kbd>
          </button>
          <div className="top-actions">
            <button
              className="capture-action"
              onClick={onCapture}
              aria-label="Remember — turn a sentence into fields on a person"
              aria-keyshortcuts="Meta+M Control+M"
            >
              <Plus size={17} weight="bold" />
              <span>Remember</span>
              <kbd className="desktop-only">
                <Command size={12} />M
              </kbd>
            </button>
          </div>
        </header>
        <main className="page-stage" id="main-content">
          {children}
        </main>
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <NavIcon kind={item.key} />
              <span>{item.label}</span>
              {"count" in item && item.count && reviewCount > 0 && (
                <i className="nav-badge" aria-label={`${reviewCount} unresolved review items`} />
              )}
            </NavLink>
          ))}
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
