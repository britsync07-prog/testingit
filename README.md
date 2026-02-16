# Lead Scraper Dashboard

A Node.js dashboard that lets users:

- Input one or more niches.
- Expand niches into related role keywords.
- Select country, states/regions, and city list.
- Choose whether to include Google Maps search (Yes/No dropdown in Search options).
- Run a background scraper job.
- Download city-wise TXT lead files from the dashboard.

## Location data source

The dashboard fetches dynamic country/state/city data from:

- `https://countriesnow.space/api/v0.1/countries`
- `https://countriesnow.space/api/v0.1/countries/states`
- `https://countriesnow.space/api/v0.1/countries/cities`

The dashboard uses these endpoints as the source of truth for countries, states, and cities.

## What it searches on the internet

For each expanded niche, selected city, area/state hint, and site source, the scraper runs DuckDuckGo queries in this pattern:

- `site:<domain> "<niche>" "<area city>" ("@gmail.com" OR "@hotmail.com" OR "@outlook.com" OR "@yahoo.com" OR "@icloud.com" OR "email" OR "contact" OR "contact me")`

It then extracts title, snippet details, and link from organic results.

If **Include Google Maps search** is enabled in the dashboard, it also searches:

- `https://www.google.com/maps/search/<niche + area + city>`

and extracts Google Maps listing links.

## Search sources

The scraper performs site-targeted DuckDuckGo queries across a broad default list, including:

- LinkedIn, Facebook, Instagram, Reddit, X/Twitter, TikTok, YouTube, Pinterest, Threads
- Medium, Substack, Quora, Tumblr
- Yelp, Foursquare, Nextdoor, Alignable, Trustpilot
- Crunchbase, Wellfound, AngelList, About.me
- Behance, Dribbble, Meetup, Eventbrite
- Gumtree, Craigslist, YellowPages, Yell, Hotfrog, Manta, Kompass, Clutch
- Plus optional Google Maps extraction

## Run

```bash
npm install
npm start
```

Open: `http://localhost:3000`


## Reliability during long runs

Leads are appended to each city TXT file immediately (`appendFileSync`) as soon as each lead is found.
This means if the job fails or is interrupted, previously saved leads stay in the file.

The dashboard now receives live `lead-saved` updates and shows file download links during the run (not only at completion).

## See backend logs live

Run server and stream logs to terminal + file:

```bash
npm start 2>&1 | tee backend.log
```

Then in another terminal, follow logs live:

```bash
tail -f backend.log
```

## Why you may see "Not Found"

If you open only static files (for example with `python3 -m http.server public`), the frontend can load but backend routes like `/api/metadata` are missing, which causes `Not Found` responses.

Always run the Node server (`npm start`) so both UI and API endpoints are available together.
