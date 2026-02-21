import { LeadScraper } from "./scraper.js";
import path from "node:path";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, "..", "data", "history.json");

export class JobQueue {
  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
    this.activeJobs = new Map();
    this.queuedJobs = [];
    this.jobs = new Map(); // All jobs (active, queued, completed)
  }

  async loadHistory() {
    try {
      const data = await fsPromises.readFile(HISTORY_FILE, "utf-8");
      const history = JSON.parse(data);
      for (const job of history) {
        job.listeners = new Set();
        if (!job.files) job.files = [];
        this.jobs.set(job.id, job);
      }
    } catch {
      await fsPromises.writeFile(HISTORY_FILE, "[]");
    }
  }

  async saveHistory() {
    const history = Array.from(this.jobs.values()).map(job => {
        const { listeners, ...rest } = job;
        return rest;
    });
    await fsPromises.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
  }

  addJob(jobData, userId) {
    const job = {
      ...jobData,
      userId,
      status: "queued",
      events: [],
      listeners: new Set(),
      files: [],
      createdAt: new Date().toISOString()
    };
    this.jobs.set(job.id, job);
    this.queuedJobs.push(job.id);
    this.processQueue();
    return job;
  }

  async processQueue() {
    if (this.activeJobs.size >= this.maxConcurrent || this.queuedJobs.length === 0) {
      return;
    }

    const jobId = this.queuedJobs.shift();
    const job = this.jobs.get(jobId);
    if (!job) return;

    const scraper = new LeadScraper({
      outputRoot: path.join(__dirname, "..", "output"),
      onProgress: (event) => {
        // Dynamically add files as they are discovered/saved
        if (event.fileName && !job.files.includes(event.fileName)) {
          job.files.push(event.fileName);
        }
        this.pushEvent(job, event);
      }
    });

    this.activeJobs.set(jobId, { job, scraper });
    job.status = "running";
    this.pushEvent(job, { type: "info", message: "Job started" });

    try {
      const result = await scraper.run({
        jobId: job.id,
        country: job.params.country,
        cities: job.params.cities,
        states: job.params.states,
        niches: job.params.niches,
        includeGoogleMaps: job.params.includeGoogleMaps !== false
      });

      if (job.status !== "stopped") {
        job.status = "completed";
        job.files = result.files;
        this.pushEvent(job, { type: "job-completed", files: result.files });
      }
    } catch (error) {
      if (job.status !== "stopped") {
        job.status = "failed";
        job.error = error.message;
        this.pushEvent(job, { type: "job-failed", message: error.message });
      }
    } finally {
      this.activeJobs.delete(jobId);
      await this.saveHistory();
      this.processQueue();
    }
  }

  stopJob(jobId) {
    // Check if it's an active job
    if (this.activeJobs.has(jobId)) {
      const { job, scraper } = this.activeJobs.get(jobId);
      job.status = "stopped";
      scraper.stop();
      this.pushEvent(job, { type: "job-stopped", message: "Job stopped by user" });
      this.saveHistory();
      return true;
    }

    // Check if it's a queued job
    const queuedIndex = this.queuedJobs.indexOf(jobId);
    if (queuedIndex !== -1) {
      this.queuedJobs.splice(queuedIndex, 1);
      const job = this.jobs.get(jobId);
      if (job) {
        job.status = "stopped";
        this.pushEvent(job, { type: "job-stopped", message: "Job cancelled by user" });
        this.saveHistory();
      }
      return true;
    }

    return false;
  }

  pushEvent(job, event) {
    const payload = { ...event, time: new Date().toISOString() };
    job.events.push(payload);

    // Track files in the job object immediately when they are mentioned in events
    if (payload.fileName && !job.files.includes(payload.fileName)) {
      job.files.push(payload.fileName);
    }
    if (payload.emailFileName && !job.files.includes(payload.emailFileName)) {
      job.files.push(payload.emailFileName);
    }
    if (payload.allEmailsFileName && !job.files.includes(payload.allEmailsFileName)) {
      job.files.push(payload.allEmailsFileName);
    }

    for (const res of job.listeners) {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  }

  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  getUserHistory(userId) {
    return Array.from(this.jobs.values())
      .filter((j) => j.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getQueueStatus() {
    return {
      active: this.activeJobs.size,
      queued: this.queuedJobs.length,
      max: this.maxConcurrent
    };
  }

  hasUserActiveJob(userId) {
    return Array.from(this.jobs.values()).some(
      (job) => job.userId === userId && (job.status === "running" || job.status === "queued")
    );
  }
}
