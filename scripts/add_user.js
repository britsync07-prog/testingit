import bcrypt from "bcryptjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USERS_FILE = path.join(__dirname, "..", "data", "users.json");

async function addUser(username, password) {
  try {
    const data = await fs.readFile(USERS_FILE, "utf-8");
    const users = JSON.parse(data);

    if (users.find((u) => u.username === username)) {
      console.error(`User "${username}" already exists.`);
      process.exit(1);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    users.push({ username, password: hashedPassword });

    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
    console.log(`User "${username}" added successfully.`);
  } catch (error) {
    console.error("Error adding user:", error.message);
    process.exit(1);
  }
}

const [username, password] = process.argv.slice(2);

if (!username || !password) {
  console.log("Usage: node scripts/add_user.js <username> <password>");
  process.exit(1);
}

addUser(username, password);
