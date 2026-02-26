import crypto from 'crypto';

// In production, this MUST be an environment variable. Do not hardcode secrets.
const HMAC_SECRET = process.env.TRACKING_HMAC_SECRET || 'xY8j!k9$mP2nD5v@sQzL7w#cF1rT4b^g';

/**
 * Creates a signed tracking URL for clicks.
 * @param {string} baseUrl - The base host URL (e.g., https://api.yourdomain.com)
 * @param {string} eventId - Unique string ID for tracking the email
 * @param {string} targetUrl - The destination URL for the user
 * @returns {string} The fully formed, signed tracking URL
 */
const generateSignedUrl = (baseUrl, eventId, targetUrl) => {
    const payload = JSON.stringify({ e: eventId, u: targetUrl });

    // Create a URL-safe Base64 encoded payload
    const encodedPayload = Buffer.from(payload).toString('base64url');

    // Generate HMAC signature
    const signature = crypto
        .createHmac('sha256', HMAC_SECRET)
        .update(encodedPayload)
        .digest('base64url');

    // Combine into final redirect URL structure
    // e.g., https://example.com/track/c/eyJ.../hash...
    return `${baseUrl}/track/c/${encodedPayload}/${signature}`;
};

/**
 * Verifies and decodes a signed tracking URL payload.
 * @param {string} encodedPayload - The Base64URL encoded payload string
 * @param {string} signature - The HMAC signature attached to the URL
 * @returns {Object|null} The decoded JSON object if valid, or null if tampered/invalid
 */
const verifyAndDecodeUrl = (encodedPayload, signature) => {
    // Re-calculate the expected signature based on the given payload
    const expectedSignature = crypto
        .createHmac('sha256', HMAC_SECRET)
        .update(encodedPayload)
        .digest('base64url');

    // Secure, constant-time string comparison to prevent timing attacks
    try {
        const isSignatureValid = crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );

        if (!isSignatureValid) {
            console.warn(`[HMAC Service] Invalid signature attempt. Expected ${expectedSignature}, got ${signature}`);
            return null;
        }

        const decodedString = Buffer.from(encodedPayload, 'base64url').toString('utf8');
        return JSON.parse(decodedString);
    } catch (error) {
        console.error(`[HMAC Service] Error decoding tracking URL: ${error.message}`);
        return null;
    }
};

export {
    generateSignedUrl,
    verifyAndDecodeUrl
};
