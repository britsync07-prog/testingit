const countryEl = document.getElementById("country");
const stateContainer = document.getElementById("states");
const cityContainer = document.getElementById("cities");
const statusEl = document.getElementById("status");
const eventsEl = document.getElementById("events");
const filesEl = document.getElementById("files");
const nichesEl = document.getElementById("niches");
const expandedNichesEl = document.getElementById("expandedNiches");
const googleMapsModeEl = document.getElementById("googleMapsMode");

function selectedValues(container) {
  return [...container.querySelectorAll("input[type='checkbox']:checked")].map((input) => input.value);
}

function renderCheckboxList(container, values) {
  container.innerHTML = "";

  if (!values.length) {
    container.textContent = "No data available.";
    return;
  }

  values.forEach((value) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" value="${value}" /> ${value}`;
    container.appendChild(label);
  });
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;

    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch {
      // ignore parse issues
    }

    throw new Error(message);
  }

  return response.json();
}

function showApiMissingHint(error, context) {
  statusEl.textContent = `${context}: ${error.message}. If you opened only static files, start the Node API server with npm start.`;
}

async function loadCountries() {
  try {
    const metadata = await fetchJson("/api/metadata");

    countryEl.innerHTML = metadata.countries.map((country) => `<option value="${country}">${country}</option>`).join("");

    if (!countryEl.value) {
      renderCheckboxList(stateContainer, []);
      renderCheckboxList(cityContainer, []);
      return;
    }

    await loadLocationDetails(countryEl.value);
  } catch (error) {
    renderCheckboxList(stateContainer, []);
    renderCheckboxList(cityContainer, []);
    showApiMissingHint(error, "Could not load countries");
  }
}

async function loadLocationDetails(country) {
  try {
    const details = await fetchJson(`/api/location?country=${encodeURIComponent(country)}`);

    renderCheckboxList(stateContainer, details.states || []);
    renderCheckboxList(cityContainer, details.cities || []);
  } catch (error) {
    renderCheckboxList(stateContainer, []);
    renderCheckboxList(cityContainer, []);
    showApiMissingHint(error, `Could not load locations for ${country}`);
  }
}

countryEl.addEventListener("change", async () => {
  await loadLocationDetails(countryEl.value);
});

document.getElementById("expandNiches").addEventListener("click", async () => {
  const niches = nichesEl.value.split("\n").map((x) => x.trim()).filter(Boolean);

  if (!niches.length) {
    expandedNichesEl.textContent = "Please enter at least one niche.";
    return;
  }

  try {
    const data = await fetchJson("/api/expand-niches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niches })
    });

    expandedNichesEl.textContent = `Expanded niches: ${data.expandedNiches.join(", ")}`;
  } catch (error) {
    expandedNichesEl.textContent = `Niche expansion failed: ${error.message}`;
    showApiMissingHint(error, "API request failed");
  }
});

document.getElementById("run").addEventListener("click", async () => {
  const niches = nichesEl.value.split("\n").map((x) => x.trim()).filter(Boolean);
  const states = selectedValues(stateContainer);
  const cities = selectedValues(cityContainer);
  const includeGoogleMaps = (googleMapsModeEl?.value || "yes") === "yes";

  if (!niches.length || !cities.length) {
    statusEl.textContent = "Select at least one niche and one city.";
    return;
  }

  statusEl.textContent = `Starting job... Google Maps: ${includeGoogleMaps ? "ON" : "OFF"}`;
  eventsEl.innerHTML = "";
  filesEl.innerHTML = "";

  try {
    const { jobId } = await fetchJson("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        country: countryEl.value,
        states,
        cities,
        niches,
        includeGoogleMaps
      })
    });

    statusEl.textContent = `Job ${jobId} is running...`;

    const stream = new EventSource(`/api/jobs/${jobId}/events`);
    stream.onmessage = (event) => {
      const payload = JSON.parse(event.data);

      const row = document.createElement("li");
      row.textContent = `[${payload.type}] ${payload.message || "update"}`;
      eventsEl.prepend(row);

      if (payload.type === "job-complete") {
        statusEl.textContent = "Completed";
        stream.close();

        (payload.files || []).forEach((file) => {
          const li = document.createElement("li");
          li.innerHTML = `<a href="/api/jobs/${jobId}/files/${file}">${file}</a>`;
          filesEl.appendChild(li);
        });
      }

      if (payload.type === "job-failed") {
        statusEl.textContent = "Job failed";
        stream.close();
      }
    };

    stream.onerror = () => {
      statusEl.textContent = "Job stream disconnected.";
      stream.close();
    };
  } catch (error) {
    showApiMissingHint(error, "Could not start job");
  }
});

loadCountries();
