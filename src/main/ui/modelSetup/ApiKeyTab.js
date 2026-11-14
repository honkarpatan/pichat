// src/main/ui/modelSetup/ApiKeyTab.js
import { ApiKeyManager } from '../../model/ApiKeyManager.js';
import { ConfigManager } from '../../utils/ConfigManager.js';
import { CustomSelect } from '../components/CustomSelect.js'; 

const escapeAttr = (str) => String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const ApiKeyTab = {
    id: 'api_fetch',

    buildHTML(ctx) {
        const { modelType, config, isFirstTab, styles } = ctx;
        const isFirst = isFirstTab('api_fetch');
        const pool = ApiKeyManager.getPool(modelType, config);
        const strategy = ApiKeyManager.getStrategy(modelType) || (pool[0] && pool[0].id) || null;

        // Config-driven labels (Bedrock Access Key ID, Vertex access token, …)
        const keyLabel = config.apiKeyLabel || 'API Keys';
        const keyPlaceholder = config.apiKeyPlaceholder || 'Enter API Key';
        const keyHint = config.apiKeyHint || `Exact 1 blank row is kept ready — fill one in and another appears (up to ${ApiKeyManager.MAX_KEYS || 10}).`;
        const consoleUrl = config.consoleUrl || '';
        const consoleText = config.consoleText || 'Get API Key';
        const getKeyLink = consoleUrl
            ? `<a href="${escapeAttr(consoleUrl)}" target="_blank" rel="noopener noreferrer"
                style="font-size:11px;color:${styles.accentColor || 'var(--button-background-color,#4b5dd1)'};text-decoration:underline;margin-left:auto;white-space:nowrap;">
                ${escapeAttr(consoleText)}
              </a>`
            : '';
        const canFetch =
            config.supportsFetchModels !== false &&
            typeof config.handler?.fetchModels === 'function';

        let rowsHtml = pool.map((k, i) => this._rowHTML(k.id, k.name || `Api Key ${i + 1}`, k.key, keyPlaceholder)).join('');
        const MAX_KEYS = ApiKeyManager.MAX_KEYS || 10;

        if (pool.length < MAX_KEYS) {
            rowsHtml += this._rowHTML('', `Api Key ${pool.length + 1}`, '', keyPlaceholder);
        }

        const strategyOptions = this._getStrategyOptions(pool);
        const selectHtml = CustomSelect.render('api-key-strategy-select', strategyOptions, strategy, styles, pool.length === 0);

        const fetchBlock = canFetch
            ? `
                <div style="text-align:right; margin-top:10px;">
                    <button id="fetch-models-btn" class="generic-btn">Fetch Models</button>
                </div>
                <div class="secondary-text" style="font-size:10px; text-align:right; margin-top:2px;">Uses the first credential above${config.fetchModelsHint ? ` — ${config.fetchModelsHint}` : ''}.</div>
                <div id="fetched-models-container" style="max-height:220px; overflow-y:auto; margin-top:8px; border-top:1px solid ${styles.borderColor}; padding-top:8px;">
                    <div class="secondary-text" style="font-size:10px; text-align:center;">Fetched models will appear here.</div>
                </div>`
            : `
                <div class="secondary-text" style="font-size:10px; margin-top:12px; padding:8px; border:1px dashed ${styles.borderColor}; border-radius:6px;">
                    Model list fetch is not available for this provider. Enter the model id manually in the <b>Manual</b> tab.
                </div>`;

        return `
            <div class="setting-tab-content" id="tab-api_fetch" style="display:${isFirst ? 'block' : 'none'};max-height:60vh;overflow-y:scroll;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap;">
                    <label style="margin:0;font-weight:inherit;">${keyLabel}</label>
                    ${getKeyLink}
                </div>
                <div id="api-key-pool">${rowsHtml}</div>
                <div class="secondary-text" style="font-size:10px; margin-top:2px;">${keyHint}</div>

                <div class="input-group" style="margin-top:14px;">
                    <label style="margin-bottom:6px; display:block;">Which key to use</label>
                    <div id="api-key-strategy-container">
                        ${selectHtml}
                    </div>
                </div>

                ${fetchBlock}

                <div style="display:flex;align-items:center;justify-content:flex-start;gap:8px;margin-top:8px;flex-wrap:wrap;">
                    <input id="fetched-models-search" type="search" placeholder="Search models…"
                      style="display:none;flex:1;min-width:120px;max-width:220px;padding:6px 10px;font-size:11px;border-radius:6px;border:1px solid ${styles.borderColor};background:${styles.secondaryBg};color:${styles.textColor};height:28px;" />
                    <button class="reset-tab-btn" data-reset="api_fetch" style="${styles.resetBtnStyle}">Reset All Keys</button>
                </div>
            </div>`;
    },

    _rowHTML(id, name, key, placeholder = 'Enter API Key') {
        return `
            <div class="api-key-wrapper">
                <div class="api-key-row" data-key-id="${escapeAttr(id)}" style="display:flex; align-items:center; gap:6px;">
                    <input type="text" class="akp-name" placeholder="Name" maxlength="40" value="${escapeAttr(name)}" style="width:34%; flex-shrink:0; padding:8px; font-size:12px; border-radius:4px;" />
                    <input type="text" class="akp-value" placeholder="${escapeAttr(placeholder)}" value="${escapeAttr(key)}" style="flex:1; padding:8px; font-size:12px; border-radius:4px;" />
                    <button type="button" class="akp-remove" title="Remove this key" style="flex-shrink:0; width:28px; height:28px; border-radius:6px; background:transparent; cursor:pointer; font-size:13px; display:flex; align-items:center; justify-content:center; border: 1px solid var(--border-color, #444); color: var(--error-text-color, #f44336);">&times;</button>
                </div>
                <div class="key-conflict-msg" style="color:var(--error-text-color, #f44336); font-size:10px; display:none; margin-top:2px; margin-bottom:8px; padding-left:36%;"></div>
            </div>`;
    },

    _getStrategyOptions(pool) {
        if (pool.length === 0) return [{ value: '', label: 'Add a key first' }];
        let opts = pool.map((k, i) => ({ value: k.id, label: `Use "${k.name || `Key ${i + 1}`}"` }));
        opts.push({ value: ApiKeyManager.RANDOM_STRATEGY, label: '🎲 Random key (rotates + auto-retries)' });
        return opts;
    },

    wire(modal, ctx) {
        const { modelType, config, app, styles } = ctx;
        const container = modal.querySelector('#api-key-pool');
        if (!container) return; 

        CustomSelect.wire('api-key-strategy-select', null, styles);

        const isRowEmpty = (wrapper) => {
            // Check only the value for emptiness to avoid glitches with auto-names
            const val = wrapper.querySelector('.akp-value').value.trim();
            return !val;
        };

        // 🟢 PRO FIX: Strict 1 empty row policy with dynamic DOM manipulation
        const ensurePadding = () => {
            let wrappers = Array.from(container.querySelectorAll('.api-key-wrapper'));
            const maxKeys = ApiKeyManager.MAX_KEYS || 10;

            // Remove intermediate empty rows (unless focused)
            wrappers.forEach((wrapper, idx) => {
                if (idx < wrappers.length - 1 && isRowEmpty(wrapper) && !wrapper.contains(document.activeElement)) {
                    wrapper.remove();
                }
            });

            // Re-evaluate DOM list
            wrappers = Array.from(container.querySelectorAll('.api-key-wrapper'));
            let trailingEmpty = 0;
            for (let i = wrappers.length - 1; i >= 0; i--) {
                if (isRowEmpty(wrappers[i])) trailingEmpty++; else break;
            }

            // Add exactly 1 empty row if missing
            while (trailingEmpty < 1 && wrappers.length < maxKeys) {
                const nextIndex = container.querySelectorAll('.api-key-wrapper').length + 1;
                container.insertAdjacentHTML('beforeend', this._rowHTML('', `Api Key ${nextIndex}`, ''));
                wrappers = Array.from(container.querySelectorAll('.api-key-wrapper'));
                trailingEmpty++;
                bindRow(wrappers[wrappers.length - 1]);
            }
            
            // Remove excessive empty rows from the end
            while (trailingEmpty > 1 && wrappers.length > 1) {
                const last = wrappers[wrappers.length - 1];
                if (document.activeElement && last.contains(document.activeElement)) break; // Don't delete if typing
                last.remove();
                wrappers = Array.from(container.querySelectorAll('.api-key-wrapper'));
                trailingEmpty--;
            }

            // Update auto-names for empty keys
            wrappers.forEach((w, i) => {
                if (isRowEmpty(w)) {
                    const nameInp = w.querySelector('.akp-name');
                    if (nameInp.value.startsWith('Api Key ')) {
                        nameInp.value = `Api Key ${i + 1}`;
                    }
                }
            });
        };

        const checkConflicts = () => {
            const wrappers = Array.from(container.querySelectorAll('.api-key-wrapper'));
            const seenNames = new Map();
            const seenKeys = new Map();

            wrappers.forEach((wrapper, index) => {
                const nameEl = wrapper.querySelector('.akp-name');
                const valEl = wrapper.querySelector('.akp-value');
                const msgEl = wrapper.querySelector('.key-conflict-msg');
                
                const name = nameEl.value.trim().toLowerCase();
                const val = valEl.value.trim();

                nameEl.classList.remove('name-conflict');
                valEl.style.borderColor = '';
                if (msgEl) msgEl.style.display = 'none';

                if (name) {
                    if (seenNames.has(name)) {
                        nameEl.classList.add('name-conflict');
                        seenNames.get(name).classList.add('name-conflict');
                    } else {
                        seenNames.set(name, nameEl);
                    }
                }

                if (val) {
                    if (seenKeys.has(val)) {
                        valEl.style.borderColor = 'var(--error-text-color, #f44336)';
                        const previousInput = seenKeys.get(val);
                        previousInput.style.borderColor = 'var(--error-text-color, #f44336)';
                        
                        const firstIdx = wrappers.findIndex(w => w.querySelector('.akp-value') === previousInput);
                        if (msgEl) {
                            msgEl.textContent = `Already used this api key in No. ${firstIdx + 1}`;
                            msgEl.style.display = 'block';
                        }
                    } else {
                        seenKeys.set(val, valEl);
                    }
                }
            });
        };

        const bindRow = (wrapper) => {
            const nameInp = wrapper.querySelector('.akp-name');
            const valInp = wrapper.querySelector('.akp-value');

            [nameInp, valInp].forEach(inp => {
                inp.addEventListener('input', () => { 
                    ensurePadding(); 
                    checkConflicts(); 
                    this._refreshStrategySelect(modal, ctx); 
                });
                // Clean up any un-focused empty rows smoothly when leaving
                inp.addEventListener('blur', () => setTimeout(ensurePadding, 100));
            });

            wrapper.querySelector('.akp-remove').onclick = () => {
                const row = wrapper.querySelector('.api-key-row');
                const keyId = row.getAttribute('data-key-id');
                const currentWrappers = Array.from(container.querySelectorAll('.api-key-wrapper'));
                
                // Don't remove if it's the only empty row left
                if (currentWrappers.length === 1 && isRowEmpty(wrapper)) return;

                const doRemove = () => {
                    wrapper.remove();
                    ensurePadding();
                    checkConflicts();
                    this._refreshStrategySelect(modal, ctx);
                };

                if (keyId && keyId !== 'null' && !keyId.startsWith('temp_')) {
                    ctx.confirmThenRun("Remove this API key from view? It will be permanently deleted when you click 'Save & Apply'.", doRemove);
                } else {
                    doRemove();
                }
            };
        };

        container.querySelectorAll('.api-key-wrapper').forEach(bindRow);
        ensurePadding();

        const fetchBtn = modal.querySelector('#fetch-models-btn');
        const canFetch =
            config.supportsFetchModels !== false &&
            typeof config.handler?.fetchModels === 'function';
        if (fetchBtn && canFetch) {
            fetchBtn.onclick = async () => {
                const firstFilled = Array.from(container.querySelectorAll('.api-key-wrapper')).find(w => w.querySelector('.akp-value').value.trim());
                const keyInput = firstFilled ? firstFilled.querySelector('.akp-value').value.trim() : '';
                if (!keyInput) return window.toast(config.apiKeyLabel ? `Enter ${config.apiKeyLabel} first!` : 'Enter at least one API Key first!');

                const resultsContainer = modal.querySelector('#fetched-models-container');
                resultsContainer.innerHTML = '<div class="secondary-text" style="text-align:center;font-size:11px;">Fetching from provider...</div>';

                try {
                    // Pass app + config so Bedrock/Vertex can read region/project from Advanced options
                    const models = await config.handler.fetchModels(keyInput, { app, config, modelType, ctx });
                    if (!models || models.length === 0) throw new Error("No models returned");

                    // Recommended filter tabs (All / Agent allowlist / Coding / Chat / Image)
                    const {
                      availableRecTabs,
                      filterModelsByTab,
                      filterModelsBySearch,
                      formatTokenLimits,
                      isRecommendedAgent
                    } = await import('../../model/RecommendedModels.js');

                    let activeTab = 'all';
                    const searchInput = modal.querySelector('#fetched-models-search');
                    if (searchInput) {
                      searchInput.style.display = 'block';
                      searchInput.value = '';
                    }

                    const paintList = (tabId) => {
                      if (tabId) activeTab = tabId;
                      const q = searchInput?.value || '';
                      let filtered = filterModelsByTab(models, modelType, activeTab);
                      filtered = filterModelsBySearch(filtered, q);
                      const listEl = resultsContainer.querySelector('#fetched-models-list');
                      if (!listEl) return;
                      if (!filtered.length) {
                        listEl.innerHTML = `<div class="secondary-text" style="text-align:center;font-size:11px;padding:12px;">No models match.</div>`;
                        return;
                      }
                      listEl.innerHTML = filtered.map(m => {
                        const id = typeof m === 'object' ? m.id : m;
                        const name = typeof m === 'object' ? (m.name || m.id) : m;
                        const desc = typeof m === 'object' && m.description ? m.description : '';
                        const limits = formatTokenLimits(typeof m === 'object' ? m : {});
                        const rec = isRecommendedAgent(id);
                        const badge = rec
                          ? `<span style="flex-shrink:0;font-size:9px;font-weight:600;letter-spacing:0.3px;color:#fff;background:#22c55e;padding:1px 6px;border-radius:8px;line-height:1.4;">recommended</span>`
                          : '';
                        const idLine = `<div style="font-size:10px;opacity:0.65;margin-top:2px;font-family:ui-monospace,monospace;word-break:break-all;">${String(id).replace(/</g, '&lt;')}</div>`;
                        const metaLine = [limits, desc ? desc.slice(0, 100) : ''].filter(Boolean).join(' — ');
                        const detailsHtml = metaLine
                          ? `<div class="secondary-text" style="font-size:9.5px; margin-top:2px;opacity:0.7;">${metaLine.replace(/</g, '&lt;')}</div>`
                          : '';
                        return `
                        <div class="fetched-model-item" data-id="${String(id).replace(/"/g, '&quot;')}" data-name="${String(name).replace(/"/g, '&quot;')}" style="padding:8px; border-bottom:1px solid ${ctx.styles.borderColor}; cursor:pointer; transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                              <div style="font-size:12px; font-weight:bold; color: ${ctx.styles.accentColor}; min-width:0;overflow:hidden;text-overflow:ellipsis;">${String(name).replace(/</g, '&lt;')}</div>
                              ${badge}
                            </div>
                            ${idLine}
                            ${detailsHtml}
                        </div>`;
                      }).join('');
                      wireFetchedItems(listEl);
                    };

                    if (searchInput) {
                      searchInput.oninput = () => paintList(activeTab);
                    }

                    const wireFetchedItems = (root) => {
                    root.querySelectorAll('.fetched-model-item').forEach(item => {
                        item.onclick = (e) => {
                            resultsContainer.querySelectorAll('.model-assign-actions').forEach(el => el.remove());
                            const modelId = item.getAttribute('data-id');
                            const inputs = ctx.uiConf.inputs;

                            const actionsDiv = document.createElement('div');
                            actionsDiv.className = 'model-assign-actions';
                            actionsDiv.style.cssText = "display:flex; gap:6px; margin-top:10px; flex-wrap:wrap; animation: gpt-slide-down 0.2s ease;";

                            // Copy model id
                            const copyBtn = document.createElement('button');
                            copyBtn.textContent = 'Copy model id';
                            copyBtn.style.cssText = `background: transparent; color: ${ctx.styles.textColor}; border: 1px solid ${ctx.styles.borderColor}; border-radius: 4px; padding: 6px 10px; font-size: 10.5px; font-weight: bold; cursor: pointer;`;
                            copyBtn.onclick = async (evt) => {
                              evt.stopPropagation();
                              try {
                                if (navigator.clipboard?.writeText) {
                                  await navigator.clipboard.writeText(modelId);
                                } else {
                                  const ta = document.createElement('textarea');
                                  ta.value = modelId;
                                  document.body.appendChild(ta);
                                  ta.select();
                                  document.execCommand('copy');
                                  ta.remove();
                                }
                                copyBtn.textContent = 'Copied!';
                                if (window.toast) window.toast(`Copied: ${modelId}`);
                                setTimeout(() => { copyBtn.textContent = 'Copy model id'; }, 1200);
                              } catch (_) {
                                if (window.toast) window.toast('Copy failed');
                              }
                            };
                            actionsDiv.appendChild(copyBtn);

                            inputs.forEach(inp => {
                                const btn = document.createElement('button');
                                btn.textContent = `Add to ${inp.label}`;
                                btn.style.cssText = `background: ${ctx.styles.accentColor}; color: #fff; border: none; border-radius: 4px; padding: 6px 10px; font-size: 10.5px; font-weight: bold; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.2);`;
                                
                                btn.onclick = (evt) => {
                                    evt.stopPropagation();
                                    actionsDiv.innerHTML = `<span style="font-size:10.5px; color:${ctx.styles.textColor}; opacity:0.8; width:100%; margin-bottom:4px; display:block;">How to add to <b>${inp.label}</b>?</span>`;
                                    
                                    const btnActive = document.createElement('button');
                                    btnActive.innerHTML = `✅ Selected Model`;
                                    btnActive.style.cssText = `background: #4CAF50; color: #fff; border: none; border-radius: 4px; padding: 6px 10px; font-size: 10.5px; font-weight: bold; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.2); margin-right: 6px;`;
                                    
                                    const btnNew = document.createElement('button');
                                    btnNew.innerHTML = `➕ As New Model`;
                                    btnNew.style.cssText = `background: ${ctx.styles.secondaryBg}; border: 1px solid ${ctx.styles.borderColor}; color: ${ctx.styles.textColor}; border-radius: 4px; padding: 6px 10px; font-size: 10.5px; font-weight: bold; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.2);`;

                                    const processAdd = (makeActive) => {
                                        const storageKey = inp.storageKey;
                                        
                                        let list = [];
                                        try { list = JSON.parse(ConfigManager.get(`${storageKey}_list`) || '[]'); } catch(e){}
                                        if (!Array.isArray(list)) list = [];
                                        list = list.filter(v => v.trim() !== '');

                                        if (!list.includes(modelId)) {
                                            if (list.length >= 10) list.shift();
                                            list.push(modelId);
                                        }
                                        ConfigManager.set(`${storageKey}_list`, JSON.stringify(list));
                                        
                                        let activeVal = ConfigManager.get(storageKey) || '';

                                        if (makeActive || !activeVal) {
                                            ConfigManager.set(storageKey, modelId);
                                            if (ctx.app) ctx.app[storageKey] = modelId;
                                        }

                                        const manualGroup = modal.querySelector(`.manual-group-container[data-key="${storageKey}"]`);
                                        if (manualGroup) {
                                            let inputsList = Array.from(manualGroup.querySelectorAll('.manual-input-val'));
                                            let targetInp = inputsList.find(i => i.value.trim() === modelId);
                                            if (!targetInp) targetInp = inputsList.find(i => i.value.trim() === '');
                                            
                                            if (!targetInp) {
                                                const activeRadio = manualGroup.querySelector('.manual-radio:checked');
                                                if (activeRadio) targetInp = activeRadio.parentElement.querySelector('.manual-input-val');
                                                else targetInp = inputsList[0];
                                            }

                                            if (targetInp) {
                                                targetInp.value = modelId;
                                                targetInp.dispatchEvent(new Event('input')); 
                                                
                                                if (makeActive) {
                                                    setTimeout(() => {
                                                        const refreshedInputs = Array.from(manualGroup.querySelectorAll('.manual-input-val'));
                                                        const newTargetInp = refreshedInputs.find(i => i.value.trim() === modelId);
                                                        if (newTargetInp) {
                                                            const row = newTargetInp.closest('.manual-model-row');
                                                            if (row) {
                                                                const radio = row.querySelector('.manual-radio');
                                                                if (radio) {
                                                                    radio.checked = true;
                                                                    radio.dispatchEvent(new Event('change'));
                                                                }
                                                            }
                                                        }
                                                    }, 50);
                                                }
                                            }
                                        }

                                        window.toast(makeActive ? `Selected ${modelId} as Active Model` : `Added ${modelId} as New Model`);
                                        actionsDiv.remove();
                                    };

                                    btnActive.onclick = (e) => { e.stopPropagation(); processAdd(true); };
                                    btnNew.onclick = (e) => { e.stopPropagation(); processAdd(false); };

                                    actionsDiv.appendChild(btnActive);
                                    actionsDiv.appendChild(btnNew);
                                };
                                actionsDiv.appendChild(btn);
                            });

                            item.appendChild(actionsDiv);
                        };
                    });
                    }; // end wireFetchedItems

                    const tabs = availableRecTabs(models, modelType);
                    // Prefer Agent tab when it has models (agent workflow); else All
                    const defaultTab = tabs.some(t => t.id === 'agent') ? 'agent' : 'all';
                    const tabsHtml = tabs.map(t => {
                      const active = t.id === defaultTab;
                      const count = t.id === 'all' ? models.length : (t.count || '');
                      return `<button type="button" class="fetched-model-tab" data-tab="${t.id}"
                        style="border:none;background:${active ? ctx.styles.accentColor : 'transparent'};color:${active ? '#fff' : ctx.styles.textColor};opacity:${active ? 1 : 0.75};font-size:10.5px;font-weight:bold;padding:5px 10px;border-radius:14px;cursor:pointer;">
                        ${t.label}${count !== '' ? ` (${count})` : ''}
                      </button>`;
                    }).join('');

                    resultsContainer.innerHTML = `
                      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;padding:3px;background:${ctx.styles.secondaryBg};border:1px solid ${ctx.styles.borderColor};border-radius:18px;">
                        ${tabsHtml}
                      </div>
                      <div class="secondary-text" style="font-size:9.5px;opacity:0.65;margin-bottom:6px;">
                        Agent = curated tool-calling allowlist only (avoids weak models) · limits show when provider reports them
                      </div>
                      <div id="fetched-models-list"></div>`;

                    resultsContainer.querySelectorAll('.fetched-model-tab').forEach(btn => {
                      btn.onclick = () => {
                        resultsContainer.querySelectorAll('.fetched-model-tab').forEach(b => {
                          const on = b === btn;
                          b.style.background = on ? ctx.styles.accentColor : 'transparent';
                          b.style.color = on ? '#fff' : ctx.styles.textColor;
                          b.style.opacity = on ? '1' : '0.75';
                        });
                        paintList(btn.getAttribute('data-tab'));
                      };
                    });
                    paintList(defaultTab);

                } catch (e) {
                    resultsContainer.innerHTML = `<div style="color:var(--error-text-color, #f44); font-size:10.5px; padding:8px;">Fetch Failed. Check API Key or Network.</div>`;
                }
            };
        }
    },

    _refreshStrategySelect(modal, ctx) {
        const { styles } = ctx;
        const container = modal.querySelector('#api-key-strategy-container');
        if (!container) return;
        
        const wrappers = Array.from(modal.querySelectorAll('.api-key-wrapper'));
        const domPool = [];
        
        wrappers.forEach((wrapper, i) => {
            const row = wrapper.querySelector('.api-key-row');
            const key = row.querySelector('.akp-value').value.trim();
            if (key) {
                let id = row.getAttribute('data-key-id');
                if (!id || id === 'null') {
                    id = `temp_${i}`; 
                    row.setAttribute('data-key-id', id);
                }
                const name = row.querySelector('.akp-name').value.trim();
                domPool.push({ id, name, key });
            }
        });

        let currentStrategy = CustomSelect.getValue('api-key-strategy-select');
        
        if (currentStrategy !== ApiKeyManager.RANDOM_STRATEGY && !domPool.find(k => k.id === currentStrategy)) {
            currentStrategy = domPool[0] ? domPool[0].id : null;
        }

        const strategyOptions = this._getStrategyOptions(domPool);
        
        container.innerHTML = CustomSelect.render('api-key-strategy-select', strategyOptions, currentStrategy, styles, domPool.length === 0);
        CustomSelect.wire('api-key-strategy-select', null, styles);
    },

    save(modal, ctx) {
        const { modelType, config, app } = ctx;
        const container = modal.querySelector('#api-key-pool');
        if (!container) return true; 

        const wrappers = Array.from(container.querySelectorAll('.api-key-wrapper'));
        const nonEmpty = wrappers.filter(wrapper => wrapper.querySelector('.akp-value').value.trim());

        // Check for any remaining errors
        if (container.querySelector('.name-conflict') || container.querySelector('.akp-value[style*="border-color"]')) {
            window.toast("Please fix the conflicting names or duplicate keys before saving.");
            return false;
        }

        const newPool = [];
        for (const wrapper of nonEmpty) {
            const row = wrapper.querySelector('.api-key-row');
            let keyId = row.getAttribute('data-key-id');
            if (!keyId || keyId === 'null' || keyId.startsWith('temp_')) {
                keyId = 'key_' + Date.now() + Math.random().toString(36).slice(2, 7);
            }
            const name = row.querySelector('.akp-name').value.trim();
            const value = row.querySelector('.akp-value').value.trim();
            newPool.push({ id: keyId, name, key: value });
        }

        ApiKeyManager.savePool(modelType, config, newPool, app);

        const strategyValue = CustomSelect.getValue('api-key-strategy-select');
        if (strategyValue) {
            ApiKeyManager.setStrategy(modelType, strategyValue);
        } else {
            ApiKeyManager.setStrategy(modelType, null);
        }

        return true;
    },

    reset(modal, ctx) {
        const container = modal.querySelector('#api-key-pool');
        if (container) {
            container.innerHTML = '';
            // Just add exactly 1 empty row on reset
            container.insertAdjacentHTML('beforeend', this._rowHTML('', 'Api Key 1', ''));
            this.wire(modal, ctx);
        }
        
        this._refreshStrategySelect(modal, ctx);
        window.toast("Keys cleared from view. Click 'Save & Apply' to confirm.");
    }
};