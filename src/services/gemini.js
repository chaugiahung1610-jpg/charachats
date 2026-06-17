const GEMINI_MODEL = "gemini-2.5-flash";
const DIRECT_KEY = import.meta.env.VITE_GEMINI_KEY?.trim();
const PROXY_ENDPOINT = import.meta.env.VITE_GEMINI_ENDPOINT?.trim();

export function geminiMode() {
  if (PROXY_ENDPOINT) return "proxy";
  if (DIRECT_KEY) return "direct";
  return "missing";
}

export function geminiSetupMessage() {
  if (geminiMode() === "missing") {
    return "Missing Gemini setup. Add VITE_GEMINI_ENDPOINT or VITE_GEMINI_KEY to your local .env file.";
  }

  if (geminiMode() === "direct") {
    return "Using VITE_GEMINI_KEY in the browser. This is okay for local testing, but use VITE_GEMINI_ENDPOINT for a real deployment.";
  }

  return "Using a protected Gemini endpoint.";
}

async function requestGemini(prompt) {
  if (PROXY_ENDPOINT) {
    const res = await fetch(PROXY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Proxy request failed with ${res.status}`);
    return data.text?.trim() ?? "";
  }

  if (!DIRECT_KEY) {
    throw new Error("Missing Gemini API configuration");
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${DIRECT_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    },
  );

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `Gemini request failed with ${res.status}`);
  }

  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
}

export async function callCharacter(systemPrompt, messages) {
  const chat = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
  return requestGemini(`SYSTEM:\n${systemPrompt}\n\nCHAT:\n${chat}\n\nStay in character. Reply naturally.`);
}

export async function summarizeMessages(messages, existingSummary, userName) {
  const chat = messages
    .map((m) => `${m.role === "user" ? userName || "User" : "Character"}: ${m.content}`)
    .join("\n");
  const previous = existingSummary ? `Existing memory: ${existingSummary}\n\nAlso include:\n` : "";
  return requestGemini(`${previous}${chat}\n\nWrite a concise 2-3 sentence memory. Key events, emotions, context only. Be brief.`);
}

export function apiErrorMessage(error) {
  const message = error?.message?.toLowerCase() ?? "";

  if (message.includes("missing gemini")) {
    return "Gemini is not set up yet. Check your .env settings.";
  }

  if (message.includes("429") || message.includes("quota") || message.includes("rate")) {
    return "I'm thinking too much right now. Try again in a bit!";
  }

  return "Hmm... something went weird. Can you say that again?";
}
