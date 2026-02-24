const countryEl = document.getElementById("country");
const stateContainer = document.getElementById("states");
const cityContainer = document.getElementById("cities");
const selectAllStates = document.getElementById("selectAllStates");
const selectAllCities = document.getElementById("selectAllCities");
const statusEl = document.getElementById("status");
const statusIndicator = document.getElementById("statusIndicator");
const eventsEl = document.getElementById("events");
const filesEl = document.getElementById("files");
const phoneFilesEl = document.getElementById("phoneFiles");
const nichesEl = document.getElementById("niches");
const expandedNichesEl = document.getElementById("expandedNiches");
const googleMapsModeEl = document.getElementById("googleMapsMode");
const userInfoEl = document.getElementById("userInfo");
const logoutBtn = document.getElementById("logoutBtn");
const historyEl = document.getElementById("history");
const queueStatusEl = document.getElementById("queueStatus");
const liveLeadCountEl = document.getElementById("liveLeadCount");
const livePhoneCountEl = document.getElementById("livePhoneCount");
const phoneQueryPreviewEl = document.getElementById("phoneQueryPreview");
const phoneQueryExampleEl = document.getElementById("phoneQueryExample");

let currentUser = null;
let totalLeads = 0;
let totalPhones = 0;

// ── Scrape Mode helpers ─────────────────────────────────────
function getScrapeMode() {
  const checked = document.querySelector('input[name="scrapeMode"]:checked');
  return checked ? checked.value : 'emails';
}

// Country → phone prefix map for the preview banner
const COUNTRY_PHONE_PREFIXES = {
  "United Kingdom": ['"07"', '"+44"'],
  "United States": ['"+1"', '"tel:"'],
  "Canada": ['"+1"', '"tel:"'],
  "Australia": ['"04"', '"+61"'],
  "Germany": ['"+49"', '"015"', '"016"', '"017"'],
  "France": ['"+33"', '"06"', '"07"'],
  "India": ['"+91"'],
  "Pakistan": ['"+92"', '"03"'],
  "UAE": ['"+971"', '"05"'],
  "Saudi Arabia": ['"+966"', '"05"']
};

function updatePhoneQueryPreview() {
  const mode = getScrapeMode();
  const showPhone = mode === 'phones' || mode === 'both';
  if (phoneQueryPreviewEl) phoneQueryPreviewEl.style.display = showPhone ? 'block' : 'none';
  if (!showPhone || !phoneQueryExampleEl) return;

  const country = countryEl?.value || 'United Kingdom';
  const prefixes = COUNTRY_PHONE_PREFIXES[country] || ['"+XX"'];
  const phoneTerm = '(' + prefixes.join(' OR ') + ')';

  const rawNiches = nichesEl?.value.split('\n').map(x => x.trim()).filter(Boolean) || [];
  const niche = rawNiches[0] || 'Fitness Trainer';

  const checkedCities = [...(cityContainer?.querySelectorAll('input:checked') || [])].map(i => i.value);
  const city = checkedCities[0] || 'London';

  phoneQueryExampleEl.textContent = `site:linkedin.com/in ${niche} "${city}" ${phoneTerm}`;
}

async function checkAuth() {
  try {
    const user = await fetchJson("/api/me");
    currentUser = user;
    userInfoEl.textContent = `Logged in as: ${user.username}`;
    loadCountries();
    loadHistory();
    startQueuePolling();

    if (user.activeJobId) {
      attachToJob(user.activeJobId);
    }
  } catch (error) {
    window.location.href = "/login.html";
  }
}

function setStatus(text, mode = 'idle') {
  if (statusEl) statusEl.textContent = text;
  if (statusIndicator) {
    const dot = statusIndicator.querySelector('.dot');
    if (dot) {
      dot.className = 'dot dot--' + mode;
    }
  }
}

function addEvent(payload) {
  const row = document.createElement("li");
  let cls = 'ev--log';
  const type = payload.type || '';
  if (type === 'lead-saved') {
    cls = 'ev--saved';
    if (liveLeadCountEl) { totalLeads++; liveLeadCountEl.textContent = totalLeads + ' leads'; }
  } else if (type === 'phone-saved') {
    cls = 'ev--phone';
    if (livePhoneCountEl) { totalPhones++; livePhoneCountEl.textContent = totalPhones + ' phones'; }
  } else if (type === 'log' && payload.message && payload.message.toLowerCase().includes('email')) {
    cls = 'ev--email';
  } else if (type === 'search-query') {
    cls = 'ev--query';
  } else if (type.includes('fail') || type.includes('error')) {
    cls = 'ev--error';
  } else if (type.includes('complete') || type.includes('done')) {
    cls = 'ev--done';
  }
  row.className = cls;
  row.textContent = `[${type}] ${payload.message || 'update'}`;
  eventsEl.prepend(row);
}

