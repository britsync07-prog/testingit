import json
import os
import random
import sys
import time
from pathlib import Path

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

NICHE_EXPANSION_DICTIONARY = {
    "fitness": ["Fitness Coach", "Gym Instructor", "Personal Trainer", "Yoga Instructor", "Pilates Teacher"],
    "trainer": ["Coach", "Instructor", "Consultant", "Mentor"],
    "yoga": ["Yoga Coach", "Yoga Therapist", "Yoga Teacher"],
    "pilates": ["Pilates Coach", "Pilates Instructor"],
}

AREA_HINTS = ["city centre", "north", "south", "east", "west", "near me"]

DEFAULT_SITES = [
    "linkedin.com/in", "facebook.com", "instagram.com", "reddit.com", "x.com", "twitter.com", "tiktok.com",
    "youtube.com", "pinterest.com", "threads.net", "snapchat.com", "medium.com", "substack.com", "quora.com",
    "tumblr.com", "yelp.com", "foursquare.com", "nextdoor.com", "alignable.com", "trustpilot.com", "crunchbase.com",
    "wellfound.com", "angel.co", "about.me", "behance.net", "dribbble.com", "meetup.com", "eventbrite.com",
    "locanto.com", "gumtree.com", "craigslist.org", "yellowpages.com", "yell.com", "hotfrog.com", "manta.com",
    "kompass.com", "clutch.co", "tripadvisor.com", "google.com/maps",
]

EMAIL_TERMS = ["@gmail.com", "@hotmail.com", "@outlook.com", "@yahoo.com", "@icloud.com", "email", "contact", "contact me"]


def emit(event):
    print(json.dumps(event), flush=True)


def expand_niches(base_niches):
    expanded = set()
    for niche in base_niches:
        trimmed = niche.strip()
        if not trimmed:
            continue

        expanded.add(trimmed)
        lower = trimmed.lower()

        for token, matches in NICHE_EXPANSION_DICTIONARY.items():
            if token in lower:
                expanded.update(matches)

        if "trainer" in lower:
            expanded.add(trimmed.replace("Trainer", "Coach").replace("trainer", "coach"))
            expanded.add(trimmed.replace("Trainer", "Instructor").replace("trainer", "instructor"))

    return [item for item in expanded if item]


def build_city_area_pairs(cities, states):
    pairs = []
    state_aware_hints = AREA_HINTS + states
    for city in cities:
        for area in state_aware_hints:
            pairs.append({"city": city, "area": area})
        pairs.append({"city": city, "area": ""})
    return pairs


def sanitize_file_name(value):
    return "".join(ch if ch.isalnum() or ch in "_-" else "_" for ch in value)


def build_site_targeted_query(niche, city, area, site):
    location_text = f"{area} {city}".strip() if area else city
    email_clause = "(" + " OR ".join(f'"{term}"' for term in EMAIL_TERMS) + ")"
    return f'site:{site} "{niche}" "{location_text}" {email_clause}'


