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

If the API is unavailable, the app falls back to local seed city data.

## Run

```bash
npm install
npm start
```

Open: `http://localhost:3000`

## Why you may see "Not Found"

If you open only static files (for example with `python3 -m http.server public`), the frontend can load but backend routes like `/api/metadata` are missing, which causes `Not Found` responses.

Always run the Node server (`npm start`) so both UI and API endpoints are available together.