function attachToJob(jobId) {
  setStatus(`Attaching to job ${jobId}...`, 'running');
  const stream = new EventSource(`/api/jobs/${jobId}/events`);

  stream.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    addEvent(payload);

    const jobStatusEl = document.getElementById(`status-${jobId}`);
    if (jobStatusEl) {
      const s = payload.type.replace('job-', '');
      jobStatusEl.textContent = s.toUpperCase();
      jobStatusEl.className = `status-${s}`;
    }

    if (payload.type === 'info' && payload.message === 'Job started') {
      setStatus(`Job ${jobId} running...`, 'running');
    }

    if (payload.type === 'lead-saved' || payload.type === 'city-update') {
      ensureFileLink(jobId, payload.fileName);
      ensureFileLink(jobId, payload.emailFileName);
      ensureFileLink(jobId, payload.allEmailsFileName);
      ensurePhoneFileLink(jobId, payload.phoneFileName);
      ensurePhoneFileLink(jobId, payload.allPhonesFileName);
    }
    if (payload.type === 'phone-saved') {
      ensurePhoneFileLink(jobId, payload.phoneFileName);
      ensurePhoneFileLink(jobId, payload.allPhonesFileName);
    }

    if (payload.type === 'job-completed' || payload.type === 'job-complete' || payload.type === 'job-stopped' || payload.type === 'job-failed') {
      const isDone = payload.type.includes('complete');
      const isStopped = payload.type === 'job-stopped';
      setStatus(isDone ? 'Completed' : isStopped ? 'Stopped' : 'Failed', isDone ? 'done' : 'error');
      stream.close();
      loadHistory();
      updateQueueStatus();
    }
  };

  stream.onerror = () => console.log('Job stream disconnected.');
}

logoutBtn.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login.html";
});

function selectedValues(container) {
  return [...container.querySelectorAll("input[type='checkbox']:checked")].map((input) => input.value);
}

function renderCheckboxList(container, values, selectAllEl) {
  container.innerHTML = "";
  if (selectAllEl) selectAllEl.checked = false; // Reset Select All when list changes

  if (!values || !values.length) {
    container.textContent = "No data available.";
    return;
  }
  values.forEach((value) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" value="${value}" /> ${value}`;
    container.appendChild(label);
  });
}

function setupSelectAll(selectAllEl, container) {
  if (!selectAllEl || !container) return;
  selectAllEl.addEventListener("change", (e) => {
    const isChecked = e.target.checked;
    const checkboxes = container.querySelectorAll("input[type='checkbox']");
    checkboxes.forEach(cb => {
      cb.checked = isChecked;
    });
  });
}

setupSelectAll(selectAllStates, stateContainer);
setupSelectAll(selectAllCities, cityContainer);

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401 && !url.includes("/api/me")) {
    window.location.href = "/login.html";
    return;
  }
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch { }
    throw new Error(message);
  }
  return response.json();
}

async function loadCountries() {
  try {
    const metadata = await fetchJson("/api/metadata");
    countryEl.innerHTML = metadata.countries.map((country) => `<option value="${country}">${country}</option>`).join("");
    if (countryEl.value) {
      await loadLocationDetails(countryEl.value);
    }
  } catch (error) {
    console.error("Could not load countries", error);
  }
}

async function loadLocationDetails(country) {
  try {
    const details = await fetchJson(`/api/location?country=${encodeURIComponent(country)}`);
    renderCheckboxList(stateContainer, details.states || [], selectAllStates);
    renderCheckboxList(cityContainer, details.cities || [], selectAllCities);
  } catch (error) {
    console.error(`Could not load locations for ${country}`, error);
  }
}

countryEl.addEventListener("change", async () => {
  await loadLocationDetails(countryEl.value);
});

