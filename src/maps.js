import puppeteer from "puppeteer";
import readline from "readline";
import fs from "fs";
import process from "process";
import { fileURLToPath } from "url";

class BusinessScraper {
  constructor() {
    this.browser = null;
    this.results = [];
    this.delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  }

  async init() {
    this.browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-notifications"],
    });
    console.log("Browser initialized");
  }

  async scrapeGoogleMaps(searchQuery, maxResults = 30) {
    this.results = []; // NEW: Clears prior query data to prevent buildup
    if (!this.browser) await this.init();

    const page = await this.browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    try {
      const searchUrl = `https://www.google.com/maps/search/$${encodeURIComponent(searchQuery)}?hl=en`;

      await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });
      await this.delay(3000);

      // Scroll to load results
      await this.scrollResults(page, maxResults);

      // Extract data
      const businesses = await page.evaluate(() => {
        const results = [];
        const businessCards = document.querySelectorAll('.Nv2PK');

        for (let i = 0; i < businessCards.length; i++) {
          const card = businessCards[i];

          const nameElement = card.querySelector('.qBF1Pd.fontHeadlineSmall');
          const name = nameElement ? nameElement.textContent.trim() : '';

          let referenceLink = '';
          const mainLink = card.querySelector('a.hfpxzc');
          if (mainLink) referenceLink = mainLink.href;

          let website = '';
          const websiteButton = card.querySelector('a[data-value="Website"]');
          if (websiteButton) website = websiteButton.href;

          let rating = '';
          const ratingElement = card.querySelector('.MW4etd');
          if (ratingElement) rating = ratingElement.textContent.trim();

          let address = '';
          let phone = '';

          // Universal info extractor
          const infoContainers = card.querySelectorAll('.W4Efsd');
          infoContainers.forEach(container => {
            const text = container.textContent;

            const phoneMatch = text.match(/(\+\d{1,4}[\s.-]?)?(\(?\d{2,6}\)?[\s.-]?)?(\d{2,6}[\s.-]?){1,4}\d{2,6}/);

            if (phoneMatch && text.includes(phoneMatch[0])) {
              if (phoneMatch[0].replace(/\D/g, '').length >= 7) {
                phone = phoneMatch[0];
              }
            }

            if (text.includes('·') && !text.includes('(') && !text.includes('Closed') && !text.includes('Open')) {
              const parts = text.split('·');
              for (const part of parts) {
                if (!part.match(/\d{3}[\s.-]?\d{4}/) && part.trim().length > 5) {
                  address = part.trim();
                }
              }
            }
          });

          if (name) {
            results.push({
              name, address, phone, rating, website, referenceLink,
              hasWebsite: !!website
            });
          }
        }

        return results;
      });

      this.results = [...this.results, ...businesses];
      await page.close();
      return businesses;

    } catch (error) {
      if (page) await page.close();
      return [];
    }
  }

  async scrollResults(page, maxResults = 999) {
    try {
      const scrollSelectors = ['[role="feed"]', '.m6QErb.DxyBCb.kA9KIf.dS8AEf.XiKgde.ecceSd', '[role="main"]'];

      let scrollContainer = null;
      for (const selector of scrollSelectors) {
        scrollContainer = await page.$(selector);
        if (scrollContainer) break;
      }

      if (!scrollContainer) {
        for (let i = 0; i < 5; i++) {
          await page.evaluate(() => window.scrollBy(0, 1000));
          await this.delay(1000);
        }
        return;
      }

      let previousCount = 0;
      let noChangeCount = 0;

      for (let i = 0; i < 200; i++) {
        await page.evaluate((container) => {
          container.scrollTop = container.scrollHeight;
        }, scrollContainer);

        await this.delay(2000);

        const resultCount = await page.evaluate(() => document.querySelectorAll('.Nv2PK').length);
        if (resultCount >= maxResults) break;

        if (resultCount === previousCount) {
          noChangeCount++;
          if (noChangeCount >= 3) break;
        } else {
          noChangeCount = 0;
        }
        previousCount = resultCount;
      }
    } catch (error) {
      // Intentionally suppressed for clean server logs
    }
  }

  cleanPhoneNumber(phone) {
    if (!phone) return "";
    return phone.replace(/[^\d+]/g, "");
  }

  async findEmails(websiteUrl) {
    if (!websiteUrl || !websiteUrl.startsWith('http')) return [];

    let page;
    try {
      page = await this.browser.newPage();

      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(websiteUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

      const emails = await page.evaluate(() => {
        const text = document.body.innerText;
        const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
        const matches = text.match(emailRegex) || [];

        const mailtoLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'))
          .map(a => a.href.replace('mailto:', '').split('?')[0]);

        return [...new Set([...matches, ...mailtoLinks])];
      });

      const validEmails = emails.filter(e =>
        !e.toLowerCase().endsWith('.png') &&
        !e.toLowerCase().endsWith('.jpg') &&
        !e.toLowerCase().endsWith('.jpeg') &&
        !e.toLowerCase().includes('sentry') &&
        !e.toLowerCase().includes('example')
      );

      return [...new Set(validEmails)];
    } catch (error) {
      return [];
    } finally {
      if (page) await page.close();
    }
  }

  async processResults(targetCount = 999) {
    const uniqueResults = this.results.filter(
      (business, index, self) =>
        index === self.findIndex((b) => b.name.toLowerCase() === business.name.toLowerCase())
    );

    const finalResults = [];

    for (let i = 0; i < uniqueResults.length; i++) {
      if (finalResults.length >= targetCount) break;

      const business = uniqueResults[i];
      const cleanPhone = this.cleanPhoneNumber(business.phone);

      let possibleEmails = [];
      if (business.website) {
        possibleEmails = await this.findEmails(business.website);
      }

      finalResults.push({
        id: finalResults.length + 1,
        name: business.name,
        address: business.address,
        phone: cleanPhone,
        website: business.website || "",
        referenceLink: business.referenceLink || "",
        possibleEmails: possibleEmails,
        rating: business.rating || "N/A",
        source: "Google Maps",
        scrapedAt: new Date().toISOString(),
      });
    }

    return finalResults;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

// CLI Execution Block (Skipped when imported into scraper.js)
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("=== Google Maps Lead Scraper ===");

  rl.question("Enter the niche (e.g., plumbers, web design): ", (niche) => {
    rl.question("Enter the location (e.g., New York, Jakarta): ", async (location) => {
      console.log(`\n🚀 Starting scraper for "${niche}" in "${location}"...\n`);

      const scraper = new BusinessScraper();

      try {
        await scraper.init();
        const query = `${niche} in ${location}`;

        await scraper.scrapeGoogleMaps(query, 999);
        const top20Leads = await scraper.processResults(999);

        const safeNiche = niche.replace(/\s+/g, "_").toLowerCase();
        const safeLocation = location.replace(/\s+/g, "_").toLowerCase();
        const filename = `${safeNiche}_${safeLocation}_leads.json`;

        fs.writeFileSync(filename, JSON.stringify(top20Leads, null, 2));

        console.log(`\n✅ Successfully scraped and saved ${top20Leads.length} leads to ${filename}`);
      } catch (error) {
        console.error("\n❌ An error occurred during execution:", error);
      } finally {
        await scraper.close();
        rl.close();
      }
    });
  });
}

export default BusinessScraper;
