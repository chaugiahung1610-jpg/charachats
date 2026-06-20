const GEMINI_MODEL = "gemini-2.5-flash";
const API_KEY = import.meta.env.VITE_GEMINI_KEY?.trim();

export function geminiMode() {
  return API_KEY ? "direct" : "missing";
}

export function geminiSetupMessage() {
  if (!API_KEY) {
    return "Missing Gemini setup. Add VITE_GEMINI_KEY to your .env file.";
  }

  return "Gemini API is connected.";
}

async function requestGemini(prompt) {
  if (!API_KEY) {
    throw new Error("Missing Gemini API configuration");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
      }),
    }
  );

  const data = await response.json();

  console.log("Gemini response:", data);

  if (!response.ok || data.error) {
    throw new Error(
      data.error?.message ||
      `Gemini request failed (${response.status})`
    );
  }

  return (
    data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ""
  );
}

export async function callCharacter(systemPrompt, messages) {
  const chat = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const prompt =
`SYSTEM:
${systemPrompt}

CHAT:
${chat}

Stay completely in character and reply naturally.`;

  return requestGemini(prompt);
}

export async function summarizeMessages(
  messages,
  existingSummary,
  userName
) {
  const chat = messages
    .map(
      (m) =>
        `${m.role === "user"
          ? userName || "User"
          : "Character"}: ${m.content}`
    )
    .join("\n");

  const previous = existingSummary
    ? `Existing memory:\n${existingSummary}\n\n`
    : "";

  return requestGemini(
`${previous}
${chat}

Write a concise memory summary in 2-3 sentences.
Include:
- Important events
- Emotional moments
- Useful context
Be brief.`
  );
}

export function apiErrorMessage(error) {
  console.error("Gemini Error:", error);

  return error?.message || "Unknown Gemini error";
}