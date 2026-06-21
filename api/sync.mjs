// =============================================================================
// api/sync.mjs
// Vercel serverless function — the ONLY place that ever touches REDIS_URL.
// Never import a Redis client into anything under src/, since that code
// ships to the browser and REDIS_URL must never be exposed client-side.
//
// Routes (Vercel strips the .mjs extension, so this lives at /api/sync):
//   GET  /api/sync?code=ABCD1234        -> { payload, updatedAt }
//   POST /api/sync  { code, payload }   -> { ok: true, updatedAt }
//
// Data model: one Redis key per sync code, holding a JSON blob:
//   { payload: { conversations, profile, customCharacters }, updatedAt }
// =============================================================================
import { createClient } from "redis";

let clientPromise;

function getClient() {
  if (!clientPromise) {
    const client = createClient({ url: process.env.REDIS_URL });
    client.on("error", (error) => console.error("Redis client error:", error));
    clientPromise = client.connect().then(() => client);
  }
  return clientPromise;
}

// Matches the client-side alphabet (no 0/O/1/I/L) so codes are easy to read
// and re-type by hand, with length 6-24 to allow either generated or
// hand-picked codes.
const CODE_PATTERN = /^[A-Z2-9]{6,24}$/;
const TTL_SECONDS = 60 * 60 * 24 * 180; // 180 days of inactivity before a code's data expires
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024; // 4MB safety cap (free Redis tier is 30MB total)

function keyFor(code) {
  return `charachat:sync:${code}`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const rawCode = req.method === "GET" ? req.query?.code : req.body?.code;
  const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";

  if (!CODE_PATTERN.test(code)) {
    return res.status(400).json({ error: "Invalid sync code" });
  }

  let client;
  try {
    client = await getClient();
  } catch (error) {
    console.error("Redis connection failed:", error);
    return res.status(503).json({ error: "Sync service unavailable" });
  }

  if (req.method === "GET") {
    try {
      const raw = await client.get(keyFor(code));
      if (!raw) return res.status(404).json({ error: "No data synced for this code yet" });
      return res.status(200).json(JSON.parse(raw));
    } catch (error) {
      console.error("Sync read failed:", error);
      return res.status(500).json({ error: "Could not read synced data" });
    }
  }

  if (req.method === "POST") {
    const payload = req.body?.payload;
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "Missing payload" });
    }

    const record = { payload, updatedAt: Date.now() };
    const serialized = JSON.stringify(record);

    if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) {
      return res.status(413).json({ error: "Synced data too large" });
    }

    try {
      await client.set(keyFor(code), serialized, { EX: TTL_SECONDS });
      return res.status(200).json({ ok: true, updatedAt: record.updatedAt });
    } catch (error) {
      console.error("Sync write failed:", error);
      return res.status(500).json({ error: "Could not save synced data" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
