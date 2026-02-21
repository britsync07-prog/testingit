const emailFileEl = document.getElementById("emailFile");
const emailCountEl = document.getElementById("emailCount");
const fileStatsEl = document.getElementById("fileStats");
const subjectEl = document.getElementById("subject");
const htmlTemplateEl = document.getElementById("htmlTemplate");
const sendEmailsBtn = document.getElementById("sendEmails");
const sendStatus = document.getElementById("sendStatus");
const userInfoEl = document.getElementById("userInfo");
const logoutBtn = document.getElementById("logoutBtn");

let emailsList = [];

async function checkAuth() {
  try {
    const user = await fetchJson("/api/me");
    userInfoEl.textContent = `Logged in as: ${user.username}`;
  } catch (error) {
    window.location.href = "/login.html";
  }
}

logoutBtn.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login.html";
});

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

emailFileEl.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const content = event.target.result;
    
    // Improved regex to find all emails in the text, regardless of formatting
    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
    const matches = content.match(emailRegex);
    
    // Remove duplicates and store
    emailsList = matches ? Array.from(new Set(matches.map(e => e.toLowerCase()))) : [];

    emailCountEl.textContent = emailsList.length;
    fileStatsEl.style.display = "block";
    
    if (emailsList.length > 0) {
      sendEmailsBtn.disabled = false;
      sendStatus.innerHTML = `<p style="color: #059669;">Successfully loaded <strong>${emailsList.length}</strong> unique emails.</p>`;
    } else {
      sendEmailsBtn.disabled = true;
      sendStatus.innerHTML = `<p style="color: #dc2626;">No valid emails found in this file.</p>`;
    }
  };
  reader.readAsText(file);
});

sendEmailsBtn.addEventListener("click", () => {
    const subject = subjectEl.value.trim();
    const template = htmlTemplateEl.value.trim();
    
    if (!subject || !template) {
        alert("Please enter a subject and an email template.");
        return;
    }
    
    // This is where you would send the data to the server to actually send emails.
    alert(`This feature is ready to be connected to an email service. You have ${emailsList.length} emails loaded!`);
});

checkAuth();
