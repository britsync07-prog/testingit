import time
import random
import json
import os
import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

class DDGMultiNicheScraper:
    def __init__(self):
        self.driver = None
        self.output_file = "Fitness_Leads_UK_Full.txt"
        self.progress_file = "search_progress.json"
        
        # --- 1. TARGET NICHES ---
        self.niche_keywords = [
            "Fitness Trainer",
            "Fitness Coach",
            "Gym Instructor",
            "Personal Trainer",
            "Yoga Instructor",
            "Pilates Teacher"
        ]

        self.cities = [
            "London", "Birmingham", "Manchester", "Liverpool", "Leeds", "Sheffield",
            "Bristol", "Newcastle", "Sunderland", "Wolverhampton", "Nottingham",
            "Coventry", "Leicester", "Southampton", "Portsmouth", 
            "Plymouth", "Derby", "Brighton", "Reading", "Glasgow", "Edinburgh"
        ]

        self.sites = [
            "linkedin.com/in", 
            "facebook.com", 
            "instagram.com"
        ]

    def setup_driver(self):
        print("   [System] Launching Browser in New Headless Mode...")
        options = uc.ChromeOptions()
        options.add_argument("--headless=new") 
        options.add_argument("--window-size=1920,1080")
        options.add_argument("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36")
        self.driver = uc.Chrome(options=options)

    # --- PROGRESS SAVING FUNCTIONS ---
    def load_progress(self):
        if os.path.exists(self.progress_file):
            try:
                with open(self.progress_file, "r") as f:
                    return json.load(f)
            except:
                return {"city_idx": 0, "niche_idx": 0, "site_idx": 0}
        return {"city_idx": 0, "niche_idx": 0, "site_idx": 0}

    def save_progress(self, city_idx, niche_idx, site_idx):
        data = {
            "city_idx": city_idx,
            "niche_idx": niche_idx,
            "site_idx": site_idx,
            "timestamp": time.strftime('%Y-%m-%d %H:%M:%S')
        }
        with open(self.progress_file, "w") as f:
            json.dump(data, f)
        print(f"   [System] Progress Saved: City {city_idx}, Niche {niche_idx}, Site {site_idx}")

    def process_result(self, city, niche, title, details, link):
        try:
            with open(self.output_file, "a", encoding="utf-8") as f:
                f.write(f"[RESULT] [{niche.upper()}] - {city}\n")
                f.write(f"Title:      {title}\n")
                f.write(f"Details:    {details}\n") 
                f.write(f"Link:       {link}\n")
                f.write("-" * 50 + "\n")
        except Exception as e:
            print(f"Error saving file: {e}")

    def load_more_results(self):
        """
        Tries to scroll down or click the 'More Results' button.
        Returns True if the page successfully expanded (height changed), False if end of page.
        """
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
                # Double check: sometimes it takes a moment. Wait and try one more scroll.
                time.sleep(2)
                self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                time.sleep(2)
                final_height = self.driver.execute_script("return document.body.scrollHeight")
                if final_height == last_height:
                    return False # Truly the end
            
            return True 
        except:
            return False

    def scrape_single_query(self, query, city, niche):
        print(f"\n>>> Searching: {query}")
        try:
            self.driver.get("https://duckduckgo.com/")
            
            # Wait for search box
            search_box = WebDriverWait(self.driver, 20).until(
                EC.presence_of_element_located((By.NAME, "q"))
            )
            search_box.clear()
            search_box.send_keys(query)
            search_box.send_keys(Keys.RETURN)

            # Wait for initial results
            try:
                WebDriverWait(self.driver, 15).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, "article, li[data-layout='organic']"))
                )
                time.sleep(2) 
            except:
                print("   [!] Timeout: Results did not load or 0 results found.")
                return 0

            scraped_links = set() 
            total_saved_for_query = 0
            page_exhausted = False
            consecutive_no_new_results = 0 
            
            # --- INFINITE LOOP (Until Page Exhausted) ---
            while not page_exhausted:
                # 1. Grab all currently visible results
                results = self.driver.find_elements(By.CSS_SELECTOR, "li[data-layout='organic']")
                if not results:
                     results = self.driver.find_elements(By.CSS_SELECTOR, "article")

                new_items_this_pass = False
                
                # 2. Iterate through visible results
                for result in results:
                    try:
                        link_el = result.find_element(By.CSS_SELECTOR, "a[data-testid='result-title-a']")
                        title_text = link_el.text
                        link = link_el.get_attribute("href")

                        if link in scraped_links: continue
                        
                        scraped_links.add(link)
                        
                        full_text = result.text
                        details = full_text.replace(title_text, "").replace("\n", " ").strip()
                        
                        # --- SAVE EVERYTHING (No Python filtering) ---
                        print(f"   [+] Saved Result: {title_text[:30]}...")
                        self.process_result(city, niche, title_text, details, link)
                        total_saved_for_query += 1
                        new_items_this_pass = True
                        
                    except:
                        continue
                
                # 3. Handle Pagination / Scrolling
                if not new_items_this_pass:
                    consecutive_no_new_results += 1
                else:
                    consecutive_no_new_results = 0

                # Attempt to load more results
                print(f"   [Status] Total found: {total_saved_for_query}. Loading more...")
                more_content_loaded = self.load_more_results()

                if not more_content_loaded:
                    print("   [End] Reached end of page (no new height).")
                    page_exhausted = True
                
                # Safety break: 5 failed scrolls
                if consecutive_no_new_results >= 5:
                    print("   [Stop] Scrolled 5 times with no new results. Moving next.")
                    break

            return total_saved_for_query

        except Exception as e:
            print(f"   [!] Error on this query: {e}")
            return 0

    def run_batch(self):
        state = self.load_progress()
        start_city_idx = state['city_idx']
        start_niche_idx = state['niche_idx']
        start_site_idx = state['site_idx']

        print(f"--- RESUMING FROM: City #{start_city_idx}, Niche #{start_niche_idx}, Site #{start_site_idx} ---")
        
        self.setup_driver()
        
        if not os.path.exists(self.output_file):
            with open(self.output_file, "w", encoding="utf-8") as f:
                f.write("--- LEADS DATABASE (RAW) ---\n\n")

        # 1. Iterate Cities
        for c_idx, city in enumerate(self.cities):
            if c_idx < start_city_idx: continue 

            print(f"\n" + "="*60)
            print(f" PROCESSING CITY [{c_idx+1}/{len(self.cities)}]: {city.upper()}")
            print("="*60)
            
            # 2. Iterate Niches
            for n_idx, niche in enumerate(self.niche_keywords):
                if c_idx == start_city_idx and n_idx < start_niche_idx: continue

                print(f"   --- Keyword: {niche} ---")
                
                # 3. Iterate Sites
                for s_idx, site in enumerate(self.sites):
                    if c_idx == start_city_idx and n_idx == start_niche_idx and s_idx < start_site_idx: continue

                    # --- FIXED SEARCH QUERY (Restored email patterns) ---
                    query = f'site:{site} "{niche}" "{city}" ("@gmail.com" OR "@hotmail" OR "@outlook.com" OR "email me")'
                    
                    self.scrape_single_query(query, city, niche)
                    
                    self.save_progress(c_idx, n_idx, s_idx + 1)

                    sleep_time = random.uniform(4, 8)
                    print(f"   [Sleep] Resting {sleep_time:.1f}s...")
                    time.sleep(sleep_time)

                self.save_progress(c_idx, n_idx + 1, 0)

            self.save_progress(c_idx + 1, 0, 0)

        print("\n[ALL DONE] Batch job finished.")
        self.driver.quit()

if __name__ == "__main__":
    scraper = DDGMultiNicheScraper()
    scraper.run_batch()