async function loadCategories() {
  try {
    const { categories } = await fetchJson("/api/categories");
    const selectEl = document.getElementById("jobCategory");
    if (selectEl) {
      const currentVal = selectEl.value;
      selectEl.innerHTML = '<option value="">-- Select a Category --</option>' +
        categories.map(c => `<option value="${c.id}">${c.name}</option>`).join("");

      const exists = categories.find(c => c.id === currentVal);
      if (exists) selectEl.value = currentVal;
    }

    // Update the history filter dropdown
    const filterSelect = document.getElementById("historyCategoryFilter");
    if (filterSelect) {
      const currentVal = filterSelect.value;
      filterSelect.innerHTML = '<option value="all">All Categories</option>' +
        categories.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
      const exists = categories.find(c => c.id === currentVal);
      filterSelect.value = exists ? currentVal : "all";
    }
  } catch (err) {
    console.error("Could not load categories", err);
  }
}

// Handle Add Category Button
const addCategoryBtn = document.getElementById("addCategoryBtn");
if (addCategoryBtn) {
  addCategoryBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    const name = prompt("Enter a name for the new category:");
    if (!name?.trim()) return;

    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() })
      });

      if (!res.ok) {
        let errorMsg = "Failed to create category";
        try {
          const data = await res.json();
          errorMsg = data.error || errorMsg;
        } catch { }
        alert(errorMsg);
        return;
      }

      const { category } = await res.json();
      await loadCategories();

      // Select the newly created category
      const selectEl = document.getElementById("jobCategory");
      if (selectEl) selectEl.value = category.id;

    } catch (err) {
      alert("Error creating category");
      console.error(err);
    }
  });
}

// Add event listener to the history category filter
const historyCategoryFilter = document.getElementById("historyCategoryFilter");
if (historyCategoryFilter) {
  historyCategoryFilter.addEventListener("change", () => loadHistory());
}

async function loadHistory() {
  try {
    const history = await fetchJson("/api/history");
    historyEl.innerHTML = "";
    if (history.length === 0) {
      historyEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px 0;">No search history yet.</p>';
      return;
    }
    const filterVal = historyCategoryFilter ? historyCategoryFilter.value : "all";

    let filteredHistory = history;
    if (filterVal !== "all") {
      filteredHistory = history.filter(job => job.params.category === filterVal);
      if (filteredHistory.length === 0) {
        historyEl.innerHTML = `<p style="color:var(--text-muted);font-size:13px;padding:8px 0;">No jobs found in this category.</p>`;
        return;
      }
    }

    filteredHistory.forEach((job) => {
      const div = document.createElement("div");
      div.className = "history-item";
      const date = new Date(job.createdAt).toLocaleString();
      const params = job.params;

      const emailFiles = (job.files || []).filter(f =>
        f.includes("_emails.txt") ||
        f === "all_emails.txt" ||
        f === "google_maps_emails.txt" ||
        f.endsWith(".json") ||
        f.endsWith(".csv")
      );

      const phoneFiles = (job.files || []).filter(f =>
        f.includes("_phones.txt") || f === "all_phones.txt"
      );

      const fileButtons = [
        ...emailFiles.map(f =>
          `<div style="display:inline-flex; gap:4px; margin-bottom:4px; margin-right:4px;">
             <a href="#" onclick="openFilePreview('${job.id}', '${f}'); return false;" class="download-btn" style="padding: 4px 6px;">&#x1F441; View</a>
             <a data-file-name="${f}" href="/api/jobs/${job.id}/files/${f}" target="_blank" class="download-btn" style="border-top-left-radius:0; border-bottom-left-radius:0;">&#x2193; DL</a>
           </div>`
        ),
        ...phoneFiles.map(f =>
          `<div style="display:inline-flex; gap:4px; margin-bottom:4px; margin-right:4px;">
             <a href="#" onclick="openFilePreview('${job.id}', '${f}'); return false;" class="download-btn" style="padding: 4px 6px; border-color:var(--purple);color:var(--purple);background:rgba(139,92,246,0.12)">&#x1F441; View</a>
             <a data-file-name="${f}" href="/api/jobs/${job.id}/files/${f}" target="_blank" class="download-btn" style="border-top-left-radius:0; border-bottom-left-radius:0; border-color:var(--purple);color:var(--purple);background:rgba(139,92,246,0.12)">&#x2193; DL</a>
           </div>`
        )
      ].join("");

      const isStoppable = job.status === "running" || job.status === "queued";
      const stopButton = isStoppable ? `<button class="stop-btn" onclick="stopJob('${job.id}')">&#x25A0; Stop</button>` : "";

      const emailListId = `emails-${job.id}`;

      div.innerHTML = `
        <div class="history-meta-row">
          <div class="history-meta">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span class="history-date">${date}</span>
            </div>
            <div class="history-location">${params.country} &ndash; ${params.cities.join(", ")}</div>
            <div class="history-niches">${params.niches.join(" &middot; ")}</div>
          </div>
          <div class="history-actions">
            <span class="status-chip ${job.status}" id="status-${job.id}">${job.status}</span>
            ${stopButton}
            <button class="toggle-btn" onclick="toggleEmails('${emailListId}')">Files</button>
          </div>
        </div>
        ${job.error ? `<div class="error-message" style="margin-top:6px">Error: ${job.error}</div>` : ""}
        <div id="${emailListId}" class="email-dropdown" style="display: none;">
          ${fileButtons}
        </div>
      `;
      historyEl.appendChild(div);
    });
  } catch (error) {
    console.error("Could not load history", error);
  }
}

