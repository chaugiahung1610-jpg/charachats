import { useEffect, useMemo, useRef, useState } from "react";
import { ALAN } from "./characters";
import {
  apiErrorMessage,
  callCharacter,
  geminiMode,
  geminiSetupMessage,
  summarizeMessages,
} from "./services/gemini";

const WINDOW_SIZE = 20;
const COMPRESS_AT = 25;
const RATE_LIMIT_MS = 1500;
const MAX_FEEDBACK = 5;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const COLORS = ["#5B8DD9", "#7C3AED", "#0EA5E9", "#F59E0B", "#10B981", "#EF4444", "#EC4899"];
const EMOJIS = ["🧒", "🌙", "🤖", "👨‍🍳", "🧙", "🦊", "🐉", "👾", "🦁", "🌺", "⚔️", "🎭"];
const PROFILE_EMOJIS = ["👤", "😊", "😎", "🌟", "🦋", "🐱", "🦊", "🌸", "⚡", "🎭", "👑", "🌙", "🎮", "🐻", "🌺", "✨"];

const emptyProfile = { name: "", emoji: "👤", description: "" };
const emptyCharacter = {
  name: "",
  emoji: "🌙",
  color: "#7C3AED",
  tagline: "",
  personality: "",
  openingMsg: "",
};

