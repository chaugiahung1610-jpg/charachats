// =============================================================================
// Sidebar.jsx
// Desktop-only left navigation. Hidden under 880px via the .cc-sidebar media
// query in styles/layout.css — MobileNav.jsx takes over below that width.
// =============================================================================
export default function Sidebar({ view, onNavigate, profile, onOpenProfile }) {
  const navItems = [
    { id: "discover", icon: "🧭", label: "Discover" },
    { id: "home", icon: "💬", label: "Chats" },
    { id: "createChar", icon: "➕", label: "Create" },
  ];

  return (
    <nav className="cc-sidebar">
      <div className="cc-sidebar__brand">
        <span className="cc-sidebar__brand-mark">✨</span>
        <span>CharaChat</span>
      </div>

      <div className="cc-sidebar__nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            className={`cc-nav-item ${item.id === "createChar" ? "cc-nav-item--create" : ""} ${view === item.id ? "is-active" : ""}`}
          >
            <span className="cc-nav-item__icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>

      <div className="cc-sidebar__footer">
        <button
          type="button"
          onClick={() => onNavigate("stats")}
          className={`cc-nav-item ${view === "stats" ? "is-active" : ""}`}
        >
          <span className="cc-nav-item__icon">📊</span>
          Statistics
        </button>

        <button type="button" onClick={onOpenProfile} className="cc-sidebar__profile">
          <span className="cc-avatar" style={{ width: 34, height: 34, fontSize: 17, background: "var(--cc-accent-soft)" }}>
            {profile.emoji}
          </span>
          <span className="cc-sidebar__profile-text">
            <strong>{profile.name || "My Profile"}</strong>
            <span>View profile</span>
          </span>
        </button>
      </div>
    </nav>
  );
}
