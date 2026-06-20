// Shared avatar renderer. Uses an image when the character defines `avatar`
// (e.g. Elena, Kaelen, E.C.H.O), otherwise falls back to the emoji-in-a-circle
// look the app already uses everywhere (e.g. Alan, custom characters).
export default function Avatar({ character, size = 48, fontSize, style = {} }) {
  const computedFontSize = fontSize || Math.round(size * 0.48);

  if (character?.avatar) {
    return (
      <img
        src={character.avatar}
        alt={character.name}
        width={size}
        height={size}
        className="cc-avatar"
        style={{ width: size, height: size, background: `${character.color}33`, ...style }}
        loading="lazy"
      />
    );
  }

  return (
    <span
      className="cc-avatar"
      style={{
        width: size,
        height: size,
        fontSize: computedFontSize,
        background: `${character?.color || "#7C3AED"}33`,
        ...style,
      }}
    >
      {character?.emoji || "🌙"}
    </span>
  );
}
