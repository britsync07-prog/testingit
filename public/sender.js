import { fetchJson, checkAuthAndSetupSidebar } from './app.js';

let currentUser = null;
let currentRecipients = [];

// DOM Elements
const campaignNameEl = document.getElementById('campaignName');
const senderNameEl = document.getElementById('senderName');
const subjectLineEl = document.getElementById('subjectLine');
const htmlTemplateEl = document.getElementById('htmlTemplate');
const btnLaunchCampaign = document.getElementById('btnLaunchCampaign');
const senderErrorBox = document.getElementById('senderErrorBox');

// SMTP Elements
const smtpHostEl = document.getElementById('smtpHost');
const smtpPortEl = document.getElementById('smtpPort');
const smtpUserEl = document.getElementById('smtpUser');
const smtpPassEl = document.getElementById('smtpPass');

// Audience Elements
const csvDropZone = document.getElementById('csvDropZone');
const audienceFileEl = document.getElementById('audienceFile');
const btnBrowseFile = document.getElementById('btnBrowseFile');
const audiencePreview = document.getElementById('audiencePreview');
const parsedCountEl = document.getElementById('parsedCount');
const btnClearAudience = document.getElementById('btnClearAudience');
const audienceTableBody = document.getElementById('audienceTableBody');

// KPIs
const kpiTotalSent = document.getElementById('kpiTotalSent');
const kpiDeliveryRate = document.getElementById('kpiDeliveryRate');
const kpiOpenRate = document.getElementById('kpiOpenRate');
const kpiClickRate = document.getElementById('kpiClickRate');

/**
 * Validates basic email formatting via regex
 */
const isValidEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

/**
 * Renders the preview table of uploaded recipients
 */
const renderAudiencePreview = () => {
  audienceTableBody.innerHTML = '';

  if (currentRecipients.length === 0) {
    audiencePreview.style.display = 'none';
    csvDropZone.style.display = 'block';
    validateForm();
    return;
  }

  csvDropZone.style.display = 'none';
  audiencePreview.style.display = 'block';
  parsedCountEl.innerText = currentRecipients.filter(r => r.valid).length;

  // Show max 100 in preview to avoid DOM lag
  const previewSlice = currentRecipients.slice(0, 100);

  previewSlice.forEach(rec => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          <svg width="14" height="14" fill="none" stroke="var(--text-muted)" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
          ${rec.email}
        </div>
      </td>
      <td>
        ${rec.valid
        ? '<span class="status-badge valid">Valid</span>'
        : '<span class="status-badge invalid">Invalid Format</span>'}
      </td>
    `;
    audienceTableBody.appendChild(tr);
  });

  if (currentRecipients.length > 100) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="2" style="text-align:center; color:var(--text-muted); font-size:12px;">+ ${currentRecipients.length - 100} more recipients hidden</td>`;
    audienceTableBody.appendChild(tr);
  }

  validateForm();
};

/**
 * Handles CSV parsing using PapaParse
 */
const handleFileUpload = (file) => {
  if (!file) return;

  Papa.parse(file, {
    header: false,
    skipEmptyLines: true,
    complete: function (results) {
      currentRecipients = [];
      const data = results.data;

      data.forEach(row => {
        // Assume first column with an '@' is the email
        const possibleEmail = row.find(col => col && col.includes('@'));
        if (possibleEmail) {
          const cleanEmail = possibleEmail.trim().toLowerCase();
          currentRecipients.push({
            email: cleanEmail,
            valid: isValidEmail(cleanEmail)
          });
        }
      });

      renderAudiencePreview();
    }
  });
};

// --- DRAG & DROP LOGIC ---
btnBrowseFile.addEventListener('click', () => audienceFileEl.click());

audienceFileEl.addEventListener('change', (e) => {
  handleFileUpload(e.target.files[0]);
});

csvDropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  csvDropZone.classList.add('dragover');
});

csvDropZone.addEventListener('dragleave', () => {
  csvDropZone.classList.remove('dragover');
});

csvDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  csvDropZone.classList.remove('dragover');
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleFileUpload(e.dataTransfer.files[0]);
  }
});

btnClearAudience.addEventListener('click', () => {
  currentRecipients = [];
  audienceFileEl.value = '';
  renderAudiencePreview();
});

