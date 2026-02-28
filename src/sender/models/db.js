import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure the data directory exists
const dataDir = path.join(__dirname, '../../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize SQLite database
const dbPath = path.join(dataDir, 'sender.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

// Define the schemas
const initDb = () => {
  // Users Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password TEXT NOT NULL,
      subscriptionPlan TEXT DEFAULT 'free', -- 'free', 'basic', 'advance', 'premium'
      trialEndsAt DATETIME,
      stripeCustomerId TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Campaigns Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'draft', -- 'draft', 'sending', 'completed'
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Recipients Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS recipients (
      id TEXT PRIMARY KEY,
      campaignId TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'bounced'
      sentAt DATETIME,
      FOREIGN KEY (campaignId) REFERENCES campaigns(id) ON DELETE CASCADE
    )
  `);

  // Event Logs Table (Designed for high volume inserts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_logs (
      id TEXT PRIMARY KEY,
      eventId TEXT NOT NULL, -- Corresponds to a specific tracking pixel or link
      campaignId TEXT NOT NULL,
      recipientId TEXT NOT NULL,
      eventType TEXT NOT NULL, -- 'OPEN', 'CLICK', 'DELIVERED', 'BOUNCED', 'WEBSITE_VISIT'
      url TEXT, -- Used for clicks and website visits
      ipAddress TEXT,
      userAgent TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaignId) REFERENCES campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (recipientId) REFERENCES recipients(id) ON DELETE CASCADE
    )
  `);

  // Create indexes for fast analytical query performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_event_logs_campaignId ON event_logs(campaignId);
    CREATE INDEX IF NOT EXISTS idx_event_logs_recipientId ON event_logs(recipientId);
    CREATE INDEX IF NOT EXISTS idx_event_logs_eventType ON event_logs(eventType);
  `);
};

initDb();

export default db;
