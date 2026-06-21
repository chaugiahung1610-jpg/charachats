import { useEffect, useRef, useState } from "react";
import { normalizeCharacters, normalizeConversations, normalizeProfile } from "../App";

// =============================================================================
// useDeviceSync.js
// Cross-device sync for CharaChat. Talks to /api/sync (a Vercel serverless
// function backed by Redis) — see api/sync.mjs. Off by default: nothing is
// sent anywhere until the person explicitly enables it from Settings, since
// this is private chat data.
//
// Conflict handling is intentionally simple: last write wins, compared by
// server-assigned `updatedAt` timestamp. Good enough for "one person, two
// devices" - not a general multi-user merge system.
// =============================================================================

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L - easy to read & retype
const CODE_LENGTH = 8;
const PUSH_DEBOUNCE_MS = 2500;

function generateSyncCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function normalizeCodeInput(raw) {
  return (raw || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function useDeviceSync({
  conversations,
  setConversations,
  profile,
  setProfile,
  customCharacters,
  setCustomCharacters,
}) {
  const [syncCode, setSyncCode] = useState(() => localStorage.getItem("cc_sync_code") || "");
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | syncing | synced | error | not-found
  const [lastSyncedAt, setLastSyncedAt] = useState(() => Number(localStorage.getItem("cc_sync_last_at")) || 0);
  const [syncError, setSyncError] = useState("");

  const skipNextPushRef = useRef(false);
  const pushTimerRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    },
    [],
  );

  function applyRemotePayload(payload, updatedAt) {
    skipNextPushRef.current = true;
    if (payload.conversations) setConversations(normalizeConversations(payload.conversations));
    if (payload.profile) setProfile(normalizeProfile(payload.profile));
    if (payload.customCharacters) setCustomCharacters(normalizeCharacters(payload.customCharacters));
    setLastSyncedAt(updatedAt);
    localStorage.setItem("cc_sync_last_at", String(updatedAt));
  }

  async function pull(code) {
    setSyncStatus("syncing");
    setSyncError("");
    try {
      const res = await fetch(`/api/sync?code=${encodeURIComponent(code)}`);
      if (res.status === 404) {
        if (mountedRef.current) setSyncStatus("synced"); // nothing pushed under this code yet — that's fine
        return;
      }
      if (!res.ok) throw new Error(`Pull failed (${res.status})`);
      const { payload, updatedAt } = await res.json();
      if (!mountedRef.current) return;
      if (updatedAt > lastSyncedAt) applyRemotePayload(payload, updatedAt);
      setSyncStatus("synced");
    } catch (error) {
      console.warn("Sync pull failed:", error);
      if (mountedRef.current) {
        setSyncStatus("error");
        setSyncError("Couldn't reach sync server. Your local data is safe either way.");
      }
    }
  }

  async function push(code) {
    setSyncStatus("syncing");
    setSyncError("");
    try {
      const payload = { conversations, profile, customCharacters };
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, payload }),
      });
      if (!res.ok) throw new Error(`Push failed (${res.status})`);
      const { updatedAt } = await res.json();
      if (!mountedRef.current) return;
      setLastSyncedAt(updatedAt);
      localStorage.setItem("cc_sync_last_at", String(updatedAt));
      setSyncStatus("synced");
    } catch (error) {
      console.warn("Sync push failed:", error);
      if (mountedRef.current) {
        setSyncStatus("error");
        setSyncError("Couldn't reach sync server. Will retry on your next change.");
      }
    }
  }

  // Pull once whenever a sync code becomes active (covers both "loaded from
  // localStorage on app start" and "user just enabled/entered a code now").
  useEffect(() => {
    if (!syncCode) return;
    pull(syncCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncCode]);

  // Debounced push whenever synced data actually changes - skipped once
  // right after a pull, so we don't immediately echo back what we just received.
  useEffect(() => {
    if (!syncCode) return;
    if (skipNextPushRef.current) {
      skipNextPushRef.current = false;
      return;
    }
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    pushTimerRef.current = setTimeout(() => push(syncCode), PUSH_DEBOUNCE_MS);
    return () => clearTimeout(pushTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, profile, customCharacters, syncCode]);

  function enableNewCode() {
    const code = generateSyncCode();
    localStorage.setItem("cc_sync_code", code);
    setLastSyncedAt(0);
    localStorage.removeItem("cc_sync_last_at");
    setSyncCode(code);
  }

  function connectExistingCode(rawCode) {
    const code = normalizeCodeInput(rawCode);
    if (code.length < 6) {
      setSyncError("That code looks too short - double check it and try again.");
      return false;
    }
    localStorage.setItem("cc_sync_code", code);
    setLastSyncedAt(0);
    localStorage.removeItem("cc_sync_last_at");
    setSyncCode(code);
    return true;
  }

  function disableSync() {
    localStorage.removeItem("cc_sync_code");
    localStorage.removeItem("cc_sync_last_at");
    setSyncCode("");
    setSyncStatus("idle");
    setSyncError("");
  }

  function syncNow() {
    if (syncCode) push(syncCode);
  }

  return { syncCode, syncStatus, lastSyncedAt, syncError, enableNewCode, connectExistingCode, disableSync, syncNow };
}
