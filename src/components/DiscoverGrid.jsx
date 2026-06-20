// =============================================================================
// DiscoverGrid.jsx
// Categorized feed of character cards (avatar, name, tagline, quick-chat CTA),
// grouped under headers like "Time Travel" / "Dark Fantasy" / "Sci-Fi".
// Characters without a `category` (e.g. user-made characters) fall under
// "Originals" so nothing silently disappears from Discover.
// =============================================================================
import Avatar from "./Avatar";

function groupByCategory(characters) {
  const groups = new Map();
  for (const char of characters) {
    const key = char.category || "Originals";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(char);
  }
  return groups;
}

export default function DiscoverGrid({ characters, onOpenCharacter }) {
  const groups = groupByCategory(characters);

  return (
    <div className="cc-discover cc-scroll">
      <div className="cc-discover__hero">
        <h1 className="cc-discover__title">Discover</h1>
        <p className="cc-discover__subtitle">Find a character to talk to, by world and vibe.</p>
      </div>

      {[...groups.entries()].map(([category, items]) => (
        <section key={category}>
          <div className="cc-discover__category">
            <h3>{category}</h3>
          </div>
          <div className="cc-discover__grid">
            {items.map((char) => (
              <article key={char.id} className="cc-character-card" onClick={() => onOpenCharacter(char)}>
                <div className="cc-character-card__top">
                  <Avatar character={char} size={44} />
                  <span className="cc-character-card__name">{char.name}</span>
                </div>
                <p className="cc-character-card__tagline">{char.tagline || "Ready to chat"}</p>
                <button
                  type="button"
                  className="cc-character-card__cta"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenCharacter(char);
                  }}
                >
                  Quick chat
                </button>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
