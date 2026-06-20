// =============================================================================
// MobileNav.jsx
// Fixed bottom tab bar. Only visible under 880px (see .cc-mobile-nav in
// styles/layout.css) — Sidebar.jsx handles the desktop layout above that.
// =============================================================================
export default function MobileNav({ view, onNavigate }) {
  const items = [
    { id: "discover", icon: "🧭", label: "Discover" },
    { id: "home", icon: "💬", label: "Chats" },
    { id: "createChar", icon: "➕", label: "Create" },
    { id: "stats", icon: "📊", label: "Stats" },
    { id: "profile", icon: "👤", label: "Profile" },
  ];

  return (
    <nav className="cc-mobile-nav">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onNavigate(item.id)}
          className={`cc-mobile-nav__item ${view === item.id ? "is-active" : ""}`}
        >
          <span className="cc-mobile-nav__item-icon">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </nav>
  );
}
