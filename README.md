# Lead Scraper Dashboard

A Node.js dashboard that lets users:

- Input one or more niches.
- Expand niches into related role keywords.
- Select country, states/regions, and city list.
- Run a background scraper job.
- Search both DuckDuckGo and Google Maps.
- Download city-wise TXT lead files from the dashboard.

## Location data source

The dashboard fetches dynamic country/state/city data from:

- `https://countriesnow.space/api/v0.1/countries`
- `https://countriesnow.space/api/v0.1/countries/states`
- `https://countriesnow.space/api/v0.1/countries/cities`

The dashboard uses these endpoints as the source of truth for countries, states, and cities.


## Search sources

The scraper now performs site-targeted DuckDuckGo queries across a broad default list, including:

- LinkedIn, Facebook, Instagram, Reddit, X/Twitter, TikTok, YouTube, Pinterest, Threads
- Medium, Substack, Quora, Tumblr
- Yelp, Foursquare, Nextdoor, Alignable, Trustpilot
- Crunchbase, Wellfound, AngelList, About.me
- Behance, Dribbble, Meetup, Eventbrite
- Gumtree, Craigslist, YellowPages, Yell, Hotfrog, Manta, Kompass, Clutch
- Plus Google Maps extraction

Queries include email-intent keywords (e.g. `@gmail.com`, `@outlook.com`, `contact`) to improve contact discovery.

## Run

```bash
npm install
npm start
```

Open: `http://localhost:3000`

## Why you may see "Not Found"

If you open only static files (for example with `python3 -m http.server public`), the frontend can load but backend routes like `/api/metadata` are missing, which causes `Not Found` responses.

Always run the Node server (`npm start`) so both UI and API endpoints are available together.
