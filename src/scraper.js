import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const nicheExpansionDictionary = {
  fitness: ["Fitness Coach", "Gym Instructor", "Personal Trainer", "Yoga Instructor", "Pilates Teacher"],
  trainer: ["Coach", "Instructor", "Consultant", "Mentor"],
  yoga: ["Yoga Coach", "Yoga Therapist", "Yoga Teacher"],
  pilates: ["Pilates Coach", "Pilates Instructor"]
};

const defaultSites = [
  "linkedin.com/in",
  "facebook.com",
  "instagram.com",
  "reddit.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "youtube.com",
  "pinterest.com",
  "threads.net",
  "snapchat.com",
  "medium.com",
  "substack.com",
  "quora.com",
  "tumblr.com",
  "yelp.com",
  "foursquare.com",
  "nextdoor.com",
  "alignable.com",
  "trustpilot.com",
  "crunchbase.com",
  "wellfound.com",
  "angel.co",
  "about.me",
  "behance.net",
  "dribbble.com",
  "meetup.com",
  "eventbrite.com",
  "locanto.com",
  "gumtree.com",
  "craigslist.org",
  "yellowpages.com",
  "yell.com",
  "hotfrog.com",
  "manta.com",
  "kompass.com",
  "clutch.co",
  "tripadvisor.com",
  "google.com/maps"
];

export function expandNiches(baseNiches) {
  const expanded = new Set();

  for (const niche of baseNiches) {
    const trimmed = niche.trim();
    if (!trimmed) continue;

    expanded.add(trimmed);
    const lower = trimmed.toLowerCase();

    for (const [token, matches] of Object.entries(nicheExpansionDictionary)) {
      if (lower.includes(token)) {
        matches.forEach((match) => expanded.add(match));
      }
    }

    if (lower.includes("trainer")) {
      expanded.add(trimmed.replace(/trainer/i, "coach"));
      expanded.add(trimmed.replace(/trainer/i, "instructor"));
    }
  }

  return Array.from(expanded).filter(Boolean);
}

export class LeadScraper {
  constructor({ outputRoot = "output", onProgress = () => {}, sites = defaultSites } = {}) {
    this.outputRoot = outputRoot;
    this.onProgress = onProgress;
    this.sites = Array.from(new Set((sites || []).filter(Boolean)));
    this.child = null;
  }

  stop() {
    if (this.child) {
      this.child.kill("SIGTERM");
      return true;
    }
    return false;
  }

  async run({ jobId, country, cities, states = [], niches, includeGoogleMaps = true }) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const scriptPath = path.join(__dirname, "scraper.py");

    const venvPython = path.join(__dirname, "..", "venv", "bin", "python3");
    const pythonCmd = fs.existsSync(venvPython) ? venvPython : "python3";

    const payload = {
      outputDir: path.join(this.outputRoot, jobId),
      country,
      cities,
      states,
      niches,
      includeGoogleMaps,
      sites: this.sites
    };

    return new Promise((resolve, reject) => {
      this.child = spawn(pythonCmd, [scriptPath, JSON.stringify(payload)], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PYTHONUNBUFFERED: "1" }
      });

      let stderr = "";
      let finalResult = null;

      this.child.stderr.on("data", (chunk) => {
        const message = chunk.toString();
        stderr += message;
        // Also pipe to real-time stderr for visibility in terminal
        process.stderr.write(message);
      });

      let buffer = "";
      this.child.stdout.on("data", (chunk) => {
        const raw = chunk.toString();
        // Also pipe to real-time stdout for visibility in terminal
        // but only if it's not JSON, or we can just pipe everything to be safe
        // Actually, we want to avoid double printing JSON if server.js also prints it.
        // Let's just push it to the buffer for parsing.
        buffer += raw;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const event = JSON.parse(trimmed);
            if (event.type === "result" || event.type === "job-complete" || event.type === "job-completed") {
              finalResult = {
                files: event.files || [],
                expandedNiches: event.expandedNiches || expandNiches(niches),
                sites: event.sites || this.sites
              };
            }
            // Always pass the event to onProgress so the UI gets it
            this.onProgress(event);
          } catch {
            this.onProgress({ type: "log", message: trimmed });
          }
        }
      });

      this.child.on("close", (code) => {
        this.child = null;
        if (code !== 0 && code !== null) { // code is null if killed
          reject(new Error(stderr || `Python scraper exited with code ${code}`));
          return;
        }

        resolve(finalResult || { files: [], expandedNiches: expandNiches(niches), sites: this.sites });
      });
    });
  }
}
