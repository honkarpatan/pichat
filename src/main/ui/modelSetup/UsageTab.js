// src/main/ui/modelSetup/UsageTab.js
import { UsageManager } from '../../core/usage/UsageManager.js';
import { ApiKeyManager } from '../../model/ApiKeyManager.js';
import {
  supportsProviderUsage,
  fetchPoolUsage,
  formatUsd,
  formatRemainingLine
} from '../../core/usage/ProviderUsage.js';

const PIE_PALETTE = ['#4b5dd1', '#4caf50', '#f97316', '#e91e63', '#9c27b0', '#00bcd4', '#ffb300', '#795548', '#607d8b'];

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const UsageTab = {
    id: 'usage',

    buildHTML(ctx) {
        const { styles } = ctx;
        return `
        <div class="setting-tab-content" id="tab-usage" style="display:none; padding:0;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; flex-wrap:wrap; gap:6px;">
                <div style="display:flex; background:${styles.secondaryBg}; border:1px solid ${styles.borderColor}; border-radius:20px; padding:3px; gap:2px;">
                    <button class="usage-scope-btn" data-scope="model" style="border:none; background:${styles.accentColor}; color:#fff; font-size:10.5px; font-weight:bold; padding:5px 12px; border-radius:16px; cursor:pointer; transition:0.15s;">This Model</button>
                    <button class="usage-scope-btn" data-scope="all" style="border:none; background:transparent; color:${styles.textColor}; opacity:0.7; font-size:10.5px; font-weight:bold; padding:5px 12px; border-radius:16px; cursor:pointer; transition:0.15s;">All Models</button>
                </div>
                <span id="usage-storage-badge" style="font-size:9.5px; opacity:0.6; color:${styles.textColor};"></span>
            </div>
            <div id="usage-tab-body">
                <div class="secondary-text" style="text-align:center; font-size:11px; padding:24px 10px;">Loading usage data…</div>
            </div>
        </div>`;
    },

    wire(modal, ctx) {
        const { app, modelType, config, styles } = ctx;
        const { accentColor, secondaryBg, borderColor, textColor, primaryBg } = styles;
        const body = modal.querySelector('#usage-tab-body');
        const badge = modal.querySelector('#usage-storage-badge');
        if (!body || !app.usageManager) return;

        let scope = 'model';

        const render = () => {
            const snap = app.usageManager.getSnapshot(modelType, 14);
            const src = scope === 'model' ? snap.model : snap.global;
            const total = (src.tokensIn || 0) + (src.tokensOut || 0);
            const avg = src.requests > 0 ? Math.round(total / src.requests) : 0;

            if (badge) badge.textContent = snap.storageMode === 'file' ? '📁 Synced to chat folder' : '💾 Local only — pick a folder to sync';

            const poolNow = scope === 'model' ? ApiKeyManager.getPool(modelType, config) : [];
            const hasLiveProvider = scope === 'model' && supportsProviderUsage(modelType) && poolNow.length > 0;

            if (!src.requests && !hasLiveProvider && poolNow.length === 0) {
                const who = scope === 'model' ? (app.selectedModel?.name || modelType) : 'any model';
                body.innerHTML = `
                <div style="text-align:center; padding:26px 10px; opacity:0.75;">
                    <div style="font-size:24px; margin-bottom:6px;">📊</div>
                    <div style="font-size:12px; color:${textColor};">No usage yet for ${who}.</div>
                    <div style="font-size:10.5px; opacity:0.7; margin-top:2px;">Send a message to start tracking tokens.</div>
                </div>`;
                return;
            }

            const lastTotal = (src.lastIn || 0) + (src.lastOut || 0);
            const lastInPct = lastTotal > 0 ? Math.round((src.lastIn / lastTotal) * 100) : 50;
            const lastOutPct = 100 - lastInPct;

            const days = snap.daily;
            const maxVal = Math.max(1, ...days.map(d => d.total));
            const chartW = 300, chartH = 74, barGap = 3;
            const barW = (chartW - (days.length - 1) * barGap) / days.length;

            let bars = '';
            days.forEach((d, i) => {
                const x = i * (barW + barGap);
                const inH = maxVal ? (d.tokensIn / maxVal) * chartH : 0;
                const outH = maxVal ? (d.tokensOut / maxVal) * chartH : 0;
                const dayNum = new Date(`${d.date}T00:00:00`).getDate();
                bars += `
                <g class="usage-bar-group" data-tooltip="${d.date} · ${d.tokensIn.toLocaleString()} in / ${d.tokensOut.toLocaleString()} out" style="cursor:pointer;">
                    <rect x="${x}" y="${chartH - inH - outH}" width="${barW}" height="${Math.max(outH, 0)}" rx="1.5" fill="${accentColor}" fill-opacity="0.4"></rect>
                    <rect x="${x}" y="${chartH - inH}" width="${barW}" height="${Math.max(inH, 0)}" rx="1.5" fill="${accentColor}"></rect>
                    <rect x="${x}" y="0" width="${barW}" height="${chartH}" fill="transparent"></rect>
                    <text x="${x + barW / 2}" y="${chartH + 11}" text-anchor="middle" font-size="7" fill="${textColor}" opacity="0.55">${dayNum}</text>
                </g>`;
            });

            // 🟢 Multi API Key System: per-key breakdown only makes sense scoped to one
            // provider, since key pools belong to a single provider (compare "This Model").
            const keyBreakdown = scope === 'model'
                ? app.usageManager.getKeyBreakdown(modelType, ApiKeyManager.getPool(modelType, config))
                : [];
            const keySectionHtml = keyBreakdown.length > 0 ? UsageTab._buildKeyBreakdownHTML(keyBreakdown, styles) : '';

            body.innerHTML = `
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:7px; margin-bottom:10px;">
                ${UsageTab._statCard('Requests', src.requests.toLocaleString(), accentColor, textColor, secondaryBg, borderColor)}
                ${UsageTab._statCard('Total Tokens', UsageManager.formatNumber(total), accentColor, textColor, secondaryBg, borderColor, `${UsageManager.formatNumber(src.tokensIn)} in · ${UsageManager.formatNumber(src.tokensOut)} out`)}
                ${UsageTab._statCard('Avg / Req', UsageManager.formatNumber(avg), accentColor, textColor, secondaryBg, borderColor)}
            </div>

            <div style="background:${secondaryBg}; border:1px solid ${borderColor}; border-radius:10px; padding:10px 12px; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:7px;">
                    <span style="font-size:9.5px; opacity:0.6; text-transform:uppercase; letter-spacing:0.4px; color:${textColor};">Last Response</span>
                    <span style="font-size:9.5px; opacity:0.55; color:${textColor};">${UsageManager.timeAgo(src.lastTimestamp)}${src.lastEstimated ? ' · est.' : ''}</span>
                </div>
                <div style="display:flex; height:8px; border-radius:6px; overflow:hidden; background:${borderColor};">
                    <div style="width:${lastInPct}%; background:${accentColor};"></div>
                    <div style="width:${lastOutPct}%; background:${accentColor}; opacity:0.4;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; margin-top:7px; font-size:11px; color:${textColor};">
                    <span>↑ In: <b>${(src.lastIn || 0).toLocaleString()}</b></span>
                    <span>↓ Out: <b>${(src.lastOut || 0).toLocaleString()}</b></span>
                </div>
            </div>

            <div style="background:${secondaryBg}; border:1px solid ${borderColor}; border-radius:10px; padding:10px 12px 2px; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
                    <span style="font-size:9.5px; opacity:0.6; text-transform:uppercase; letter-spacing:0.4px; color:${textColor};">Last 14 Days</span>
                    <div style="display:flex; gap:10px; font-size:9px; opacity:0.65; color:${textColor};">
                        <span><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${accentColor};margin-right:3px;"></span>In</span>
                        <span><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${accentColor};opacity:0.4;margin-right:3px;"></span>Out</span>
                    </div>
                </div>
                <svg viewBox="0 0 ${chartW} ${chartH + 16}" style="width:100%; height:100px; overflow:visible; display:block;">${bars}</svg>
            </div>

            ${keySectionHtml}

            <div id="usage-provider-live" style="margin-bottom:10px;"></div>

            <div style="text-align:right;">
                <button class="usage-reset-btn" style="background:transparent; color:var(--error-text-color,#f44336); border:none; font-size:10.5px; font-weight:bold; cursor:pointer; padding:4px;">Reset ${scope === 'model' ? 'This Model' : 'All'} Usage</button>
            </div>`;

            // Live provider credits (OpenRouter, …) under the pie
            const liveBox = body.querySelector('#usage-provider-live');
            if (liveBox && scope === 'model' && supportsProviderUsage(modelType)) {
              liveBox.innerHTML = `<div style="font-size:11px; opacity:0.6; padding:8px; text-align:center;">Loading provider usage…</div>`;
              const pool = ApiKeyManager.getPool(modelType, config);
              const strat = ApiKeyManager.getStrategy(modelType);
              const activeId = app._activeApiKeyId
                || (strat && strat !== ApiKeyManager.RANDOM_STRATEGY ? strat : null);
              const bindLiveKeys = (box, rows) => {
                box.querySelectorAll('[data-usage-key-id]').forEach(row => {
                  row.addEventListener('click', async () => {
                    const id = row.getAttribute('data-usage-key-id');
                    if (!id) return;
                    ApiKeyManager.setStrategy(modelType, id);
                    const keyObj = pool.find(k => k.id === id);
                    if (keyObj && config.apiKeyName) {
                      try {
                        const { ConfigManager } = await import('../../utils/ConfigManager.js');
                        ConfigManager.set(config.apiKeyName, keyObj.key);
                        app[config.apiKeyName] = keyObj.key;
                        app._activeApiKeyId = keyObj.id;
                        app._activeApiKeyName = keyObj.name;
                      } catch (_) {}
                    }
                    if (window.toast) window.toast(`API key: ${keyObj?.name || id}`);
                    try {
                      window.dispatchEvent(new CustomEvent('gpt-model-changed', {
                        detail: { modelType, source: 'usageTab' }
                      }));
                    } catch (_) {}
                    render();
                  });
                });
              };
              fetchPoolUsage(modelType, pool).then((rows) => {
                if (!liveBox.isConnected) return;
                liveBox.innerHTML = UsageTab._buildProviderLiveHTML(rows, styles, activeId, modelType);
                bindLiveKeys(liveBox, rows);
              }).catch(() => {
                if (liveBox.isConnected) {
                  liveBox.innerHTML = `<div style="font-size:10.5px; opacity:0.6; padding:6px;">Could not load provider usage — showing local token stats above.</div>`;
                }
              });
            }

            const resetBtn = body.querySelector('.usage-reset-btn');
            if (resetBtn) {
                resetBtn.onclick = () => {
                    const scopeLabel = scope === 'model' ? (app.selectedModel?.name || modelType) : 'ALL models';
                    const doReset = async () => {
                        await app.usageManager.reset(scope === 'model' ? modelType : null);
                        if (window.toast) window.toast('Usage data reset.');
                        render();
                    };
                    const DialogBox = window.acode ? window.acode.require('dialogBox') : null;
                    if (DialogBox) {
                        const confirmBox = DialogBox('Reset Usage Data', `<p style="font-size:13px; color:${textColor};">This will permanently clear token usage for <b>${scopeLabel}</b>. Continue?</p>`, 'Cancel');
                        confirmBox.then(async () => { await doReset(); confirmBox.hide(); });
                    } else if (confirm(`Reset usage data for ${scopeLabel}?`)) {
                        doReset();
                    }
                };
            }

            body.querySelectorAll('.usage-bar-group').forEach(g => {
                const tipText = g.getAttribute('data-tooltip');
                g.addEventListener('mouseenter', (e) => UsageTab._showUsageTooltip(e, tipText, textColor, primaryBg, borderColor));
                g.addEventListener('mousemove', (e) => UsageTab._showUsageTooltip(e, tipText, textColor, primaryBg, borderColor));
                g.addEventListener('mouseleave', UsageTab._hideUsageTooltip);
                g.addEventListener('touchstart', (e) => UsageTab._showUsageTooltip(e, tipText, textColor, primaryBg, borderColor), { passive: true });
            });

            body.querySelectorAll('.pie-slice').forEach(g => {
                const tipText = g.getAttribute('data-tooltip');
                g.addEventListener('mouseenter', (e) => UsageTab._showUsageTooltip(e, tipText, textColor, primaryBg, borderColor));
                g.addEventListener('mousemove', (e) => UsageTab._showUsageTooltip(e, tipText, textColor, primaryBg, borderColor));
                g.addEventListener('mouseleave', UsageTab._hideUsageTooltip);
                g.addEventListener('touchstart', (e) => UsageTab._showUsageTooltip(e, tipText, textColor, primaryBg, borderColor), { passive: true });
            });
        };

        const scopeBtns = modal.querySelectorAll('.usage-scope-btn');
        scopeBtns.forEach(btn => {
            btn.onclick = () => {
                scope = btn.getAttribute('data-scope');
                scopeBtns.forEach(b => {
                    const active = b === btn;
                    b.style.background = active ? accentColor : 'transparent';
                    b.style.color = active ? '#fff' : textColor;
                    b.style.opacity = active ? '1' : '0.7';
                });
                render();
            };
        });

        if (modal._usageListener) window.removeEventListener('gpt-usage-updated', modal._usageListener);
        const listener = (e) => {
            const affected = e.detail?.modelType;
            if (scope === 'all' || affected === modelType || affected === 'all') render();
        };
        modal._usageListener = listener;
        window.addEventListener('gpt-usage-updated', listener);

        if (!app.usageManager.loaded) app.usageManager.load();
        render();
    },

    // ================================================================
    // 🟢 Multi API Key System: per-key breakdown + pie chart
    // ================================================================

    /**
     * Provider-reported credits per API key (OpenRouter GET /api/v1/key).
     * Highlights the currently selected / last-used key; bars for remaining.
     */
    _buildProviderLiveHTML(rows, styles, activeId, modelType) {
        const { accentColor, secondaryBg, borderColor, textColor } = styles;
        if (!rows?.length) {
            return `<div style="background:${secondaryBg};border:1px solid ${borderColor};border-radius:10px;padding:10px;font-size:11px;opacity:0.7;color:${textColor};">No API keys to query for ${modelType}.</div>`;
        }

        const withData = rows.filter(r => r.data);
        // Prefer active key for headline; else first with data
        const focus = rows.find(r => r.id === activeId && r.data)
            || withData[0]
            || rows[0];
        const d = focus?.data;

        let headline = '';
        if (d) {
            const remPct = d.pctRemain != null ? Math.round(d.pctRemain)
              : (d.remaining === 0 ? 0 : null);
            headline = `
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap;">
                ${UsageTab._ringSvg(remPct != null ? remPct : 0, accentColor, 42)}
                <div style="flex:1;min-width:120px;color:${textColor};">
                  <div style="font-size:10px;opacity:0.55;text-transform:uppercase;letter-spacing:0.3px;">Provider · ${modelType}</div>
                  <div style="font-size:13px;font-weight:600;margin-top:2px;">${escapeHtml(focus.name || 'API Key')}</div>
                  <div style="font-size:11px;opacity:0.8;margin-top:3px;">${escapeHtml(formatRemainingLine(d))}</div>
                  <div style="font-size:10px;opacity:0.6;margin-top:2px;">
                    Used ${formatUsd(d.usage) || '$0'} · today ${formatUsd(d.usageDaily) || '$0'} · month ${formatUsd(d.usageMonthly) || '$0'}
                    ${d.limit != null && formatUsd(d.limit) ? ` · limit ${formatUsd(d.limit)}` : ''}
                  </div>
                </div>
              </div>`;
        } else if (focus?.error) {
            headline = `<div style="font-size:11px;color:var(--error-text-color,#f44336);margin-bottom:8px;">${escapeHtml(focus.error)}</div>`;
        }

        const bars = rows.map((r, i) => {
            const color = PIE_PALETTE[i % PIE_PALETTE.length];
            const sel = r.id === activeId;
            const pct = r.data?.pctRemain != null ? Math.round(r.data.pctRemain)
                : (r.data?.remaining === 0 ? 0
                  : (r.data?.limit > 0 && r.data?.remaining != null
                    ? Math.round((r.data.remaining / r.data.limit) * 100) : null));
            const barW = pct != null ? Math.max(pct === 0 ? 0 : 2, pct) : 0;
            const line = r.data ? formatRemainingLine(r.data) : (r.error ? String(r.error).slice(0, 48) : 'no data');
            return `
              <div data-usage-key-id="${escapeHtml(r.id)}" title="Tap to select"
                style="margin-bottom:8px;padding:6px 8px;border-radius:8px;border:1px solid ${sel ? accentColor : borderColor};background:${sel ? accentColor + '18' : 'transparent'};cursor:pointer;">
                <div style="display:flex;justify-content:space-between;font-size:11px;color:${textColor};margin-bottom:4px;">
                  <span style="font-weight:${sel ? '600' : '400'};">${escapeHtml(r.name)}${sel ? ' · selected' : ''}</span>
                  <span style="opacity:0.75;">${escapeHtml(line)}</span>
                </div>
                <div style="height:6px;border-radius:4px;background:${borderColor};overflow:hidden;">
                  <div style="height:100%;width:${barW}%;background:${color};border-radius:4px;"></div>
                </div>
                <div style="font-size:9.5px;opacity:0.55;margin-top:3px;color:${textColor};line-height:1.35;">
                  ${escapeHtml(r.keyPreview || '')}
                  ${r.data ? `
                    <br/>used ${formatUsd(r.data.usage) || '$0'} · day ${formatUsd(r.data.usageDaily) || '$0'} · week ${formatUsd(r.data.usageWeekly) || '$0'} · month ${formatUsd(r.data.usageMonthly) || '$0'}
                    ${r.data.isFreeTier ? ' · free tier' : ''}
                    ${r.data.freeModelDaily ? ` · free models ${r.data.freeModelDaily.used ?? 0}/${r.data.freeModelDaily.limit ?? '?'} today` : ''}
                    ${r.data.expiresAt ? ` · expires ${String(r.data.expiresAt).slice(0, 10)}` : ''}
                  ` : (r.error ? `<br/><span style="color:var(--error-text-color,#f44336);">${escapeHtml(String(r.error).slice(0, 80))}</span>` : '')}
                </div>
              </div>`;
        }).join('');

        return `
          <div style="background:${secondaryBg};border:1px solid ${borderColor};border-radius:10px;padding:10px 12px;">
            <div style="font-size:9.5px;opacity:0.6;text-transform:uppercase;letter-spacing:0.4px;color:${textColor};margin-bottom:8px;">Provider credits (live) · tap key to select</div>
            ${headline}
            ${bars}
          </div>`;
    },

    _ringSvg(pctRemain, color, size = 40) {
        const r = 14, c = 2 * Math.PI * r;
        const p = Math.max(0, Math.min(100, pctRemain));
        const dash = (p / 100) * c;
        return `<svg width="${size}" height="${size}" viewBox="0 0 36 36" style="flex-shrink:0;">
          <circle cx="18" cy="18" r="${r}" fill="none" stroke="currentColor" stroke-opacity="0.15" stroke-width="3.5"/>
          <circle cx="18" cy="18" r="${r}" fill="none" stroke="${color}" stroke-width="3.5"
            stroke-dasharray="${dash} ${c}" stroke-linecap="round"
            transform="rotate(-90 18 18)"/>
          <text x="18" y="20.5" text-anchor="middle" font-size="8" font-weight="600" fill="currentColor">${Math.round(p)}%</text>
        </svg>`;
    },

    _buildKeyBreakdownHTML(breakdown, styles) {
        const { accentColor, secondaryBg, borderColor, textColor } = styles;
        if (!breakdown || !breakdown.length) return '';

        const totalTokens = breakdown.reduce((s, k) => s + (k.total || 0), 0);
        // Pie: if no local tokens yet, equal slices so every key is visible
        const pieData = breakdown.map(k => ({
            ...k,
            pieValue: totalTokens > 0 ? (k.total || 0) : 1
        }));
        const pieTotal = pieData.reduce((s, k) => s + k.pieValue, 0);
        const pie = UsageTab._buildPieSVG(pieData.map(k => ({
            name: k.name,
            total: k.pieValue,
            tokensIn: k.tokensIn,
            tokensOut: k.tokensOut,
            requests: k.requests
        })), pieTotal, accentColor);

        const rows = breakdown.map((k, i) => {
            const color = PIE_PALETTE[i % PIE_PALETTE.length];
            const pct = totalTokens > 0 ? Math.round((k.total / totalTokens) * 100) : 0;
            const barW = totalTokens > 0 ? Math.max(k.total > 0 ? 2 : 0, pct) : 0;
            const sub = k.removed
                ? 'removed from pool'
                : (k.hasLocal || k.requests
                    ? `${UsageManager.formatNumber(k.tokensIn || 0)} in · ${UsageManager.formatNumber(k.tokensOut || 0)} out · ${k.requests || 0} req`
                    : 'no local tokens yet — live credits below');
            return `
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
                <div style="flex:1;min-width:0;">
                  <div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;color:${textColor};">
                    <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(k.name)}</span>
                    <span style="opacity:0.75;flex-shrink:0;">${totalTokens > 0 ? pct + '%' : '—'}</span>
                  </div>
                  <div style="height:5px;border-radius:3px;background:${borderColor};margin-top:3px;overflow:hidden;">
                    <div style="height:100%;width:${barW}%;background:${color};border-radius:3px;"></div>
                  </div>
                  <div style="font-size:9.5px;opacity:0.55;margin-top:2px;color:${textColor};">${escapeHtml(sub)}</div>
                </div>
              </div>`;
        }).join('');

        return `
            <div style="background:${secondaryBg}; border:1px solid ${borderColor}; border-radius:10px; padding:10px 12px; margin-bottom:10px;">
                <div style="font-size:9.5px; opacity:0.6; text-transform:uppercase; letter-spacing:0.4px; color:${textColor}; margin-bottom:8px;">By API Key · ${breakdown.length} key${breakdown.length === 1 ? '' : 's'}${totalTokens > 0 ? '' : ' · equal pie until usage is recorded'}</div>
                <div style="display:flex; gap:14px; align-items:flex-start; flex-wrap:wrap;">
                    ${pie}
                    <div style="flex:1; min-width:160px;">${rows}</div>
                </div>
            </div>`;
    },

    _buildPieSVG(breakdown, total, defaultAccent) {
        const r = 34, cx = 44, cy = 44, strokeW = 16;
        const circumference = 2 * Math.PI * r;
        let offsetAcc = 0;
        let circles = '';

        breakdown.forEach((b, i) => {
            const frac = total > 0 ? b.total / total : 0;
            if (frac <= 0) return;
            const len = frac * circumference;
            const color = b.removed ? '#888' : PIE_PALETTE[i % PIE_PALETTE.length];
            const tip = `${b.name} · ${UsageManager.formatNumber(b.total)} tok · ${(b.requests || 0).toLocaleString()} req`;
            circles += `<circle class="pie-slice" data-tooltip="${tip}" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-dasharray="${len} ${circumference - len}" stroke-dashoffset="${-offsetAcc}" transform="rotate(-90 ${cx} ${cy})" style="cursor:pointer; transition:opacity .15s;" />`;
            offsetAcc += len;
        });

        if (!circles) circles = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${defaultAccent}" stroke-width="${strokeW}" opacity="0.15" />`;

        return `<svg viewBox="0 0 88 88" style="width:88px; height:88px; flex-shrink:0;">${circles}</svg>`;
    },

    // ================================================================
    // Shared small helpers
    // ================================================================

    _statCard(label, value, accentColor, textColor, secondaryBg, borderColor, sub) {
        return `
        <div style="background:${secondaryBg}; border:1px solid ${borderColor}; border-radius:10px; padding:10px 10px;">
            <div style="font-size:9.5px; opacity:0.6; text-transform:uppercase; letter-spacing:0.4px; color:${textColor};">${label}</div>
            <div style="font-size:18px; font-weight:700; color:${accentColor}; margin-top:3px; line-height:1.1;">${value}</div>
            ${sub ? `<div style="font-size:9.5px; opacity:0.55; color:${textColor}; margin-top:2px;">${sub}</div>` : ''}
        </div>`;
    },

    _showUsageTooltip(evt, text, textColor, bgColor, borderColor) {
        let tip = document.getElementById('gpt-usage-tooltip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'gpt-usage-tooltip';
            tip.style.cssText = 'position:fixed; z-index:10000; pointer-events:none; font-size:10.5px; padding:5px 8px; border-radius:6px; white-space:nowrap; box-shadow:0 4px 10px rgba(0,0,0,0.3); transition:opacity 0.1s;';
            document.body.appendChild(tip);
        }
        tip.style.background = bgColor;
        tip.style.color = textColor;
        tip.style.border = `1px solid ${borderColor}`;
        tip.textContent = text;
        tip.style.opacity = '1';

        const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
        const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
        tip.style.left = `${Math.min(clientX + 12, window.innerWidth - (tip.offsetWidth || 100) - 10)}px`;
        tip.style.top = `${Math.max(clientY - 34, 6)}px`;
    },

    _hideUsageTooltip() {
        const tip = document.getElementById('gpt-usage-tooltip');
        if (tip) tip.style.opacity = '0';
    }
};