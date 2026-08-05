import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "nett.theme";
const isTheme = (value: unknown): value is ThemePreference =>
  value === "system" || value === "light" || value === "dark";

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/** Applied to <html> so the token layer resolves before first paint. */
export function applyThemePreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
}

export function resolvedTheme(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolvedTheme(readThemePreference()));

  useEffect(() => {
    applyThemePreference(preference);
    setResolved(resolvedTheme(preference));
    try {
      window.localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // A private window without storage still gets a working theme.
    }
  }, [preference]);

  useEffect(() => {
    if (preference !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setResolved(query.matches ? "dark" : "light");
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, [preference]);

  const cycle = useCallback(() => {
    setPreference((current) => (current === "system" ? "light" : current === "light" ? "dark" : "system"));
  }, []);

  return { preference, resolved, setPreference, cycle };
}
