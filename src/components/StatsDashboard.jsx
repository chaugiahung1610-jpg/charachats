// =============================================================================
// StatsDashboard.jsx
// Presentational only — App.jsx computes real numbers from `conversations`
// (message counts, conversation counts, earliest timestamp, etc.) and passes
// them in as `stats`. Dynamic rather than mocked, since this app already has
// real local chat history to draw from.
// =============================================================================
export default function StatsDashboard({ stats }) {
  const { totalMessages, totalConversations, activeHours, genesisLabel, perCharacter } = stats;
  const topCount = Math.max(1, ...perCharacter.map((row) => row.messageCount));

  const cards = [
    { icon: "💬", value: totalMessages.toLocaleString(), label: "Total Messages Sent" },
    { icon: "🧵", value: totalConversations.toLocaleString(), label: "Unique Chat Lifelines" },
    { icon: "⏱️", value: `${activeHours.toLocaleString()} hrs`, label: "Active Time Spent Together" },
    { icon: "🌱", value: genesisLabel, label: "First Conversation" },
  ];

  return (
    <div className="cc-stats cc-scroll">
      <h1 className="cc-discover__title">Your Statistics</h1>
      <p className="cc-discover__subtitle">A snapshot of your history across every character.</p>

      <div className="cc-stats__grid">
        {cards.map((card) => (
          <div key={card.label} className="cc-stat-card">
            <div className="cc-stat-card__icon">{card.icon}</div>
            <div className="cc-stat-card__value">{card.value}</div>
            <div className="cc-stat-card__label">{card.label}</div>
          </div>
        ))}
      </div>

      {perCharacter.length > 0 && (
        <section style={{ marginTop: 30 }}>
          <div className="cc-discover__category" style={{ marginTop: 0 }}>
            <h3>Messages by character</h3>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {perCharacter.map((row) => (
              <div key={row.character.id} className="cc-stat-card" style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ fontSize: 20 }}>{row.character.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}>
                    <span>{row.character.name}</span>
                    <span style={{ color: "var(--cc-text-secondary)", fontWeight: 500 }}>{row.messageCount.toLocaleString()} msgs</span>
                  </div>
                  <div className="cc-stats__bar-track">
                    <div className="cc-stats__bar-fill" style={{ width: `${Math.round((row.messageCount / topCount) * 100)}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
