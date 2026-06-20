import { useEffect, useMemo, useRef, useState } from "react";
import { ALAN, BUILT_IN_CHARACTERS, DEFAULT_EMOTIONS } from "./characters";
import {
  apiErrorMessage,
  callCharacter,
  geminiMode,
  geminiSetupMessage,
  summarizeMessages,
} from "./services/gemini";
import { ThemeProvider } from "./context/ThemeContext";
import Sidebar from "./components/Sidebar";
import MobileNav from "./components/MobileNav";
import DiscoverGrid from "./components/DiscoverGrid";
import StatsDashboard from "./components/StatsDashboard";
import ThemeSettingsPanel from "./components/ThemeSettingsPanel";
import EmotionMatrix from "./components/EmotionMatrix";
import MemoryBox from "./components/MemoryBox";
import Avatar from "./components/Avatar";
import "./styles/layout.css";

const BUILT_IN_IDS = new Set(BUILT_IN_CHARACTERS.map((char) => char.id));

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

function now() {
  return Date.now();
}

function makeIntro(char) {
  return {
    role: "assistant",
    content: char.openingMsg || `*${char.name} waves.* "Hey!"`,
    time: now(),
  };
}

function newConversation(char, firstMessage = "") {
  return {
    id: uid(),
    title: firstMessage ? firstMessage.split("\n")[0].slice(0, 50) : "New conversation",
    messages: [makeIntro(char)],
    summary: null,
    feedback: [],
    createdAt: now(),
    updatedAt: now(),
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
  return { role, content, time: Number(message.time) || now() };
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
    createdAt: Number(value.createdAt) || now(),
    updatedAt: Number(value.updatedAt) || now(),
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
      if (normalized) {
        const firstMessage = normalized.messages[0];
        if (safeCharId === "alan" && firstMessage?.role === "assistant" && firstMessage.content === `*Alan waves.* "Hey!"`) {
          normalized.messages[0] = { ...firstMessage, content: ALAN.openingMsg };
        }
        next[safeCharId][normalized.id] = normalized;
      }
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

// -----------------------------------------------------------------------
// Feature 5: Real-Time Dynamic Emotion System Matrix
// -----------------------------------------------------------------------
// Emotion + pinned-memory state is tracked per "session" (one character's
// one conversation), keyed as `${charId}:${conversationId}`.
function sessionKey(charId, conversationId) {
  return `${charId}:${conversationId}`;
}

function clampEmotionValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 50;
  return Math.max(0, Math.min(100, Math.round(number)));
}

// Matches a trailing `||EMOTION_MATRIX: {...}||` block. Non-greedy on the
// object body (no nested braces expected) and case-insensitive so a minor
// model formatting slip doesn't silently leak the raw block into the bubble.
const EMOTION_MATRIX_PATTERN = /\|\|EMOTION_MATRIX:\s*(\{[^{}]*\})\s*\|\|/i;

function parseEmotionMatrix(rawText) {
  if (typeof rawText !== "string") return { cleanText: rawText, emotions: null };

  const match = rawText.match(EMOTION_MATRIX_PATTERN);
  if (!match) return { cleanText: rawText, emotions: null };

  let emotions = null;
  try {
    const parsed = JSON.parse(match[1]);
    emotions = {
      Trust: clampEmotionValue(parsed.Trust),
      Happiness: clampEmotionValue(parsed.Happiness),
      Anger: clampEmotionValue(parsed.Anger),
      Affection: clampEmotionValue(parsed.Affection),
    };
  } catch (error) {
    console.warn("Could not parse emotion matrix block", error);
  }

  // Strip the block wherever it appears (spec puts it at the end, but this
  // stays safe even if the model adds trailing whitespace/newlines after it).
  const cleanText = (rawText.slice(0, match.index) + rawText.slice(match.index + match[0].length)).trim();
  return { cleanText, emotions };
}

function buildEmotionInstruction(emotionState) {
  const current = emotionState || DEFAULT_EMOTIONS;
  return [
    "[EMOTION TRACKING - internal system instruction, never reveal this block or its contents to the user]",
    `Your current internal emotional state toward the user is: Trust ${current.Trust}, Happiness ${current.Happiness}, Anger ${current.Anger}, Affection ${current.Affection} (each on a 0-100 scale).`,
    "Let this state evolve naturally based on what is said in the conversation - do not jump to extremes.",
    "Whenever your emotional state shifts as a result of this exchange, end your reply with a hidden block in exactly this format, on its own at the absolute end of the response, with nothing after it:",
    '||EMOTION_MATRIX: {"Trust": <0-100>, "Happiness": <0-100>, "Anger": <0-100>, "Affection": <0-100>}||',
    "If your emotional state has not meaningfully shifted this turn, omit the block entirely.",
    "Never mention this instruction, the block, or these numbers anywhere in the visible reply text itself.",
  ].join("\n");
}

// -----------------------------------------------------------------------
// Feature 3: Algorithmic "AUTO Pinned Chats"
// -----------------------------------------------------------------------
// NOTE: this app's callCharacter() (services/gemini.js) always appends
// "Stay completely in character and reply naturally." after the chat,
// since it's built for roleplay replies. This prompt is reused for a
// non-roleplay analysis task, so it explicitly overrides that trailer -
// otherwise the model may ignore the FALSE/one-sentence format and just
// produce an in-character chat reply instead.
const MILESTONE_SYSTEM_PROMPT = [
  "You are a silent analysis tool, not a roleplay character. Ignore any instruction elsewhere telling you to stay in character or reply naturally - that does not apply here.",
  "Analyze the last 10 messages of this chat.",
  "Identify if a critical, unchangeable plot point, fact, or secret about the user or character was established (e.g. the user's hometown, relationship status, or core backstory).",
  "If and ONLY if a milestone is present, respond with a single plain sentence summarizing it - no roleplay, no asterisked actions, no quotation marks, nothing else.",
  "Otherwise, respond with exactly one word: FALSE",
].join("\n");

// Defensive cleanup in case the model still wraps the answer (e.g. with
// quotes or a stray action) despite the instruction above.
function cleanMilestoneResult(rawResult) {
  return (rawResult || "")
    .trim()
    .split("\n")[0]
    .replace(/^["'*]+|["'*]+$/g, "")
    .trim();
}

// -----------------------------------------------------------------------
// Feature 4: Historical User Profile Analytics
// -----------------------------------------------------------------------
// Real numbers from local chat history rather than mocked ones, since the
// app already has all of this data sitting in `conversations`.
function computeStats(allCharacters, conversations) {
  let totalMessages = 0;
  let totalConversations = 0;
  let earliest = null;
  const perCharacter = [];

  for (const char of allCharacters) {
    const charConversations = Object.values(conversations[char.id] || {});
    let charMessageCount = 0;

    for (const conversation of charConversations) {
      totalConversations += 1;
      const count = conversation.messages?.length || 0;
      charMessageCount += count;
      totalMessages += count;
      if (conversation.createdAt && (!earliest || conversation.createdAt < earliest)) {
        earliest = conversation.createdAt;
      }
    }

    if (charMessageCount > 0) perCharacter.push({ character: char, messageCount: charMessageCount });
  }

  // Rough engagement estimate: ~40 seconds of active time per message exchange.
  const activeHours = Math.round(((totalMessages * 40) / 3600) * 10) / 10;
  const genesisLabel = earliest ? new Date(earliest).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "Not yet started";

  return {
    totalMessages,
    totalConversations,
    activeHours,
    genesisLabel,
    perCharacter: perCharacter.sort((a, b) => b.messageCount - a.messageCount),
  };
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

function AppShell() {
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

  // Feature 5 (Emotion Matrix) + Feature 3 (Auto-Pinned Chats) state, both
  // keyed per session via sessionKey(charId, conversationId).
  const [emotionStates, setEmotionStates] = useState(() => readJson("cc_emotions", {}));
  const [pinnedDetails, setPinnedDetails] = useState(() => readJson("cc_pins", {}));
  const [memoryBoxOpen, setMemoryBoxOpen] = useState(false);

  const lastSend = useRef(0);
  const endRef = useRef(null);
  const textAreaRef = useRef(null);
  const importRef = useRef(null);

  const allCharacters = useMemo(() => [...BUILT_IN_CHARACTERS, ...customCharacters], [customCharacters]);
  const activeCharacter = allCharacters.find((char) => char.id === activeCharacterId) || null;
  const activeConversationId = activeCharacter ? activeConversationIds[activeCharacter.id] : "";
  const activeConversation = activeCharacter ? conversations[activeCharacter.id]?.[activeConversationId] || null : null;
  const messages = activeConversation?.messages || [];
  const conversationList = activeCharacter
    ? Object.values(conversations[activeCharacter.id] || {}).sort((a, b) => b.updatedAt - a.updatedAt)
    : [];
  const currentView = activeCharacter ? view : view === "chat" || view === "convList" ? "home" : view;
  const blocked = loading || compressing;

  const activeSessionKey = activeCharacter && activeConversationId ? sessionKey(activeCharacter.id, activeConversationId) : null;
  const activeEmotionState = (activeSessionKey && emotionStates[activeSessionKey]) || activeCharacter?.baseEmotions || DEFAULT_EMOTIONS;
  const activePinnedDetails = (activeSessionKey && pinnedDetails[activeSessionKey]) || [];
  const stats = useMemo(() => computeStats(allCharacters, conversations), [allCharacters, conversations]);

  useEffect(() => writeJson("cc_profile", profile), [profile]);
  useEffect(() => writeJson("cc_convs", conversations), [conversations]);
  useEffect(() => writeJson("cc_acid", activeConversationIds), [activeConversationIds]);
  useEffect(() => writeJson("cc_chars", customCharacters), [customCharacters]);
  useEffect(() => writeJson("cc_emotions", emotionStates), [emotionStates]);
  useEffect(() => writeJson("cc_pins", pinnedDetails), [pinnedDetails]);
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
          createdAt: now(),
          ...(previous[charId]?.[conversationId] || {}),
          ...patch,
          updatedAt: now(),
        },
      },
    }));
  }

  function buildSystemPrompt(char, conversation, emotionState) {
    const parts = [char.personality];

    if (profile.name || profile.description) {
      parts.push(["About the user:", profile.name ? `Their name is ${profile.name}.` : "", profile.description].filter(Boolean).join("\n"));
    }

    if (conversation?.summary) parts.push(`[EARLIER MEMORY:\n${conversation.summary}]`);
    if (conversation?.feedback?.length) {
      parts.push(`[USER FEEDBACK - adjust behavior:\n${conversation.feedback.map((f, index) => `${index + 1}. ${f}`).join("\n")}]`);
    }

    parts.push(buildEmotionInstruction(emotionState));

    return parts.join("\n\n");
  }

  async function checkForPinnedMilestone(charId, conversationId, allMessages) {
    const lastTen = allMessages.slice(-10);
    try {
      const result = await callCharacter(MILESTONE_SYSTEM_PROMPT, lastTen);
      const cleaned = cleanMilestoneResult(result);
      if (cleaned && cleaned.toUpperCase() !== "FALSE") {
        setPinnedDetails((previous) => {
          const key = sessionKey(charId, conversationId);
          const existing = previous[key] || [];
          return { ...previous, [key]: [...existing, { text: cleaned, time: now() }] };
        });
      }
    } catch (error) {
      console.warn("Milestone check failed", error);
    }
  }

  function openCharacter(char) {
    const existingId = activeConversationIds[char.id];
    setActiveCharacterId(char.id);
    setEditingIndex(null);
    setFeedbackIndex(null);
    setFeedbackInput("");
    setMemoryBoxOpen(false);

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
    setEmotionStates((previous) => ({ ...previous, [sessionKey(char.id, conversation.id)]: char.baseEmotions || DEFAULT_EMOTIONS }));
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
    setEmotionStates((previous) => ({
      ...previous,
      [sessionKey(activeCharacter.id, conversation.id)]: activeCharacter.baseEmotions || DEFAULT_EMOTIONS,
    }));
    setInput("");
    setEditingIndex(null);
    setFeedbackIndex(null);
    setFeedbackInput("");
    setMemoryBoxOpen(false);
    setView("chat");
  }

  function switchConversation(conversationId) {
    if (!activeCharacter) return;
    setActiveConversationIds((previous) => ({ ...previous, [activeCharacter.id]: conversationId }));
    setInput("");
    setEditingIndex(null);
    setFeedbackIndex(null);
    setFeedbackInput("");
    setMemoryBoxOpen(false);
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
      setEmotionStates((previous) => ({
        ...previous,
        [sessionKey(activeCharacter.id, replacement.id)]: activeCharacter.baseEmotions || DEFAULT_EMOTIONS,
      }));
    } else if (activeConversationId === conversationId) {
      setActiveConversationIds((previous) => ({ ...previous, [activeCharacter.id]: remainingIds[0] }));
    }

    const removedKey = sessionKey(activeCharacter.id, conversationId);
    setEmotionStates((previous) => {
      const next = { ...previous };
      delete next[removedKey];
      return next;
    });
    setPinnedDetails((previous) => {
      const next = { ...previous };
      delete next[removedKey];
      return next;
    });
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
      const reply = await callCharacter(buildSystemPrompt(activeCharacter, activeConversation, activeEmotionState), history);
      const { cleanText: replyText, emotions } = parseEmotionMatrix(reply);
      const nextMessages = [...history, { role: "assistant", content: replyText, time: now() }];
      updateConversation(activeCharacter.id, activeConversation.id, { messages: nextMessages });

      if (emotions) {
        setEmotionStates((previous) => ({ ...previous, [sessionKey(activeCharacter.id, activeConversation.id)]: emotions }));
      }
      if (nextMessages.length % 10 === 0) {
        checkForPinnedMilestone(activeCharacter.id, activeConversation.id, nextMessages);
      }
    } catch (error) {
      updateConversation(activeCharacter.id, activeConversation.id, {
        messages: [...history, { role: "assistant", content: apiErrorMessage(error), time: now() }],
      });
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    if (!input.trim() || blocked || !activeCharacter) return;
    if (now() - lastSend.current < RATE_LIMIT_MS) return;
    lastSend.current = now();

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
      setEmotionStates((previous) => ({
        ...previous,
        [sessionKey(activeCharacter.id, conversation.id)]: activeCharacter.baseEmotions || DEFAULT_EMOTIONS,
      }));
    }

    const currentMessages = conversation.messages || [];
    const existingSummary = conversation.summary || null;

    if (editingIndex !== null) {
      const editedMessages = currentMessages.map((message, index) =>
        index === editingIndex ? { ...message, content: input.trim(), time: now() } : message,
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
        const sessionEmotion = emotionStates[sessionKey(activeCharacter.id, conversationId)] || activeCharacter.baseEmotions || DEFAULT_EMOTIONS;
        const reply = await callCharacter(buildSystemPrompt(activeCharacter, conversation, sessionEmotion), history);
        const { cleanText: replyText, emotions } = parseEmotionMatrix(reply);
        const nextMessages = [...history, { role: "assistant", content: replyText, time: now() }];
        updateConversation(activeCharacter.id, conversationId, { messages: nextMessages });

        if (emotions) {
          setEmotionStates((previous) => ({ ...previous, [sessionKey(activeCharacter.id, conversationId)]: emotions }));
        }
        if (nextMessages.length % 10 === 0) {
          checkForPinnedMilestone(activeCharacter.id, conversationId, nextMessages);
        }
        if (nextMessages.length >= COMPRESS_AT) await compressConversation(activeCharacter.id, conversationId, nextMessages, existingSummary);
      } catch (error) {
        updateConversation(activeCharacter.id, conversationId, {
          messages: [...history, { role: "assistant", content: apiErrorMessage(error), time: now() }],
        });
      } finally {
        setLoading(false);
      }
      return;
    }

    const userMessage = { role: "user", content: input.trim(), time: now() };
    const withUser = [...currentMessages, userMessage];
    const title = conversation.title === "New conversation" ? userMessage.content.split("\n")[0].slice(0, 50) : conversation.title;

    updateConversation(activeCharacter.id, conversationId, { messages: withUser, title });
    setInput("");
    if (textAreaRef.current) textAreaRef.current.style.height = "auto";
    setLoading(true);

    try {
      const sessionEmotion = emotionStates[sessionKey(activeCharacter.id, conversationId)] || activeCharacter.baseEmotions || DEFAULT_EMOTIONS;
      const reply = await callCharacter(buildSystemPrompt(activeCharacter, conversation, sessionEmotion), withUser);
      const { cleanText: replyText, emotions } = parseEmotionMatrix(reply);
      const nextMessages = [...withUser, { role: "assistant", content: replyText, time: now() }];
      updateConversation(activeCharacter.id, conversationId, { messages: nextMessages, title });

      if (emotions) {
        setEmotionStates((previous) => ({ ...previous, [sessionKey(activeCharacter.id, conversationId)]: emotions }));
      }
      if (nextMessages.length % 10 === 0) {
        checkForPinnedMilestone(activeCharacter.id, conversationId, nextMessages);
      }
      if (nextMessages.length >= COMPRESS_AT) await compressConversation(activeCharacter.id, conversationId, nextMessages, existingSummary);
    } catch (error) {
      updateConversation(activeCharacter.id, conversationId, {
        messages: [...withUser, { role: "assistant", content: apiErrorMessage(error), time: now() }],
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
    const dropSessionsForChar = (state) => {
      const next = { ...state };
      for (const key of Object.keys(next)) {
        if (key.startsWith(`${characterId}:`)) delete next[key];
      }
      return next;
    };
    setEmotionStates(dropSessionsForChar);
    setPinnedDetails(dropSessionsForChar);
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
    <div className="cc-shell-grid">
      <Sidebar view={currentView} onNavigate={setView} profile={profile} onOpenProfile={() => setView("profile")} />

      <div className="cc-shell-grid__content">
        {notice && <div style={styles.toast}>{notice}</div>}

        {currentView === "discover" && <DiscoverGrid characters={allCharacters} onOpenCharacter={openCharacter} />}

        {currentView === "stats" && <StatsDashboard stats={stats} />}

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
                    <Avatar character={char} size={52} />
                    <span style={styles.characterText}>
                      <strong>{char.name}</strong>
                      <span>{char.tagline || "Ready to chat"}</span>
                      {lastMessage && <small>{lastMessage.content.replace(/\*[^*]+\*/g, "").trim().slice(0, 72)}</small>}
                    </span>
                    {!BUILT_IN_IDS.has(char.id) && (
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
        <main style={{ ...styles.chatShell, position: "relative" }}>
          <header style={styles.chatHeader}>
            <button type="button" aria-label="Back to characters" onClick={() => setView("home")} style={styles.iconButton}>
              ‹
            </button>
            <Avatar character={activeCharacter} size={40} />
            <div style={styles.chatTitle}>
              <strong>{activeCharacter.name}</strong>
              <span>{compressing ? "Saving memory..." : loading ? "Thinking..." : "Online"}</span>
            </div>
            <span className="cc-pin-toggle">
              <button type="button" aria-label="Character memory" onClick={() => setMemoryBoxOpen((open) => !open)} style={styles.outlineButton}>
                📌
              </button>
              {activePinnedDetails.length > 0 && <span className="cc-pin-badge">{activePinnedDetails.length}</span>}
            </span>
            <button type="button" onClick={createConversation} disabled={blocked} style={styles.outlineButton}>
              New
            </button>
            <button type="button" onClick={() => setView("convList")} style={styles.outlineButton}>
              Chats
            </button>
          </header>

          {memoryBoxOpen && <MemoryBox pinnedDetails={activePinnedDetails} onClose={() => setMemoryBoxOpen(false)} />}

          <section style={styles.messages}>
            {activeConversation.summary && <div style={styles.memoryPill}>Memory saved for earlier messages</div>}

            {messages.map((message, index) => {
              const fromUser = message.role === "user";
              return (
                <article key={`${message.time}-${index}`} style={{ ...styles.messageRow, justifyContent: fromUser ? "flex-end" : "flex-start" }}>
                  {!fromUser && <Avatar character={activeCharacter} size={34} fontSize={16} />}
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
                <Avatar character={activeCharacter} size={34} fontSize={16} />
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

          <div style={{ padding: "0 18px", background: "var(--cc-bg-surface)" }}>
            <EmotionMatrix emotions={activeEmotionState} compact />
          </div>

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
              <article key={conversation.id} onClick={() => !renaming && switchConversation(conversation.id)} style={{ ...styles.listItem, borderColor: active ? activeCharacter.color : "var(--cc-border)" }}>
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
          <ThemeSettingsPanel />

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

      <MobileNav view={currentView} onNavigate={setView} />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
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
    background: "var(--cc-bg-canvas)",
    color: "var(--cc-text-primary)",
    fontFamily: "var(--cc-font-body)",
  },
  toast: {
    position: "fixed",
    top: 16,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 20,
    background: "var(--cc-bg-elevated)",
    border: "1px solid var(--cc-border)",
    borderRadius: 10,
    padding: "10px 14px",
    boxShadow: "var(--cc-shadow)",
  },
  home: { maxWidth: 860, margin: "0 auto", padding: "34px 22px" },
  topBar: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 },
  brand: { textAlign: "center", padding: "34px 0 38px" },
  title: { margin: 0, fontSize: 42, fontWeight: 800, color: "var(--cc-text-primary)", letterSpacing: 0, fontFamily: "var(--cc-font-display)" },
  subtitle: { margin: "8px 0 0", color: "var(--cc-text-secondary)", fontSize: 15 },
  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  kicker: { color: "var(--cc-text-secondary)", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  cardList: { display: "grid", gap: 12 },
  characterCard: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 14,
    textAlign: "left",
    background: "var(--cc-bg-surface)",
    color: "var(--cc-text-primary)",
    border: "1px solid var(--cc-border)",
    borderRadius: 12,
    padding: 18,
    cursor: "pointer",
  },
  avatar: { width: 52, height: 52, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 26, flexShrink: 0 },
  tinyAvatar: { width: 34, height: 34, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0 },
  largeAvatar: { width: 62, height: 62, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--cc-bg-elevated)", fontSize: 30, flexShrink: 0 },
  characterText: { display: "grid", gap: 3, minWidth: 0, flex: 1 },
  deleteInline: { color: "var(--cc-danger)", fontSize: 12, padding: "6px 8px" },
  profileButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    background: "var(--cc-bg-surface)",
    color: "var(--cc-text-secondary)",
    border: "1px solid var(--cc-border)",
    borderRadius: 999,
    padding: "8px 14px",
    cursor: "pointer",
  },
  chatShell: { flex: 1, display: "flex", flexDirection: "column" },
  chatHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    borderBottom: "1px solid var(--cc-border)",
    background: "var(--cc-bg-surface)",
    padding: "12px 18px",
  },
  chatTitle: { display: "grid", gap: 2, minWidth: 0, flex: 1 },
  messages: { flex: 1, overflowY: "auto", padding: "22px 18px", display: "flex", flexDirection: "column", gap: 14 },
  messageRow: { display: "flex", alignItems: "flex-start", gap: 10 },
  bubble: { maxWidth: "min(720px, 82vw)", borderRadius: 16, padding: "11px 14px", lineHeight: 1.55, whiteSpace: "pre-wrap" },
  userBubble: { background: "var(--cc-bubble-user-bg)", color: "var(--cc-bubble-user-text)", borderBottomRightRadius: 4 },
  assistantBubble: { background: "var(--cc-bubble-assistant-bg)", color: "var(--cc-bubble-assistant-text)", border: "1px solid var(--cc-border)", borderBottomLeftRadius: 4 },
  messageMeta: { marginTop: 8, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, color: "var(--cc-text-secondary)", fontSize: 12 },
  memoryPill: { alignSelf: "center", color: "var(--cc-text-secondary)", background: "var(--cc-bg-hover)", border: "1px solid var(--cc-border)", borderRadius: 999, padding: "5px 10px", fontSize: 12 },
  feedbackBox: { marginTop: 10, display: "flex", gap: 8 },
  editingBar: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--cc-bg-surface)", borderTop: "1px solid var(--cc-border)", padding: "8px 18px", color: "var(--cc-text-secondary)" },
  composer: { display: "flex", alignItems: "flex-end", gap: 10, background: "var(--cc-bg-surface)", borderTop: "1px solid var(--cc-border)", padding: 14 },
  textarea: {
    flex: 1,
    minHeight: 44,
    maxHeight: 130,
    resize: "none",
    overflowY: "auto",
    background: "var(--cc-bg-elevated)",
    color: "var(--cc-text-primary)",
    border: "1px solid var(--cc-border)",
    borderRadius: 14,
    padding: "11px 14px",
    font: "inherit",
    outline: "none",
  },
  textareaTall: {
    width: "100%",
    resize: "vertical",
    background: "var(--cc-bg-elevated)",
    color: "var(--cc-text-primary)",
    border: "1px solid var(--cc-border)",
    borderRadius: 10,
    padding: "10px 12px",
    font: "inherit",
    outline: "none",
    boxSizing: "border-box",
  },
panel: {
  width: "100%",
  minHeight: "100svh",
  padding: "30px 22px",
  display: "grid",
  gap: 16,
  alignContent: "start",
  boxSizing: "border-box",
},
  panelHeader: { display: "flex", alignItems: "center", gap: 12 },
  previewCard: { display: "flex", alignItems: "center", gap: 14, background: "var(--cc-bg-surface)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 18 },
  settingsCard: { background: "var(--cc-bg-surface)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 18 },
  label: { display: "grid", gap: 7, color: "var(--cc-text-secondary)", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.7 },
  labelText: { color: "var(--cc-text-secondary)", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 },
  input: {
    width: "100%",
    background: "var(--cc-bg-elevated)",
    color: "var(--cc-text-primary)",
    border: "1px solid var(--cc-border)",
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
    background: "var(--cc-bg-surface)",
    border: "1px solid var(--cc-border)",
    borderRadius: 12,
    padding: 15,
    cursor: "pointer",
  },
  listText: { display: "grid", gap: 4, minWidth: 0 },
  rowActions: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  renameRow: { display: "flex", gap: 8, width: "100%" },
  emojiGrid: { display: "flex", flexWrap: "wrap", gap: 8 },
  emojiButton: { width: 40, height: 40, background: "var(--cc-bg-surface)", border: "1px solid var(--cc-border)", borderRadius: 10, cursor: "pointer", fontSize: 19 },
  emojiActive: { width: 40, height: 40, background: "var(--cc-bg-hover)", border: "2px solid var(--cc-accent)", borderRadius: 10, cursor: "pointer", fontSize: 19 },
  colorRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  colorSwatch: { width: 32, height: 32, borderRadius: "50%", border: "3px solid transparent", cursor: "pointer" },
  primaryButton: { background: "linear-gradient(135deg, var(--cc-accent), var(--cc-accent-2))", color: "#fff", border: 0, borderRadius: 10, padding: "12px 16px", fontWeight: 800, cursor: "pointer" },
  primarySmall: { background: "linear-gradient(135deg, var(--cc-accent), var(--cc-accent-2))", color: "#fff", border: 0, borderRadius: 10, padding: "8px 13px", fontWeight: 700, cursor: "pointer" },
  outlineButton: { background: "var(--cc-bg-hover)", color: "var(--cc-text-secondary)", border: "1px solid var(--cc-border)", borderRadius: 10, padding: "8px 12px", cursor: "pointer" },
  dangerButton: { background: "#f8717120", color: "#fca5a5", border: "1px solid #f87171", borderRadius: 10, padding: "9px 13px", cursor: "pointer" },
  sendButton: { color: "#fff", border: 0, borderRadius: 12, padding: "12px 16px", minHeight: 44, fontWeight: 800, cursor: "pointer" },
  iconButton: { background: "transparent", color: "var(--cc-text-primary)", border: 0, fontSize: 32, lineHeight: 1, cursor: "pointer" },
  textButton: { background: "transparent", color: "var(--cc-text-secondary)", border: 0, padding: 0, cursor: "pointer", font: "inherit", fontSize: 12 },
};