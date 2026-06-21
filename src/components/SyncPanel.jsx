import { useState } from "react";

// =============================================================================
// SyncPanel.jsx
// Drop-in section for the existing Settings view. Presentational only — all
// the actual push/pull logic lives in useDeviceSync.js; this just calls the
// functions it returns.
// =============================================================================

function timeAgo(timestamp) {
  if (!timestamp) return "";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const STATUS_LABEL = {
  idle: "Not enabled",
  syncing: "Syncing…",
  synced: "Synced",
  error: "Sync error",
};

export default function SyncPanel({ syncCode, syncStatus, lastSyncedAt, syncError, enableNewCode, connectExistingCode, disableSync, syncNow }) {
  const [codeInput, setCodeInput] = useState("");
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard?.writeText(syncCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function handleConnect() {
    if (connectExistingCode(codeInput)) setCodeInput("");
  }

  return (
    <section style={{ background: "var(--cc-bg-surface)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 18 }}>
      <h3 style={{ marginTop: 0 }}>Sync across devices</h3>

      {!syncCode ? (
        <>
          <p style={{ color: "var(--cc-text-secondary)", margin: "0 0 14px" }}>
            Off by default. Enabling this sends your chats to a private cloud store so you can pick them up on another device.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={enableNewCode} style={{ background: "linear-gradient(135deg, var(--cc-accent), var(--cc-accent-2))", color: "#fff", border: 0, borderRadius: 10, padding: "10px 14px", fontWeight: 700, cursor: "pointer" }}>
              Enable on this device
            </button>
          </div>

          <p style={{ color: "var(--cc-text-secondary)", fontSize: 13, margin: "16px 0 6px" }}>Already have a code from another device?</p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
              placeholder="Enter sync code"
              style={{ flex: 1, background: "var(--cc-bg-elevated)", color: "var(--cc-text-primary)", border: "1px solid var(--cc-border)", borderRadius: 10, padding: "10px 12px", font: "inherit", outline: "none" }}
            />
            <button type="button" onClick={handleConnect} disabled={!codeInput.trim()} style={{ background: "var(--cc-bg-hover)", color: "var(--cc-text-secondary)", border: "1px solid var(--cc-border)", borderRadius: 10, padding: "10px 14px", cursor: "pointer" }}>
              Connect
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ color: "var(--cc-text-secondary)", margin: "0 0 12px" }}>
            {STATUS_LABEL[syncStatus] || "Not enabled"}
            {syncStatus === "synced" && lastSyncedAt ? ` • ${timeAgo(lastSyncedAt)}` : ""}
          </p>

          <p style={{ color: "var(--cc-text-secondary)", fontSize: 13, margin: "0 0 6px" }}>Your sync code — enter this on your other device:</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{ flex: 1, background: "var(--cc-bg-elevated)", border: "1px solid var(--cc-border)", borderRadius: 10, padding: "10px 12px", fontSize: 18, letterSpacing: 2, fontWeight: 700 }}>
              {syncCode}
            </code>
            <button type="button" onClick={handleCopy} style={{ background: "var(--cc-bg-hover)", color: "var(--cc-text-secondary)", border: "1px solid var(--cc-border)", borderRadius: 10, padding: "10px 14px", cursor: "pointer" }}>
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>

          {syncError && <p style={{ color: "var(--cc-danger)", fontSize: 12.5, margin: "10px 0 0" }}>{syncError}</p>}

          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button type="button" onClick={syncNow} disabled={syncStatus === "syncing"} style={{ background: "var(--cc-bg-hover)", color: "var(--cc-text-secondary)", border: "1px solid var(--cc-border)", borderRadius: 10, padding: "8px 12px", cursor: "pointer" }}>
              Sync now
            </button>
            <button
              type="button"
              onClick={() => window.confirm("Turn off sync on this device? Your data stays on this device either way, and the code keeps working on other devices.") && disableSync()}
              style={{ background: "#f8717120", color: "#fca5a5", border: "1px solid #f87171", borderRadius: 10, padding: "8px 12px", cursor: "pointer" }}
            >
              Disable on this device
            </button>
          </div>

          <p style={{ color: "var(--cc-text-tertiary, var(--cc-text-secondary))", fontSize: 11.5, margin: "14px 0 0" }}>
            Keep this code private — anyone with it can read or overwrite your synced chats. Sync only works on the deployed app, not your local dev server.
          </p>
        </>
      )}
    </section>
  );
}
