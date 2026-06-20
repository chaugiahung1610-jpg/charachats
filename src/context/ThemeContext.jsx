import { createContext, useContext, useEffect, useMemo, useState } from "react";

// =============================================================================
// ThemeContext.jsx
// Global theme system. Each theme is a flat map of CSS custom properties that
// get written onto :root (document.documentElement) whenever the active theme
// changes. Components never hardcode colors for themable surfaces — they read
// `var(--cc-...)` instead, so switching themes is just swapping the variable
// values, no re-render of the whole tree required.
// =============================================================================

export const THEMES = {
  "classic-dark-slate": {
    label: "Classic Dark Slate",
    swatch: ["#0f1115", "#7C3AED", "#5B8DD9"],
    vars: {
      "--cc-bg-canvas": "#0f1115",
      "--cc-bg-surface": "#181923",
      "--cc-bg-elevated": "#1d1f2d",
      "--cc-bg-hover": "#22243299",
      "--cc-border": "#2a2a38",
      "--cc-text-primary": "#f8fafc",
      "--cc-text-secondary": "#8b8ca3",
      "--cc-text-tertiary": "#5d5e72",
      "--cc-accent": "#7C3AED",
      "--cc-accent-2": "#3b82f6",
      "--cc-accent-soft": "#7C3AED22",
      "--cc-bubble-user-bg": "#5B8DD9",
      "--cc-bubble-user-text": "#ffffff",
      "--cc-bubble-assistant-bg": "#1d1f2d",
      "--cc-bubble-assistant-text": "#e8e6f0",
      "--cc-danger": "#f87171",
      "--cc-success": "#34d399",
      "--cc-shadow": "0 16px 40px #00000066",
    },
  },
  "cyberpunk-neon": {
    label: "Cyberpunk Neon",
    swatch: ["#05060a", "#ff2e88", "#22d3ee"],
    vars: {
      "--cc-bg-canvas": "#05060a",
      "--cc-bg-surface": "#0c0f1a",
      "--cc-bg-elevated": "#11162a",
      "--cc-bg-hover": "#1c2440",
      "--cc-border": "#22315c",
      "--cc-text-primary": "#eafcff",
      "--cc-text-secondary": "#7dd3fc",
      "--cc-text-tertiary": "#3f6f8c",
      "--cc-accent": "#ff2e88",
      "--cc-accent-2": "#22d3ee",
      "--cc-accent-soft": "#ff2e8822",
      "--cc-bubble-user-bg": "#ff2e88",
      "--cc-bubble-user-text": "#0a0610",
      "--cc-bubble-assistant-bg": "#11162a",
      "--cc-bubble-assistant-text": "#b9f4ff",
      "--cc-danger": "#ff5c7a",
      "--cc-success": "#39ffb0",
      "--cc-shadow": "0 0 32px #ff2e8833, 0 0 60px #22d3ee22",
    },
  },
  "midnight-purple": {
    label: "Midnight Purple",
    swatch: ["#120f1f", "#a855f7", "#6366f1"],
    vars: {
      "--cc-bg-canvas": "#120f1f",
      "--cc-bg-surface": "#1b1730",
      "--cc-bg-elevated": "#221c3d",
      "--cc-bg-hover": "#2a2349",
      "--cc-border": "#34294f",
      "--cc-text-primary": "#f2eaff",
      "--cc-text-secondary": "#b3a3d9",
      "--cc-text-tertiary": "#766a96",
      "--cc-accent": "#a855f7",
      "--cc-accent-2": "#6366f1",
      "--cc-accent-soft": "#a855f722",
      "--cc-bubble-user-bg": "#8b5cf6",
      "--cc-bubble-user-text": "#ffffff",
      "--cc-bubble-assistant-bg": "#221c3d",
      "--cc-bubble-assistant-text": "#ece4ff",
      "--cc-danger": "#f87171",
      "--cc-success": "#4ade80",
      "--cc-shadow": "0 16px 40px #00000066",
    },
  },
  "light-minimalist": {
    label: "Light Minimalist",
    swatch: ["#f7f7f5", "#2563eb", "#18181b"],
    vars: {
      "--cc-bg-canvas": "#f7f7f5",
      "--cc-bg-surface": "#ffffff",
      "--cc-bg-elevated": "#f1f1ee",
      "--cc-bg-hover": "#ececea",
      "--cc-border": "#e2e2dd",
      "--cc-text-primary": "#18181b",
      "--cc-text-secondary": "#5f5f5a",
      "--cc-text-tertiary": "#94948c",
      "--cc-accent": "#2563eb",
      "--cc-accent-2": "#7c3aed",
      "--cc-accent-soft": "#2563eb18",
      "--cc-bubble-user-bg": "#2563eb",
      "--cc-bubble-user-text": "#ffffff",
      "--cc-bubble-assistant-bg": "#ffffff",
      "--cc-bubble-assistant-text": "#18181b",
      "--cc-danger": "#dc2626",
      "--cc-success": "#16a34a",
      "--cc-shadow": "0 10px 30px #0000000f",
    },
  },
};

const DEFAULT_THEME = "classic-dark-slate";
const STORAGE_KEY = "cc_theme";

const ThemeContext = createContext(null);

function applyThemeVars(vars) {
  const root = document.documentElement.style;
  for (const [key, value] of Object.entries(vars)) {
    root.setProperty(key, value);
  }
}

export function ThemeProvider({ children }) {
  const [themeKey, setThemeKey] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved && THEMES[saved] ? saved : DEFAULT_THEME;
  });

  useEffect(() => {
    applyThemeVars(THEMES[themeKey].vars);
    localStorage.setItem(STORAGE_KEY, themeKey);
  }, [themeKey]);

  const value = useMemo(
    () => ({
      themeKey,
      theme: THEMES[themeKey],
      themes: THEMES,
      setTheme: (key) => {
        if (THEMES[key]) setThemeKey(key);
      },
    }),
    [themeKey],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside a ThemeProvider");
  return context;
}