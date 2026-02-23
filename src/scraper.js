import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import BusinessScraper from "./maps.js";

const nicheExpansionDictionary = {
  fitness: ["Fitness Coach", "Gym Instructor", "Personal Trainer", "Yoga Instructor", "Pilates Teacher"],
  trainer: ["Coach", "Instructor", "Consultant", "Mentor"],
  yoga: ["Yoga Coach", "Yoga Therapist", "Yoga Teacher"],
  pilates: ["Pilates Coach", "Pilates Instructor"]
};

const defaultSites = [
  "linkedin.com/in", "facebook.com", "instagram.com", "reddit.com", "x.com",
  "twitter.com", "tiktok.com", "youtube.com", "pinterest.com", "threads.net",
  "snapchat.com", "medium.com", "substack.com", "quora.com", "tumblr.com",
  "yelp.com", "foursquare.com", "nextdoor.com", "alignable.com", "trustpilot.com",
  "crunchbase.com", "wellfound.com", "angel.co", "about.me", "behance.net",
  "dribbble.com", "meetup.com", "eventbrite.com", "locanto.com", "gumtree.com",
  "craigslist.org", "yellowpages.com", "yell.com", "hotfrog.com", "manta.com",
  "kompass.com", "clutch.co", "tripadvisor.com"
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
    this.mapsScraper = null;
    this.isStopped = false;
  }

  stop() {
    this.isStopped = true;
    if (this.child) {
      this.child.kill("SIGTERM");
    }
    if (this.mapsScraper) {
      this.mapsScraper.close().catch(() => {});
    }
    return true;
  }

  async runMapsScraper({ country, cities, niches, outputDir }) {
    this.mapsScraper = new BusinessScraper();
    await this.mapsScraper.init();
    
    // --- FILE SETUP ---
    const allEmailsPath = path.join(outputDir, "all_emails.txt");
    const mapsOnlyEmailsPath = path.join(outputDir, "google_maps_emails.txt"); 
    const seenEmails = new Set();
    
    if (fs.existsSync(allEmailsPath)) {
        const existing = fs.readFileSync(allEmailsPath, "utf8").split("\n");
        existing.forEach(e => {
            if (e.trim()) seenEmails.add(e.trim().toLowerCase());
        });
    }

    try {
        for (const city of cities) {
            if (this.isStopped) break;
            
            const safeCity = city.replace(/[^a-zA-Z0-9_-]/g, "_");

            for (const niche of niches) {
                if (this.isStopped) break;

                const query = `"${niche}" in "${city} ${country}"`;
                this.onProgress({ type: "log", message: `[Maps] Searching: ${query}` });
                
                await this.mapsScraper.scrapeGoogleMaps(query, 20); 
                const leads = await this.mapsScraper.processResults(20);
                
                // Save the raw JSON data just in case you need business names/phones later
                const mapsLeadsJsonName = `maps_${safeCity}_leads.json`;
                const mapsLeadsJsonPath = path.join(outputDir, mapsLeadsJsonName);
                fs.writeFileSync(mapsLeadsJsonPath, JSON.stringify(leads, null, 2));
                
                let newEmailsFound = 0;
                for (const lead of leads) {
                    for (const email of lead.possibleEmails) {
                        if (!email) continue;
                        const eLower = email.toLowerCase();
                        
                        if (!seenEmails.has(eLower)) {
                            seenEmails.add(eLower);
                            
                            // 1. ADD TO SEPARATE GOOGLE MAPS TXT FILE
                            fs.appendFileSync(mapsOnlyEmailsPath, email + "\n", "utf8");
                            
                            // 2. ADD TO MASTER ALL EMAILS FILE
                            fs.appendFileSync(allEmailsPath, email + "\n", "utf8");
                            
                            newEmailsFound++;
                            
                            // NEW: Fire the lead-saved event so the UI updates instantly
                            this.onProgress({ 
                                type: "lead-saved", 
                                fileName: mapsLeadsJsonName,
                                emailFileName: "google_maps_emails.txt",
                                allEmailsFileName: "all_emails.txt",
                                message: `[Maps] Found New Email: ${email}` 
                            });
                        }
                    }
                }
                this.onProgress({ 
                    type: "log", 
                    message: `[Maps] Query completed. Extracted ${newEmailsFound} new emails.` 
                });
            }
        }
    } catch (error) {
        this.onProgress({ type: "log", message: `[Maps] Error: ${error.message}` });
    } finally {
        if (this.mapsScraper) {
            await this.mapsScraper.close();
            this.mapsScraper = null;
        }
    }
  }

  async run({ jobId, country, cities, states = [], niches, includeGoogleMaps = true }) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const scriptPath = path.join(__dirname, "scraper.py");
    const outputDir = path.join(this.outputRoot, jobId);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const expandedNichesList = expandNiches(niches);

    // 1. Run Google Maps Scraper FIRST
    if (includeGoogleMaps && !this.isStopped) {
        this.onProgress({ type: "log", message: "Starting Google Maps Scraper phase..." });
        await this.runMapsScraper({ country, cities, niches: expandedNichesList, outputDir });
    }

    // 2. Run Python Social Scraper SECOND
    if (this.isStopped) {
        return { files: [], expandedNiches: expandedNichesList, sites: this.sites };
    }

    this.onProgress({ type: "log", message: "Maps phase complete. Starting Social Scraper (Python)..." });

    const venvPython = path.join(__dirname, "..", "venv", "bin", "python3");
    const pythonCmd = fs.existsSync(venvPython) ? venvPython : "python3";

    const payload = {
      outputDir,
      country,
      cities,
      states,
      niches,
      includeGoogleMaps: false, 
      sites: this.sites
    };

    const pythonTask = new Promise((resolve, reject) => {
      this.child = spawn(pythonCmd, [scriptPath, JSON.stringify(payload)], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PYTHONUNBUFFERED: "1" }
      });

      let stderr = "";
      this.child.stderr.on("data", (chunk) => {
        const message = chunk.toString();
        stderr += message;
        process.stderr.write(message);
      });

      let buffer = "";
      let pythonFinalResult = null;

      this.child.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const event = JSON.parse(trimmed);
            if (event.type === "result" || event.type === "job-complete" || event.type === "job-completed") {
              pythonFinalResult = event;
              continue; 
            }
            this.onProgress(event);
          } catch {
            this.onProgress({ type: "log", message: trimmed });
          }
        }
      });

      this.child.on("close", (code) => {
        if (code !== 0 && code !== null) {
          reject(new Error(stderr || `Python scraper exited with code ${code}`));
          return;
        }
        resolve(pythonFinalResult);
      });
    });

    try {
        await pythonTask; 
        
        // 3. Finalize and report total collected files
        const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.txt') || f.endsWith('.json'));
        const finalResult = {
            files,
            expandedNiches: expandedNichesList,
            sites: this.sites
        };
        
        this.onProgress({ type: "job-complete", files, message: "All scraping tasks completed successfully." });
        return finalResult;
        
    } catch (error) {
        throw error;
    } finally {
        this.child = null;
        this.isStopped = false;
    }
  }
}