window.toggleEmails = function (id) {
  const el = document.getElementById(id);
  if (el) {
    el.style.display = el.style.display === "none" ? "flex" : "none";
    // Toggle button text if needed
    const btn = el.previousElementSibling.querySelector('.toggle-btn');
    if (btn) {
      btn.textContent = el.style.display === "none" ? "View Files" : "Hide Files";
    }
  }
};

window.stopJob = async function (jobId) {
  if (!confirm("Are you sure you want to stop this job?")) return;
  try {
    await fetchJson(`/api/jobs/${jobId}/stop`, { method: "POST" });
    loadHistory();
    updateQueueStatus();
  } catch (error) {
    alert("Failed to stop job: " + error.message);
  }
};

async function updateQueueStatus() {
  try {
    const status = await fetchJson("/api/queue");
    if (queueStatusEl) queueStatusEl.textContent = `${status.active} active · ${status.queued} queued · max ${status.max}`;
  } catch (error) {
    console.error("Could not update queue status", error);
  }
}

function startQueuePolling() {
  updateQueueStatus();
  setInterval(updateQueueStatus, 5000);
}

document.getElementById("expandNiches").addEventListener("click", async () => {
  const niches = nichesEl.value.split("\n").map((x) => x.trim()).filter(Boolean);
  if (!niches.length) return;
  try {
    const data = await fetchJson("/api/expand-niches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niches })
    });
    expandedNichesEl.textContent = `Expanded niches: ${data.expandedNiches.join(", ")}`;
  } catch (error) {
    expandedNichesEl.textContent = `Niche expansion failed: ${error.message}`;
  }
});

document.getElementById("run").addEventListener("click", async () => {
  const niches = nichesEl.value.split("\n").map((x) => x.trim()).filter(Boolean);
  const states = selectedValues(stateContainer);
  const cities = selectedValues(cityContainer);
  const includeGoogleMaps = (googleMapsModeEl?.value || "yes") === "yes";
  const scrapeMode = getScrapeMode();

  const allSites = ["facebook.com", "instagram.com", "linkedin.com/in", "twitter.com", "reddit.com"];
  let sites = [...allSites];
  const smLeaveItEl = document.getElementById("smLeaveIt");

  if (smLeaveItEl && !smLeaveItEl.checked) {
    const selectedSites = Array.from(document.querySelectorAll(".sm-site:checked")).map(el => el.value);
    if (selectedSites.length > 0) {
      // Prioritize selected sites: put them first, then the remaining ones
      sites = [...selectedSites, ...allSites.filter(s => !selectedSites.includes(s))];
    }
  }

  if (!niches.length || !cities.length) {
    statusEl.textContent = "Select at least one niche and one city.";
    return;
  }

  statusEl.textContent = "Submitting job to queue...";
  eventsEl.innerHTML = "";
  filesEl.innerHTML = "";

  try {
    const { jobId, status } = await fetchJson("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        country: countryEl.value,
        states,
        cities,
        niches,
        includeGoogleMaps,
        scrapeMode,
        sites,
        category: document.getElementById("jobCategory")?.value || undefined
      })
    });

    setStatus(`Job ${jobId} is ${status}. Waiting...`, 'running');
    totalLeads = 0;
    totalPhones = 0;
    if (liveLeadCountEl) liveLeadCountEl.textContent = '0 leads';
    if (livePhoneCountEl) livePhoneCountEl.textContent = '0 phones';
    if (phoneFilesEl) phoneFilesEl.innerHTML = '';

    // Refresh history, queue status, and category list immediately
    loadHistory();
    updateQueueStatus();
    loadCategories();

    const stream = new EventSource(`/api/jobs/${jobId}/events`);
    stream.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      addEvent(payload);

      if (payload.type === 'info' && payload.message === 'Job started') {
        setStatus(`Job ${jobId} running...`, 'running');
      }

      if (payload.type === 'lead-saved' || payload.type === 'city-update') {
        ensureFileLink(jobId, payload.fileName);
        ensureFileLink(jobId, payload.emailFileName);
        ensureFileLink(jobId, payload.allEmailsFileName);
        ensurePhoneFileLink(jobId, payload.phoneFileName);
        ensurePhoneFileLink(jobId, payload.allPhonesFileName);
      }
      if (payload.type === 'phone-saved') {
        ensurePhoneFileLink(jobId, payload.phoneFileName);
        ensurePhoneFileLink(jobId, payload.allPhonesFileName);
      }

      if (payload.type === 'job-completed' || payload.type === 'job-complete') {
        setStatus('Completed', 'done');
        stream.close(); loadHistory(); updateQueueStatus();
        (payload.files || []).forEach((file) => ensureFileLink(jobId, file));
      }

      if (payload.type === 'job-stopped') {
        setStatus('Stopped by user', 'idle');
        stream.close(); loadHistory(); updateQueueStatus();
      }

      if (payload.type === 'job-failed') {
        setStatus(`Failed: ${payload.message}`, 'error');
        stream.close(); loadHistory(); updateQueueStatus();
      }
    };

    stream.onerror = () => console.log('Job stream disconnected (might be finished or queued).');
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  }
});

