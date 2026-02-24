import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import session from "express-session";
import sessionFileStore from "session-file-store";
import validator from "html-validator";
import juice from "juice";
import { authenticate, requireAuth } from "./auth.js";
import { JobQueue } from "./queue.js";
import { expandNiches } from "./scraper.js";

const FileStore = sessionFileStore(session);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const COUNTRY_API = "https://countriesnow.space/api/v0.1";

const queue = new JobQueue(3);
await queue.loadHistory();

// Ensure sessions directory exists
const sessionsDir = path.join(__dirname, "..", "data", "sessions");
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(
  session({
    store: new FileStore({
      path: sessionsDir,
      retries: 5,
      ttl: 30 * 24 * 60 * 60, // 30 days
      logFn: () => { }, // Silences the retry logs
    }),
    secret: "company-secret-key-12345", // Change this to a secure random string in production
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  })
);

const locationCache = {
  countries: null,
  details: new Map()
};

// --- AUTH ROUTES ---

app.post("/api/login", async (req, res) => {
  const { username, password, rememberMe } = req.body;
  const user = await authenticate(username, password);
  if (user) {
    req.session.user = user;
    if (rememberMe) {
      // 30 days session
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    } else {
      // Session cookie (cleared when browser closes)
      req.session.cookie.expires = false;
    }
    return res.json({ username: user.username });
  }
  return res.status(401).json({ error: "Invalid username or password" });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.status(204).end();
});

app.get("/api/me", (req, res) => {
  if (req.session.user) {
    const activeJob = Array.from(queue.jobs.values()).find(
      j => j.userId === req.session.user.username && (j.status === "running" || j.status === "queued")
    );
    return res.json({
      username: req.session.user.username,
      activeJobId: activeJob ? activeJob.id : null
    });
  }
  return res.status(401).json({ error: "Not logged in" });
});

// --- HELPER FUNCTIONS ---

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);

  if (!response.ok || payload?.error === true) {
    const message = payload?.msg || payload?.message || `Failed request ${url}: ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function getCountries() {
  if (locationCache.countries) return locationCache.countries;

  const payload = await fetchJson(`${COUNTRY_API}/countries`);
  const countries = (payload.data || [])
    .map((item) => item.country)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  locationCache.countries = countries;
  return countries;
}

async function getCountryDetails(country) {
  if (locationCache.details.has(country)) return locationCache.details.get(country);

  const [statesPayload, citiesPayload] = await Promise.all([
    fetchJson(`${COUNTRY_API}/countries/states`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country })
    }),
    fetchJson(`${COUNTRY_API}/countries/cities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country })
    })
  ]);

  const states = (statesPayload.data?.states || [])
    .map((item) => item.name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const cities = (citiesPayload.data || [])
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const details = {
    states: Array.from(new Set(states)),
    cities: Array.from(new Set(cities))
  };

  locationCache.details.set(country, details);
  return details;
}

// --- API ROUTES ---

const checkerCallbacks = new Map();

app.post("/api/checker/callback", (req, res) => {
  const { requestId, message, details } = req.body;
  console.log(`Received callback for ${requestId}: ${message}`);
  if (!requestId) return res.status(400).json({ error: "requestId is required" });

  checkerCallbacks.set(requestId, {
    message,
    details,
    timestamp: Date.now()
  });

  // Cleanup old callbacks after 10 minutes
  setTimeout(() => checkerCallbacks.delete(requestId), 10 * 60 * 1000);

  res.json({ success: true });
});

app.get("/api/checker/status/:requestId", requireAuth, (req, res) => {
  const result = checkerCallbacks.get(req.params.requestId);
  if (result) {
    return res.json(result);
  }
  res.status(404).json({ error: "No update yet" });
});

app.get("/api/metadata", requireAuth, async (_req, res) => {
  try {
    const countries = await getCountries();
    res.json({ countries, source: COUNTRY_API });
  } catch (error) {
    res.status(502).json({ error: `CountriesNow API unavailable: ${error.message}` });
  }
});

app.get("/api/location", requireAuth, async (req, res) => {
  const country = req.query.country;
  if (!country || typeof country !== "string") {
    return res.status(400).json({ error: "country query param is required" });
  }

  try {
    const details = await getCountryDetails(country);
    return res.json({ ...details, source: COUNTRY_API, country });
  } catch (error) {
    return res.status(502).json({ error: `CountriesNow API unavailable: ${error.message}` });
  }
});

app.post("/api/expand-niches", requireAuth, (req, res) => {
  const { niches = [] } = req.body || {};
  res.json({ expandedNiches: expandNiches(niches) });
});

app.get("/api/categories", requireAuth, (req, res) => {
  const categories = queue.getCategories(req.session.user.username);
  res.json({ categories });
});

app.post("/api/categories", requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Category name is required" });
  }

  // Basic dupe check (case-insensitive)
  const existing = queue.getCategories(req.session.user.username);
  if (existing.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    return res.status(400).json({ error: "Category already exists" });
  }

  const category = queue.addCategory(name.trim(), req.session.user.username);
  res.status(201).json({ category });
});

app.post("/api/jobs", requireAuth, async (req, res) => {
  const { country, cities, states = [], niches, includeGoogleMaps = true, scrapeMode = 'emails', sites, category } = req.body || {};

  if (queue.hasUserActiveJob(req.session.user.username)) {
    return res.status(429).json({ error: "You already have a job running or in the queue. Please wait or stop the current job before starting a new one." });
  }

  if (!country || !Array.isArray(cities) || !cities.length || !Array.isArray(niches) || !niches.length) {
    return res.status(400).json({ error: "country, cities, and niches are required." });
  }

  try {
    await getCountryDetails(country); // Validate country/fetch cache
  } catch (error) {
    return res.status(502).json({ error: `CountriesNow API unavailable: ${error.message}` });
  }

  const jobData = {
    id: crypto.randomUUID(),
    params: { country, cities, states, niches, includeGoogleMaps, scrapeMode, sites, category }
  };

  const job = queue.addJob(jobData, req.session.user.username);
  res.status(202).json({ jobId: job.id, status: job.status });
});

