import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const nicheExpansionDictionary = {
  fitness: ["Fitness Coach", "Gym Instructor", "Personal Trainer", "Yoga Instructor", "Pilates Teacher"],
  trainer: ["Coach", "Instructor", "Consultant", "Mentor"],
  yoga: ["Yoga Coach", "Yoga Therapist", "Yoga Teacher"],
  pilates: ["Pilates Coach", "Pilates Instructor"]
};

const areaHints = ["city centre", "north", "south", "east", "west", "near me"];

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

function buildCityAreaPairs(cities, states = []) {
  const cityAreaPairs = [];
  const stateAwareHints = [...areaHints, ...states];

  for (const city of cities) {
    for (const area of stateAwareHints) {
      cityAreaPairs.push({ city, area });
    }
    cityAreaPairs.push({ city, area: "" });
  }

  return cityAreaPairs;
}

function sanitizeFileName(input) {
  return input.replace(/[^a-z0-9_-]/gi, "_");
}

export class LeadScraper {
  constructor({ outputRoot = "output", onProgress = () => {} } = {}) {
    this.outputRoot = outputRoot;
    this.onProgress = onProgress;
    this.browser = null;
  }

  async setupBrowser() {
    this.browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1920,1080"]
    });
  }

  async scrapeSearchPage(page, query) {
    await page.goto("https://duckduckgo.com/", { waitUntil: "networkidle2" });
    await page.waitForSelector("input[name='q']", { timeout: 20000 });

    await page.click("input[name='q']", { clickCount: 3 });
    await page.type("input[name='q']", query, { delay: 20 });
    await page.keyboard.press("Enter");

    try {
      await page.waitForSelector("article, li[data-layout='organic']", { timeout: 12000 });
    } catch {
      return [];
    }

    await sleep(1200);

    return page.evaluate(() => {
      const rows = [];
      const items = document.querySelectorAll("li[data-layout='organic'], article");
      items.forEach((item) => {
        const linkEl = item.querySelector("a[data-testid='result-title-a']");
        if (!linkEl?.href) return;

        const title = linkEl.innerText?.trim() || "";
        const details = (item.innerText || "").replace(title, "").replace(/\n/g, " ").trim();
        rows.push({ title, details, link: linkEl.href });
      });
      return rows;
    });
  }

  async scrapeGoogleMaps(page, query) {
    const mapUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    await page.goto(mapUrl, { waitUntil: "domcontentloaded" });

    try {
      await page.waitForSelector("a[href*='/maps/place/']", { timeout: 9000 });
    } catch {
      return [];
    }

    await sleep(1000);

    return page.evaluate(() => {
      const rows = [];
      const links = document.querySelectorAll("a[href*='/maps/place/']");
      links.forEach((el) => {
        const title = el.getAttribute("aria-label") || el.innerText || "Google Maps listing";
        const href = el.href;
        if (!href) return;
        rows.push({ title: title.trim(), details: "Google Maps result", link: href });
      });
      return rows.slice(0, 20);
    });
  }

  async run({ jobId, country, cities, states = [], niches }) {
    await this.setupBrowser();

    const page = await this.browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    const expandedNiches = expandNiches(niches);
    const cityAreas = buildCityAreaPairs(cities, states);

    const outputDir = path.join(this.outputRoot, jobId);
    fs.mkdirSync(outputDir, { recursive: true });

    const files = [];

    this.onProgress({ type: "job-start", message: `Running ${expandedNiches.length} niches in ${country}.` });

    for (const city of cities) {
      const fileName = `${sanitizeFileName(country)}_${sanitizeFileName(city)}_leads.txt`;
      fs.writeFileSync(path.join(outputDir, fileName), `--- LEADS FOR ${city}, ${country} ---\n\n`);
      files.push(fileName);
    }

    const seen = new Set();

    for (const niche of expandedNiches) {
      for (const pair of cityAreas) {
        const areaSuffix = pair.area ? `${pair.area} ${pair.city}` : pair.city;
        const query = `"${niche}" "${areaSuffix}"`;

        const ddgResults = await this.scrapeSearchPage(page, query);
        const mapResults = await this.scrapeGoogleMaps(page, `${niche} in ${areaSuffix}`);

        const allResults = [...ddgResults, ...mapResults];

        if (!allResults.length) continue;

        const fileName = `${sanitizeFileName(country)}_${sanitizeFileName(pair.city)}_leads.txt`;
        const filePath = path.join(outputDir, fileName);

        for (const result of allResults) {
          const fingerprint = `${pair.city}|${result.link}`;
          if (seen.has(fingerprint)) continue;
          seen.add(fingerprint);

          const entry =
            `[RESULT] [${niche.toUpperCase()}] - ${pair.city}${pair.area ? ` (${pair.area})` : ""}\n` +
            `Title:      ${result.title}\n` +
            `Details:    ${result.details}\n` +
            `Link:       ${result.link}\n` +
            `${"-".repeat(50)}\n`;

          fs.appendFileSync(filePath, entry, "utf8");
        }

        this.onProgress({
          type: "city-update",
          city: pair.city,
          niche,
          area: pair.area,
          fileName,
          message: `${niche} / ${pair.city}${pair.area ? ` (${pair.area})` : ""} processed.`
        });
      }
    }

    await this.browser.close();

    this.onProgress({ type: "job-complete", files, message: "Scraping completed." });

    return { files, expandedNiches };
  }
}
