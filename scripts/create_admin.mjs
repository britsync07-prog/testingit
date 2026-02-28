import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

const db = new Database('data/sender.db');
const hash = await bcrypt.hash('Saimon55@', 10);
const id = uuidv4();

try {
    db.prepare(
        "INSERT INTO users (id, username, email, password, subscriptionPlan, trialEndsAt, isAdmin) VALUES (?, ?, ?, ?, 'premium', NULL, 1)"
    ).run(id, 'britsync', 'britsync@britsync.com', hash);
    console.log('✅ Admin account created successfully!');
    console.log('   Username : britsync');
    console.log('   Plan     : Premium');
    console.log('   Admin    : Yes');
} catch (e) {
    if (e.message.includes('UNIQUE')) {
        // Already exists — just make sure it's admin + premium
        db.prepare("UPDATE users SET isAdmin = 1, subscriptionPlan = 'premium', trialEndsAt = NULL WHERE username = 'britsync'").run();
        console.log('✅ Account already existed — updated to Admin + Premium.');
    } else {
        console.error('❌ Error:', e.message);
    }
}
db.close();
