import json
import os
import re
import random
import sys
import time
from pathlib import Path

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

# --- CONFIGURATION ---
DEFAULT_SITES = [
    "linkedin.com/in", "facebook.com", "instagram.com"
]

EMAIL_TERMS = ["@gmail.com", "@hotmail", "@outlook.com", "email me"]

NICHE_EXPANSION_DICTIONARY = {
    "fitness": ["Fitness Coach", "Gym Instructor", "Personal Trainer", "Yoga Instructor", "Pilates Teacher"],
    "trainer": ["Coach", "Instructor", "Consultant", "Mentor"],
    "yoga": ["Yoga Coach", "Yoga Therapist", "Yoga Teacher"],
    "pilates": ["Pilates Coach", "Pilates Instructor"],
}

def emit(event):
    """Sends logs to the Node.js server."""
    print(json.dumps(event), flush=True)

def extract_email(text):
    """Finds the first email in a string using regex."""
    if not text:
        return None
    email_regex = r'([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)'
    match = re.search(email_regex, text)
    return match.group(0) if match else None

def expand_niches(base_niches):
    """Expands base niches into more specific search terms."""
    expanded = set()
    for niche in base_niches:
        trimmed = niche.strip()
        if not trimmed: continue

        expanded.add(trimmed)
        lower = trimmed.lower()

        for token, matches in NICHE_EXPANSION_DICTIONARY.items():
            if token in lower:
                expanded.update(matches)

        if "trainer" in lower:
            expanded.add(trimmed.replace("Trainer", "Coach").replace("trainer", "coach"))
            expanded.add(trimmed.replace("Trainer", "Instructor").replace("trainer", "instructor"))

    return [item for item in expanded if item]

def sanitize_file_name(value):
    return "".join(ch if ch.isalnum() or ch in "_-" else "_" for ch in value)

