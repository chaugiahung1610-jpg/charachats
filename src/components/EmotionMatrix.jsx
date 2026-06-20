// =============================================================================
// EmotionMatrix.jsx
// Read-only horizontal "sliders" (really progress bars) showing the
// character's current emotion state. Fed by `activeEmotionState`, which
// App.jsx updates whenever a ||EMOTION_MATRIX:{...}|| block is parsed out of
// a reply (see parseEmotionMatrix in App.jsx).
// =============================================================================
const EMOTION_COLORS = {
  Trust: "#3b82f6",
  Happiness: "#fbbf24",
  Anger: "#ef4444",
  Affection: "#ec4899",
};

export default function EmotionMatrix({ emotions, compact = false }) {
  const entries = Object.entries(emotions);

  return (
    <div className="cc-emotion-matrix">
      {entries.map(([label, value]) => (
        <div key={label} className="cc-emotion-row">
          {!compact && (
            <div className="cc-emotion-row__top">
              <span>{label}</span>
              <span>{value}</span>
            </div>
          )}
          <div className="cc-emotion-bar-track" style={{ height: compact ? 4 : 6 }} title={`${label}: ${value}`}>
            <div
              className="cc-emotion-bar-fill"
              style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: EMOTION_COLORS[label] || "var(--cc-accent)" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