function ensureFileLink(jobId, fileName) {
  if (!fileName) return;
  if (!fileName.includes("_emails.txt") && fileName !== "all_emails.txt" && !fileName.endsWith(".json") && fileName !== "google_maps_emails.txt") return;

  const existingGlobal = filesEl.querySelector(`a[data-file-name="${fileName}"]`);
  if (!existingGlobal) {
    const li = document.createElement("li");
    li.style.display = "inline-flex";
    li.style.gap = "4px";
    li.style.marginRight = "6px";
    li.style.marginBottom = "6px";
    li.innerHTML = `
      <a href="#" onclick="openFilePreview('${jobId}', '${fileName}'); return false;" class="download-btn" style="padding: 4px 6px;">&#x1F441; View</a>
      <a data-file-name="${fileName}" class="download-btn" style="border-top-left-radius:0; border-bottom-left-radius:0;" href="/api/jobs/${jobId}/files/${fileName}" target="_blank">&#x2193; DL</a>
    `;
    filesEl.appendChild(li);
  }

  const historyContainer = document.getElementById(`emails-${jobId}`);
  if (historyContainer) {
    const existingHistory = historyContainer.querySelector(`a[data-file-name="${fileName}"]`);
    if (!existingHistory) {
      historyContainer.insertAdjacentHTML("beforeend", `
        <div style="display:inline-flex; gap:4px; margin-bottom:4px; margin-right:4px;">
          <a href="#" onclick="openFilePreview('${jobId}', '${fileName}'); return false;" class="download-btn" style="padding: 4px 6px;">&#x1F441; View</a>
          <a data-file-name="${fileName}" href="/api/jobs/${jobId}/files/${fileName}" target="_blank" class="download-btn" style="border-top-left-radius:0; border-bottom-left-radius:0;">&#x2193; DL</a>
        </div>
      `);
    }
  }
}