class DDGMultiNicheScraper:
    def __init__(self, config):
        self.config = config
        self.driver = None
        self.output_dir = Path(config["outputDir"])
        self.country = config["country"]
        self.cities = config["cities"]
        self.niches = config["niches"]
        
        # Use sites from config or default to the big 3 social ones
        self.sites = config.get("sites") or DEFAULT_SITES
        
        # Progress tracking file
        self.progress_file = self.output_dir / "scrape_progress.json"
        
        # Email tracking to prevent duplicates in this job run
        self.seen_emails = set()
        self.all_emails_file = self.output_dir / "all_emails.txt"

    def setup_driver(self):
        """Launches a stealthy Chrome browser matching lead.py setup."""
        options = uc.ChromeOptions()
        options.add_argument("--headless=new")
        options.add_argument("--window-size=1920,1080")
        options.add_argument("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36")
        
        self.driver = uc.Chrome(options=options)

    def load_progress(self):
        """Resumes from where it left off."""
        if self.progress_file.exists():
            try:
                with open(self.progress_file, "r") as f:
                    return json.load(f)
            except:
                return {"city_idx": 0, "niche_idx": 0, "site_idx": 0}
        return {"city_idx": 0, "niche_idx": 0, "site_idx": 0}

    def save_progress(self, city_idx, niche_idx, site_idx):
        """Saves current state to JSON."""
        data = {
            "city_idx": city_idx,
            "niche_idx": niche_idx,
            "site_idx": site_idx,
            "timestamp": time.strftime('%Y-%m-%d %H:%M:%S')
        }
        with open(self.progress_file, "w") as f:
            json.dump(data, f)

    def load_more_results(self):
        """Tries to scroll down or click the 'More Results' button."""
        try:
            last_height = self.driver.execute_script("return document.body.scrollHeight")
            
            # 1. Scroll to bottom
            self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(3) 
            
            # 2. Try to click "More Results" button if it exists
            try:
                more_btn = self.driver.find_element(By.ID, "more-results")
                if more_btn.is_displayed():
                    self.driver.execute_script("arguments[0].click();", more_btn)
                    time.sleep(3) 
            except:
                pass 
            
            # 3. Check if new content loaded
            new_height = self.driver.execute_script("return document.body.scrollHeight")
            if new_height == last_height:
                time.sleep(2)
                self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                time.sleep(2)
                final_height = self.driver.execute_script("return document.body.scrollHeight")
                if final_height == last_height:
                    return False 
            
            return True 
        except:
            return False

    def scrape_single_query(self, query, city, niche, site, file_path, email_file_path, saved_count):
        """Performs the search on DuckDuckGo and extracts results and emails."""
        emit({"type": "search-query", "query": query, "message": f"Searching: {query}"})
        
        try:
            # Check if driver is still responsive
            try:
                self.driver.title
            except Exception:
                emit({"type": "log", "message": "Browser lost connection. Restarting..."})
                self.setup_driver()

            self.driver.get("https://duckduckgo.com/")
            
            # 1. Search Box
            search_box = WebDriverWait(self.driver, 20).until(
                EC.presence_of_element_located((By.NAME, "q"))
            )
            search_box.clear()
            search_box.send_keys(query)
            search_box.send_keys(Keys.RETURN)

            # 2. Wait for Results
            try:
                WebDriverWait(self.driver, 15).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, "article, li[data-layout='organic']"))
                )
                time.sleep(2)
            except:
                return 0

            scraped_links = set() 
            total_saved_for_query = 0
            page_exhausted = False
            consecutive_no_new_results = 0 
            
            while not page_exhausted:
                # 1. Grab all currently visible results
                results = self.driver.find_elements(By.CSS_SELECTOR, "li[data-layout='organic'], article")
                if not results:
                     break

                new_items_this_pass = False
                
                # 2. Iterate through visible results
                for result in results:
                    try:
                        link_el = result.find_element(By.CSS_SELECTOR, "a[data-testid='result-title-a']")
                        href = link_el.get_attribute("href")
                        title = link_el.text

                        if not href or href in scraped_links: continue
                        
                        scraped_links.add(href)
                        
                        full_text = result.text
                        details = full_text.replace(title, "").replace("\n", " ").strip()
                        
                        # --- Email Extraction ---
                        email = extract_email(title) or extract_email(details)
                        if email:
                            email_lower = email.lower()
                            if email_lower not in self.seen_emails:
                                self.seen_emails.add(email_lower)
                                # Update city-specific email file
                                with open(email_file_path, "a", encoding="utf-8") as ef:
                                    ef.write(email + "\n")
                                # Update global all_emails.txt
                                with open(self.all_emails_file, "a", encoding="utf-8") as af:
                                    af.write(email + "\n")
                                
                                emit({
                                    "type": "log",
                                    "message": f"Found New Email: {email}"
                                })

                        # Save full result
                        entry = (
                            f"[RESULT] [{niche.upper()}] - {city} [{site}]\n"
                            f"Title:      {title}\n"
                            f"Details:    {details}\n"
                            f"Link:       {href}\n"
                            f"{'-' * 50}\n"
                        )
                        
                        with file_path.open("a", encoding="utf-8") as f:
                            f.write(entry)

                        total_saved_for_query += 1
                        new_items_this_pass = True
                        
                        # Log success to server
                        emit({
                            "type": "lead-saved",
                            "title": title,
                            "city": city,
                            "niche": niche,
                            "site": site,
                            "fileName": file_path.name,
                            "emailFileName": email_file_path.name,
                            "allEmailsFileName": "all_emails.txt",
                            "totalSavedForFile": saved_count + total_saved_for_query,
                            "message": f"Saved: {title[:30]}..."
                        })
                        
                    except Exception:
                        continue
                
                # 3. Handle Pagination / Scrolling
                if not new_items_this_pass:
                    consecutive_no_new_results += 1
                else:
                    consecutive_no_new_results = 0

                emit({"type": "log", "message": f"Total found: {total_saved_for_query}. Loading more..."})
                more_content_loaded = self.load_more_results()

                if not more_content_loaded:
                    page_exhausted = True
                
                if consecutive_no_new_results >= 5:
                    emit({"type": "log", "message": "Scrolled 5 times with no new results. Moving next."})
                    break

            return total_saved_for_query

        except Exception as e:
            emit({"type": "log", "message": f"Error searching {query}: {str(e)}"})
            # Try to restart driver for the next query if it seems dead
            if "HTTPConnectionPool" in str(e) or "Connection refused" in str(e):
                try:
                    self.setup_driver()
                except:
                    pass
            return 0

    def run(self):
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.setup_driver()

        # Initialize all_emails.txt if not exists
        if not self.all_emails_file.exists():
            self.all_emails_file.write_text("", encoding="utf-8")
        else:
            # Load existing emails to seen_emails to prevent duplicates across resumes
            with open(self.all_emails_file, "r", encoding="utf-8") as f:
                for line in f:
                    email = line.strip().lower()
                    if email:
                        self.seen_emails.add(email)

        expanded_niches = expand_niches(self.niches)
        
        # Load previous state
        state = self.load_progress()
        start_city_idx = state['city_idx']
        start_niche_idx = state['niche_idx']
        start_site_idx = state['site_idx']

        emit({
            "type": "job-start",
            "message": f"Resuming from City #{start_city_idx}, Niche #{start_niche_idx}"
        })

        files = []

        # --- MAIN LOOP ---
        for c_idx, city in enumerate(self.cities):
            if c_idx < start_city_idx: continue

            sanitized_city = sanitize_file_name(city)
            file_name = f"{sanitize_file_name(self.country)}_{sanitized_city}_leads.txt"
            email_file_name = f"{sanitize_file_name(self.country)}_{sanitized_city}_emails.txt"
            
            file_path = self.output_dir / file_name
            email_file_path = self.output_dir / email_file_name

            if not file_path.exists():
                file_path.write_text(f"--- LEADS FOR {city}, {self.country} ---\n\n", encoding="utf-8")
            if not email_file_path.exists():
                email_file_path.write_text("", encoding="utf-8")
            
            if file_name not in files: files.append(file_name)
            if email_file_name not in files: files.append(email_file_name)
            if "all_emails.txt" not in files: files.append("all_emails.txt")
            
            # Simple line count for 'saved_count' (approximate)
            saved_count = 0
            if file_path.exists():
                with open(file_path, 'r', encoding='utf-8') as f:
                    saved_count = sum(1 for line in f if "[RESULT]" in line)

            for n_idx, niche in enumerate(expanded_niches):
                if c_idx == start_city_idx and n_idx < start_niche_idx: continue

                for s_idx, site in enumerate(self.sites):
                    if c_idx == start_city_idx and n_idx == start_niche_idx and s_idx < start_site_idx: continue

                    # Construct precise query
                    query = build_site_targeted_query(niche, city, "", site)
                    
                    self.scrape_single_query(query, city, niche, site, file_path, email_file_path, saved_count)
                    
                    # Save progress after every site search
                    self.save_progress(c_idx, n_idx, s_idx + 1)
                    
                    # Random human delay (Stealth Mode)
                    sleep_time = random.uniform(3, 7)
                    time.sleep(sleep_time)

                # Reset site index for next niche
                self.save_progress(c_idx, n_idx + 1, 0)

            # Reset niche index for next city
            self.save_progress(c_idx + 1, 0, 0)

        if self.driver:
            self.driver.quit()

        emit({"type": "job-complete", "files": files, "message": "Scraping completed."})

def build_site_targeted_query(niche, city, area, site):
    location_text = f"{area} {city}".strip() if area else city
    email_clause = "(" + " OR ".join(f'"{term}"' for term in EMAIL_TERMS) + ")"
    return f'site:{site} "{niche}" "{location_text}" {email_clause}'

def main():
    if len(sys.argv) < 2:
        print("Usage: python scraper.py '<json-config>'", file=sys.stderr)
        sys.exit(1)

    try:
        config = json.loads(sys.argv[1])
        scraper = DDGMultiNicheScraper(config)
        scraper.run()
    except Exception as e:
        import traceback
        emit({
            "type": "job-failed",
            "message": str(e),
            "traceback": traceback.format_exc()
        })
        sys.exit(1)

if __name__ == "__main__":
    main()
