/**
 * Base64 string for a 1x1 transparent GIF.
 * Minimal payload footprint for tracking pixel.
 */
const TRANSPARENT_GIF_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const PIXEL_BUFFER = Buffer.from(TRANSPARENT_GIF_BASE64, 'base64');

/**
 * Common user agents used by Apple Mail Privacy Protection (AMPP) and
 * corporate/enterprise security scanners that cache/prefetch emails blindly.
 * We ignore these to prevent massively inflated false-positive "Open" rates.
 */
const BOT_USER_AGENTS = [
    'Apple-Mail', // Heuristic match for desktop caching (Apple Mail Privacy Protection)
    'YahooMailProxy',
    'Microsoft-Office-Scanner',
    'Barracuda',
    'Mimecast',
    'bot',
    'crawler',
    'spider'
];

/**
 * Detects if the incoming request is likely from a bot or privacy proxy.
 * @param {string} userAgent - The User-Agent header of the HTTP request
 * @returns {boolean} True if likely a bot/proxy
 */
const isBotAgent = (userAgent) => {
    if (!userAgent) return true; // Aggressive filtering on missing agents

    return BOT_USER_AGENTS.some(bot =>
        userAgent.toLowerCase().includes(bot.toLowerCase())
    );
};

export {
    PIXEL_BUFFER,
    isBotAgent
};
