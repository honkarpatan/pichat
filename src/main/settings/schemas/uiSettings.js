// src/main/settings/schemas/uiSettings.js

function applyWaveEffects(enabled) {
    try {
        const on = enabled !== false && enabled !== 'false';
        document.documentElement.classList.toggle('gpt-wave-off', !on);
        document.body?.classList?.toggle('gpt-wave-off', !on);
        let style = document.getElementById('gpt-wave-effects-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'gpt-wave-effects-style';
            document.head.appendChild(style);
        }
        style.textContent = on ? '' : `
            .gpt-wave-off .gpt-fastwave-touch,
            .gpt-wave-off .gpt-slowwave-touch { display: none !important; animation: none !important; }
            html.gpt-wave-off .gpt-fastwave-touch,
            html.gpt-wave-off .gpt-slowwave-touch { display: none !important; }
        `;
    } catch (_) {}
}

export const uiSettingsSchema = [
    { type: 'header', label: 'Layout & Interface' },
    {
        type: 'info',
        label: 'Adjust the core layout and dimensions of the Aicode Cosmo interface.'
    },
    {
        type: 'range',
        key: 'chatContainerWidth',
        label: 'Sidebar Width',
        description: 'Set the absolute width of the chat container.',
        min: 200,
        max: 500,
        step: 5,
        default: 360,
        unit: 'px',
        onChange: (val) => {
            let style = document.getElementById('gpt-dynamic-ui-styles');
            if (!style) {
                style = document.createElement('style');
                style.id = 'gpt-dynamic-ui-styles';
                document.head.appendChild(style);
            }
            style.innerHTML = `
                .chat-container { 
                    min-width: ${val}px !important; 
                    max-width: ${val}px !important; 
                    width: ${val}px !important; 
                }
            `;
        }
    },

    { type: 'header', label: 'Touch feedback' },
    {
        type: 'toggle',
        key: 'uiWaveEffects',
        label: 'Wave effects',
        description: 'Enable gpt-slow-wave / gpt-fast-wave ripple on settings rows, model list, chat history, and messages. Off = no ripple on touch.',
        default: true,
        onChange: (val) => applyWaveEffects(val)
    }
];

/** Call once on plugin boot to apply saved wave preference */
export function applyUiWaveEffectsFromStore(store) {
    try {
        const v = store?.getBool?.('uiWaveEffects', true);
        applyWaveEffects(v !== false);
    } catch (_) {
        applyWaveEffects(true);
    }
}
