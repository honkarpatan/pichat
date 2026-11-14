// Layout / motion / geometry only — NO brand colors.
// Colors injected as CSS vars from model config at render time.

/**
 * @typedef {Object} StartPageTheme
 * @property {string} id
 * @property {string} label
 * @property {boolean} showInfo          bottom/side tip cards from infoData
 * @property {boolean} showCommandHints  /slash command chips
 * @property {boolean} showGreeting      "How can I help" style line
 * @property {boolean} showModelName
 * @property {object} icon
 * @property {object} page
 * @property {object} chips
 * @property {object} animation
 */

/** @type {Record<string, StartPageTheme>} */
export const START_PAGE_THEMES = {
  chatgpt: {
    id: 'chatgpt',
    label: 'ChatGPT',
    showInfo: true,
    showCommandHints: false,
    showGreeting: false,
    showModelName: false,
    icon: {
      size: 44,
      radius: '50%',
      shadow: '0 4px 14px rgba(0,0,0,.18)',
      marginBottom: 0
    },
    page: {
      justify: 'center',
      align: 'center',
      padding: '0 12px 72px',
      gap: '0'
    },
    chips: {
      position: 'bottom', // absolute bottom strip
      height: 62,
      radius: 10,
      gap: '10px',
      opacity: 0.72,
      direction: 'row',
      scroll: true
    },
    animation: { enter: 'fade-up', chip: 'wave' }
  },

  codex: {
    id: 'codex',
    label: 'Codex',
    showInfo: false,
    showCommandHints: true,
    showGreeting: true,
    showModelName: true,
    icon: {
      size: 52,
      radius: '14px',
      shadow: '0 10px 28px rgba(0,0,0,.22)',
      marginBottom: 14
    },
    page: {
      justify: 'center',
      align: 'center',
      padding: '0 16px 24px',
      gap: '10px'
    },
    chips: {
      position: 'center',
      height: 44,
      radius: 8,
      gap: '8px',
      opacity: 0.9,
      direction: 'row',
      scroll: true
    },
    animation: { enter: 'fade', chip: 'none' }
  },

  gemini: {
    id: 'gemini',
    label: 'Gemini',
    showInfo: true,
    showCommandHints: false,
    showGreeting: true,
    showModelName: false,
    icon: {
      size: 56,
      radius: '18px',
      shadow: '0 8px 32px rgba(0,0,0,.12)',
      marginBottom: 16
    },
    page: {
      justify: 'center',
      align: 'center',
      padding: '0 14px 80px',
      gap: '12px'
    },
    chips: {
      position: 'bottom',
      height: 70,
      radius: 16,
      gap: '12px',
      opacity: 0.78,
      direction: 'row',
      scroll: true
    },
    animation: { enter: 'scale-in', chip: 'wave' }
  },

  claude: {
    id: 'claude',
    label: 'Claude',
    showInfo: true,
    showCommandHints: false,
    showGreeting: true,
    showModelName: true,
    icon: {
      size: 48,
      radius: '12px',
      shadow: 'none',
      marginBottom: 12
    },
    page: {
      justify: 'center',
      align: 'center',
      padding: '0 18px 88px',
      gap: '8px'
    },
    chips: {
      position: 'bottom',
      height: 58,
      radius: 6,
      gap: '8px',
      opacity: 0.65,
      direction: 'row',
      scroll: true
    },
    animation: { enter: 'fade', chip: 'none' }
  },

  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    showInfo: false,
    showCommandHints: true,
    showGreeting: true,
    showModelName: true,
    icon: {
      size: 46,
      radius: '10px',
      shadow: '0 0 0 1px rgba(255,255,255,.08), 0 12px 32px rgba(0,0,0,.35)',
      marginBottom: 12
    },
    page: {
      justify: 'center',
      align: 'center',
      padding: '0 12px 20px',
      gap: '12px'
    },
    chips: {
      position: 'center',
      height: 40,
      radius: 999,
      gap: '8px',
      opacity: 0.88,
      direction: 'row',
      scroll: true
    },
    animation: { enter: 'fade-up', chip: 'wave' }
  },

  grok: {
    id: 'grok',
    label: 'Grok',
    showInfo: false,
    showCommandHints: false,
    showGreeting: true,
    showModelName: true,
    icon: {
      size: 64,
      radius: '20px',
      shadow: '0 16px 40px rgba(0,0,0,.28)',
      marginBottom: 18
    },
    page: {
      justify: 'center',
      align: 'center',
      padding: '0 20px',
      gap: '6px'
    },
    chips: {
      position: 'none',
      height: 0,
      radius: 0,
      gap: '0',
      opacity: 0,
      direction: 'row',
      scroll: false
    },
    animation: { enter: 'scale-in', chip: 'none' }
  },

  minimal: {
    id: 'minimal',
    label: 'Minimal',
    showInfo: false,
    showCommandHints: false,
    showGreeting: false,
    showModelName: false,
    icon: {
      size: 40,
      radius: '50%',
      shadow: 'none',
      marginBottom: 0
    },
    page: {
      justify: 'center',
      align: 'center',
      padding: '0',
      gap: '0'
    },
    chips: {
      position: 'none',
      height: 0,
      radius: 0,
      gap: '0',
      opacity: 0,
      direction: 'row',
      scroll: false
    },
    animation: { enter: 'fade', chip: 'none' }
  },


  professional: {
    id: 'professional',
    label: 'Professional',
    showInfo: true,
    showCommandHints: true,
    showGreeting: true,
    showModelName: true,
    icon: {
      size: 48,
      radius: '12px',
      shadow: '0 2px 8px rgba(0,0,0,.10), 0 12px 28px rgba(0,0,0,.08)',
      marginBottom: 14
    },
    page: {
      justify: 'center',
      align: 'center',
      padding: '0 0 96px',
      gap: '10px'
    },
    chips: {
      position: 'bottom',
      height: 48,
      radius: 10,
      gap: '10px',
      opacity: 0.9,
      direction: 'row',
      scroll: true
    },
    animation: { enter: 'fade-up', chip: 'wave' }
  },

  commands: {
    id: 'commands',
    label: 'Commands',
    showInfo: false,
    showCommandHints: true,
    showGreeting: true,
    showModelName: false,
    icon: {
      size: 42,
      radius: '50%',
      shadow: '0 6px 18px rgba(0,0,0,.16)',
      marginBottom: 10
    },
    page: {
      justify: 'center',
      align: 'center',
      padding: '0 14px 16px',
      gap: '12px'
    },
    chips: {
      position: 'center',
      height: 42,
      radius: 10,
      gap: '8px',
      opacity: 0.85,
      direction: 'row',
      scroll: true
    },
    animation: { enter: 'fade-up', chip: 'wave' }
  }
};

export function getStartPageTheme(themeId) {
  return START_PAGE_THEMES[themeId] || START_PAGE_THEMES.chatgpt;
}
