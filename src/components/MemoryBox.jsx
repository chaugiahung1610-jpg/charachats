// =============================================================================
// MemoryBox.jsx
// Toggleable overlay shown above the chat viewport, listing milestones the
// Auto-Pin background check has flagged for the current conversation (see
// checkForPinnedMilestone in App.jsx).
// =============================================================================
export default function MemoryBox({ pinnedDetails, onClose }) {
  return (
    <div className="cc-memory-box cc-scroll">
      <div className="cc-memory-box__title">
        <span>📌 Character Memory</span>
        <button type="button" onClick={onClose} className="cc-text-button" style={{ marginLeft: "auto", background: "transparent", border: 0, color: "var(--cc-text-secondary)", cursor: "pointer" }}>
          Close
        </button>
      </div>

      {pinnedDetails.length === 0 ? (
        <p className="cc-memory-box__empty">Nothing pinned yet. Key facts get auto-saved here as your story unfolds.</p>
      ) : (
        pinnedDetails
          .slice()
          .reverse()
          .map((detail, index) => (
            <div key={index} className="cc-memory-box__item">
              {detail.text}
            </div>
          ))
      )}
    </div>
  );
}