function ensurePhoneFileLink(jobId, fileName) {
  if (!fileName) return;
  if (!fileName.includes("_phones.txt") && fileName !== "all_phones.txt") return;

  if (phoneFilesEl) {
    const existing = phoneFilesEl.querySelector(`a[data-file-name="${fileName}"]`);
    if (!existing) {
      const li = document.createElement("li");
      li.style.display = "inline-flex";
      li.style.gap = "4px";
      li.style.marginRight = "6px";
      li.style.marginBottom = "6px";
      li.innerHTML = `
        <a href="#" onclick="openFilePreview('${jobId}', '${fileName}'); return false;" class="download-btn" style="padding: 4px 6px; border-color:var(--purple);color:var(--purple);background:rgba(139,92,246,0.12)">&#x1F441; View</a>
        <a data-file-name="${fileName}" class="download-btn" style="border-top-left-radius:0; border-bottom-left-radius:0; border-color:var(--purple);color:var(--purple);background:rgba(139,92,246,0.12)" href="/api/jobs/${jobId}/files/${fileName}" target="_blank">&#x2193; DL</a>
      `;
      phoneFilesEl.appendChild(li);
    }
  }

  const historyContainer = document.getElementById(`emails-${jobId}`);
  if (historyContainer) {
    const existing = historyContainer.querySelector(`a[data-file-name="${fileName}"]`);
    if (!existing) {
      historyContainer.insertAdjacentHTML("beforeend", `
        <div style="display:inline-flex; gap:4px; margin-bottom:4px; margin-right:4px;">
          <a href="#" onclick="openFilePreview('${jobId}', '${fileName}'); return false;" class="download-btn" style="padding: 4px 6px; border-color:var(--purple);color:var(--purple);background:rgba(139,92,246,0.12)">&#x1F441; View</a>
          <a data-file-name="${fileName}" href="/api/jobs/${jobId}/files/${fileName}" target="_blank" class="download-btn" style="border-top-left-radius:0; border-bottom-left-radius:0; border-color:var(--purple);color:var(--purple);background:rgba(139,92,246,0.12)">&#x2193; DL</a>
        </div>
      `);
    }
  }
}

// ── Phone query preview event wiring ─────────────────────────
document.querySelectorAll('input[name="scrapeMode"]').forEach(r => r.addEventListener('change', updatePhoneQueryPreview));
nichesEl?.addEventListener('input', updatePhoneQueryPreview);
countryEl?.addEventListener('change', updatePhoneQueryPreview);
cityContainer?.addEventListener('change', updatePhoneQueryPreview);
// Initial call once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  updatePhoneQueryPreview();

  // Social media priority group toggle
  const smLeaveItEl = document.getElementById("smLeaveIt");
  const smSiteEls = document.querySelectorAll(".sm-site");

  if (smLeaveItEl) {
    smLeaveItEl.addEventListener("change", (e) => {
      const isLeaveIt = e.target.checked;
      smSiteEls.forEach(el => {
        el.disabled = isLeaveIt;
        if (isLeaveIt) el.checked = false;
        el.parentElement.style.opacity = isLeaveIt ? '0.5' : '1';
      });
    });
  }

  // Close Modal bindings
  if (document.getElementById('closeModalBtn')) {
    document.getElementById('closeModalBtn').addEventListener('click', () => {
      document.getElementById('filePreviewModal').style.display = 'none';
    });
  }
});

// ── File Preview Logic ─────────────────────────
window.openFilePreview = async function (jobId, fileName) {
  const modal = document.getElementById('filePreviewModal');
  const titleEl = document.getElementById('modalFileName');
  const contentEl = document.getElementById('modalFileContent');
  const downloadBtn = document.getElementById('modalDownloadBtn');

  if (!modal || !titleEl || !contentEl || !downloadBtn) return;

  titleEl.textContent = `Loading ${fileName}...`;
  contentEl.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted);">Fetching file contents...</div>';
  downloadBtn.href = `/api/jobs/${jobId}/files/${fileName}`;
  downloadBtn.setAttribute('download', fileName);
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/jobs/${jobId}/files/${fileName}`);
    if (!res.ok) throw new Error("Failed to load file");

    const text = await res.text();
    titleEl.textContent = fileName;

    if (fileName.endsWith('.csv')) {
      // Render CSV as a table
      const rows = text.split('\n').filter(r => r.trim());
      if (rows.length === 0) {
        contentEl.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted);">CSV is empty.</div>';
        return;
      }

      const tableRows = rows.map((row, idx) => {
        const cols = row.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || row.split(',');
        const cleanCols = cols.map(c => c.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));

        if (idx === 0) { // Header
          return `<tr>${cleanCols.map(c => `<th>${c}</th>`).join('')}</tr>`;
        }
        return `<tr>${cleanCols.map(c => `<td>${c}</td>`).join('')}</tr>`;
      });

      contentEl.innerHTML = `
        <div class="csv-table-wrapper">
          <table class="csv-table">
            ${tableRows.join('')}
          </table>
        </div>
      `;
    } else {
      // Render as raw text
      contentEl.innerHTML = `<pre>${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
    }

  } catch (err) {
    titleEl.textContent = "Error";
    contentEl.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--red);">Could not load file. It may no longer exist on the server.</div>`;
    console.error(err);
  }
};
checkAuth();

// Load initial data
loadCountries();
loadCategories();
startQueuePolling();