class DDGMultiNicheScraper:
    def __init__(self, config):
        self.config = config
        self.driver = None
        self.output_dir = Path(config["outputDir"])
        self.country = config["country"]
        self.cities = config["cities"]
        self.states = config.get("states", [])
        self.niches = config["niches"]
        self.include_google_maps = bool(config.get("includeGoogleMaps", True))
        self.sites = config.get("sites") or DEFAULT_SITES

    def setup_driver(self):
        options = uc.ChromeOptions()
        options.add_argument("--headless=new")
        options.add_argument("--window-size=1920,1080")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-gpu")
        self.driver = uc.Chrome(options=options)

    def scrape_search_page(self, query):
        self.driver.get("https://duckduckgo.com/")
        search_box = WebDriverWait(self.driver, 20).until(EC.presence_of_element_located((By.NAME, "q")))
        search_box.clear()
        search_box.send_keys(query)
        search_box.send_keys(Keys.RETURN)

        try:
            WebDriverWait(self.driver, 12).until(EC.presence_of_element_located((By.CSS_SELECTOR, "article, li[data-layout='organic']")))
        except Exception:
            return []

        time.sleep(1.2)
        results = self.driver.find_elements(By.CSS_SELECTOR, "li[data-layout='organic'], article")
        rows = []
        for item in results:
            try:
                link_el = item.find_element(By.CSS_SELECTOR, "a[data-testid='result-title-a']")
                href = link_el.get_attribute("href")
                if not href:
                    continue
                title = (link_el.text or "").strip()
                details = (item.text or "").replace(title, "").replace("\n", " ").strip()
                rows.append({"title": title, "details": details, "link": href})
            except Exception:
                continue
        return rows

    def scrape_google_maps(self, query):
        if not self.include_google_maps:
            return []

        map_url = f"https://www.google.com/maps/search/{query.replace(' ', '%20')}"
        self.driver.get(map_url)

        try:
            WebDriverWait(self.driver, 9).until(EC.presence_of_element_located((By.CSS_SELECTOR, "a[href*='/maps/place/']")))
        except Exception:
            return []

        time.sleep(1)
        rows = []
        links = self.driver.find_elements(By.CSS_SELECTOR, "a[href*='/maps/place/']")
        for el in links[:20]:
            href = el.get_attribute("href")
            if not href:
                continue
            title = el.get_attribute("aria-label") or el.text or "Google Maps listing"
            rows.append({"title": title.strip(), "details": "Google Maps result", "link": href})
        return rows

    def run(self):
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.setup_driver()

        expanded_niches = expand_niches(self.niches)
        city_areas = build_city_area_pairs(self.cities, self.states)
        files = []
        seen = set()
        saved_counts = {}

        emit({
            "type": "job-start",
            "message": f"Running {len(expanded_niches)} niches across {len(self.sites)} sites in {self.country}. Google Maps: {'on' if self.include_google_maps else 'off'}."
        })

        for city in self.cities:
            file_name = f"{sanitize_file_name(self.country)}_{sanitize_file_name(city)}_leads.txt"
            file_path = self.output_dir / file_name
            file_path.write_text(f"--- LEADS FOR {city}, {self.country} ---\n\n", encoding="utf-8")
            files.append(file_name)
            saved_counts[file_name] = 0

        for niche in expanded_niches:
            for pair in city_areas:
                for site in self.sites:
                    query = build_site_targeted_query(niche, pair["city"], pair["area"], site)
                    ddg_results = self.scrape_search_page(query)
                    location_query = f"{niche} in {pair['area'] + ' ' if pair['area'] else ''}{pair['city']}"
                    map_results = self.scrape_google_maps(location_query)
                    all_results = ddg_results + map_results

                    if not all_results:
                        continue

                    file_name = f"{sanitize_file_name(self.country)}_{sanitize_file_name(pair['city'])}_leads.txt"
                    file_path = self.output_dir / file_name

                    for result in all_results:
                        fingerprint = f"{pair['city']}|{result['link']}"
                        if fingerprint in seen:
                            continue
                        seen.add(fingerprint)

                        area_label = f" ({pair['area']})" if pair["area"] else ""
                        entry = (
                            f"[RESULT] [{niche.upper()}] - {pair['city']}{area_label} [{site}]\n"
                            f"Title:      {result['title']}\n"
                            f"Details:    {result['details']}\n"
                            f"Link:       {result['link']}\n"
                            f"{'-' * 50}\n"
                        )
                        with file_path.open("a", encoding="utf-8") as f:
                            f.write(entry)

                        saved_counts[file_name] = saved_counts.get(file_name, 0) + 1
                        emit({
                            "type": "lead-saved",
                            "city": pair["city"],
                            "niche": niche,
                            "area": pair["area"],
                            "site": site,
                            "fileName": file_name,
                            "totalSavedForFile": saved_counts[file_name],
                            "message": f"Saved lead #{saved_counts[file_name]} to {file_name}",
                        })

                    area_label = f" ({pair['area']})" if pair["area"] else ""
                    emit({
                        "type": "city-update",
                        "city": pair["city"],
                        "niche": niche,
                        "area": pair["area"],
                        "site": site,
                        "fileName": file_name,
                        "totalSavedForFile": saved_counts.get(file_name, 0),
                        "message": f"{niche} / {pair['city']}{area_label} / {site} processed.",
                    })

                    time.sleep(random.uniform(0.2, 0.6))

        if self.driver:
            self.driver.quit()

        emit({"type": "job-complete", "files": files, "message": "Scraping completed."})
        emit({"type": "result", "files": files, "expandedNiches": expanded_niches, "sites": self.sites})


def main():
    if len(sys.argv) < 2:
        print("Usage: python scraper.py '<json-config>'", file=sys.stderr)
        sys.exit(1)

    config = json.loads(sys.argv[1])
    scraper = DDGMultiNicheScraper(config)
    scraper.run()


if __name__ == "__main__":
    main()