app.get("/api/jobs/:jobId/events", requireAuth, (req, res) => {
  const job = queue.getJob(req.params.jobId);
  if (!job) return res.status(404).end();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  for (const event of job.events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  job.listeners.add(res);

  req.on("close", () => {
    job.listeners.delete(res);
  });

  return undefined;
});

app.get("/api/jobs/:jobId/files/:fileName", requireAuth, (req, res) => {
  const job = queue.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  const fileName = req.params.fileName;
  if (!job.files.includes(fileName)) {
    return res.status(404).json({ error: "File not available for this job" });
  }

  const filePath = path.join(__dirname, "..", "output", job.id, fileName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found on disk" });
  }

  return res.download(filePath);
});

app.post("/api/jobs/:jobId/stop", requireAuth, (req, res) => {
  const success = queue.stopJob(req.params.jobId);
  if (success) {
    return res.json({ message: "Job stop initiated" });
  }
  return res.status(404).json({ error: "Job not found or not in a stoppable state" });
});

app.get("/api/history", requireAuth, (req, res) => {
  const history = queue.getUserHistory(req.session.user.username);
  res.json(history);
});

app.get("/api/queue", requireAuth, (req, res) => {
  res.json(queue.getQueueStatus());
});

app.post("/api/check-template", requireAuth, async (req, res) => {
  const { html, testEmail, subject } = req.body;
  if (!html) return res.status(400).json({ error: "No HTML template provided" });

  const spamWords = ["free", "win", "winner", "prize", "cash", "act now", "limited time", "guarantee", "congratulations", "urgent", "money", "income", "profit", "earn", "dollar", "crypto", "bitcoin", "lottery", "gift card", "reward", "viagra", "pharmacy", "medicine", "drugs", "no cost", "best price", "save big", "buy now", "click here", "subscribe", "urgent", "secret", "unlimited", "apply now", "claims", "collect", "extra", "junk", "marketing", "promotion", "sales", "special", "stop", "unsubscribe"];

  const findings = [];
  let spamScore = 0;
  let webhookStatus = null;
  const requestId = crypto.randomUUID();

  // Webhook integration
  if (testEmail) {
    try {
      // If n8n is in docker, localhost:5678 works if port is mapped to host
      const webhookResponse = await fetch("http://127.0.0.1:5678/webhook-test/get", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: testEmail,
          subject: subject || "Test Email",
          html,
          requestId // Send this to n8n so it can call back
        })
      });

      if (webhookResponse.ok) {
        try {
          const n8nData = await webhookResponse.json();
          webhookStatus = n8nData.message || n8nData.status || "Test email successfully sent to n8n!";
        } catch (e) {
          webhookStatus = "Test email sent, but n8n returned an empty response.";
        }
      } else {
        const errorText = await webhookResponse.text();
        webhookStatus = `Webhook Error: ${webhookResponse.status} - ${errorText || webhookResponse.statusText}`;
      }
    } catch (error) {
      webhookStatus = `Failed to connect to n8n: ${error.message}`;
    }
  }

  // Check for spam words (case insensitive)
  const lowerHtml = html.toLowerCase();
  spamWords.forEach(word => {
    if (lowerHtml.includes(word)) {
      spamScore += 1;
      findings.push(`Spam word found: "${word}"`);
    }
  });

  // Structural checks
  if (html.length < 100) findings.push("Template is too short (might be flagged as spam).");
  if (!html.includes("<img")) findings.push("No images found (plain text emails are okay, but rich templates should have some images).");
  if (html.includes("<img") && !html.includes("alt=")) findings.push("Images found without alt tags (common spam indicator).");
  if (html.includes("<style") && !juice(html).includes("style=")) findings.push("Styles are not inlined (essential for email delivery).");
  if (!html.includes("unsubscribe") && !html.includes("stop")) findings.push("No unsubscribe link or footer found (high spam risk).");

  // HTML Validation
  try {
    const result = await validator({ data: html, format: "json" });
    const errors = result.messages.filter(m => {
      if (m.type !== "error") return false;

      const msg = m.message.toLowerCase();
      // Ignore common email-specific false positives
      if (msg.includes("xmlns:v") || msg.includes("xmlns:o")) return false;
      if (msg.includes("mso-")) return false;
      if (msg.includes("doctype")) return false;
      if (msg.includes("meta") && msg.includes("attribute") && msg.includes("property") && msg.includes("not allowed")) return false;
      if (msg.includes("meta") && msg.includes("missing") && (msg.includes("content") || msg.includes("property"))) return false;

      return true;
    });

    if (errors.length > 0) {
      findings.push(`HTML Syntax Errors (${errors.length}):`);
      errors.forEach(err => {
        findings.push(`- Line ${err.lastLine || err.lastRow || '?'}: ${err.message}`);
      });
      spamScore += errors.length;
    }
  } catch (e) {
    findings.push("HTML Validation failed to run (might be malformed).");
  }

  const passed = spamScore < 5;
  res.json({
    passed,
    spamScore,
    findings,
    webhookStatus,
    requestId,
    status: passed ? "PASS" : "FAIL"
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Dashboard server running on http://${HOST}:${PORT}`);
});
