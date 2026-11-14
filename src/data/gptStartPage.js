// Legacy entry — prefer main/ui/startPage (themes + provider map).
export {
  buildStartPageHTML,
  mountStartPage,
  updateStartPageIcon,
  fillInfoChips,
  START_PAGE_THEMES,
  PROVIDER_START_PAGE_THEME,
  resolveStartPageThemeId
} from '../main/ui/startPage/index.js';

/** @deprecated Static snapshot; use buildStartPageHTML({ model }) instead. */
export const gptStartPage = `<div id="gpt-start-page" class="gpt-start-page gpt-start--chatgpt" data-start-theme="chatgpt" style="display:flex;justify-content:center;align-items:center;height:100%;min-height:60vh;flex-direction:column;position:relative;padding:0 12px 72px;box-sizing:border-box;">
  <div id="gpt-start-page-icon" class="gpt-start-icon" style="background-color:var(--sp-icon-bg,#111);width:44px;height:44px;border-radius:50%;align-items:center;justify-content:center;display:flex;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,.18);"></div>
  <div class="gpt-info gpt-start-chips" style="width:95%;position:absolute;bottom:5px;text-align:center;line-height:1.5;padding:5px;display:flex;gap:10px;overflow-x:auto;"></div>
</div>`;
