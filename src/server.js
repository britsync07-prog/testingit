import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { LeadScraper, expandNiches } from "./scraper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const COUNTRY_API = "https://countriesnow.space/api/v0.1";

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const jobs = new Map();
const locationCache = {
  countries: null,
  details: new Map()
};

function createJob() {
  const id = crypto.randomUUID();
  const job = {
    id,
    status: "queued",
    events: [],
    listeners: new Set(),
    files: []
  };
  jobs.set(id, job);
  return job;
}

function pushEvent(job, event) {
  const payload = { ...event, time: new Date().toISOString() };
  job.events.push(payload);
  for (const res of job.listeners) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

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

app.get("/api/metadata", async (_req, res) => {
  try {
    const countries = await getCountries();
    res.json({ countries, source: COUNTRY_API });
  } catch (error) {
    res.status(502).json({ error: `CountriesNow API unavailable: ${error.message}` });
  }
});

app.get("/api/location", async (req, res) => {
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

app.post("/api/expand-niches", (req, res) => {
  const { niches = [] } = req.body || {};
  res.json({ expandedNiches: expandNiches(niches) });
});

app.post("/api/jobs", async (req, res) => {
  const { country, cities, states = [], niches, includeGoogleMaps = true } = req.body || {};

  if (!country || !Array.isArray(cities) || !cities.length || !Array.isArray(niches) || !niches.length) {
    return res.status(400).json({ error: "country, cities, and niches are required." });
  }

  let details;
  try {
    details = await getCountryDetails(country);
  } catch (error) {
    return res.status(502).json({ error: `CountriesNow API unavailable: ${error.message}` });
  }

  const validCities = cities.filter((city) => details.cities.includes(city));
  const validStates = (Array.isArray(states) ? states : []).filter((state) => details.states.includes(state));

  if (!validCities.length) {
    return res.status(400).json({ error: "No valid cities selected for the chosen country." });
  }

  const job = createJob();
  job.status = "running";

  res.status(202).json({ jobId: job.id });

  const scraper = new LeadScraper({
    outputRoot: path.join(__dirname, "..", "output"),
    onProgress: (event) => pushEvent(job, event)
  });

  try {
    const result = await scraper.run({
      jobId: job.id,
      country,
      cities: validCities,
      states: validStates,
      niches,
      includeGoogleMaps: includeGoogleMaps !== false
    });

    job.status = "completed";
    job.files = result.files;
  } catch (error) {
    job.status = "failed";
    pushEvent(job, { type: "job-failed", message: error.message });
  }

  return undefined;
});

app.get("/api/jobs/:jobId/events", (req, res) => {
  const job = jobs.get(req.params.jobId);
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

app.get("/api/jobs/:jobId/files/:fileName", (req, res) => {
  const job = jobs.get(req.params.jobId);
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

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Dashboard server running on http://${HOST}:${PORT}`);
});