// --- FORM VALIDATION ---
const validateForm = () => {
  const hasValidRecipients = currentRecipients.some(r => r.valid);
  const isConfigFilled = campaignNameEl.value.trim() &&
    senderNameEl.value.trim() &&
    subjectLineEl.value.trim() &&
    htmlTemplateEl.value.trim() &&
    smtpHostEl.value.trim() &&
    smtpPortEl.value.trim() &&
    smtpUserEl.value.trim() &&
    smtpPassEl.value.trim();

  btnLaunchCampaign.disabled = !(hasValidRecipients && isConfigFilled);
};

[campaignNameEl, senderNameEl, subjectLineEl, htmlTemplateEl, smtpHostEl, smtpPortEl, smtpUserEl, smtpPassEl].forEach(el => {
  el.addEventListener('input', validateForm);
});

btnLaunchCampaign.addEventListener('click', async () => {
  btnLaunchCampaign.disabled = true;
  senderErrorBox.style.display = 'none';

  const validEmails = currentRecipients.filter(r => r.valid).map(r => r.email);

  const payload = {
    campaignName: campaignNameEl.value.trim(),
    senderName: senderNameEl.value.trim(),
    subject: subjectLineEl.value.trim(),
    htmlContent: htmlTemplateEl.value.trim(),
    smtpHost: smtpHostEl.value.trim(),
    smtpPort: parseInt(smtpPortEl.value.trim(), 10),
    smtpUser: smtpUserEl.value.trim(),
    smtpPass: smtpPassEl.value.trim(),
    recipients: validEmails
  };

  try {
    btnLaunchCampaign.innerHTML = `<svg width="18" height="18" class="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Launching...`;

    // 1. Dispatch the payload to the Native SMTP Endpoint
    const result = await fetchJson('/api/sender/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (result && result.campaignId) {
      // 2. Mock immediate initial KPI load since it was just accepted into the Delivery Queue
      kpiTotalSent.innerText = validEmails.length;
      kpiDeliveryRate.innerText = 'Queued';
      kpiOpenRate.innerText = '0.0%';
      kpiClickRate.innerText = '0.0%';

      senderErrorBox.className = 'status-box success-box';
      senderErrorBox.innerHTML = `<strong>Success!</strong> ${result.message} Check back shortly for delivery metrics.`;
      senderErrorBox.style.display = 'block';

      audiencePreview.style.display = 'none';
      csvDropZone.style.display = 'block';
      currentRecipients = [];
      campaignNameEl.value = '';
      subjectLineEl.value = '';
      htmlTemplateEl.value = '';

      btnLaunchCampaign.innerHTML = `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 2L11 13"></path><path d="M22 2L15 22L11 13L2 9L22 2Z"></path></svg> Launch Campaign`;
    }

  } catch (error) {
    senderErrorBox.className = 'error-box';
    senderErrorBox.innerHTML = `<strong>Launch Failed:</strong><br>${error.message}`;
    senderErrorBox.style.display = 'block';

    btnLaunchCampaign.disabled = false;
    btnLaunchCampaign.innerHTML = `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 2L11 13"></path><path d="M22 2L15 22L11 13L2 9L22 2Z"></path></svg> Launch Campaign`;
  }
});


document.addEventListener('DOMContentLoaded', () => {
    // Re-bind just in case they fired too early
    const reBtnBrowse = document.getElementById('btnBrowseFile');
    const reAudienceFile = document.getElementById('audienceFile');
    const reCsvDropZone = document.getElementById('csvDropZone');
    const reBtnClear = document.getElementById('btnClearAudience');
    const reBtnLaunch = document.getElementById('btnLaunchCampaign');
    
    if (reBtnBrowse && reAudienceFile) {
        // Clear any old listeners if possible by cloning
        const newBtnBrowse = reBtnBrowse.cloneNode(true);
        reBtnBrowse.parentNode.replaceChild(newBtnBrowse, reBtnBrowse);
        
        newBtnBrowse.addEventListener('click', (e) => {
            e.preventDefault();
            reAudienceFile.click();
        });
        
        reAudienceFile.addEventListener('change', (e) => {
            handleFileUpload(e.target.files[0]);
        });
    }
});

// --- INIT ---
async function init() {
  currentUser = await checkAuthAndSetupSidebar();

  if (currentUser && currentUser.subscriptionPlan !== 'premium') {
    // If somehow a non-premium user accesses this page despite locks
    window.location.href = "/dashboard.html";
    return;
  }
}

init();
