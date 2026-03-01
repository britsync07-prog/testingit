import db from '../models/db.js';
import { createTransporter, injectTrackingHtml, sendEmail } from '../services/mailer.js';
import { v4 as uuidv4 } from 'uuid';

// Ensure abort-related columns exist (safe to run every boot)
try { db.exec(`ALTER TABLE campaigns ADD COLUMN abortReason TEXT`); } catch { }
try { db.exec(`ALTER TABLE campaigns ADD COLUMN deliveredCount INTEGER DEFAULT 0`); } catch { }
try { db.exec(`ALTER TABLE campaigns ADD COLUMN bouncedCount INTEGER DEFAULT 0`); } catch { }
try { db.exec(`ALTER TABLE recipients ADD COLUMN error TEXT`); } catch { }

const MAX_CONSECUTIVE_FAILURES = 4;

/**
 * Validates the SMTP credentials by attempting a connection before processing the campaign.
 */
const verifySmtpConnection = async (smtpConfig) => {
    const transporter = createTransporter(smtpConfig);
    try {
        await transporter.verify();
        return transporter;
    } catch (error) {
        throw new Error(`SMTP Connection Failed: ${error.message}`);
    }
};

/**
 * Handles the Campaign Dispatch Pipeline from the UI Builder.
 * Expected Payload:
 * {
 *   campaignName: "Promo 1",
 *   senderName: "John Doe",
 *   subject: "Hello",
 *   htmlContent: "...",
 *   recipients: ["a@a.com", "b@b.com"],
 *   smtpHost: "...",
 *   smtpPort: 587,
 *   smtpUser: "...",
 *   smtpPass: "..."
 * }
 */
const launchCampaign = async (req, res) => {
    try {
        const { campaignName, senderName, subject, htmlContent, recipients, smtpHost, smtpPort, smtpUser, smtpPass } = req.body;

        // 1. Basic Validation
        if (!campaignName || !subject || !htmlContent || !recipients || recipients.length === 0) {
            return res.status(400).json({ error: "Missing required campaign data." });
        }
        if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
            return res.status(400).json({ error: "Missing required SMTP credentials." });
        }

        // 2. Verify SMTP Connection Upfront
        const smtpConfig = { host: smtpHost, port: parseInt(smtpPort, 10), user: smtpUser, pass: smtpPass };
        const transporter = await verifySmtpConnection(smtpConfig);

        // 3. Initialize Campaign in SQLite
        const campaignId = uuidv4();
        const userId = req.session?.user?.username || req.session?.user?.id || 'admin_user';

        db.prepare(`INSERT INTO campaigns (id, userId, name, status) VALUES (?, ?, ?, 'sending')`)
            .run(campaignId, userId, campaignName);

        // 4. Send Response Early (Async Processing for Delivery)
        res.status(202).json({
            message: 'Campaign accepted for delivery.',
            campaignId: campaignId,
            totalRecipients: recipients.length
        });

        // 5. Asynchronous Delivery Worker with Consecutive-Failure Abort
        process.nextTick(async () => {
            const hostUrl = `${req.protocol}://${req.get('host')}`;

            let deliveredCount = 0;
            let bouncedCount = 0;
            let consecutiveFails = 0;
            let aborted = false;
            let lastError = '';

            for (const email of recipients) {
                const recipientId = uuidv4();

                // Track pending recipient
                db.prepare(`INSERT INTO recipients (id, campaignId, email, status) VALUES (?, ?, ?, 'pending')`)
                    .run(recipientId, campaignId, email);

                // Prepare tracking payload
                const trackedHtml = injectTrackingHtml(htmlContent, recipientId, hostUrl);

                // Dispatch
                const result = await sendEmail(transporter, { name: senderName, email: smtpUser }, email, subject, trackedHtml);

                if (result.ok) {
                    db.prepare(`UPDATE recipients SET status = 'delivered', sentAt = CURRENT_TIMESTAMP WHERE id = ?`)
                        .run(recipientId);
                    db.prepare(`INSERT INTO event_logs (id, eventId, campaignId, recipientId, eventType, ipAddress, userAgent)
                                VALUES (?, ?, ?, ?, 'DELIVERED', '127.0.0.1', 'Native SMTP Queue')`)
                        .run(uuidv4(), recipientId, campaignId, recipientId);

                    deliveredCount++;
                    consecutiveFails = 0; // reset streak on any success
                } else {
                    const errorMsg = result.error || 'Unknown SMTP error';
                    db.prepare(`UPDATE recipients SET status = 'bounced', error = ?, sentAt = CURRENT_TIMESTAMP WHERE id = ?`)
                        .run(errorMsg, recipientId);
                    db.prepare(`INSERT INTO event_logs (id, eventId, campaignId, recipientId, eventType, ipAddress, userAgent)
                                VALUES (?, ?, ?, ?, 'BOUNCED', '127.0.0.1', 'Native SMTP Queue')`)
                        .run(uuidv4(), recipientId, campaignId, recipientId);

                    bouncedCount++;
                    consecutiveFails++;
                    lastError = errorMsg;

                    // ⛔ Abort after MAX_CONSECUTIVE_FAILURES in a row
                    if (consecutiveFails >= MAX_CONSECUTIVE_FAILURES) {
                        aborted = true;
                        console.warn(`[Campaign ${campaignId}] ⛔ Aborted after ${MAX_CONSECUTIVE_FAILURES} consecutive failures. Last error: ${lastError}`);
                        break;
                    }
                }

                // 🔄 Update progress in DB (optional but helpful for long queues)
                db.prepare(`UPDATE campaigns SET deliveredCount = ?, bouncedCount = ? WHERE id = ?`)
                    .run(deliveredCount, bouncedCount, campaignId);

                // ⏳ 5-second delay between every email sending as requested
                await new Promise(r => setTimeout(r, 5000));
            }

            // 6. Mark campaign final status + persist counts + abort reason
            if (aborted) {
                const abortMsg = `Stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive SMTP failures. Last error: ${lastError}`;
                db.prepare(`UPDATE campaigns SET status = 'aborted', abortReason = ?, deliveredCount = ?, bouncedCount = ? WHERE id = ?`)
                    .run(abortMsg, deliveredCount, bouncedCount, campaignId);
                console.log(`[Campaign ${campaignId}] Aborted. Sent: ${deliveredCount}, Bounced: ${bouncedCount}.`);
            } else {
                db.prepare(`UPDATE campaigns SET status = 'completed', deliveredCount = ?, bouncedCount = ? WHERE id = ?`)
                    .run(deliveredCount, bouncedCount, campaignId);
                console.log(`[Campaign ${campaignId}] Completed. Delivered: ${deliveredCount}, Bounced: ${bouncedCount}.`);
            }
        });

    } catch (error) {
        console.error('[Campaign Error]', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message || 'Internal Server Error during campaign launch.' });
        }
    }
};

export {
    launchCampaign
};
