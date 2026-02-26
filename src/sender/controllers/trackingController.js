import db from '../models/db.js';
import { verifyAndDecodeUrl } from '../services/hmac.js';
import { PIXEL_BUFFER, isBotAgent } from '../services/pixel.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Ensures the event is logged into SQLite under high concurrency.
 * @param {string} eventId 
 * @param {string} type - 'OPEN' | 'CLICK' | 'DELIVERED' | 'BOUNCED'
 * @param {Object} req - The Express request object to extract IP/UA
 * @param {string} [url] - The destination URL for clicks
 */
const logEvent = (eventId, type, req, url = null) => {
    try {
        // 1. Resolve eventId to actual Campaign & Recipient (Assumes eventId maps 1:1 to recipientId for now, or fetch from lookup tree)
        // To simplify for this scaffold: eventId represents the recipientId uniquely
        const recipient = db.prepare('SELECT campaignId FROM recipients WHERE id = ?').get(eventId);
        if (!recipient) return; // Invalid/orphaned event

        const ipAddress = req.ip || req.headers['x-forwarded-for'] || '';
        const userAgent = req.headers['user-agent'] || '';

        // 2. Filter obvious bots from polluting open/click stats
        if ((type === 'OPEN' || type === 'CLICK') && isBotAgent(userAgent)) {
            console.log(`[Tracking] Filtered bot ${type} from IP: ${ipAddress}`);
            return;
        }

        // 3. Insert the high-volume log using a fast prepared statement
        const insertLog = db.prepare(`
      INSERT INTO event_logs (id, eventId, campaignId, recipientId, eventType, url, ipAddress, userAgent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

        insertLog.run(
            uuidv4(),
            eventId,
            recipient.campaignId,
            eventId, // Recipient ID
            type,
            url,
            ipAddress,
            userAgent
        );

    } catch (err) {
        console.error(`[Tracking Controller] Failed to log ${type} event: ${err.message}`);
    }
};

/**
 * Handles the 1x1 transparent GIF open tracker.
 */
const handleOpen = (req, res) => {
    const { eventId } = req.params;

    // Log the OPEN asynchronously so it doesn't block the pixel response
    process.nextTick(() => logEvent(eventId, 'OPEN', req));

    // Serve the tiny transparent pixel image
    res.writeHead(200, {
        'Content-Type': 'image/gif',
        'Content-Length': PIXEL_BUFFER.length,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0' // Enforce fresh fetch every time
    });

    res.end(PIXEL_BUFFER);
};

/**
 * Handles secure Base64URL HMAC signed click tracking redirects.
 */
const handleClick = (req, res) => {
    const { payload, signature } = req.params;

    // 1. Cryptographically decode and verify the URL has not been tampered with
    const decoded = verifyAndDecodeUrl(payload, signature);

    if (!decoded || !decoded.u || !decoded.e) {
        return res.status(403).send('Invalid or tampered tracking link.');
    }

    // 2. Log the CLICK asynchronously
    process.nextTick(() => logEvent(decoded.e, 'CLICK', req, decoded.u));

    // 3. Issue a temporary 302 redirect so subsequent clicks are continually tracked
    res.redirect(302, decoded.u);
};

export {
    handleOpen,
    handleClick
};