function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    console.warn(`Could not read ${key} from localStorage`, error);
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function uid() {
  return `c${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeIntro(char) {
  return {
    role: "assistant",
    content: char.openingMsg || `*${char.name} waves.* "Hey!"`,
    time: Date.now(),
  };
}

function newConversation(char, firstMessage = "") {
  return {
    id: uid(),
    title: firstMessage ? firstMessage.split("\n")[0].slice(0, 50) : "New conversation",
    messages: [makeIntro(char)],
    summary: null,
    feedback: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function cleanText(value, max = 4000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeMessage(message) {
  if (!isRecord(message)) return null;
  const role = message.role === "assistant" ? "assistant" : message.role === "user" ? "user" : null;
  const content = cleanText(message.content, 12000);
  if (!role || !content) return null;
  return { role, content, time: Number(message.time) || Date.now() };
}

function normalizeConversation(value) {
  if (!isRecord(value)) return null;
  const id = cleanText(value.id, 80) || uid();
  const messages = Array.isArray(value.messages)
    ? value.messages.map(normalizeMessage).filter(Boolean).slice(-80)
    : [];

  return {
    id,
    title: cleanText(value.title, 80) || "Imported conversation",
    messages,
    summary: value.summary ? cleanText(value.summary, 3000) : null,
    feedback: Array.isArray(value.feedback) ? value.feedback.map((f) => cleanText(f, 500)).filter(Boolean).slice(-MAX_FEEDBACK) : [],
    createdAt: Number(value.createdAt) || Date.now(),
    updatedAt: Number(value.updatedAt) || Date.now(),
  };
}

function normalizeConversations(value) {
  if (!isRecord(value)) return {};
  const next = {};

  for (const [charId, conversations] of Object.entries(value)) {
    if (!isRecord(conversations)) continue;
    const safeCharId = cleanText(charId, 80);
    if (!safeCharId) continue;
    next[safeCharId] = {};

    for (const conversation of Object.values(conversations)) {
      const normalized = normalizeConversation(conversation);
      if (normalized) next[safeCharId][normalized.id] = normalized;
    }
  }

  return next;
}

function normalizeProfile(value) {
  if (!isRecord(value)) return emptyProfile;
  return {
    name: cleanText(value.name, 80),
    emoji: cleanText(value.emoji, 8) || "👤",
    description: cleanText(value.description, 1200),
  };
}

function normalizeCharacter(value) {
  if (!isRecord(value)) return null;
  const name = cleanText(value.name, 80);
  const personality = cleanText(value.personality, 8000);
  if (!name || !personality) return null;

  return {
    id: cleanText(value.id, 80) || uid(),
    name,
    emoji: cleanText(value.emoji, 8) || "🌙",
    color: /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : "#7C3AED",
    tagline: cleanText(value.tagline, 160),
    personality,
    openingMsg: cleanText(value.openingMsg, 800),
  };
}

function normalizeCharacters(value) {
  return Array.isArray(value) ? value.map(normalizeCharacter).filter(Boolean) : [];
}

function initialActiveCharacterId() {
  const savedId = localStorage.getItem("cc_active_char_id");
  if (savedId) return savedId;

  const savedCharacter = readJson("cc_char", null);
  return savedCharacter?.id || "";
}

function MarkdownLite({ content }) {
  return (
    <span>
      {content.split("\n").map((line, index) => (
        <span key={`${line}-${index}`}>
          {index > 0 && <br />}
          {renderMarkdownLine(line)}
        </span>
      ))}
    </span>
  );
}

function renderMarkdownLine(line) {
  const pieces = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let cursor = 0;
  let match;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > cursor) pieces.push(line.slice(cursor, match.index));
    const raw = match[0];
    if (raw.startsWith("**")) {
      pieces.push(<strong key={match.index}>{raw.slice(2, -2)}</strong>);
    } else {
      pieces.push(
        <em key={match.index} style={{ color: "#94a3b8", fontStyle: "italic" }}>
          {raw.slice(1, -1)}
        </em>,
      );
    }
    cursor = match.index + raw.length;
  }

  if (cursor < line.length) pieces.push(line.slice(cursor));
  return pieces.length ? pieces : line;
}

export default function App() {
  const [profile, setProfile] = useState(() => normalizeProfile(readJson("cc_profile", emptyProfile)));
  const [conversations, setConversations] = useState(() => normalizeConversations(readJson("cc_convs", {})));
  const [activeConversationIds, setActiveConversationIds] = useState(() => readJson("cc_acid", {}));
  const [customCharacters, setCustomCharacters] = useState(() => normalizeCharacters(readJson("cc_chars", [])));
  const [activeCharacterId, setActiveCharacterId] = useState(initialActiveCharacterId);
  const [view, setView] = useState("home");
  const [input, setInput] = useState(() => localStorage.getItem("cc_draft") || "");
  const [loading, setLoading] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [feedbackIndex, setFeedbackIndex] = useState(null);
  const [feedbackInput, setFeedbackInput] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [newCharacter, setNewCharacter] = useState(emptyCharacter);
  const [notice, setNotice] = useState("");

  const lastSend = useRef(0);
  const endRef = useRef(null);
  const textAreaRef = useRef(null);
  const importRef = useRef(null);

  const allCharacters = useMemo(() => [ALAN, ...customCharacters], [customCharacters]);
  const activeCharacter = allCharacters.find((char) => char.id === activeCharacterId) || null;
  const activeConversationId = activeCharacter ? activeConversationIds[activeCharacter.id] : "";
  const activeConversation = activeCharacter ? conversations[activeCharacter.id]?.[activeConversationId] || null : null;
  const messages = activeConversation?.messages || [];
  const conversationList = activeCharacter
    ? Object.values(conversations[activeCharacter.id] || {}).sort((a, b) => b.updatedAt - a.updatedAt)
    : [];
  const currentView = activeCharacter ? view : view === "chat" || view === "convList" ? "home" : view;
  const blocked = loading || compressing;

  useEffect(() => writeJson("cc_profile", profile), [profile]);
  useEffect(() => writeJson("cc_convs", conversations), [conversations]);
  useEffect(() => writeJson("cc_acid", activeConversationIds), [activeConversationIds]);
  useEffect(() => writeJson("cc_chars", customCharacters), [customCharacters]);
  useEffect(() => localStorage.setItem("cc_active_char_id", activeCharacterId), [activeCharacterId]);
  useEffect(() => localStorage.setItem("cc_draft", input), [input]);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages.length, loading]);

  function showNotice(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2800);
  }

  function resizeTextArea() {
    const element = textAreaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 130)}px`;
  }

  function updateConversation(charId, conversationId, patch) {
    setConversations((previous) => ({
      ...previous,
      [charId]: {
        ...(previous[charId] || {}),
        [conversationId]: {
          id: conversationId,
          title: "New conversation",
          messages: [],
          summary: null,
          feedback: [],
          createdAt: Date.now(),
          ...(previous[charId]?.[conversationId] || {}),
          ...patch,
          updatedAt: Date.now(),
        },
      },
    }));
  }

  function buildSystemPrompt(char, conversation) {
    const parts = [char.personality];

    if (profile.name || profile.description) {
      parts.push(["About the user:", profile.name ? `Their name is ${profile.name}.` : "", profile.description].filter(Boolean).join("\n"));
    }

    if (conversation?.summary) parts.push(`[EARLIER MEMORY:\n${conversation.summary}]`);
    if (conversation?.feedback?.length) {
      parts.push(`[USER FEEDBACK - adjust behavior:\n${conversation.feedback.map((f, index) => `${index + 1}. ${f}`).join("\n")}]`);
    }

    return parts.join("\n\n");
  }

  function openCharacter(char) {
    const existingId = activeConversationIds[char.id];
    setActiveCharacterId(char.id);
    setEditingIndex(null);
    setFeedbackIndex(null);
    setFeedbackInput("");

    if (existingId && conversations[char.id]?.[existingId]) {
      setView("chat");
      return;
    }

    const conversation = newConversation(char);
    setConversations((previous) => ({
      ...previous,
      [char.id]: { ...(previous[char.id] || {}), [conversation.id]: conversation },
    }));
    setActiveConversationIds((previous) => ({ ...previous, [char.id]: conversation.id }));
    setView("chat");
  }

  function createConversation() {
    if (!activeCharacter) return;
    const conversation = newConversation(activeCharacter);
    setConversations((previous) => ({
      ...previous,
      [activeCharacter.id]: { ...(previous[activeCharacter.id] || {}), [conversation.id]: conversation },
    }));
    setActiveConversationIds((previous) => ({ ...previous, [activeCharacter.id]: conversation.id }));
    setInput("");
    setEditingIndex(null);
    setFeedbackIndex(null);
    setFeedbackInput("");
    setView("chat");
  }

  function switchConversation(conversationId) {
    if (!activeCharacter) return;
    setActiveConversationIds((previous) => ({ ...previous, [activeCharacter.id]: conversationId }));
    setInput("");
    setEditingIndex(null);
    setFeedbackIndex(null);
    setFeedbackInput("");
    setView("chat");
  }

  function deleteConversation(conversationId) {
    if (!activeCharacter) return;

    const nextForCharacter = { ...(conversations[activeCharacter.id] || {}) };
    delete nextForCharacter[conversationId];
    const remainingIds = Object.keys(nextForCharacter);

    if (!remainingIds.length) {
      const replacement = newConversation(activeCharacter);
      nextForCharacter[replacement.id] = replacement;
      setActiveConversationIds((previous) => ({ ...previous, [activeCharacter.id]: replacement.id }));
    } else if (activeConversationId === conversationId) {
      setActiveConversationIds((previous) => ({ ...previous, [activeCharacter.id]: remainingIds[0] }));
    }

    setConversations((previous) => ({ ...previous, [activeCharacter.id]: nextForCharacter }));
  }

  function renameConversation(conversationId, title) {
    if (!activeCharacter || !title.trim()) return;
    updateConversation(activeCharacter.id, conversationId, { title: title.trim().slice(0, 80) });
    setRenamingId(null);
    setRenameValue("");
  }

  function submitFeedback() {
    if (!activeCharacter || !activeConversation || !feedbackInput.trim()) return;
    const nextFeedback = [...(activeConversation.feedback || []), feedbackInput.trim()].slice(-MAX_FEEDBACK);
    updateConversation(activeCharacter.id, activeConversation.id, { feedback: nextFeedback });
    setFeedbackIndex(null);
    setFeedbackInput("");
  }

  function deleteMessage(index) {
    if (!activeCharacter || !activeConversation) return;
    updateConversation(activeCharacter.id, activeConversation.id, {
      messages: messages.filter((_, messageIndex) => messageIndex !== index),
    });
  }

  function editMessage(index) {
    setEditingIndex(index);
    setInput(messages[index]?.content || "");
    window.setTimeout(resizeTextArea, 0);
  }

  async function compressConversation(charId, conversationId, allMessages, existingSummary) {
    const toCompress = allMessages.slice(0, allMessages.length - WINDOW_SIZE);
    const toKeep = allMessages.slice(allMessages.length - WINDOW_SIZE);
    setCompressing(true);

    try {
      const summary = await summarizeMessages(toCompress, existingSummary, profile.name);
      updateConversation(charId, conversationId, { messages: toKeep, summary });
    } catch (error) {
      console.warn("Memory compression failed", error);
    } finally {
      setCompressing(false);
    }
  }

  async function regenerateLastReply() {
    if (!activeCharacter || !activeConversation || blocked) return;
    const history = messages.at(-1)?.role === "assistant" ? messages.slice(0, -1) : messages;
    if (!history.length) return;

    updateConversation(activeCharacter.id, activeConversation.id, { messages: history });
    setLoading(true);

    try {
      const reply = await callCharacter(buildSystemPrompt(activeCharacter, activeConversation), history);
      updateConversation(activeCharacter.id, activeConversation.id, {
        messages: [...history, { role: "assistant", content: reply, time: Date.now() }],
      });
    } catch (error) {
      updateConversation(activeCharacter.id, activeConversation.id, {
        messages: [...history, { role: "assistant", content: apiErrorMessage(error), time: Date.now() }],
      });
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    if (!input.trim() || blocked || !activeCharacter) return;
    if (Date.now() - lastSend.current < RATE_LIMIT_MS) return;
    lastSend.current = Date.now();

    let conversationId = activeConversationId;
    let conversation = activeConversation;

    if (!conversationId || !conversation) {
      conversation = newConversation(activeCharacter);
      conversationId = conversation.id;
      setConversations((previous) => ({
        ...previous,
        [activeCharacter.id]: { ...(previous[activeCharacter.id] || {}), [conversation.id]: conversation },
      }));
      setActiveConversationIds((previous) => ({ ...previous, [activeCharacter.id]: conversation.id }));
    }

    const currentMessages = conversation.messages || [];
    const existingSummary = conversation.summary || null;

    if (editingIndex !== null) {
      const editedMessages = currentMessages.map((message, index) =>
        index === editingIndex ? { ...message, content: input.trim(), time: Date.now() } : message,
      );
      setInput("");
      setEditingIndex(null);

      if (textAreaRef.current) textAreaRef.current.style.height = "auto";

      if (editedMessages[editingIndex]?.role !== "user") {
        updateConversation(activeCharacter.id, conversationId, { messages: editedMessages });
        return;
      }

      const history = editedMessages.slice(0, editingIndex + 1);
      updateConversation(activeCharacter.id, conversationId, { messages: history });
      setLoading(true);

      try {
        const reply = await callCharacter(buildSystemPrompt(activeCharacter, conversation), history);
        const nextMessages = [...history, { role: "assistant", content: reply, time: Date.now() }];
        updateConversation(activeCharacter.id, conversationId, { messages: nextMessages });
        if (nextMessages.length >= COMPRESS_AT) await compressConversation(activeCharacter.id, conversationId, nextMessages, existingSummary);
      } catch (error) {
        updateConversation(activeCharacter.id, conversationId, {
          messages: [...history, { role: "assistant", content: apiErrorMessage(error), time: Date.now() }],
        });
      } finally {
        setLoading(false);
      }
      return;
    }

    const userMessage = { role: "user", content: input.trim(), time: Date.now() };
    const withUser = [...currentMessages, userMessage];
    const title = conversation.title === "New conversation" ? userMessage.content.split("\n")[0].slice(0, 50) : conversation.title;

    updateConversation(activeCharacter.id, conversationId, { messages: withUser, title });
    setInput("");
    if (textAreaRef.current) textAreaRef.current.style.height = "auto";
    setLoading(true);

    try {
      const reply = await callCharacter(buildSystemPrompt(activeCharacter, conversation), withUser);
      const nextMessages = [...withUser, { role: "assistant", content: reply, time: Date.now() }];
      updateConversation(activeCharacter.id, conversationId, { messages: nextMessages, title });
      if (nextMessages.length >= COMPRESS_AT) await compressConversation(activeCharacter.id, conversationId, nextMessages, existingSummary);
    } catch (error) {
      updateConversation(activeCharacter.id, conversationId, {
        messages: [...withUser, { role: "assistant", content: apiErrorMessage(error), time: Date.now() }],
        title,
      });
    } finally {
      setLoading(false);
    }
  }

  function saveNewCharacter() {
    const normalized = normalizeCharacter({
      ...newCharacter,
      id: uid(),
      openingMsg: newCharacter.openingMsg || `*${newCharacter.name.trim()} smiles.* "Hey there!"`,
    });

    if (!normalized) return;
    setCustomCharacters((previous) => [...previous, normalized]);
    setNewCharacter(emptyCharacter);
    setView("home");
  }

  function deleteCustomCharacter(characterId) {
    setCustomCharacters((previous) => previous.filter((char) => char.id !== characterId));
    setConversations((previous) => {
      const next = { ...previous };
      delete next[characterId];
      return next;
    });
    setActiveConversationIds((previous) => {
      const next = { ...previous };
      delete next[characterId];
      return next;
    });
    if (activeCharacterId === characterId) {
      setActiveCharacterId("");
      setView("home");
    }
  }

  function exportChats() {
    const blob = new Blob([JSON.stringify({ conversations, profile, customCharacters }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "charachat_backup.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function importChats(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (file.size > MAX_IMPORT_BYTES) {
      showNotice("Backup is too large to import.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const data = JSON.parse(loadEvent.target.result);
        const importedConversations = normalizeConversations(data.conversations || data.convs);
        const importedProfile = data.profile ? normalizeProfile(data.profile) : profile;
        const importedCharacters = data.customCharacters ? normalizeCharacters(data.customCharacters) : normalizeCharacters(data.customChars);

        setConversations(importedConversations);
        setProfile(importedProfile);
        setCustomCharacters(importedCharacters);
        setActiveConversationIds({});
        setActiveCharacterId("");
        setView("home");
        showNotice("Backup imported.");
      } catch (error) {
        console.warn("Import failed", error);
        showNotice("Invalid backup file.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <div style={styles.shell}>
      {notice && <div style={styles.toast}>{notice}</div>}

      {currentView === "home" && (
        <main style={styles.home}>
          <header style={styles.topBar}>
            <button type="button" aria-label="Settings" onClick={() => setView("settings")} style={styles.outlineButton}>
              Settings
            </button>
            <button type="button" onClick={() => setView("profile")} style={styles.profileButton}>
              <span>{profile.emoji}</span>
              <span>{profile.name || "My Profile"}</span>
            </button>
          </header>

          <section style={styles.brand}>
            <h1 style={styles.title}>CharaChat</h1>
            <p style={styles.subtitle}>Your characters, your conversations.</p>
          </section>

          <section>
            <div style={styles.sectionHeader}>
              <span style={styles.kicker}>Characters</span>
              <button type="button" onClick={() => setView("createChar")} style={styles.primarySmall}>
                + Create
              </button>
            </div>

            <div style={styles.cardList}>
              {allCharacters.map((char) => {
                const latestConversation = Object.values(conversations[char.id] || {}).sort((a, b) => b.updatedAt - a.updatedAt)[0];
                const lastMessage = latestConversation?.messages?.at(-1);

                return (
                  <button key={char.id} type="button" onClick={() => openCharacter(char)} style={styles.characterCard}>
                    <span style={{ ...styles.avatar, background: `${char.color}33` }}>{char.emoji}</span>
                    <span style={styles.characterText}>
                      <strong>{char.name}</strong>
                      <span>{char.tagline || "Ready to chat"}</span>
                      {lastMessage && <small>{lastMessage.content.replace(/\*[^*]+\*/g, "").trim().slice(0, 72)}</small>}
                    </span>
                    {char.id !== "alan" && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Delete ${char.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (window.confirm(`Delete ${char.name}?`)) deleteCustomCharacter(char.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.stopPropagation();
                            deleteCustomCharacter(char.id);
                          }
                        }}
                        style={styles.deleteInline}
                      >
                        Delete
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        </main>
      )}

      {currentView === "chat" && activeCharacter && activeConversation && (
        <main style={styles.chatShell}>
          <header style={styles.chatHeader}>
            <button type="button" aria-label="Back to characters" onClick={() => setView("home")} style={styles.iconButton}>
              ‹
            </button>
            <div style={{ ...styles.avatar, background: `${activeCharacter.color}33` }}>{activeCharacter.emoji}</div>
            <div style={styles.chatTitle}>
              <strong>{activeCharacter.name}</strong>
              <span>{compressing ? "Saving memory..." : loading ? "Thinking..." : "Online"}</span>
            </div>
            <button type="button" onClick={createConversation} disabled={blocked} style={styles.outlineButton}>
              New
            </button>
            <button type="button" onClick={() => setView("convList")} style={styles.outlineButton}>
              Chats
            </button>
          </header>

          <section style={styles.messages}>
            {activeConversation.summary && <div style={styles.memoryPill}>Memory saved for earlier messages</div>}

            {messages.map((message, index) => {
              const fromUser = message.role === "user";
              return (
                <article key={`${message.time}-${index}`} style={{ ...styles.messageRow, justifyContent: fromUser ? "flex-end" : "flex-start" }}>
                  {!fromUser && <div style={{ ...styles.tinyAvatar, background: `${activeCharacter.color}33` }}>{activeCharacter.emoji}</div>}
                  <div style={{ ...styles.bubble, ...(fromUser ? styles.userBubble : styles.assistantBubble) }}>
                    <MarkdownLite content={message.content} />
                    <div style={styles.messageMeta}>
                      <span>{formatTime(message.time)}</span>
                      <button type="button" onClick={() => editMessage(index)} disabled={blocked} style={styles.textButton}>
                        Edit
                      </button>
                      <button type="button" onClick={() => deleteMessage(index)} disabled={blocked} style={styles.textButton}>
                        Delete
                      </button>
                      {!fromUser && (
                        <button type="button" onClick={() => setFeedbackIndex(feedbackIndex === index ? null : index)} disabled={blocked} style={styles.textButton}>
                          Feedback
                        </button>
                      )}
                      {!fromUser && index === messages.length - 1 && (
                        <button type="button" onClick={regenerateLastReply} disabled={blocked} style={styles.textButton}>
                          Retry
                        </button>
                      )}
                    </div>

                    {feedbackIndex === index && (
                      <div style={styles.feedbackBox}>
                        <input
                          value={feedbackInput}
                          onChange={(event) => setFeedbackInput(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") submitFeedback();
                          }}
                          placeholder={`How should ${activeCharacter.name} respond differently?`}
                          style={styles.input}
                        />
                        <button type="button" onClick={submitFeedback} style={{ ...styles.primarySmall, background: activeCharacter.color }}>
                          Save
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}

            {loading && (
              <article style={styles.messageRow}>
                <div style={{ ...styles.tinyAvatar, background: `${activeCharacter.color}33` }}>{activeCharacter.emoji}</div>
                <div style={styles.assistantBubble}>...</div>
              </article>
            )}
            <div ref={endRef} />
          </section>

          {editingIndex !== null && (
            <div style={styles.editingBar}>
              <span>Editing message {editingIndex + 1}</span>
              <button
                type="button"
                onClick={() => {
                  setEditingIndex(null);
                  setInput("");
                }}
                style={styles.textButton}
              >
                Cancel
              </button>
            </div>
          )}

          <footer style={styles.composer}>
            <textarea
              ref={textAreaRef}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                resizeTextArea();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
              disabled={blocked}
              placeholder={compressing ? "Saving memory..." : editingIndex !== null ? "Edit message..." : `Message ${activeCharacter.name}...`}
              rows={1}
              style={styles.textarea}
            />
            <button type="button" onClick={sendMessage} disabled={blocked || !input.trim()} style={{ ...styles.sendButton, background: activeCharacter.color }}>
              {editingIndex !== null ? "Save" : "Send"}
            </button>
          </footer>
        </main>
      )}

      {currentView === "convList" && activeCharacter && (
        <main style={styles.panel}>
          <header style={styles.panelHeader}>
            <button type="button" aria-label="Back to chat" onClick={() => setView("chat")} style={styles.iconButton}>
              ‹
            </button>
            <h2>Chats with {activeCharacter.name}</h2>
            <button type="button" onClick={createConversation} style={styles.primarySmall}>
              New
            </button>
          </header>

          {conversationList.map((conversation) => {
            const active = conversation.id === activeConversationId;
            const lastMessage = conversation.messages?.at(-1);
            const renaming = renamingId === conversation.id;

            return (
              <article key={conversation.id} onClick={() => !renaming && switchConversation(conversation.id)} style={{ ...styles.listItem, borderColor: active ? activeCharacter.color : "#2a2a38" }}>
                {renaming ? (
                  <div style={styles.renameRow} onClick={(event) => event.stopPropagation()}>
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") renameConversation(conversation.id, renameValue);
                        if (event.key === "Escape") setRenamingId(null);
                      }}
                      style={styles.input}
                    />
                    <button type="button" onClick={() => renameConversation(conversation.id, renameValue)} style={styles.primarySmall}>
                      Save
                    </button>
                  </div>
                ) : (
                  <>
                    <div style={styles.listText}>
                      <strong>{conversation.title}</strong>
                      {lastMessage && <span>{lastMessage.content.replace(/\*[^*]+\*/g, "").trim().slice(0, 80)}</span>}
                      <small>
                        {conversation.messages?.length || 0} messages · {new Date(conversation.updatedAt).toLocaleDateString()}
                      </small>
                    </div>
                    <div style={styles.rowActions} onClick={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingId(conversation.id);
                          setRenameValue(conversation.title);
                        }}
                        style={styles.textButton}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm("Delete this chat?")) deleteConversation(conversation.id);
                        }}
                        style={styles.textButton}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </main>
      )}

      {currentView === "profile" && (
        <main style={styles.panel}>
          <HeaderBack title="My Profile" onBack={() => setView("home")} />
          <div style={styles.previewCard}>
            <div style={styles.largeAvatar}>{profile.emoji}</div>
            <div>
              <strong>{profile.name || "Your name"}</strong>
              <p>{profile.description || "Tell characters about yourself."}</p>
            </div>
          </div>

          <label style={styles.label}>
            Name
            <input value={profile.name} onChange={(event) => setProfile((prev) => ({ ...prev, name: event.target.value }))} placeholder="What should characters call you?" style={styles.input} />
          </label>

          <div>
            <div style={styles.labelText}>Avatar</div>
            <div style={styles.emojiGrid}>
              {PROFILE_EMOJIS.map((emoji) => (
                <button key={emoji} type="button" onClick={() => setProfile((prev) => ({ ...prev, emoji }))} style={profile.emoji === emoji ? styles.emojiActive : styles.emojiButton}>
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <label style={styles.label}>
            About you
            <textarea value={profile.description} onChange={(event) => setProfile((prev) => ({ ...prev, description: event.target.value }))} rows={4} placeholder="Age, hobbies, personality..." style={styles.textareaTall} />
          </label>

          <button type="button" onClick={() => setView("home")} style={styles.primaryButton}>
            Save and go back
          </button>
        </main>
      )}

      {currentView === "settings" && (
        <main style={styles.panel}>
          <HeaderBack title="Settings" onBack={() => setView("home")} />
          <section style={styles.settingsCard}>
            <h3>Gemini setup</h3>
            <p>{geminiSetupMessage()}</p>
            <small>Mode: {geminiMode()}</small>
          </section>

          <section style={styles.settingsCard}>
            <h3>Data backup</h3>
            <p>Export all local chats, or import a validated backup file.</p>
            <div style={styles.rowActions}>
              <button type="button" onClick={exportChats} style={styles.outlineButton}>
                Export
              </button>
              <button type="button" onClick={() => importRef.current?.click()} style={styles.outlineButton}>
                Import
              </button>
              <input ref={importRef} type="file" accept=".json,application/json" onChange={importChats} style={{ display: "none" }} />
            </div>
          </section>

          <section style={styles.settingsCard}>
            <h3>Clear all data</h3>
            <p>Delete conversations and active chat selections from this browser.</p>
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Delete all chats? This cannot be undone.")) {
                  setConversations({});
                  setActiveConversationIds({});
                  setActiveCharacterId("");
                }
              }}
              style={styles.dangerButton}
            >
              Clear all chats
            </button>
          </section>
        </main>
      )}

      {currentView === "createChar" && (
        <main style={styles.panel}>
          <HeaderBack title="Create Character" onBack={() => setView("home")} />
          <div style={{ ...styles.previewCard, borderColor: `${newCharacter.color}55` }}>
            <div style={{ ...styles.largeAvatar, background: `${newCharacter.color}33` }}>{newCharacter.emoji}</div>
            <div>
              <strong>{newCharacter.name || "Character name"}</strong>
              <p>{newCharacter.tagline || "Tagline..."}</p>
            </div>
          </div>

          <label style={styles.label}>
            Name *
            <input value={newCharacter.name} onChange={(event) => setNewCharacter((prev) => ({ ...prev, name: event.target.value }))} placeholder="e.g. Luna" style={styles.input} />
          </label>

          <label style={styles.label}>
            Tagline
            <input value={newCharacter.tagline} onChange={(event) => setNewCharacter((prev) => ({ ...prev, tagline: event.target.value }))} placeholder="e.g. Mysterious and wise" style={styles.input} />
          </label>

          <div>
            <div style={styles.labelText}>Emoji</div>
            <div style={styles.emojiGrid}>
              {EMOJIS.map((emoji) => (
                <button key={emoji} type="button" onClick={() => setNewCharacter((prev) => ({ ...prev, emoji }))} style={newCharacter.emoji === emoji ? styles.emojiActive : styles.emojiButton}>
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={styles.labelText}>Color</div>
            <div style={styles.colorRow}>
              {COLORS.map((color) => (
                <button key={color} type="button" aria-label={`Use ${color}`} onClick={() => setNewCharacter((prev) => ({ ...prev, color }))} style={{ ...styles.colorSwatch, background: color, borderColor: newCharacter.color === color ? "#fff" : "transparent" }} />
              ))}
            </div>
          </div>

          <label style={styles.label}>
            Personality *
            <textarea value={newCharacter.personality} onChange={(event) => setNewCharacter((prev) => ({ ...prev, personality: event.target.value }))} rows={5} placeholder="Describe how your character thinks, speaks, and behaves..." style={styles.textareaTall} />
          </label>

          <label style={styles.label}>
            Opening message
            <input value={newCharacter.openingMsg} onChange={(event) => setNewCharacter((prev) => ({ ...prev, openingMsg: event.target.value }))} placeholder={`*${newCharacter.name || "Character"} smiles.* "Hey there!"`} style={styles.input} />
          </label>

          <button type="button" onClick={saveNewCharacter} disabled={!newCharacter.name.trim() || !newCharacter.personality.trim()} style={styles.primaryButton}>
            Create Character
          </button>
        </main>
      )}
    </div>
  );
}

function HeaderBack({ title, onBack }) {
  return (
    <header style={styles.panelHeader}>
      <button type="button" aria-label="Back" onClick={onBack} style={styles.iconButton}>
        ‹
      </button>
      <h2>{title}</h2>
    </header>
  );
}

const styles = {
  shell: {
    minHeight: "100svh",
    background: "#0f1016",
    color: "#e8e6f0",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  },
  toast: {
    position: "fixed",
    top: 16,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 20,
    background: "#1e1e2e",
    border: "1px solid #34344a",
    borderRadius: 10,
    padding: "10px 14px",
    boxShadow: "0 16px 40px #0007",
  },
  home: { maxWidth: 860, margin: "0 auto", padding: "34px 22px" },
  topBar: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 },
  brand: { textAlign: "center", padding: "34px 0 38px" },
  title: { margin: 0, fontSize: 42, fontWeight: 800, color: "#f8fafc", letterSpacing: 0 },
  subtitle: { margin: "8px 0 0", color: "#8b8ca3", fontSize: 15 },
  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  kicker: { color: "#8b8ca3", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  cardList: { display: "grid", gap: 12 },
  characterCard: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 14,
    textAlign: "left",
    background: "#191a24",
    color: "#e8e6f0",
    border: "1px solid #2a2a38",
    borderRadius: 12,
    padding: 18,
    cursor: "pointer",
  },
  avatar: { width: 52, height: 52, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 26, flexShrink: 0 },
  tinyAvatar: { width: 34, height: 34, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0 },
  largeAvatar: { width: 62, height: 62, borderRadius: "50%", display: "grid", placeItems: "center", background: "#ffffff12", fontSize: 30, flexShrink: 0 },
  characterText: { display: "grid", gap: 3, minWidth: 0, flex: 1 },
  deleteInline: { color: "#f87171", fontSize: 12, padding: "6px 8px" },
  profileButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    background: "#191a24",
    color: "#d7d7e4",
    border: "1px solid #2a2a38",
    borderRadius: 999,
    padding: "8px 14px",
    cursor: "pointer",
  },
  chatShell: { minHeight: "100svh", display: "flex", flexDirection: "column" },
  chatHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    borderBottom: "1px solid #2a2a38",
    background: "#181923",
    padding: "12px 18px",
  },
  chatTitle: { display: "grid", gap: 2, minWidth: 0, flex: 1 },
  messages: { flex: 1, overflowY: "auto", padding: "22px 18px", display: "flex", flexDirection: "column", gap: 14 },
  messageRow: { display: "flex", alignItems: "flex-start", gap: 10 },
  bubble: { maxWidth: "min(720px, 82vw)", borderRadius: 16, padding: "11px 14px", lineHeight: 1.55, whiteSpace: "pre-wrap" },
  userBubble: { background: "#5B8DD9", color: "#fff", borderBottomRightRadius: 4 },
  assistantBubble: { background: "#1d1f2d", color: "#e8e6f0", border: "1px solid #2a2a38", borderBottomLeftRadius: 4 },
  messageMeta: { marginTop: 8, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, color: "#85869a", fontSize: 12 },
  memoryPill: { alignSelf: "center", color: "#8b8ca3", background: "#ffffff0c", border: "1px solid #2a2a38", borderRadius: 999, padding: "5px 10px", fontSize: 12 },
  feedbackBox: { marginTop: 10, display: "flex", gap: 8 },
  editingBar: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#191a24", borderTop: "1px solid #2a2a38", padding: "8px 18px", color: "#8b8ca3" },
  composer: { display: "flex", alignItems: "flex-end", gap: 10, background: "#181923", borderTop: "1px solid #2a2a38", padding: 14 },
  textarea: {
    flex: 1,
    minHeight: 44,
    maxHeight: 130,
    resize: "none",
    overflowY: "auto",
    background: "#10111a",
    color: "#f8fafc",
    border: "1px solid #313244",
    borderRadius: 14,
    padding: "11px 14px",
    font: "inherit",
    outline: "none",
  },
  textareaTall: {
    width: "100%",
    resize: "vertical",
    background: "#10111a",
    color: "#f8fafc",
    border: "1px solid #313244",
    borderRadius: 10,
    padding: "10px 12px",
    font: "inherit",
    outline: "none",
    boxSizing: "border-box",
  },
  panel: { maxWidth: 720, margin: "0 auto", padding: "30px 22px", display: "grid", gap: 16 },
  panelHeader: { display: "flex", alignItems: "center", gap: 12 },
  previewCard: { display: "flex", alignItems: "center", gap: 14, background: "#191a24", border: "1px solid #2a2a38", borderRadius: 12, padding: 18 },
  settingsCard: { background: "#191a24", border: "1px solid #2a2a38", borderRadius: 12, padding: 18 },
  label: { display: "grid", gap: 7, color: "#a7a8bb", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.7 },
  labelText: { color: "#a7a8bb", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 },
  input: {
    width: "100%",
    background: "#10111a",
    color: "#f8fafc",
    border: "1px solid #313244",
    borderRadius: 10,
    padding: "10px 12px",
    font: "inherit",
    outline: "none",
    boxSizing: "border-box",
  },
  listItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    background: "#191a24",
    border: "1px solid #2a2a38",
    borderRadius: 12,
    padding: 15,
    cursor: "pointer",
  },
  listText: { display: "grid", gap: 4, minWidth: 0 },
  rowActions: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  renameRow: { display: "flex", gap: 8, width: "100%" },
  emojiGrid: { display: "flex", flexWrap: "wrap", gap: 8 },
  emojiButton: { width: 40, height: 40, background: "#191a24", border: "1px solid #2a2a38", borderRadius: 10, cursor: "pointer", fontSize: 19 },
  emojiActive: { width: 40, height: 40, background: "#26243a", border: "2px solid #7C3AED", borderRadius: 10, cursor: "pointer", fontSize: 19 },
  colorRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  colorSwatch: { width: 32, height: 32, borderRadius: "50%", border: "3px solid transparent", cursor: "pointer" },
  primaryButton: { background: "linear-gradient(135deg,#7C3AED,#3b82f6)", color: "#fff", border: 0, borderRadius: 10, padding: "12px 16px", fontWeight: 800, cursor: "pointer" },
  primarySmall: { background: "linear-gradient(135deg,#7C3AED,#3b82f6)", color: "#fff", border: 0, borderRadius: 10, padding: "8px 13px", fontWeight: 700, cursor: "pointer" },
  outlineButton: { background: "#ffffff0c", color: "#d7d7e4", border: "1px solid #313244", borderRadius: 10, padding: "8px 12px", cursor: "pointer" },
  dangerButton: { background: "#f8717120", color: "#fca5a5", border: "1px solid #f87171", borderRadius: 10, padding: "9px 13px", cursor: "pointer" },
  sendButton: { color: "#fff", border: 0, borderRadius: 12, padding: "12px 16px", minHeight: 44, fontWeight: 800, cursor: "pointer" },
  iconButton: { background: "transparent", color: "#e8e6f0", border: 0, fontSize: 32, lineHeight: 1, cursor: "pointer" },
  textButton: { background: "transparent", color: "#9ca3af", border: 0, padding: 0, cursor: "pointer", font: "inherit", fontSize: 12 },
};
