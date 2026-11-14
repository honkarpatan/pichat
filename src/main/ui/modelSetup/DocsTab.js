// src/main/ui/modelSetup/DocsTab.js

export const DocsTab = {
    id: 'docs',

    buildHTML(ctx) {
        const { config, isFirstTab, modelType } = ctx;
        const isFirst = isFirstTab('docs');
        // Custom models: user docs live on config.info (from def.docsHtml)
        let docsHtml;
        if (config.isCustomModel) {
            docsHtml = config.info || (config.handler?.getDocsHTML ? config.handler.getDocsHTML() : '');
            if (!docsHtml) {
                docsHtml = '<p class="secondary-text" style="font-size:12px;padding:12px;">No docs yet. Edit them in the <b>Manager</b> tab.</p>';
            }
        } else {
            docsHtml = config.handler?.getDocsHTML
                ? config.handler.getDocsHTML()
                : '<p class="secondary-text" style="font-size:12px;">No documentation available.</p>';
        }
        return `
            <div class="setting-tab-content" id="tab-docs" style="display:${isFirst ? 'block' : 'none'}; padding: 0;" data-model-type="${modelType || ''}">
                ${docsHtml}
            </div>`;
    },

    wire(modal, ctx) {},
    save(modal, ctx) {},
    reset(modal, ctx) {}
};