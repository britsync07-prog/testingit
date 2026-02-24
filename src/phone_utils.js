/**
 * Country-specific phone number prefixes and regex patterns.
 * Used to build site-search queries like:
 *   site:linkedin.com/in "Fitness Trainer" "London" ("07" OR "+44")
 */

export const countryPhoneConfig = {
    "United Kingdom": {
        prefixes: ["07", "+44"],
        // Matches UK numbers: 07xxx xxxxxx or +447xxx xxxxxx (10-13 digits)
        regex: /(?:\+44\s?|0)(?:7\d{9}|\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4})/g,
        clean: (n) => {
            let d = n.replace(/[^\d+]/g, "");
            if (d.startsWith("0")) d = "+44" + d.slice(1);
            return d;
        }
    },
    "United States": {
        prefixes: ["+1", "tel:"],
        regex: /(?:\+1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g,
        clean: (n) => {
            let d = n.replace(/[^\d+]/g, "");
            if (!d.startsWith("+")) d = "+1" + d.slice(-10);
            return d;
        }
    },
    "Canada": {
        prefixes: ["+1", "tel:"],
        regex: /(?:\+1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g,
        clean: (n) => {
            let d = n.replace(/[^\d+]/g, "");
            if (!d.startsWith("+")) d = "+1" + d.slice(-10);
            return d;
        }
    },
    "Australia": {
        prefixes: ["04", "+61"],
        regex: /(?:\+61\s?|0)(?:4\d{8}|\d{1,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4})/g,
        clean: (n) => {
            let d = n.replace(/[^\d+]/g, "");
            if (d.startsWith("0")) d = "+61" + d.slice(1);
            return d;
        }
    },
    "Germany": {
        prefixes: ["015", "016", "017", "+49"],
        regex: /(?:\+49\s?|0)(?:1[567]\d{7,10}|\d{2,4}[\s.-]?\d{3,8})/g,
        clean: (n) => {
            let d = n.replace(/[^\d+]/g, "");
            if (d.startsWith("0")) d = "+49" + d.slice(1);
            return d;
        }
    },
    "France": {
        prefixes: ["06", "07", "+33"],
        regex: /(?:\+33\s?|0)[67]\d{8}/g,
        clean: (n) => {
            let d = n.replace(/[^\d+]/g, "");
            if (d.startsWith("0")) d = "+33" + d.slice(1);
            return d;
        }
    },
    "India": {
        prefixes: ["+91", "9", "8", "7", "6"],
        regex: /(?:\+91[\s.-]?)?[6-9]\d{9}/g,
        clean: (n) => {
            let d = n.replace(/[^\d+]/g, "");
            if (!d.startsWith("+")) d = "+91" + d.slice(-10);
            return d;
        }
    },
    "Pakistan": {
        prefixes: ["03", "+92"],
        regex: /(?:\+92[\s.-]?|0)3\d{9}/g,
        clean: (n) => {
            let d = n.replace(/[^\d+]/g, "");
            if (d.startsWith("0")) d = "+92" + d.slice(1);
            return d;
        }
    },
    "UAE": {
        prefixes: ["05", "+971"],
        regex: /(?:\+971[\s.-]?|0)5\d{8}/g,
        clean: (n) => {
            let d = n.replace(/[^\d+]/g, "");
            if (d.startsWith("0")) d = "+971" + d.slice(1);
            return d;
        }
    },
    "Saudi Arabia": {
        prefixes: ["05", "+966"],
        regex: /(?:\+966[\s.-]?|0)5\d{8}/g,
        clean: (n) => {
            let d = n.replace(/[^\d+]/g, "");
            if (d.startsWith("0")) d = "+966" + d.slice(1);
            return d;
        }
    }
};

/**
 * Build the phone-search query term for a country.
 * Returns a string like: ("07" OR "+44")
 * Falls back to a generic phone keyword search if country not mapped.
 */
export function buildPhoneQueryTerm(country) {
    const cfg = countryPhoneConfig[country];
    if (!cfg) return '(WhatsApp OR phone OR mobile OR call)';
    return '(' + cfg.prefixes.map(p => `"${p}"`).join(' OR ') + ')';
}

/**
 * Extract and clean phone numbers from text using country-specific regex.
 */
export function extractPhones(text, country) {
    const cfg = countryPhoneConfig[country];
    if (!cfg) {
        // Generic fallback
        const raw = text.match(/(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,5}[\s.-]?\d{3,5}/g) || [];
        return raw.map(n => n.replace(/[^\d+]/g, "")).filter(n => n.length >= 10);
    }

    const matches = text.match(cfg.regex) || [];
    const cleaned = matches.map(cfg.clean).filter(n => n.replace(/[^\d]/g, "").length >= 10);
    return [...new Set(cleaned)];
}
