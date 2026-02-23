const countryEl = document.getElementById("country");
const stateContainer = document.getElementById("states");
const cityContainer = document.getElementById("cities");
const selectAllStates = document.getElementById("selectAllStates");
const selectAllCities = document.getElementById("selectAllCities");
const statusEl = document.getElementById("status");
const eventsEl = document.getElementById("events");
const filesEl = document.getElementById("files");
const nichesEl = document.getElementById("niches");
const expandedNichesEl = document.getElementById("expandedNiches");
const googleMapsModeEl = document.getElementById("googleMapsMode");
const userInfoEl = document.getElementById("userInfo");
const logoutBtn = document.getElementById("logoutBtn");
const historyEl = document.getElementById("history");
const queueStatusEl = document.getElementById("queueStatus");

let currentUser = null;

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

function attachToJob(jobId) {
  statusEl.textContent = `Job ${jobId} is in progress. Re-attaching...`;
  const stream = new EventSource(`/api/jobs/${jobId}/events`);
  
  stream.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    const row = document.createElement("li");
    row.textContent = `[${payload.type}] ${payload.message || "update"}`;
    eventsEl.prepend(row);

    const jobStatusEl = document.getElementById(`status-${jobId}`);
    if (jobStatusEl) {
      const displayStatus = payload.type.replace("job-", "").toUpperCase();
      jobStatusEl.textContent = displayStatus;
      jobStatusEl.className = `status-${displayStatus.toLowerCase()}`;
    }

    if (payload.type === "info" && payload.message === "Job started") {
      statusEl.textContent = `Job ${jobId} is now running...`;
    }

    if (payload.type === "lead-saved" || payload.type === "city-update") {
      ensureFileLink(jobId, payload.fileName);
      ensureFileLink(jobId, payload.emailFileName);
      ensureFileLink(jobId, payload.allEmailsFileName);
    }

    if (payload.type === "job-completed" || payload.type === "job-complete" || payload.type === "job-stopped" || payload.type === "job-failed") {
      statusEl.textContent = payload.type.includes("complete") ? "Completed" : (payload.type === "job-stopped" ? "Stopped" : "Failed");
      stream.close();
      loadHistory();
      updateQueueStatus();
    }
  };

  stream.onerror = () => {
    console.log("Job stream disconnected.");
  };
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
    } catch {}
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

async function loadHistory() {
  try {
    const history = await fetchJson("/api/history");
    historyEl.innerHTML = "";
    if (history.length === 0) {
      historyEl.textContent = "No search history yet.";
      return;
    }
    history.forEach((job) => {
      const div = document.createElement("div");
      div.className = "history-item";
      const date = new Date(job.createdAt).toLocaleString();
      const params = job.params;
      
      // Filter to only show email files and map json files
      const emailFiles = (job.files || []).filter(f => 
        f.includes("_emails.txt") || 
        f === "all_emails.txt" || 
        f === "google_maps_emails.txt" || 
        f.endsWith(".json")
      );
      
      const fileButtons = emailFiles.map(f => `<a data-file-name="${f}" href="/api/jobs/${job.id}/files/${f}" target="_blank" class="download-btn">Download ${f}</a>`).join("");

      const isStoppable = job.status === "running" || job.status === "queued";
      const stopButton = isStoppable ? `<button class="stop-btn" onclick="stopJob('${job.id}')">Stop</button>` : "";
      
      const emailListId = `emails-${job.id}`;

      div.innerHTML = `
        <div class="history-meta">
          <strong>${date}</strong> - ${params.country} (${params.cities.join(", ")})
          <br>Niches: ${params.niches.join(", ")}
          <br>Status: <span class="status-${job.status}" id="status-${job.id}">${job.status.toUpperCase()}</span>
          ${stopButton}
          <button class="toggle-btn" onclick="toggleEmails('${emailListId}')">View Files</button>
          ${job.error ? `<br><span class="error-message">Error: ${job.error}</span>` : ""}
        </div>
        <div id="${emailListId}" class="history-files email-dropdown" style="display: none;">
          ${fileButtons}
        </div>
      `;
      historyEl.appendChild(div);
    });
  } catch (error) {
    console.error("Could not load history", error);
  }
}

window.toggleEmails = function(id) {
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

window.stopJob = async function(jobId) {
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
    queueStatusEl.textContent = `Queue Status: ${status.active} active, ${status.queued} queued (Max concurrent: ${status.max})`;
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
        includeGoogleMaps
      })
    });

    statusEl.textContent = `Job ${jobId} is ${status}. Waiting for updates...`;
    
    // Refresh history and queue status immediately
    loadHistory();
    updateQueueStatus();

    const stream = new EventSource(`/api/jobs/${jobId}/events`);
    stream.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      const row = document.createElement("li");
      row.textContent = `[${payload.type}] ${payload.message || "update"}`;
      eventsEl.prepend(row);

      if (payload.type === "info" && payload.message === "Job started") {
          statusEl.textContent = `Job ${jobId} is now running...`;
      }

      if (payload.type === "lead-saved" || payload.type === "city-update") {
        ensureFileLink(jobId, payload.fileName);
        ensureFileLink(jobId, payload.emailFileName);
        ensureFileLink(jobId, payload.allEmailsFileName);
      }

      if (payload.type === "job-completed" || payload.type === "job-complete") {
        statusEl.textContent = "Completed";
        stream.close();
        loadHistory();
        updateQueueStatus();
        (payload.files || []).forEach((file) => ensureFileLink(jobId, file));
      }

      if (payload.type === "job-stopped") {
        statusEl.textContent = "Stopped by user";
        stream.close();
        loadHistory();
        updateQueueStatus();
      }

      if (payload.type === "job-failed") {
        statusEl.textContent = `Job failed: ${payload.message}`;
        stream.close();
        loadHistory();
        updateQueueStatus();
      }
    };

    stream.onerror = () => {
      console.log("Job stream disconnected (might be finished or queued).");
    };
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  }
});

function ensureFileLink(jobId, fileName) {
  if (!fileName) return;
  // UPDATED FILTER: allows google_maps_emails.txt and .json files
  if (!fileName.includes("_emails.txt") && fileName !== "all_emails.txt" && !fileName.endsWith(".json") && fileName !== "google_maps_emails.txt") return;
  
  // Update Current Job panel
  const existingGlobal = filesEl.querySelector(`a[data-file-name="${fileName}"]`);
  if (!existingGlobal) {
    const li = document.createElement("li");
    li.innerHTML = `<a data-file-name="${fileName}" class="download-btn" href="/api/jobs/${jobId}/files/${fileName}" target="_blank">Download ${fileName}</a>`;
    filesEl.appendChild(li);
  }

  // Update History list (Dropdown)
  const historyContainer = document.getElementById(`emails-${jobId}`);
  if (historyContainer) {
    const existingHistory = historyContainer.querySelector(`a[data-file-name="${fileName}"]`);
    if (!existingHistory) {
      const linkHtml = `<a data-file-name="${fileName}" href="/api/jobs/${jobId}/files/${fileName}" target="_blank" class="download-btn">Download ${fileName}</a>`;
      historyContainer.insertAdjacentHTML("beforeend", linkHtml);
    }
  }
}

checkAuth();
