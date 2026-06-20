import { useTheme } from "../context/ThemeContext";

// =============================================================================
// ThemeSettingsPanel.jsx
// Drop-in section for the existing Settings view. Clicking a swatch calls
// setTheme(), which ThemeContext immediately reflects by writing new CSS
// custom properties onto :root — no reload needed.
// =============================================================================
export default function ThemeSettingsPanel() {
  const { themeKey, themes, setTheme } = useTheme();

  return (
    <section style={{ background: "var(--cc-bg-surface)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 18 }}>
      <h3 style={{ marginTop: 0 }}>Theme</h3>
      <p style={{ color: "var(--cc-text-secondary)", margin: "0 0 4px" }}>Pick the look of your whole app.</p>

      <div className="cc-theme-grid">
        {Object.entries(themes).map(([key, theme]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTheme(key)}
            className={`cc-theme-swatch-btn ${themeKey === key ? "is-active" : ""}`}
          >
            <div className="cc-theme-swatch-btn__dots">
              {theme.swatch.map((color, index) => (
                <span key={index} className="cc-theme-swatch-btn__dot" style={{ background: color }} />
              ))}
            </div>
            <div className="cc-theme-swatch-btn__label">{theme.label}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
