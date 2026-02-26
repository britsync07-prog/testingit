tailwind.config = {
    darkMode: 'class', // Keeping class for potential future toggles, but defaulting to light
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'sans-serif'], // Professional, clean, Apple-esque
                mono: ['Fira Code', 'monospace'],
            },
            colors: {
                brand: {
                    base: '#F8FAFC',      // Soft Slate 50 Background
                    card: '#FFFFFF',      // Pure White Panels
                    hover: '#F1F5F9',     // Slate 100 on hover
                    cta: '#10B981',       // Emerald Green (positive actions)
                    primary: '#6366F1',   // Indigo/Sapphire (main accents)
                    text: '#0F172A',      // Slate 900 Text (high contrast)
                    secondary: '#475569', // Slate 600 secondary text
                    muted: '#94A3B8',     // Slate 400 for borders/hints
                    border: '#E2E8F0',    // Slate 200 light borders
                }
            },
            boxShadow: {
                // Soft, diffused shadows synonymous with premium "fancy" designs
                'glass': '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
                'glow': '0 0 15px rgba(99, 102, 241, 0.3)',
                'card': '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
            },
            backgroundImage: {
                'gradient-mesh': 'radial-gradient(at 0% 0%, hsla(253,16%,7%,1) 0, transparent 50%), radial-gradient(at 50% 0%, hsla(225,39%,30%,1) 0, transparent 50%), radial-gradient(at 100% 0%, hsla(339,49%,30%,1) 0, transparent 50%)'
            }
        }
    }
}
