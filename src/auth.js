import bcrypt from "bcryptjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USERS_FILE = path.join(__dirname, "..", "data", "users.json");

async function ensureDataDir() {
  const dataDir = path.join(__dirname, "..", "data");
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

async function loadUsers() {
  await ensureDataDir();
  try {
    const data = await fs.readFile(USERS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    // Default user: admin / admin123
    const hashedPassword = await bcrypt.hash("admin123", 10);
    const defaultUsers = [{ username: "admin", password: hashedPassword }];
    await fs.writeFile(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
    return defaultUsers;
  }
}

export async function authenticate(username, password) {
  const users = await loadUsers();
  const user = users.find((u) => u.username === username);
  if (user && (await bcrypt.compare(password, user.password))) {
    return {
      username: user.username,
      subscriptionPlan: user.subscriptionPlan || "basic"
    };
  }
  return null;
}

export function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  return res.status(401).json({ error: "Unauthorized" });
}
