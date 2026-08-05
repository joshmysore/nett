import {
  Circle,
  Command,
  FileCsv,
  GearSix,
  House,
  MagnifyingGlass,
  Moon,
  Network,
  Plus,
  SidebarSimple,
  Sun,
  Users,
  X,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { IconButton } from "@/components/Primitives";
import { useTheme } from "@/lib/theme";

const navigation = [
  { to: "/", label: "Today", icon: House, end: true },
  { to: "/people", label: "People", icon: Users, end: false },
  { to: "/settings/connectors", label: "Settings", icon: GearSix, end: false },
];

export function AppShell({
  children,
  onSearch,
  onCapture,
  onImport,
}: {
  children: ReactNode;
  onSearch: () => void;
  onCapture: () => void;
  onImport: () => void;
}) {
  const [railOpen, setRailOpen] = useState(false);
  const location = useLocation();
  const { preference, cycle } = useTheme();

  useEffect(() => setRailOpen(false), [location.pathname]);

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
        <NavLink className="brand-mark" to="/" title="Nett">
          <Network size={24} weight="duotone" />
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
              title={label}
            >
              <Icon size={20} weight="regular" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="rail-bottom">
          <span className="privacy-label">Local</span>
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
            <span>Search people, places, and memories</span>
            <kbd>
              <Command size={12} />K
            </kbd>
          </button>
          <div className="top-actions">
            <button className="quiet-action desktop-only" onClick={onImport}>
              <FileCsv size={17} />
              Import
            </button>
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
