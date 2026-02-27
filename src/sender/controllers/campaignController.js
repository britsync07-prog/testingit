import db from '../models/db.js';
import { createTransporter, injectTrackingHtml, sendEmail } from '../services/mailer.js';
import { v4 as uuidv4 } from 'uuid';

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
        // Extract the actual logged-in username, or fallback to the session ID if it's an API key
        const userId = req.session?.user?.username || req.session?.user?.id || 'admin_user';

        db.prepare(`INSERT INTO campaigns (id, userId, name, status) VALUES (?, ?, ?, 'sending')`)
            .run(campaignId, userId, campaignName);

        // 4. Send Response Early (Async Processing for Delivery)
        res.status(202).json({
            message: 'Campaign accepted for delivery.',
            campaignId: campaignId,
            totalRecipients: recipients.length
        });

        // 5. Asynchronous Delivery Worker Queue
        process.nextTick(async () => {
            const hostUrl = `${req.protocol}://${req.get('host')}`; // e.g. http://localhost:3000

            let deliveredCount = 0;
            let failedCount = 0;

            for (const email of recipients) {
                const recipientId = uuidv4();

                // Track pending recipient
                db.prepare(`INSERT INTO recipients (id, campaignId, email, status) VALUES (?, ?, ?, 'pending')`)
                    .run(recipientId, campaignId, email);

                // Prepare tracking payload
                const trackedHtml = injectTrackingHtml(htmlContent, recipientId, hostUrl);

                // Dispatch
                const success = await sendEmail(transporter, { name: senderName, email: smtpUser }, email, subject, trackedHtml);

                if (success) {
                    db.prepare(`UPDATE recipients SET status = 'delivered', sentAt = CURRENT_TIMESTAMP WHERE id = ?`)
                        .run(recipientId);

                    // Simulate the webhook 'DELIVERED' event immediately since we bypassed relying on external notifications
                    db.prepare(`INSERT INTO event_logs (id, eventId, campaignId, recipientId, eventType, ipAddress, userAgent)
                                VALUES (?, ?, ?, ?, 'DELIVERED', '127.0.0.1', 'Native SMTP Queue')`)
                        .run(uuidv4(), recipientId, campaignId, recipientId);

                    deliveredCount++;
                } else {
                    db.prepare(`UPDATE recipients SET status = 'bounced', sentAt = CURRENT_TIMESTAMP WHERE id = ?`)
                        .run(recipientId);

                    // Simulate webhook 'BOUNCED'
                    db.prepare(`INSERT INTO event_logs (id, eventId, campaignId, recipientId, eventType, ipAddress, userAgent)
                                VALUES (?, ?, ?, ?, 'BOUNCED', '127.0.0.1', 'Native SMTP Queue')`)
                        .run(uuidv4(), recipientId, campaignId, recipientId);

                    failedCount++;
                }

                // Slight delay to prevent spamming the SMTP server block limits
                await new Promise(r => setTimeout(r, 100)); // 10 emails / second max throughput
            }

            // Mark Campaign Completed
            db.prepare(`UPDATE campaigns SET status = 'completed' WHERE id = ?`).run(campaignId);
            console.log(`[Campaign ${campaignId}] Completed. Delivered: ${deliveredCount}. Failed: ${failedCount}.`);
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
