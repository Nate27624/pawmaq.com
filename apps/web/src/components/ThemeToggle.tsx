import type { ThemeMode } from "../types";

interface ThemeToggleProps {
  mode: ThemeMode;
  onToggle: () => void;
}

export function ThemeToggle({ mode, onToggle }: ThemeToggleProps) {
  return (
    <button className="theme-toggle" onClick={onToggle} type="button" aria-label="Toggle color mode">
      <span>{mode === "dark" ? "Dark" : "Light"}</span>
      <span className="theme-toggle__icon">{mode === "dark" ? "Moon" : "Sun"}</span>
    </button>
  );
}
