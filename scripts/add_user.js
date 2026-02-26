import bcrypt from "bcryptjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USERS_FILE = path.join(__dirname, "..", "data", "users.json");

async function addUser() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log("Usage: npm run add-user <username> <password> [plan]");
    console.log("Example: npm run add-user john mypassword123 premium");
    process.exit(1);
  }

  const [username, password, plan] = args;
  const subscriptionPlan = plan || "premium";

  try {
    let users = [];
    try {
      const data = await fs.readFile(USERS_FILE, "utf-8");
      users = JSON.parse(data);
    } catch (e) {
      // File doesn't exist yet, that's fine
    }

    if (users.find(u => u.username === username)) {
      console.error(`Error: User '${username}' already exists.`);
      process.exit(1);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    users.push({
      username,
      password: hashedPassword,
      subscriptionPlan
    });

    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
    console.log(`✅ Successfully created ${subscriptionPlan} account for '${username}'!`);
    console.log(`You can now log in at http://localhost:3000/login.html`);

  } catch (err) {
    console.error("Failed to add user:", err.message);
    process.exit(1);
  }
}

addUser();
