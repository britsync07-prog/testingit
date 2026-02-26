import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import BusinessScraper from "./maps.js";
import { extractPhones, buildPhoneQueryTerm } from "./phone_utils.js";

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
  constructor({ outputRoot = "output", onProgress = () => { }, sites = defaultSites } = {}) {
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
      this.mapsScraper.close().catch(() => { });
    }
    return true;
  }

  async runMapsScraper({ country, cities, niches, outputDir, userPlan }) {
    this.mapsScraper = new BusinessScraper();
    await this.mapsScraper.init();

    // --- FILE SETUP ---
    const allEmailsPath = path.join(outputDir, "all_emails.txt");
    const mapsOnlyEmailsPath = path.join(outputDir, "google_maps_emails.txt");
    const countryPhoneFile = path.join(outputDir, `${country.replace(/[^a-zA-Z0-9]/g, "_")}_phones.txt`);
    const allPhonesPath = path.join(outputDir, "all_phones.txt");
    const seenEmails = new Set();
    const seenPhones = new Set();

    // Pre-load existing emails
    if (fs.existsSync(allEmailsPath)) {
      fs.readFileSync(allEmailsPath, "utf8").split("\n").forEach(e => { if (e.trim()) seenEmails.add(e.trim().toLowerCase()); });
    }
    // Pre-load existing phones
    if (fs.existsSync(allPhonesPath)) {
      fs.readFileSync(allPhonesPath, "utf8").split("\n").forEach(p => { if (p.trim()) seenPhones.add(p.trim()); });
    }

    try {
      for (const city of cities) {
        if (this.isStopped) break;

        const safeCity = city.replace(/[^a-zA-Z0-9_-]/g, "_");

        for (const niche of niches) {
          if (this.isStopped) break;

          const query = `"${niche}" in "${city} ${country}"`;
          this.onProgress({ type: "log", message: `[Maps] Searching: ${query}` });

          await this.mapsScraper.scrapeGoogleMaps(query, 999);
          let leads = await this.mapsScraper.processResults(999);

          if (userPlan === 'advance' || userPlan === 'premium') {
            const originalCount = leads.length;
            leads = leads.filter(lead => {
              const hasEmail = lead.possibleEmails && lead.possibleEmails.length > 0;
              const rawPhone = lead.phone || "";
              const extractedPhones = rawPhone
                ? extractPhones(rawPhone, country)
                : extractPhones([lead.name, lead.address].join(" "), country);
              const hasPhone = extractedPhones && extractedPhones.length > 0;

              return hasEmail && hasPhone;
            });
            this.onProgress({ type: "log", message: `[Maps] Strict Quality Filter applied: Kept ${leads.length} out of ${originalCount} leads.` });
          }

          // Save the raw JSON data just in case you need business names/phones later
          const mapsLeadsJsonName = `maps_${safeCity}_leads.json`;
          const mapsLeadsJsonPath = path.join(outputDir, mapsLeadsJsonName);
          fs.writeFileSync(mapsLeadsJsonPath, JSON.stringify(leads, null, 2));

          let newEmailsFound = 0;
          let newPhonesFound = 0;
          for (const lead of leads) {
            // ── EMAILS ──────────────────────────────────────
            for (const email of lead.possibleEmails) {
              if (!email) continue;
              const eLower = email.toLowerCase();
              if (!seenEmails.has(eLower)) {
                seenEmails.add(eLower);
                fs.appendFileSync(mapsOnlyEmailsPath, email + "\n", "utf8");
                fs.appendFileSync(allEmailsPath, email + "\n", "utf8");
                newEmailsFound++;
                this.onProgress({
                  type: "lead-saved",
                  fileName: mapsLeadsJsonName,
                  emailFileName: "google_maps_emails.txt",
                  allEmailsFileName: "all_emails.txt",
                  message: `[Maps] Found New Email: ${email}`
                });
              }
            }

            // ── PHONES ──────────────────────────────────────
            // Phone field directly from Maps
            const rawPhone = lead.phone || "";
            const extractedPhones = rawPhone
              ? extractPhones(rawPhone, country)
              : extractPhones([lead.name, lead.address].join(" "), country);

            for (const phone of extractedPhones) {
              if (!seenPhones.has(phone)) {
                seenPhones.add(phone);
                fs.appendFileSync(countryPhoneFile, phone + "\n", "utf8");
                fs.appendFileSync(allPhonesPath, phone + "\n", "utf8");
                newPhonesFound++;
                this.onProgress({
                  type: "phone-saved",
                  phone,
                  city: lead.address || "",
                  niche: niches[0] || "",
                  site: "Google Maps",
                  title: lead.name,
                  phoneFileName: path.basename(countryPhoneFile),
                  allPhonesFileName: "all_phones.txt",
                  message: `[Maps] Phone: ${phone}`
                });
              }
            }
          }

          // ── CSV EXPORT ──────────────────────────────────────
          if (leads.length > 0) {
            const csvFileName = `google_maps_all.csv`;
            const csvPath = path.join(outputDir, csvFileName);

            // Build CSV header if file doesn't exist yet
            const fileExists = fs.existsSync(csvPath);
            let csvContent = "";
            if (!fileExists) {
              csvContent += "Name,Phone,Emails,Website,Rating,Address,Source Link\n";
            }

            leads.forEach(lead => {
              const escapeCsv = (str) => `"${(str || '').toString().replace(/"/g, '""')}"`;
              const emailsStr = lead.possibleEmails && lead.possibleEmails.length
                ? lead.possibleEmails.join('; ')
                : '';

              csvContent += [
                escapeCsv(lead.name),
                escapeCsv(lead.phone),
                escapeCsv(emailsStr),
                escapeCsv(lead.website),
                escapeCsv(lead.rating),
                escapeCsv(lead.address),
                escapeCsv(lead.referenceLink)
              ].join(",") + "\n";
            });

            fs.appendFileSync(csvPath, csvContent, "utf8");
            this.onProgress({
              type: "csv-saved",
              fileName: csvFileName,
              message: `[Maps] Saved ${leads.length} leads to CSV: ${csvFileName}`
            });
          }

          this.onProgress({
            type: "log",
            message: `[Maps] Query done. ${newEmailsFound} new emails, ${newPhonesFound} new phones.`
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

  async run({ jobId, country, cities, states = [], niches, includeGoogleMaps = true, scrapeMode = 'emails', sites, userPlan = 'basic' }) {
    if (sites && sites.length) {
      this.sites = sites;
    }

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const scriptPath = path.join(__dirname, "scraper.py");
    const outputDir = path.join(this.outputRoot, jobId);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const expandedNichesList = expandNiches(niches);
    const doEmails = scrapeMode === 'emails' || scrapeMode === 'both';

    // 1. Run Google Maps Scraper (useful for both phones and emails)
    if (includeGoogleMaps && !this.isStopped) {
      this.onProgress({ type: "log", message: "Starting Google Maps Scraper phase..." });
      await this.runMapsScraper({ country, cities, niches: expandedNichesList, outputDir, userPlan });
    }

    // 2. Run Google Search Scraper FIRST
    if (this.isStopped) {
      return { files: [], expandedNiches: expandedNichesList, sites: this.sites };
    }

    this.onProgress({ type: "log", message: "Maps phase complete. Starting Google Search phase..." });

    const payload = {
      outputDir,
      country,
      cities,
      states,
      niches,
      includeGoogleMaps: false,
      sites: this.sites,
      scrapeMode
    };

    const runScraperProcess = (cmd, args, name) => {
      return new Promise((resolve, reject) => {
        this.child = spawn(cmd, args, {
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
        let finalResult = null;

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
                finalResult = event;
                continue;
              }
              this.onProgress(event);
            } catch {
              this.onProgress({ type: "log", message: `[${name}] ${trimmed}` });
            }
          }
        });

        this.child.on("close", (code) => {
          if (code !== 0 && code !== null) {
            reject(new Error(stderr || `${name} exited with code ${code}`));
            return;
          }
          resolve(finalResult);
        });
      });
    };

    try {
      const googleScriptPath = path.join(__dirname, "google_scraper.js");
      await runScraperProcess(process.execPath, [googleScriptPath, JSON.stringify(payload)], "Google");
    } catch (googleError) {
      this.onProgress({ type: "log", message: `Google scraper failed: ${googleError.message}. Falling back to DuckDuckGo (Python)...` });

      if (this.isStopped) {
        return { files: [], expandedNiches: expandedNichesList, sites: this.sites };
      }

      const venvPython = path.join(__dirname, "..", "venv", "bin", "python3");
      const pythonCmd = fs.existsSync(venvPython) ? venvPython : "python3";
      await runScraperProcess(pythonCmd, [scriptPath, JSON.stringify(payload)], "Python");
    }

    try {

      // 3. Finalize and report total collected files
      const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.txt') || f.endsWith('.json') || f.endsWith('.csv'));
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
