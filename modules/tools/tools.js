/**
 * 工具面板模块
 * 负责工具导航、全局美化 CSS 条目管理与注入。
 */
import { getSettings, saveAllSettings } from '../../index.js';
import { isFullscreen as _gggIsFullscreen, exitFullscreen as _gggExitFullscreen } from '../phone/shell/browser-fullscreen.js';

const STYLE_ID = 'ggg-global-beautify-style';
const ITEM_STYLE_PREFIX = 'ggg-global-beautify-style-';
const PERSONA_PREVIEW_ID = 'ggg-persona-avatar-preview';
const CHARACTER_AVATAR_TARGET_SELECTOR = '#avatar_load_preview, #avatar_div_div';
const AVATAR_DRAG_TARGET_SELECTOR = `${CHARACTER_AVATAR_TARGET_SELECTOR}, #${PERSONA_PREVIEW_ID}`;
const PERSONA_EXTRA_DRAWER_CLASS = 'ggg-persona-management-extra-drawer';
const PERSONA_EXTRA_CONTENT_CLASS = 'ggg-persona-management-extra-content';
const LONGSHOT_CHAT_ONLY_KEY = 'ggg_longshot_chat_only';
const LONGSHOT_KEEP_BARS_KEY = 'ggg_longshot_keep_bars';
const LONGSHOT_REVEAL_CLICKS = 7;
const LONGSHOT_REVEAL_GAP_MS = 500;
const REMOVED_GLOBAL_BEAUTIFY_IDS = new Set(['builtin_loading_screen_replace']);
const REMOVED_GLOBAL_BEAUTIFY_SCRIPTS = new Set(['loadingScreenReplace']);

const BUILTIN_CONFIGS = {
    builtin_favorite_avatar_scroll: {
        defaults: { maxHeight: 50, direction: 'vertical' },
        fields: [
            { key: 'maxHeight', label: '最大高度', type: 'number', min: 1, step: 1, suffix: 'px' },
            {
                key: 'direction',
                label: '滚动方向',
                type: 'select',
                options: [
                    { value: 'vertical', label: '纵向滚动条' },
                    { value: 'horizontal', label: '横向滚动条' },
                ],
            },
        ],
    },
    builtin_single_star_emphasis: {
        defaults: { bold: true, fontSize: 1 },
        fields: [
            { key: 'bold', label: '加粗', type: 'checkbox' },
            { key: 'fontSize', label: '字号', type: 'number', min: 0.1, step: 0.05, suffix: 'em' },
        ],
    },
    builtin_double_star_strong: {
        defaults: { fontSize: 1.1 },
        fields: [
            { key: 'fontSize', label: '字号', type: 'number', min: 0.1, step: 0.05, suffix: 'em' },
        ],
    },
    builtin_triple_star_strong_em: {
        defaults: { fontWeight: 700, fontSize: 1.2 },
        fields: [
            { key: 'fontWeight', label: '字体粗度', type: 'number', min: 100, max: 900, step: 100 },
            { key: 'fontSize', label: '字号', type: 'number', min: 0.1, step: 0.05, suffix: 'em' },
        ],
    },
    builtin_character_avatar_large: {
        defaults: { width: 330, height: 220, positions: {} },
        fields: [
            { key: 'width', label: '最大宽度', type: 'number', min: 40, step: 1, suffix: 'px' },
            { key: 'height', label: '高度', type: 'number', min: 40, step: 1, suffix: 'px' },
        ],
    },
    builtin_persona_avatar_preview: {
        defaults: { width: 330, height: 220, positions: {} },
        fields: [
            { key: 'width', label: '最大宽度', type: 'number', min: 40, step: 1, suffix: 'px' },
            { key: 'height', label: '高度', type: 'number', min: 40, step: 1, suffix: 'px' },
        ],
    },
};

const BUILTIN_ITEMS = [
    {
        id: 'builtin_top_bar_shadow_none',
        label: '移除导航栏阴影',
        enabled: false,
        css: `#top-bar {
  box-shadow: none !important;
  -webkit-box-shadow: none !important;
}`,
    },
    {
        id: 'builtin_favorite_avatar_scroll',
        label: '收藏角色添加滚动条',
        enabled: false,
        config: { ...BUILTIN_CONFIGS.builtin_favorite_avatar_scroll.defaults },
        css: '',
    },
    {
        id: 'builtin_qr_bar_hide',
        label: 'qr隐藏',
        enabled: false,
        css: `#qr--bar {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s ease;
}
#send_form:focus-within #qr--bar {
  max-height: 40px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
#qr--bar .qr--buttons {
  height: 40px;
  align-items: center;
  display: flex;
}`,
    },
    {
        id: 'builtin_single_star_emphasis',
        label: '单星号文本立正加粗',
        enabled: false,
        config: { ...BUILTIN_CONFIGS.builtin_single_star_emphasis.defaults },
        css: '',
    },
    {
        id: 'builtin_double_star_strong',
        label: '双星号文本加粗放大',
        enabled: false,
        config: { ...BUILTIN_CONFIGS.builtin_double_star_strong.defaults },
        css: '',
    },
    {
        id: 'builtin_triple_star_strong_em',
        label: '三星号文本放大加粗',
        enabled: false,
        config: { ...BUILTIN_CONFIGS.builtin_triple_star_strong_em.defaults },
        css: '',
    },
    {
        id: 'builtin_top_bar_transparent',
        label: '顶栏背景透明',
        enabled: false,
        css: `#top-bar {
  background: rgba(0, 0, 0, 0) !important;
}`,
    },
    {
        id: 'builtin_send_form_transparent',
        label: '底栏背景透明',
        enabled: false,
        css: `#send_form {
  background: rgba(0, 0, 0, 0) !important;
}`,
    },
    {
        id: 'builtin_character_avatar_large',
        label: '角色管理头像放大',
        enabled: false,
        config: { ...BUILTIN_CONFIGS.builtin_character_avatar_large.defaults },
        css: '',
    },
    {
        id: 'builtin_persona_avatar_preview',
        label: '用户角色预览大头像',
        enabled: false,
        config: { ...BUILTIN_CONFIGS.builtin_persona_avatar_preview.defaults },
        css: '',
        script: 'personaPreview',
    },
    {
        id: 'builtin_persona_current_description_up',
        label: '当前人设+用户描述上移',
        enabled: false,
        css: `#persona-management-block {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: start;
  gap: 10px 12px;
}

#persona-management-block > .persona_management_right_column {
  display: contents !important;
}

#persona-management-block > .persona_management_left_column {
  grid-column: 2;
  order: 2;
  min-width: 0;
  width: 100%;
}

#persona-management-block > .persona_management_right_column > .persona_management_current_persona {
  grid-column: 1;
  order: 1;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

#persona-management-block > .persona_management_left_column > .persona_management_global_settings {
  margin-top: 10px;
}

#persona-management-block .${PERSONA_EXTRA_DRAWER_CLASS} {
  margin-top: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #888) 4%, transparent);
  overflow: hidden;
}

#persona-management-block .${PERSONA_EXTRA_DRAWER_CLASS} > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 6px 10px;
  cursor: pointer;
  user-select: none;
  list-style: none;
}

#persona-management-block .${PERSONA_EXTRA_DRAWER_CLASS} > summary::-webkit-details-marker {
  display: none;
}

#persona-management-block .${PERSONA_EXTRA_DRAWER_CLASS} > summary::before {
  content: "\\f054";
  font-family: "Font Awesome 6 Free", "FontAwesome";
  font-weight: 900;
  font-size: 0.75em;
  opacity: 0.55;
  transition: transform 0.2s;
}

#persona-management-block .${PERSONA_EXTRA_DRAWER_CLASS}[open] > summary::before {
  transform: rotate(90deg);
}

#persona-management-block .${PERSONA_EXTRA_CONTENT_CLASS} {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 10px 10px;
}

@media (max-width: 900px) {
  #persona-management-block {
    grid-template-columns: minmax(0, 1fr);
  }

  #persona-management-block > .persona_management_right_column > .persona_management_current_persona,
  #persona-management-block > .persona_management_left_column {
    grid-column: 1;
  }
}`,
        script: 'personaCurrentDescriptionUp',
    },
];

let personaObserver = null;
let personaTimer = null;
let personaManagementTimer = null;
let personaManagementRetryCount = 0;
let personaGlobalSettingsPlaceholder = null;
let avatarPreviewRefreshBound = false;
let avatarPreviewStEventsBound = false;
let avatarDragBound = false;
let avatarDragState = null;
let avatarDragActiveState = { character: false, persona: false };
let avatarDragButtonTimer = null;
let avatarDirectDragTargets = new WeakSet();
let longScreenshotState = null;
let longScreenshotRange = { start: null, end: null };

export function initTools() {
    ensureGlobalBeautifyData();
    bindToolNav();
    bindGlobalBeautifyToolbar();
    bindAvatarPreviewRefreshHandlers();
    bindLongScreenshotTool();
    renderGlobalBeautifyList();
    applyGlobalBeautify();
}

function bindAvatarPreviewRefreshHandlers() {
    if (avatarPreviewRefreshBound) return;
    avatarPreviewRefreshBound = true;
    document.addEventListener('click', handleAvatarPreviewPotentialChange, true);
    document.addEventListener('change', handleAvatarPreviewPotentialChange, true);
    bindAvatarPreviewStEvents();
}

function bindAvatarPreviewStEvents() {
    if (avatarPreviewStEventsBound) return;
    try {
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
        const es = ctx?.eventSource;
        if (!es || typeof es.on !== 'function') return;

        const scheduleForceRefresh = () => {
            setTimeout(() => syncPersonaPreview(true), 0);
            setTimeout(() => syncPersonaPreview(true), 350);
            setTimeout(() => syncPersonaPreview(true), 1200);
        };

        ['settings_updated', 'persona_set', 'PERSONA_CHANGED'].forEach(ev => {
            try {
                es.on(ev, scheduleForceRefresh);
                avatarPreviewStEventsBound = true;
            } catch {}
        });
    } catch {}
}

function bindToolNav() {
    const nav = document.querySelector('#ggg-panel-tools .ggg-tools-nav');
    if (!nav) return;
    const longshotNav = document.getElementById('ggg-tool-longshot-nav');
    let revealClicks = 0;
    let lastRevealTs = 0;
    let longshotRevealed = false;

    const revealLongshotNav = () => {
        if (longshotRevealed || !longshotNav) return;
        longshotRevealed = true;
        longshotNav.style.display = '';
        nav.appendChild(longshotNav);
    };

    nav.querySelectorAll('.ggg-tools-nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const now = Date.now();
            if (!longshotRevealed && item.dataset.toolTab !== 'longshot') {
                revealClicks = (now - lastRevealTs <= LONGSHOT_REVEAL_GAP_MS) ? (revealClicks + 1) : 1;
                lastRevealTs = now;
                if (revealClicks >= LONGSHOT_REVEAL_CLICKS) revealLongshotNav();
            }
            nav.querySelectorAll('.ggg-tools-nav-item').forEach(it => it.classList.remove('active'));
            item.classList.add('active');
            document.querySelectorAll('#ggg-panel-tools .ggg-tools-subpanel').forEach(panel => panel.classList.remove('active'));
            document.getElementById(`ggg-tool-panel-${item.dataset.toolTab}`)?.classList.add('active');
        });
    });
}

function bindGlobalBeautifyToolbar() {
    document.getElementById('ggg-global-beautify-add')?.addEventListener('click', () => {
        const item = {
            id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            label: '新建全局美化',
            enabled: true,
            css: '',
        };
        getGlobalBeautifyItems().unshift(item);
        saveAllSettings();
        renderGlobalBeautifyList(item.id);
        applyGlobalBeautify();
    });

    document.getElementById('ggg-global-beautify-export-all')?.addEventListener('click', () => {
        exportItems(getGlobalBeautifyItems().filter(item => !isBuiltinItem(item)), 'ggg-global-beautify-all.json');
    });
}

function bindLongScreenshotTool() {
    document.getElementById('ggg-longshot-start')?.addEventListener('click', startLongScreenshot);
    document.getElementById('ggg-longshot-cancel')?.addEventListener('click', cancelLongScreenshot);
    const floatEntry = document.getElementById('ggg-longshot-enable-float-entry');
    const chatOnly = document.getElementById('ggg-longshot-chat-only');
    const keepBars = document.getElementById('ggg-longshot-keep-bars');
    ensureLongScreenshotSettings();
    if (floatEntry) {
        floatEntry.checked = hasLongScreenshotEntry();
        floatEntry.addEventListener('change', () => {
            const settings = getSettings();
            if (!settings.longScreenshot) settings.longScreenshot = {};
            settings.longScreenshot.enabled = floatEntry.checked;
            saveAllSettings();
            window.dispatchEvent(new CustomEvent('ggg-floating-ball-config-changed'));
        });
    }
    if (chatOnly) {
        chatOnly.checked = getLongScreenshotChatOnly();
        chatOnly.addEventListener('change', () => {
            localStorage.setItem(LONGSHOT_CHAT_ONLY_KEY, chatOnly.checked ? '1' : '0');
            syncLongScreenshotOptionState();
        });
    }
    if (keepBars) {
        keepBars.checked = getLongScreenshotKeepBars();
        keepBars.addEventListener('change', () => {
            setLongScreenshotKeepBars(keepBars.checked);
        });
    }
    syncLongScreenshotOptionState();
    syncLongScreenshotAvailability();
}

function canUseLongScreenshotCapture() {
    return !!navigator.mediaDevices?.getDisplayMedia;
}

function getLongScreenshotUnavailableText() {
    return '当前浏览器不支持真实长截图。移动端浏览器通常没有屏幕/标签页采集能力，请在 PC 浏览器使用。';
}

function syncLongScreenshotAvailability() {
    const available = canUseLongScreenshotCapture();
    const start = document.getElementById('ggg-longshot-start');
    const status = document.getElementById('ggg-longshot-status');
    const panel = document.getElementById('ggg-longshot-range-panel');
    if (start) {
        start.disabled = !available;
        start.title = available ? '' : getLongScreenshotUnavailableText();
    }
    if (status && !available) {
        status.textContent = getLongScreenshotUnavailableText();
        status.classList.add('error');
        status.classList.remove('warn');
    }
    if (panel) {
        panel.classList.toggle('unavailable', !available);
        panel.querySelectorAll('[data-action="start"], [data-action="end"], [data-action="capture"], [data-action="clear"]')
            .forEach(btn => {
                btn.disabled = !available;
                btn.title = available ? '' : getLongScreenshotUnavailableText();
            });
    }
}

function ensureLongScreenshotRangePanel() {
    if (document.getElementById('ggg-longshot-range-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'ggg-longshot-range-panel';
    panel.innerHTML = `
        <div class="ggg-longshot-range-head">
            <div>
                <div class="ggg-longshot-range-title">长截图</div>
                <div class="ggg-longshot-range-subtitle">范围、裁切和保留栏位都在这里控制</div>
            </div>
            <button class="ggg-longshot-range-close" type="button" data-action="close" aria-label="关闭长截图面板">
                <i class="ggg-fa fa-solid fa-xmark"></i>
            </button>
        </div>
        <div class="ggg-longshot-range-options">
            <label class="ggg-longshot-chip">
                <input type="checkbox" data-role="chat-only">
                <span>只留聊天区域</span>
            </label>
            <label class="ggg-longshot-chip">
                <input type="checkbox" data-role="keep-bars">
                <span>保留顶栏/底栏</span>
            </label>
        </div>
        <div class="ggg-longshot-range-status">先滚到开始位置，点“设起点”。</div>
        <div class="ggg-longshot-range-actions">
            <button class="menu_button" type="button" data-action="start">设起点</button>
            <button class="menu_button" type="button" data-action="end">设终点</button>
            <button class="menu_button" type="button" data-action="capture">截取范围</button>
            <button class="menu_button" type="button" data-action="clear">清除</button>
        </div>
    `;
    panel.querySelector('[data-role="chat-only"]')?.addEventListener('change', (event) => {
        setLongScreenshotChatOnly(!!event.target.checked);
        syncLongScreenshotOptionState();
        updateLongScreenshotRangePanel();
    });
    panel.querySelector('[data-role="keep-bars"]')?.addEventListener('change', (event) => {
        setLongScreenshotKeepBars(!!event.target.checked);
        syncLongScreenshotOptionState();
    });
    panel.querySelector('[data-action="start"]')?.addEventListener('click', () => setLongScreenshotRangePoint('start'));
    panel.querySelector('[data-action="end"]')?.addEventListener('click', () => setLongScreenshotRangePoint('end'));
    panel.querySelector('[data-action="capture"]')?.addEventListener('click', () => {
        setLongScreenshotRangeStatus('正在唤起屏幕采集授权，请选择当前酒馆标签页。', 'warn');
        startLongScreenshot({ useRange: true });
    });
    panel.querySelector('[data-action="clear"]')?.addEventListener('click', clearLongScreenshotRange);
    panel.querySelector('[data-action="close"]')?.addEventListener('click', () => toggleLongScreenshotRangePanel(false));
    document.body.appendChild(panel);
    syncLongScreenshotOptionState();
    syncLongScreenshotAvailability();
}

export function toggleLongScreenshotRangePanel(forceOpen = null, anchorRect = null) {
    ensureLongScreenshotRangePanel();
    const panel = document.getElementById('ggg-longshot-range-panel');
    if (!panel) return;
    const active = forceOpen == null ? !panel.classList.contains('active') : !!forceOpen;
    panel.classList.toggle('active', active);
    document.documentElement.classList.toggle('ggg-longshot-range-open', active);
    if (active && anchorRect) {
        const width = Math.min(260, window.innerWidth - 20);
        const left = Math.max(10, Math.min(window.innerWidth - width - 10, anchorRect.right - width));
        const top = Math.max(10, Math.min(window.innerHeight - 190, anchorRect.bottom + 12));
        panel.style.setProperty('left', `${left}px`, 'important');
        panel.style.setProperty('right', 'auto', 'important');
        panel.style.setProperty('top', `${top}px`, 'important');
    }
    syncLongScreenshotOptionState();
    syncLongScreenshotAvailability();
    updateLongScreenshotRangePanel();
}

function ensureLongScreenshotSettings() {
    const settings = getSettings();
    if (!settings.longScreenshot || typeof settings.longScreenshot !== 'object') {
        settings.longScreenshot = { enabled: false };
    }
    if (typeof settings.longScreenshot.enabled !== 'boolean') settings.longScreenshot.enabled = false;
    return settings.longScreenshot;
}

export function hasLongScreenshotEntry() {
    return ensureLongScreenshotSettings().enabled !== false;
}

function setLongScreenshotRangePoint(kind) {
    const chatOnly = getLongScreenshotChatOnly();
    const target = findLongScreenshotScrollTarget(chatOnly);
    const cropTarget = findLongScreenshotCropTarget(chatOnly) || target;
    if (!target) {
        setLongScreenshotStatus('没有找到可滚动的聊天区域或页面区域。', 'error');
        return;
    }
    const top = getLongScreenshotScrollTop(target);
    const rect = getLongScreenshotCropRect(cropTarget);
    if (kind === 'start') {
        longScreenshotRange.start = top;
        if (longScreenshotRange.end !== null && longScreenshotRange.end <= top) longScreenshotRange.end = null;
    } else {
        longScreenshotRange.end = top + rect.height;
    }
    updateLongScreenshotRangePanel();
}

function clearLongScreenshotRange() {
    longScreenshotRange = { start: null, end: null };
    updateLongScreenshotRangePanel();
}

function updateLongScreenshotRangePanel() {
    const panel = document.getElementById('ggg-longshot-range-panel');
    const status = panel?.querySelector('.ggg-longshot-range-status');
    if (!status || !panel) return;
    if (!canUseLongScreenshotCapture()) {
        setLongScreenshotRangeStatus(getLongScreenshotUnavailableText(), 'error');
        return;
    }
    const chatOnlyToggle = panel.querySelector('[data-role="chat-only"]');
    const keepBarsToggle = panel.querySelector('[data-role="keep-bars"]');
    if (chatOnlyToggle) chatOnlyToggle.checked = getLongScreenshotChatOnly();
    if (keepBarsToggle) {
        keepBarsToggle.checked = getLongScreenshotKeepBars();
        keepBarsToggle.disabled = !getLongScreenshotChatOnly();
        keepBarsToggle.closest('.ggg-longshot-chip')?.classList.toggle('disabled', !getLongScreenshotChatOnly());
    }
    const start = longScreenshotRange.start;
    const end = longScreenshotRange.end;
    if (start === null && end === null) {
        status.textContent = '先滚到开始位置，点“设起点”。';
    } else if (start !== null && end === null) {
        status.textContent = `起点 ${Math.round(start)}。滚到结束位置，让终点在视口底部附近，再点“设终点”。`;
    } else if (start === null && end !== null) {
        status.textContent = `终点 ${Math.round(end)}。还需要设置起点。`;
    } else {
        const length = Math.max(0, end - start);
        status.textContent = `起点 ${Math.round(start)}，终点 ${Math.round(end)}，范围约 ${Math.round(length)}px。`;
    }
}

function setLongScreenshotRangeStatus(text, type = '') {
    const panel = document.getElementById('ggg-longshot-range-panel');
    const status = panel?.querySelector('.ggg-longshot-range-status');
    if (!status) return;
    status.textContent = text;
    status.classList.toggle('warn', type === 'warn');
    status.classList.toggle('error', type === 'error');
}

function ensureGlobalBeautifyData() {
    const settings = getSettings();
    if (!settings.globalBeautify || typeof settings.globalBeautify !== 'object') {
        settings.globalBeautify = {};
    }
    if (!Array.isArray(settings.globalBeautify.items)) {
        settings.globalBeautify.items = [];
    }
    if (!Array.isArray(settings.globalBeautify.deletedBuiltinIds)) {
        settings.globalBeautify.deletedBuiltinIds = [];
    }

    const originalLength = settings.globalBeautify.items.length;
    settings.globalBeautify.items = settings.globalBeautify.items.filter(item => {
        if (!item || typeof item !== 'object') return false;
        if (REMOVED_GLOBAL_BEAUTIFY_IDS.has(item.id)) return false;
        if (REMOVED_GLOBAL_BEAUTIFY_SCRIPTS.has(item.script)) return false;
        return true;
    });
    if (settings.globalBeautify.items.length !== originalLength) {
        saveAllSettings();
    }

    const items = settings.globalBeautify.items;
    const builtinById = new Map(BUILTIN_ITEMS.map(item => [item.id, item]));
    const existingIds = new Set(items.map(item => item.id));
    const deletedBuiltinIds = new Set(settings.globalBeautify.deletedBuiltinIds);
    BUILTIN_ITEMS.forEach(item => {
        if (!existingIds.has(item.id) && !deletedBuiltinIds.has(item.id)) {
            items.push(cloneItem(item));
        }
    });

    items.forEach(item => {
        if (!item.id) {
            item.id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        }
        if (typeof item.label !== 'string') {
            item.label = '未命名条目';
        }
        if (typeof item.css !== 'string') {
            item.css = '';
        }
        if (item.enabled === undefined) {
            item.enabled = item.id?.startsWith('builtin_') ? false : true;
        }
        const builtin = builtinById.get(item.id);
        if (builtin) {
            item.builtin = true;
            if (item.label !== builtin.label) {
                item.label = builtin.label;
            }
            item.script = builtin.script || item.script;
            if (BUILTIN_CONFIGS[item.id]) {
                item.config = normalizeBuiltinConfig(item.id, item.config);
                item.css = buildBuiltinCSS(item);
            } else if (item.id === 'builtin_persona_current_description_up') {
                item.css = builtin.css;
            } else if (!item.css && builtin.css) {
                item.css = builtin.css;
            }
        }
    });
}

function getGlobalBeautifyItems() {
    ensureGlobalBeautifyData();
    return getSettings().globalBeautify.items;
}

function cloneItem(item) {
    return JSON.parse(JSON.stringify(item));
}

function isBuiltinItem(item) {
    return item?.builtin === true || item?.id?.startsWith('builtin_');
}

function normalizeBuiltinConfig(itemId, config = {}) {
    const defaults = BUILTIN_CONFIGS[itemId]?.defaults || {};
    const normalized = { ...defaults, ...(config && typeof config === 'object' ? config : {}) };
    if ((itemId === 'builtin_character_avatar_large' || itemId === 'builtin_persona_avatar_preview')) {
        if (!normalized.positions || typeof normalized.positions !== 'object' || Array.isArray(normalized.positions)) {
            normalized.positions = {};
        }
        delete normalized.positionX;
        delete normalized.positionY;
    }
    return normalized;
}

function buildBuiltinCSS(item) {
    const cfg = normalizeBuiltinConfig(item.id, item.config);
    switch (item.id) {
        case 'builtin_favorite_avatar_scroll': {
            const maxHeight = clampNumber(cfg.maxHeight, 1, 2000, 50);
            const horizontal = cfg.direction === 'horizontal';
            return `.hotswap.avatars_inline.scroll-reset-container.expander {
  max-height: ${maxHeight}px;
  overflow-y: ${horizontal ? 'hidden' : 'auto'};
  overflow-x: ${horizontal ? 'auto' : 'hidden'};
}`;
        }
        case 'builtin_single_star_emphasis': {
            const fontSize = clampNumber(cfg.fontSize, 0.1, 10, 1);
            return `#chat .mes_text em {
  font-style: normal;
  font-weight: ${cfg.bold === false ? 'normal' : 'bold'};
  font-size: ${fontSize}em;
}`;
        }
        case 'builtin_double_star_strong': {
            const fontSize = clampNumber(cfg.fontSize, 0.1, 10, 1.1);
            return `#chat .mes_text strong {
  font-weight: bold;
  font-size: ${fontSize}em;
}`;
        }
        case 'builtin_triple_star_strong_em': {
            const fontSize = clampNumber(cfg.fontSize, 0.1, 10, 1.2);
            const fontWeight = clampNumber(cfg.fontWeight, 100, 900, 700);
            return `#chat .mes_text strong em,
#chat .mes_text em strong {
  font-weight: ${fontWeight};
  font-style: normal;
  font-size: ${fontSize}em;
}`;
        }
        case 'builtin_character_avatar_large': {
            const width = clampNumber(cfg.width, 40, 3000, 330);
            const height = clampNumber(cfg.height, 40, 3000, 220);
            return `#avatar_div {
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

#avatar_div_div,
#avatar_load_preview {
  max-width: ${width}px;
  height: ${height}px;
  display: block;
  touch-action: none;
  user-select: none;
  -webkit-user-drag: none;
}

#avatar_load_preview {
  width: 100%;
  height: ${height}px;
  border-radius: 12px;
  object-fit: cover;
  object-position: var(--ggg-avatar-pos-x, 50%) var(--ggg-avatar-pos-y, 50%);
  background-position: var(--ggg-avatar-pos-x, 50%) var(--ggg-avatar-pos-y, 50%);
  background-size: cover;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-drag: none;
}

#avatar_div_div {
  background-position: var(--ggg-avatar-pos-x, 50%) var(--ggg-avatar-pos-y, 50%);
  background-size: cover;
  cursor: grab;
}

#avatar_load_preview.ggg-avatar-dragging {
  cursor: grabbing;
}

#avatar_controls .form_create_bottom_buttons_block {
  width: 100%;
  display: flex;
  justify-content: center !important;
  align-items: center;
  flex-wrap: wrap;
}

#char-management-dropdown {
  width: 100%;
}`;
        }
        case 'builtin_persona_avatar_preview': {
            const width = clampNumber(cfg.width, 40, 3000, 330);
            const height = clampNumber(cfg.height, 40, 3000, 220);
            return `#persona_controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
}

#${PERSONA_PREVIEW_ID} {
  width: 100%;
  max-width: ${width}px;
  height: ${height}px;
  object-fit: cover;
  object-position: var(--ggg-avatar-pos-x, 50%) var(--ggg-avatar-pos-y, 50%);
  background-position: var(--ggg-avatar-pos-x, 50%) var(--ggg-avatar-pos-y, 50%);
  background-size: cover;
  border-radius: 12px;
  display: block;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-drag: none;
}

#${PERSONA_PREVIEW_ID}.ggg-avatar-dragging {
  cursor: grabbing;
}

#persona_controls .persona_controls_buttons_block {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
}

#persona_controls .persona_name,
#your_name {
  font-size: 1.15em;
  font-weight: 700;
  line-height: 1.3;
  margin: 0;
}`;
        }
        default:
            return item.css || '';
    }
}

function clampNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
}

function renderGlobalBeautifyList(openId = null) {
    const list = document.getElementById('ggg-global-beautify-list');
    if (!list) return;

    const items = getGlobalBeautifyItems();
    if (!items.length) {
        list.innerHTML = '<div class="ggg-empty-state" style="padding:12px">暂无全局美化条目</div>';
        return;
    }

    list.innerHTML = '';
    items.forEach(item => list.appendChild(createBeautifyItemNode(item, item.id === openId)));
}

function canExpandBeautifyItem(item) {
    return !isBuiltinItem(item) || !!BUILTIN_CONFIGS[item.id];
}

function createBeautifyItemNode(item, open) {
    if (!canExpandBeautifyItem(item)) return createSimpleBeautifyItemNode(item);

    const details = document.createElement('details');
    details.className = 'ggg-global-beautify-item';
    details.dataset.id = item.id;
    details.open = !!open;
    if (!item.enabled) details.classList.add('disabled');

    const summary = document.createElement('summary');
    summary.className = 'ggg-global-beautify-summary';

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = item.enabled !== false;
    enabled.title = '启用';
    enabled.addEventListener('click', e => e.stopPropagation());
    enabled.addEventListener('change', () => {
        item.enabled = enabled.checked;
        details.classList.toggle('disabled', !item.enabled);
        saveAllSettings();
        applyGlobalBeautify();
    });

    const title = document.createElement('span');
    title.className = 'ggg-global-beautify-title';
    title.textContent = item.label || '未命名条目';

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'menu_button ggg-btn-small';
    exportBtn.innerHTML = '<i class="ggg-fa fa-solid fa-file-export"></i>';
    exportBtn.title = '导出此条目';
    exportBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        exportItems([item], `${safeFileName(item.label || item.id)}.json`);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'menu_button ggg-btn-small ggg-global-beautify-delete';
    deleteBtn.innerHTML = '<i class="ggg-fa fa-solid fa-trash"></i>';
    deleteBtn.title = '删除';
    deleteBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const idx = getGlobalBeautifyItems().findIndex(it => it.id === item.id);
        if (idx >= 0) getGlobalBeautifyItems().splice(idx, 1);
        if (item.id?.startsWith('builtin_')) {
            const data = getSettings().globalBeautify;
            if (!data.deletedBuiltinIds.includes(item.id)) data.deletedBuiltinIds.push(item.id);
        }
        removeItemStyle(item.id);
        saveAllSettings();
        renderGlobalBeautifyList();
        applyGlobalBeautify();
    });

    summary.append(enabled, title);
    if (!isBuiltinItem(item)) summary.append(exportBtn);
    if (!isBuiltinItem(item)) summary.append(deleteBtn);

    const body = document.createElement('div');
    body.className = 'ggg-global-beautify-body';

    if (!isBuiltinItem(item)) {
        const labelInput = document.createElement('input');
        labelInput.className = 'text_pole ggg-global-beautify-name';
        labelInput.value = item.label || '';
        labelInput.placeholder = '条目名称';
        labelInput.addEventListener('input', () => {
            item.label = labelInput.value;
            title.textContent = item.label || '未命名条目';
            saveAllSettings();
        });
        body.append(labelInput);
    }
    if (BUILTIN_CONFIGS[item.id]) {
        body.append(createBuiltinConfigNode(item));
    } else if (!isBuiltinItem(item)) {
        const textarea = document.createElement('textarea');
        textarea.className = 'ggg-code-textarea ggg-global-beautify-css';
        textarea.value = item.css || '';
        textarea.placeholder = '在这里输入全局 CSS';
        textarea.spellcheck = false;
        textarea.addEventListener('input', () => {
            item.css = textarea.value;
            saveAllSettings();
            applyGlobalBeautify();
        });
        body.append(textarea);
    }
    details.append(summary, body);
    return details;
}

function createSimpleBeautifyItemNode(item) {
    const row = document.createElement('div');
    row.className = 'ggg-global-beautify-item ggg-global-beautify-simple';
    row.dataset.id = item.id;
    if (!item.enabled) row.classList.add('disabled');

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = item.enabled !== false;
    enabled.title = '启用';
    enabled.addEventListener('change', () => {
        item.enabled = enabled.checked;
        row.classList.toggle('disabled', !item.enabled);
        saveAllSettings();
        applyGlobalBeautify();
    });

    const title = document.createElement('span');
    title.className = 'ggg-global-beautify-title';
    title.textContent = item.label || '未命名条目';

    row.append(enabled, title);
    return row;
}

function createBuiltinConfigNode(item) {
    item.config = normalizeBuiltinConfig(item.id, item.config);
    const wrap = document.createElement('div');
    wrap.className = 'ggg-global-beautify-config';

    BUILTIN_CONFIGS[item.id].fields.forEach(field => {
        const row = document.createElement('label');
        row.className = 'ggg-global-beautify-field';

        const label = document.createElement('span');
        label.className = 'ggg-global-beautify-field-label';
        label.textContent = field.label;

        const control = createConfigControl(item, field);
        row.append(label, control);

        if (field.suffix) {
            const suffix = document.createElement('span');
            suffix.className = 'ggg-global-beautify-field-suffix';
            suffix.textContent = field.suffix;
            row.append(suffix);
        }

        wrap.append(row);
    });

    return wrap;
}

function createConfigControl(item, field) {
    let control;
    if (field.type === 'select') {
        control = document.createElement('select');
        control.className = 'text_pole ggg-global-beautify-control';
        field.options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            control.append(option);
        });
        control.value = item.config[field.key];
        control.addEventListener('change', () => updateBuiltinConfig(item, field.key, control.value));
        return control;
    }

    if (field.type === 'checkbox') {
        control = document.createElement('input');
        control.type = 'checkbox';
        control.className = 'ggg-global-beautify-check';
        control.checked = item.config[field.key] !== false;
        control.addEventListener('change', () => updateBuiltinConfig(item, field.key, control.checked));
        return control;
    }

    control = document.createElement('input');
    control.type = 'number';
    control.className = 'text_pole ggg-global-beautify-control';
    if (field.min !== undefined) control.min = field.min;
    if (field.max !== undefined) control.max = field.max;
    if (field.step !== undefined) control.step = field.step;
    control.value = item.config[field.key];
    control.addEventListener('input', () => updateBuiltinConfig(item, field.key, Number(control.value)));
    return control;
}

function updateBuiltinConfig(item, key, value) {
    item.config = normalizeBuiltinConfig(item.id, item.config);
    item.config[key] = value;
    item.css = buildBuiltinCSS(item);
    saveAllSettings();
    applyGlobalBeautify();
}

export function applyGlobalBeautify() {
    const settings = getSettings();
    const enabled = settings.enabled !== false && settings.toolsEnabled !== false;
    removeLegacyCombinedStyle();

    for (const item of getGlobalBeautifyItems()) {
        const active = enabled && item.enabled !== false;
        updateItemStyle(item, active);
    }

    const personaItem = getGlobalBeautifyItems().find(item => item.script === 'personaPreview');
    if (enabled && personaItem?.enabled !== false) startPersonaPreview();
    else stopPersonaPreview();

    const personaManagementItem = getGlobalBeautifyItems().find(item => item.script === 'personaCurrentDescriptionUp');
    if (enabled && personaManagementItem?.enabled !== false) startPersonaCurrentDescriptionUp();
    else stopPersonaCurrentDescriptionUp();

    const characterAvatarItem = getGlobalBeautifyItems().find(item => item.id === 'builtin_character_avatar_large');
    startAvatarPositionDrag({
        character: enabled && characterAvatarItem?.enabled !== false,
        persona: enabled && personaItem?.enabled !== false,
    });
}

function removeLegacyCombinedStyle() {
    document.getElementById(STYLE_ID)?.remove();
}

function updateItemStyle(item, active) {
    removeItemStyle(item.id);
    const css = BUILTIN_CONFIGS[item.id] ? buildBuiltinCSS(item) : item.css;
    if (!active || !css?.trim()) return;

    const style = document.createElement('style');
    style.id = `${ITEM_STYLE_PREFIX}${cssEscapeId(item.id)}`;
    style.dataset.gggGlobalBeautify = item.id;
    style.textContent = css;
    document.head.appendChild(style);
}

function removeItemStyle(id) {
    document.querySelectorAll(`style[data-ggg-global-beautify="${escapeAttr(id)}"]`).forEach(node => node.remove());
    document.getElementById(`${ITEM_STYLE_PREFIX}${cssEscapeId(id)}`)?.remove();
}

function cssEscapeId(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function escapeAttr(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function startPersonaPreview() {
    syncPersonaPreview();
    if (!personaObserver && document.body) {
        personaObserver = new MutationObserver(schedulePersonaSync);
        personaObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'style', 'class'],
        });
    }
}

function stopPersonaPreview() {
    personaObserver?.disconnect();
    personaObserver = null;
    if (personaTimer) clearTimeout(personaTimer);
    personaTimer = null;
    document.getElementById(PERSONA_PREVIEW_ID)?.remove();
}

function handleAvatarPreviewPotentialChange(event) {
    const target = event.target;
    if (!target?.closest) return;
    if (target.closest('.ggg-avatar-drag-toggle')) return;
    if (target.closest(AVATAR_DRAG_TARGET_SELECTOR)) return;

    if (target.closest('#user_avatar_block, #persona_set_image_button, #persona_duplicate_button, #persona_delete_button, #avatar_upload_file')) {
        setTimeout(() => syncPersonaPreview(true), 0);
        setTimeout(() => syncPersonaPreview(true), 350);
        setTimeout(() => syncPersonaPreview(true), 1200);
    }

    if (target.closest('#character_popup, #avatar_div, #avatar_upload_file, #character_select, #rm_button_selected_ch')) {
        setTimeout(() => refreshCharacterAvatarPreview(true), 0);
        setTimeout(() => refreshCharacterAvatarPreview(true), 350);
        setTimeout(() => refreshCharacterAvatarPreview(true), 1200);
    }
}

function schedulePersonaSync() {
    if (personaTimer) return;
    personaTimer = setTimeout(() => {
        personaTimer = null;
        syncPersonaPreview();
    }, 100);
}

function syncPersonaPreview(forceReload = false) {
    const controls = document.getElementById('persona_controls');
    if (!controls) {
        document.getElementById(PERSONA_PREVIEW_ID)?.remove();
        return;
    }

    let preview = document.getElementById(PERSONA_PREVIEW_ID);
    if (!preview) {
        preview = document.createElement('img');
        preview.id = PERSONA_PREVIEW_ID;
        preview.alt = 'Persona avatar preview';
        controls.insertBefore(preview, controls.firstChild);
    } else if (preview.parentElement !== controls) {
        controls.insertBefore(preview, controls.firstChild);
    }

    const src = findPersonaAvatarSrc(preview);
    setAvatarPreviewSource(preview, src, { forceReload });
    applyStoredAvatarPosition('persona', preview);
    scheduleAvatarDragButtonSync();
}

function refreshCharacterAvatarPreview(forceReload = false) {
    const preview = document.getElementById('avatar_load_preview');
    if (!preview) return;
    const src = preview.dataset.gggPreviewBaseSrc
        || normalizePreviewSource(preview.currentSrc || preview.getAttribute('src'))
        || preview.currentSrc
        || preview.getAttribute('src')
        || '';
    if (!src) return;
    setAvatarPreviewSource(preview, src, { forceReload });
    applyStoredAvatarPosition('character', preview);
    scheduleAvatarDragButtonSync();
}

function setAvatarPreviewSource(preview, src, { forceReload = false } = {}) {
    if (!preview) return;
    if (!src) {
        preview.removeAttribute('src');
        preview.style.display = 'none';
        delete preview.dataset.gggPreviewBaseSrc;
        return;
    }

    const normalizedSrc = normalizePreviewSource(src) || String(src);
    const currentNormalized = preview.dataset.gggPreviewBaseSrc
        || normalizePreviewSource(preview.currentSrc || preview.getAttribute('src'))
        || '';
    if (forceReload || currentNormalized !== normalizedSrc || !preview.getAttribute('src')) {
        preview.dataset.gggPreviewBaseSrc = normalizedSrc;
        preview.src = src;
    }
    preview.style.display = '';
}

function normalizePreviewSource(value) {
    if (!value) return '';
    try {
        const url = new URL(value, location.href);
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch {
        return String(value).replace(/[?#].*$/, '');
    }
}

function findPersonaAvatarSrc(preview) {
    const selected = document.querySelector('#user_avatar_block .avatar-container.selected img');
    const selectedSrc = selected?.currentSrc || selected?.src;
    if (selectedSrc) return selectedSrc;

    const selectedAvatarId = document.querySelector('#user_avatar_block .avatar-container.selected')?.getAttribute('data-avatar-id');
    if (selectedAvatarId) return `User Avatars/${selectedAvatarId}`;

    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    const userAvatar = ctx?.powerUserSettings?.user_avatar || ctx?.user_avatar || window.power_user?.user_avatar || window.user_avatar;
    if (userAvatar) return `User Avatars/${userAvatar}`;

    const selectors = [
        '#user_avatar_block .avatar-container.selected img',
        '#user_avatar img',
        '#persona_avatar img',
        '.persona_avatar img',
        '.avatar-container img[src*="User Avatars"]',
        'img[src*="/User Avatars/"]',
        'img[src*="user_avatar"]',
    ];

    for (const selector of selectors) {
        const img = [...document.querySelectorAll(selector)].find(node => node !== preview && (node.currentSrc || node.src));
        const src = img?.currentSrc || img?.src;
        if (src) return src;
    }

    const bgSelectors = ['#user_avatar_block', '#user_avatar', '#persona_avatar', '.persona_avatar'];
    for (const selector of bgSelectors) {
        const node = document.querySelector(selector);
        const src = extractBackgroundUrl(node);
        if (src) return src;
    }

    return '';
}

function startPersonaCurrentDescriptionUp() {
    personaManagementRetryCount = 0;
    schedulePersonaManagementSync();
}

function stopPersonaCurrentDescriptionUp() {
    if (personaManagementTimer) clearTimeout(personaManagementTimer);
    personaManagementTimer = null;
    personaManagementRetryCount = 0;
    restorePersonaCurrentDescriptionLayout();
}

function schedulePersonaManagementSync() {
    if (personaManagementTimer) return;
    personaManagementTimer = setTimeout(() => {
        personaManagementTimer = null;
        const applied = syncPersonaCurrentDescriptionUp();
        if (!applied && personaManagementRetryCount < 20) {
            personaManagementRetryCount += 1;
            schedulePersonaManagementSync();
        }
    }, 120);
}

function syncPersonaCurrentDescriptionUp() {
    const currentPersona = getCurrentPersonaBlock();
    if (!currentPersona) return false;

    movePersonaGlobalSettingsToListColumn();
    foldCurrentPersonaExtraSettings(currentPersona);
    personaManagementRetryCount = 0;
    return true;
}

function movePersonaGlobalSettingsToListColumn() {
    const leftColumn = getPersonaLeftColumn();
    const globalSettings = getPersonaGlobalSettings();
    if (!leftColumn || !globalSettings || globalSettings.parentElement === leftColumn) return;

    if (!personaGlobalSettingsPlaceholder) {
        personaGlobalSettingsPlaceholder = document.createComment('ggg persona global settings original position');
    }
    if (!personaGlobalSettingsPlaceholder.parentNode) {
        globalSettings.parentElement?.insertBefore(personaGlobalSettingsPlaceholder, globalSettings);
    }
    leftColumn.appendChild(globalSettings);
}

function foldCurrentPersonaExtraSettings(currentPersona) {
    const existingDrawer = getDirectChildByClass(currentPersona, PERSONA_EXTRA_DRAWER_CLASS);
    if (existingDrawer) {
        return;
    }

    const firstExtraNode = findPersonaExtraStart(currentPersona);
    if (!firstExtraNode) return;

    const drawer = document.createElement('details');
    drawer.className = PERSONA_EXTRA_DRAWER_CLASS;

    const summary = document.createElement('summary');
    summary.innerHTML = '<span><i class="fa-solid fa-sliders"></i> 插入位置与链接</span>';

    const content = document.createElement('div');
    content.className = PERSONA_EXTRA_CONTENT_CLASS;

    currentPersona.insertBefore(drawer, firstExtraNode);
    drawer.append(summary, content);
    appendFollowingSiblings(drawer, content);
}

function appendFollowingSiblings(anchor, target) {
    if (!anchor || !target) return;
    let node = anchor.nextSibling;
    while (node) {
        const next = node.nextSibling;
        target.appendChild(node);
        node = next;
    }
}

function restorePersonaCurrentDescriptionLayout() {
    const currentPersona = getCurrentPersonaBlock();
    restorePersonaGlobalSettingsLayout();
    if (!currentPersona) return;
    unfoldCurrentPersonaExtraSettings(currentPersona);
}

function restorePersonaGlobalSettingsLayout() {
    const globalSettings = getPersonaGlobalSettings();
    if (globalSettings && personaGlobalSettingsPlaceholder?.parentNode) {
        personaGlobalSettingsPlaceholder.parentNode.insertBefore(globalSettings, personaGlobalSettingsPlaceholder);
    }
    personaGlobalSettingsPlaceholder?.remove();
    personaGlobalSettingsPlaceholder = null;
}

function unfoldCurrentPersonaExtraSettings(currentPersona) {
    const drawer = getDirectChildByClass(currentPersona, PERSONA_EXTRA_DRAWER_CLASS);
    if (!drawer) return;

    const content = drawer.querySelector(`.${PERSONA_EXTRA_CONTENT_CLASS}`);
    while (content?.firstChild) {
        currentPersona.insertBefore(content.firstChild, drawer);
    }
    drawer.remove();
}

function getCurrentPersonaBlock() {
    return document.querySelector('#persona-management-block .persona_management_current_persona.ggg-cc-persona-host')
        || document.querySelector('#persona-management-block .persona_management_current_persona');
}

function getPersonaLeftColumn() {
    return document.querySelector('#persona-management-block .persona_management_left_column');
}

function getPersonaGlobalSettings() {
    return document.querySelector('#persona-management-block .persona_management_global_settings');
}

function findPersonaExtraStart(currentPersona) {
    return [...currentPersona.children].find(node => (
        node.classList?.contains('flex-container')
        && node.classList?.contains('justifySpaceBetween')
        && node.querySelector?.('#persona_description_token_count')
    ));
}

function getDirectChildByClass(parent, className) {
    return [...(parent?.children || [])].find(node => node.classList?.contains(className)) || null;
}

function extractBackgroundUrl(node) {
    if (!node) return '';
    const bg = getComputedStyle(node).backgroundImage || '';
    const match = bg.match(/url\(["']?(.+?)["']?\)/);
    return match?.[1] || '';
}

function startAvatarPositionDrag(active = {}) {
    avatarDragActiveState = { character: !!active.character, persona: !!active.persona };
    document.documentElement.dataset.gggAvatarDragCharacter = active.character ? '1' : '0';
    document.documentElement.dataset.gggAvatarDragPersona = active.persona ? '1' : '0';
    if (!active.character) document.documentElement.dataset.gggAvatarDragUnlockedCharacter = '0';
    if (!active.persona) document.documentElement.dataset.gggAvatarDragUnlockedPersona = '0';
    scheduleAvatarDragButtonSync();

    if ((active.character || active.persona) && !avatarDragBound) {
        document.addEventListener('click', handleAvatarClickWhileUnlocked, true);
        document.addEventListener('dragstart', handleAvatarNativeDragStart, true);
        avatarDragBound = true;
    } else if (!active.character && !active.persona && avatarDragBound) {
        document.removeEventListener('click', handleAvatarClickWhileUnlocked, true);
        document.removeEventListener('dragstart', handleAvatarNativeDragStart, true);
        avatarDragBound = false;
    }
}

function scheduleAvatarDragButtonSync() {
    if (avatarDragButtonTimer) clearTimeout(avatarDragButtonTimer);
    avatarDragButtonTimer = setTimeout(() => {
        avatarDragButtonTimer = null;
        syncAvatarDragButtons(avatarDragActiveState);
        syncAvatarDirectDragTargets();
        syncStoredAvatarPositions();
    }, 50);
}

function syncAvatarDirectDragTargets() {
    document.querySelectorAll(CHARACTER_AVATAR_TARGET_SELECTOR).forEach(bindAvatarDirectDragTarget);
    bindAvatarDirectDragTarget(document.getElementById(PERSONA_PREVIEW_ID));
}

function bindAvatarDirectDragTarget(target) {
    if (!target || avatarDirectDragTargets.has(target)) return;
    avatarDirectDragTargets.add(target);
    target.style.touchAction = 'none';
    target.style.userSelect = 'none';
    target.style.webkitUserDrag = 'none';
    target.draggable = false;
    target.addEventListener('pointerdown', handleAvatarPointerDown);
    target.addEventListener('touchstart', handleAvatarTouchStart, { passive: false });
    target.addEventListener('dragstart', handleAvatarNativeDragStart);
}

function syncAvatarDragButtons(active = {}) {
    syncAvatarDragButton({
        active: active.character,
        controls: document.getElementById('favorite_button')?.parentElement,
        anchor: document.getElementById('favorite_button'),
        kind: 'character',
    });
    syncAvatarDragButton({
        active: active.persona,
        controls: document.getElementById('persona_rename_button')?.parentElement,
        anchor: document.getElementById('persona_rename_button'),
        kind: 'persona',
    });
}

function syncAvatarDragButton({ active, controls, anchor, kind }) {
    const id = `ggg-avatar-drag-toggle-${kind}`;
    const existing = document.getElementById(id);
    if (!active || !controls) {
        existing?.remove();
        return;
    }

    let button = existing;
    if (!button) {
        button = document.createElement('div');
        button.id = id;
        button.className = 'menu_button ggg-fa fa-solid fa-arrows-up-down-left-right interactable ggg-avatar-drag-toggle';
        button.dataset.dragKind = kind;
        button.tabIndex = 0;
        button.setAttribute('role', 'button');
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopImmediatePropagation();
            toggleAvatarDragUnlock(kind, button);
        });
        button.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopImmediatePropagation();
            toggleAvatarDragUnlock(kind, button);
        });
    }

    updateAvatarDragButtonState(button, isAvatarDragUnlocked(kind));
    if (anchor && button.nextSibling !== anchor) controls.insertBefore(button, anchor);
    else if (!button.parentElement) controls.insertBefore(button, controls.firstChild);
}

function toggleAvatarDragUnlock(kind, button) {
    const next = !isAvatarDragUnlocked(kind);
    document.documentElement.dataset[getAvatarDragUnlockDatasetKey(kind)] = next ? '1' : '0';
    updateAvatarDragButtonState(button, next);
    if (next) {
        const target = kind === 'persona' ? document.getElementById(PERSONA_PREVIEW_ID) : document.getElementById('avatar_load_preview');
        applyStoredAvatarPosition(kind, target);
    }
}

function isAvatarDragUnlocked(kind) {
    return document.documentElement.dataset[getAvatarDragUnlockDatasetKey(kind)] === '1';
}

function getAvatarDragUnlockDatasetKey(kind) {
    return kind === 'persona' ? 'gggAvatarDragUnlockedPersona' : 'gggAvatarDragUnlockedCharacter';
}

function updateAvatarDragButtonState(button, unlocked) {
    button.classList.toggle('active', unlocked);
    button.title = unlocked ? '拖拽已开启，再次点击关闭' : '点击后可拖拽头像调整显示位置';
}

function syncStoredAvatarPositions() {
    if (avatarDragState) return;
    applyStoredAvatarPosition('character', document.getElementById('avatar_load_preview'));
    applyStoredAvatarPosition('character', document.getElementById('avatar_div_div'));
    applyStoredAvatarPosition('persona', document.getElementById(PERSONA_PREVIEW_ID));
}

function applyStoredAvatarPosition(kind, target) {
    if (!target) return;
    const item = getAvatarPositionItem(kind);
    if (!item || item.enabled === false) return;

    item.config = normalizeBuiltinConfig(item.id, item.config);
    const key = getAvatarPositionKey(kind, target);
    const pos = getStoredAvatarPosition(item, key);
    applyAvatarPositionForKind(kind, target, pos);
}

function getAvatarPositionItem(kind) {
    const itemId = kind === 'persona' ? 'builtin_persona_avatar_preview' : 'builtin_character_avatar_large';
    return getGlobalBeautifyItems().find(it => it.id === itemId);
}

function getAvatarPositionKey(kind, target) {
    if (kind === 'persona') {
        const selectedAvatarId = document.querySelector('#user_avatar_block .avatar-container.selected')?.getAttribute('data-avatar-id');
        if (selectedAvatarId) return selectedAvatarId;
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
        const userAvatar = ctx?.powerUserSettings?.user_avatar || ctx?.user_avatar || window.power_user?.user_avatar || window.user_avatar;
        if (userAvatar) return userAvatar;
    } else {
        const charKey = getCurrentCharacterPositionKey();
        if (charKey) return charKey;
    }

    const src = target?.currentSrc || target?.src || target?.getAttribute?.('src') || extractBackgroundUrl(target);
    return normalizeAvatarPositionKey(src) || '__default__';
}

function getCurrentCharacterPositionKey() {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    const candidateIds = [
        ctx?.characterId,
        ctx?.chid,
        window.this_chid,
        window.selected_chid,
        document.getElementById('character_select')?.value,
        document.querySelector('#rm_button_selected_ch')?.getAttribute?.('chid'),
    ];
    for (const value of candidateIds) {
        if (value == null) continue;
        const text = String(value).trim();
        if (text) return `character:${text}`;
    }

    const names = [
        document.getElementById('character_name_pole')?.value,
        document.querySelector('#character_popup input[name="name"]')?.value,
    ];
    for (const value of names) {
        const text = String(value || '').trim();
        if (text) return `character-name:${text}`;
    }

    return '';
}

function normalizeAvatarPositionKey(value) {
    if (!value) return '';
    try {
        const url = new URL(value, location.href);
        return decodeURIComponent(url.pathname.split('/').pop() || url.pathname || value);
    } catch {
        return String(value).split(/[\\/]/).pop() || String(value);
    }
}

function getStoredAvatarPosition(item, key) {
    const positions = item.config.positions || {};
    const pos = positions[key] || positions.__default__;
    return {
        x: clampNumber(pos?.x, 0, 100, 50),
        y: clampNumber(pos?.y, 0, 100, 50),
    };
}

function setStoredAvatarPosition(item, key, position) {
    item.config = normalizeBuiltinConfig(item.id, item.config);
    item.config.positions[key || '__default__'] = {
        x: roundPosition(position.x),
        y: roundPosition(position.y),
    };
}

function applyAvatarPositionToTarget(target, position) {
    if (!target || !position) return;
    target.style.setProperty('--ggg-avatar-pos-x', `${position.x}%`);
    target.style.setProperty('--ggg-avatar-pos-y', `${position.y}%`);
    target.style.objectPosition = `${position.x}% ${position.y}%`;
    target.style.backgroundPosition = `${position.x}% ${position.y}%`;
}

function applyAvatarPositionForKind(kind, target, position) {
    if (kind !== 'character') {
        applyAvatarPositionToTarget(target, position);
        return;
    }

    const targets = new Set([
        target,
        document.getElementById('avatar_load_preview'),
        document.getElementById('avatar_div_div'),
    ]);
    targets.forEach(node => applyAvatarPositionToTarget(node, position));
}

function handleAvatarPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (avatarDragState) return;

    const target = event.target?.closest?.(AVATAR_DRAG_TARGET_SELECTOR);
    if (!target) return;

    startAvatarDragFromEvent(event, target, {
        pointerId: event.pointerId,
        capturePointer: true,
        addMoveListeners() {
            document.addEventListener('pointermove', handleAvatarPointerMove, true);
            document.addEventListener('pointerup', handleAvatarPointerUp, true);
            document.addEventListener('pointercancel', handleAvatarPointerUp, true);
        },
    });
}

function handleAvatarTouchStart(event) {
    if (avatarDragState) return;

    const target = event.target?.closest?.(AVATAR_DRAG_TARGET_SELECTOR);
    if (!target || event.touches.length !== 1) return;

    const touch = event.changedTouches[0] || event.touches[0];
    startAvatarDragFromEvent(event, target, {
        pointerId: touch.identifier,
        point: touch,
        addMoveListeners() {
            document.addEventListener('touchmove', handleAvatarTouchMove, { capture: true, passive: false });
            document.addEventListener('touchend', handleAvatarTouchEnd, true);
            document.addEventListener('touchcancel', handleAvatarTouchEnd, true);
        },
    });
}

function startAvatarDragFromEvent(event, target, options = {}) {
    const isPersona = target.id === PERSONA_PREVIEW_ID;
    const activeKey = isPersona ? 'gggAvatarDragPersona' : 'gggAvatarDragCharacter';
    if (document.documentElement.dataset[activeKey] !== '1') return;
    if (!isAvatarDragUnlocked(isPersona ? 'persona' : 'character')) return;

    const itemId = isPersona ? 'builtin_persona_avatar_preview' : 'builtin_character_avatar_large';
    const item = getGlobalBeautifyItems().find(it => it.id === itemId);
    if (!item || item.enabled === false) return;

    item.config = normalizeBuiltinConfig(item.id, item.config);
    const positionKey = getAvatarPositionKey(isPersona ? 'persona' : 'character', target);
    const storedPosition = getStoredAvatarPosition(item, positionKey);
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const point = options.point || event;

    avatarDragState = {
        item,
        target,
        rect,
        pointerId: options.pointerId,
        hasPointerCapture: !!options.capturePointer,
        kind: isPersona ? 'persona' : 'character',
        moved: false,
        startX: point.clientX,
        startY: point.clientY,
        positionKey,
        currentPosX: storedPosition.x,
        currentPosY: storedPosition.y,
        startPosX: storedPosition.x,
        startPosY: storedPosition.y,
    };

    target.classList.add('ggg-avatar-dragging');
    target.draggable = false;
    if (options.capturePointer && options.pointerId != null) {
        try {
            target.setPointerCapture?.(options.pointerId);
        } catch {}
    }
    options.addMoveListeners?.();
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
}

function handleAvatarPointerMove(event) {
    if (!avatarDragState) return;
    moveAvatarDrag(event, event);
}

function handleAvatarTouchMove(event) {
    if (!avatarDragState) return;
    const touch = findAvatarDragTouch(event);
    if (!touch) return;
    moveAvatarDrag(event, touch);
}

function moveAvatarDrag(event, point) {
    const dx = point.clientX - avatarDragState.startX;
    const dy = point.clientY - avatarDragState.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) avatarDragState.moved = true;
    const nextX = clampNumber(avatarDragState.startPosX - (dx / avatarDragState.rect.width) * 100, 0, 100, 50);
    const nextY = clampNumber(avatarDragState.startPosY - (dy / avatarDragState.rect.height) * 100, 0, 100, 50);

    avatarDragState.currentPosX = roundPosition(nextX);
    avatarDragState.currentPosY = roundPosition(nextY);
    applyAvatarPositionForKind(avatarDragState.kind, avatarDragState.target, {
        x: avatarDragState.currentPosX,
        y: avatarDragState.currentPosY,
    });
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
}

function handleAvatarPointerUp(event) {
    if (!avatarDragState) return;
    finishAvatarDrag(event);
}

function handleAvatarTouchEnd(event) {
    if (!avatarDragState) return;
    if (event.changedTouches?.length && !findAvatarDragTouch(event, 'changedTouches')) return;
    finishAvatarDrag(event);
}

function finishAvatarDrag(event) {
    if (avatarDragState.hasPointerCapture && avatarDragState.pointerId != null) {
        try {
            if (!avatarDragState.target.hasPointerCapture || avatarDragState.target.hasPointerCapture(avatarDragState.pointerId)) {
                avatarDragState.target.releasePointerCapture?.(avatarDragState.pointerId);
            }
        } catch {}
    }
    avatarDragState.target.classList.remove('ggg-avatar-dragging');
    setStoredAvatarPosition(avatarDragState.item, avatarDragState.positionKey, {
        x: avatarDragState.currentPosX,
        y: avatarDragState.currentPosY,
    });
    avatarDragState.item.css = buildBuiltinCSS(avatarDragState.item);
    avatarDragState = null;
    document.removeEventListener('pointermove', handleAvatarPointerMove, true);
    document.removeEventListener('pointerup', handleAvatarPointerUp, true);
    document.removeEventListener('pointercancel', handleAvatarPointerUp, true);
    document.removeEventListener('touchmove', handleAvatarTouchMove, true);
    document.removeEventListener('touchend', handleAvatarTouchEnd, true);
    document.removeEventListener('touchcancel', handleAvatarTouchEnd, true);
    saveAllSettings();
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
}

function findAvatarDragTouch(event, listName = 'touches') {
    const touches = event[listName] || event.touches || [];
    return [...touches].find(touch => touch.identifier === avatarDragState.pointerId) || null;
}

function handleAvatarClickWhileUnlocked(event) {
    const target = event.target?.closest?.(AVATAR_DRAG_TARGET_SELECTOR);
    if (!target) return;

    const kind = target.id === PERSONA_PREVIEW_ID ? 'persona' : 'character';
    if (!isAvatarDragUnlocked(kind)) return;

    // The character-management preview has its own click handler for changing
    // avatar. While positioning is unlocked, keep clicks dedicated to dragging.
    event.preventDefault();
    event.stopImmediatePropagation();
}

function handleAvatarNativeDragStart(event) {
    const target = event.target?.closest?.(AVATAR_DRAG_TARGET_SELECTOR);
    if (!target) return;
    const kind = target.id === PERSONA_PREVIEW_ID ? 'persona' : 'character';
    if (!isAvatarDragUnlocked(kind)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
}

function roundPosition(value) {
    return Math.round(value * 10) / 10;
}

async function startLongScreenshot(options = {}) {
    if (longScreenshotState?.active) {
        setLongScreenshotStatus('长截图正在进行中。', 'warn');
        return;
    }

    if (!canUseLongScreenshotCapture()) {
        syncLongScreenshotAvailability();
        setLongScreenshotStatus(getLongScreenshotUnavailableText(), 'error');
        return;
    }

    if (options.useRange && !isLongScreenshotRangeReady()) {
        updateLongScreenshotRangePanel();
        setLongScreenshotStatus('请先设置长截图起点和终点。', 'warn');
        return;
    }

    const state = {
        active: true,
        stopRequested: false,
        cancelRequested: false,
        stream: null,
        video: null,
        scrollTarget: null,
        chunks: [],
        chatOnly: getLongScreenshotChatOnly(),
        keepBars: false,
        useRange: !!options.useRange,
        rangeStart: options.useRange ? Math.min(longScreenshotRange.start, longScreenshotRange.end) : null,
        rangeEnd: options.useRange ? Math.max(longScreenshotRange.start, longScreenshotRange.end) : null,
        topBarChunk: null,
        bottomBarChunk: null,
        startScrollTop: 0,
        lastScrollTop: null,
        capturedUntil: 0,
        cropRect: null,
        overlay: null,
        marker: null,
        cropTarget: null,
    };
    state.keepBars = state.chatOnly && getLongScreenshotKeepBars();
    longScreenshotState = state;
    setLongScreenshotControls(true);
    setLongScreenshotStatus(state.useRange
        ? '正在唤起屏幕采集授权，请选择当前酒馆标签页。'
        : (_gggIsFullscreen() ? '正在退出全屏并等待布局稳定...' : '请选择当前酒馆标签页，授权后会自动开始滚动截图。'));

    try {
        state.scrollTarget = findLongScreenshotScrollTarget(state.chatOnly);
        state.cropTarget = findLongScreenshotCropTarget(state.chatOnly) || state.scrollTarget;
        if (!state.scrollTarget) {
            setLongScreenshotStatus('没有找到可滚动的聊天区域或页面区域。', 'error');
            return;
        }
        state.startScrollTop = state.useRange ? state.rangeStart : getLongScreenshotScrollTop(state.scrollTarget);

        setLongScreenshotStatus('正在唤起屏幕采集授权，请选择当前酒馆标签页。');
        state.stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                frameRate: { ideal: 5, max: 10 },
                displaySurface: 'browser',
            },
            audio: false,
            preferCurrentTab: true,
            selfBrowserSurface: 'include',
        });

        const exitedFullscreen = state.useRange ? false : await exitLongScreenshotFullscreenIfNeeded();
        if (exitedFullscreen) {
            setLongScreenshotStatus('已退出全屏。请把聊天滚到想开始的位置，然后点击“开始采集”。');
            await waitLongScreenshotUserReadyAfterFullscreen(state);
            if (state.cancelRequested) return;
        }

        state.video = await createLongScreenshotVideo(state.stream);
        state.overlay = createLongScreenshotOverlay();
        state.marker = createLongScreenshotMarker();
        document.documentElement.classList.add('ggg-longshot-capturing');
        await waitLongScreenshotFrame(700);
        state.scrollTarget = findLongScreenshotScrollTarget(state.chatOnly);
        state.cropTarget = findLongScreenshotCropTarget(state.chatOnly) || state.scrollTarget;
        if (!state.scrollTarget) {
            setLongScreenshotStatus('授权后没有找到可滚动的聊天区域或页面区域。', 'error');
            return;
        }
        restoreLongScreenshotStartPosition(state);
        await waitLongScreenshotFrame(500);
        if (state.keepBars) {
            await captureLongScreenshotBars(state);
        }
        restoreLongScreenshotStartPosition(state);
        await waitLongScreenshotFrame(250);

        await captureLongScreenshotLoop(state);
        if (state.cancelRequested || !state.chunks.length) {
            setLongScreenshotStatus(state.chunks.length ? '已取消长截图，未保存。' : '未截取到画面。', state.chunks.length ? 'warn' : 'error');
            return;
        }

        setLongScreenshotStatus('正在拼接并保存图片...');
        updateLongScreenshotOverlay('正在拼接...');
        await stitchAndDownloadLongScreenshot(state);
        setLongScreenshotStatus(`已保存长截图，共 ${state.chunks.length} 段。`);
    } catch (error) {
        const message = error?.name === 'NotAllowedError'
            ? '已取消授权。需要选择当前酒馆标签页才能截图。'
            : `长截图失败：${error?.message || error}`;
        setLongScreenshotStatus(message, 'error');
        console.warn('[ggg] long screenshot failed', error);
    } finally {
        cleanupLongScreenshotState(state);
    }
}

function isLongScreenshotRangeReady() {
    return Number.isFinite(longScreenshotRange.start)
        && Number.isFinite(longScreenshotRange.end)
        && Math.abs(longScreenshotRange.end - longScreenshotRange.start) > 8;
}

async function captureLongScreenshotLoop(state) {
    const target = state.scrollTarget;
    const maxScroll = getLongScreenshotMaxScrollTop(target);
    let currentTop = getLongScreenshotScrollTop(target);
    let deltaFromPrev = 0;

    while (!state.cancelRequested) {
        currentTop = getLongScreenshotScrollTop(target);
        updateLongScreenshotOverlay(`第 ${state.chunks.length + 1} 段`);
        setLongScreenshotStatus(`正在截取第 ${state.chunks.length + 1} 段，当前位置 ${Math.round(currentTop)} / ${Math.round(maxScroll)}。`);

        const chunk = await captureLongScreenshotFrame(state, deltaFromPrev);
        if (state.useRange) {
            chunk.clipCssHeight = Math.max(1, Math.min(chunk.cssHeight, state.rangeEnd - currentTop));
        }
        state.chunks.push(chunk);
        state.lastScrollTop = currentTop;
        state.capturedUntil = currentTop + (state.cropRect?.height || 0);
        if (state.useRange) state.capturedUntil = Math.min(state.capturedUntil, state.rangeEnd);
        updateLongScreenshotMarker(state);

        if (state.useRange && currentTop + (state.cropRect?.height || 0) >= state.rangeEnd - 1) break;
        if (state.stopRequested || currentTop >= getLongScreenshotMaxScrollTop(target) - 1) break;

        const cropHeight = Math.max(1, state.cropRect?.height || window.innerHeight);
        const step = Math.max(1, Math.floor(cropHeight * 0.45));
        const rangeLimitedTop = state.useRange ? Math.max(currentTop + 1, state.rangeEnd - cropHeight) : Number.POSITIVE_INFINITY;
        const nextTop = Math.min(getLongScreenshotMaxScrollTop(target), rangeLimitedTop, currentTop + step);
        if (nextTop <= currentTop + 0.5) break;

        await animateLongScreenshotScroll(state, currentTop, nextTop, 700);
        if (state.cancelRequested) break;

        const afterTop = getLongScreenshotScrollTop(target);
        deltaFromPrev = Math.max(0, afterTop - currentTop);
        if (deltaFromPrev <= 0.5) break;
        if (state.stopRequested) break;
    }
}

async function captureLongScreenshotBars(state) {
    const topTarget = document.getElementById('top-bar');
    const bottomTarget = document.getElementById('send_form');
    state.topBarChunk = topTarget ? await captureLongScreenshotElementFrame(state, topTarget, 'top') : null;
    state.bottomBarChunk = bottomTarget ? await captureLongScreenshotElementFrame(state, bottomTarget, 'bottom') : null;
}

async function captureLongScreenshotFrame(state, deltaFromPrev) {
    const rect = getLongScreenshotCropRect(state.cropTarget || state.scrollTarget);
    state.cropRect = rect;
    const chunk = await captureLongScreenshotRectFrame(state, rect);

    return {
        ...chunk,
        deltaFromPrev,
    };
}

async function captureLongScreenshotElementFrame(state, element, kind) {
    const rect = getLongScreenshotCropRect(element);
    if (!rect.width || !rect.height) return null;
    return {
        ...(await captureLongScreenshotRectFrame(state, rect)),
        kind,
        deltaFromPrev: 0,
    };
}

async function captureLongScreenshotRectFrame(state, rect) {
    const video = state.video;
    const viewport = getLongScreenshotViewportSize();
    const scaleX = video.videoWidth / Math.max(1, viewport.width);
    const scaleY = video.videoHeight / Math.max(1, viewport.height);
    const aspectDelta = Math.abs((video.videoWidth / video.videoHeight) - (viewport.width / viewport.height));
    if (aspectDelta > 0.18) {
        setLongScreenshotStatus('采集画面比例和页面比例不一致。若图片裁切不准，请重新开始并选择“当前标签页”。', 'warn');
    }

    const sourceX = Math.max(0, Math.round(rect.left * scaleX));
    const sourceY = Math.max(0, Math.round(rect.top * scaleY));
    const sourceWidth = Math.min(video.videoWidth - sourceX, Math.round(rect.width * scaleX));
    const sourceHeight = Math.min(video.videoHeight - sourceY, Math.round(rect.height * scaleY));

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, sourceWidth);
    canvas.height = Math.max(1, sourceHeight);
    const ctx = canvas.getContext('2d');
    await withLongScreenshotOverlayHidden(async () => {
        await waitLongScreenshotFrame(80);
        ctx.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    });

    return {
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
        cssWidth: rect.width,
        cssHeight: rect.height,
    };
}

async function stitchAndDownloadLongScreenshot(state) {
    const chunks = state.chunks;
    const allSourceChunks = [state.topBarChunk, ...chunks, state.bottomBarChunk].filter(Boolean);
    const width = Math.max(...allSourceChunks.map(chunk => chunk.width));
    const renderedChunks = [];
    for (const chunk of chunks) {
        renderedChunks.push(await renderLongScreenshotChunk(chunk));
    }

    const chatParts = [];
    renderedChunks.forEach((item, index) => {
        const chunk = item.chunk;
        if (index === 0) {
            chatParts.push({ ...item, sourceY: 0, sourceHeight: getLongScreenshotChunkSourceHeight(chunk, 0) });
            return;
        }
        const cssOverlap = Math.max(0, chunk.cssHeight - chunk.deltaFromPrev);
        const fallbackY = Math.min(chunk.height - 1, Math.round(cssOverlap * (chunk.height / chunk.cssHeight)));
        const sourceY = fallbackY;
        const sourceHeight = getLongScreenshotChunkSourceHeight(chunk, sourceY);
        chatParts.push({ ...item, sourceY, sourceHeight });
    });

    const parts = [];
    if (state.topBarChunk) {
        const top = await renderLongScreenshotChunk(state.topBarChunk);
        parts.push({ ...top, sourceY: 0, sourceHeight: top.chunk.height, noOverlap: true });
    }
    parts.push(...chatParts);
    if (state.bottomBarChunk) {
        const bottom = await renderLongScreenshotChunk(state.bottomBarChunk);
        parts.push({ ...bottom, sourceY: 0, sourceHeight: bottom.chunk.height, noOverlap: true });
    }

    const rawHeight = parts.reduce((sum, part) => sum + part.sourceHeight, 0);
    const outputScale = Math.min(1, 32760 / Math.max(1, rawHeight), 32760 / Math.max(1, width));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(width * outputScale));
    canvas.height = Math.max(1, Math.floor(rawHeight * outputScale));
    const ctx = canvas.getContext('2d');

    let y = 0;
    for (const part of parts) {
        const drawHeight = Math.round(part.sourceHeight * outputScale);
        const drawWidth = Math.round(part.chunk.width * outputScale);
        const drawX = Math.max(0, Math.round((canvas.width - drawWidth) / 2));
        ctx.drawImage(
            part.img,
            0,
            part.sourceY,
            part.chunk.width,
            part.sourceHeight,
            drawX,
            y,
            drawWidth,
            drawHeight,
        );
        y += drawHeight;
    }

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('无法生成 PNG 文件');
    downloadLongScreenshotBlob(blob, `ggg-longshot-${formatLongScreenshotDate(new Date())}.png`);
}

async function renderLongScreenshotChunk(chunk) {
    const img = await loadLongScreenshotImage(chunk.dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = chunk.width;
    canvas.height = chunk.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return { chunk, img, canvas, ctx };
}

function getLongScreenshotChunkSourceHeight(chunk, sourceY) {
    const pxPerCss = chunk.height / Math.max(1, chunk.cssHeight);
    const clipCssHeight = Math.min(chunk.cssHeight, chunk.clipCssHeight || chunk.cssHeight);
    const sourceYCss = sourceY / pxPerCss;
    const remainingCss = Math.max(1, clipCssHeight - sourceYCss);
    return Math.max(1, Math.min(chunk.height - sourceY, Math.round(remainingCss * pxPerCss)));
}

function detectLongScreenshotOverlap(prevPart, currentItem, fallbackY) {
    if (!prevPart || !currentItem || fallbackY <= 0) return fallbackY;

    const currentHeight = currentItem.chunk.height;
    const minY = Math.max(0, fallbackY);
    const maxY = Math.min(currentHeight - 1, fallbackY + 180);
    let bestY = fallbackY;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let candidateY = minY; candidateY <= maxY; candidateY += 4) {
        const overlap = candidateY;
        if (overlap < 24 || overlap > prevPart.sourceHeight - 4) continue;
        const score = scoreLongScreenshotOverlap(prevPart, currentItem, overlap);
        if (score < bestScore) {
            bestScore = score;
            bestY = candidateY;
        }
    }

    return bestScore < 42 ? bestY : fallbackY;
}

function scoreLongScreenshotOverlap(prevPart, currentItem, overlap) {
    const sampleCols = 18;
    const sampleRows = 24;
    const prevWidth = prevPart.chunk.width;
    const currWidth = currentItem.chunk.width;
    const width = Math.min(prevWidth, currWidth);
    const prevStartY = prevPart.sourceY + prevPart.sourceHeight - overlap;
    const rowStep = Math.max(1, Math.floor(overlap / sampleRows));
    const colStep = Math.max(1, Math.floor(width / sampleCols));
    let total = 0;
    let count = 0;

    for (let y = Math.floor(rowStep / 2); y < overlap; y += rowStep) {
        for (let x = Math.floor(colStep / 2); x < width; x += colStep) {
            const a = prevPart.ctx.getImageData(x, prevStartY + y, 1, 1).data;
            const b = currentItem.ctx.getImageData(x, y, 1, 1).data;
            total += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
            count++;
        }
    }

    return count ? total / (count * 3) : Number.POSITIVE_INFINITY;
}

function findLongScreenshotScrollTarget(chatOnly = true) {
    if (!chatOnly) {
        return document.scrollingElement || document.documentElement;
    }

    const selectors = ['#chat', '#chat .mes_block', '#sheld', 'main', '.chat'];
    for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (isLongScreenshotScrollable(node)) return node;
    }

    const all = [...document.querySelectorAll('body *')];
    const visibleScrollable = all
        .filter(isLongScreenshotScrollable)
        .sort((a, b) => (b.clientHeight * b.clientWidth) - (a.clientHeight * a.clientWidth));
    return visibleScrollable[0] || document.scrollingElement || document.documentElement;
}

function findLongScreenshotCropTarget(chatOnly = true) {
    if (!chatOnly) return document.scrollingElement || document.documentElement;
    const selectors = ['#chat', '#chat .mes_block', '#chat .mes', '.chat', '#sheld'];
    for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!(node instanceof Element)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width >= 120 && rect.height >= 120) return node;
    }
    return null;
}

function isLongScreenshotScrollable(node) {
    if (!node || !(node instanceof Element)) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 120) return false;
    const style = getComputedStyle(node);
    const overflowY = style.overflowY;
    return node.scrollHeight > node.clientHeight + 8 && ['auto', 'scroll', 'overlay'].includes(overflowY);
}

function getLongScreenshotCropRect(target) {
    const viewport = getLongScreenshotViewportSize();
    if (target && target !== document.scrollingElement && target !== document.documentElement && target !== document.body) {
        const rect = target.getBoundingClientRect();
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(viewport.width, rect.right);
        const bottom = Math.min(viewport.height, rect.bottom);
        if (right > left && bottom > top) {
            return { left, top, width: right - left, height: bottom - top };
        }
    }
    return { left: 0, top: 0, width: viewport.width, height: viewport.height };
}

function getLongScreenshotScrollTop(target) {
    if (target === document.scrollingElement || target === document.documentElement || target === document.body) {
        return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }
    return target.scrollTop || 0;
}

function setLongScreenshotScrollTop(target, value) {
    if (target === document.scrollingElement || target === document.documentElement || target === document.body) {
        window.scrollTo(window.scrollX, value);
        return;
    }
    target.scrollTop = value;
}

function restoreLongScreenshotStartPosition(state) {
    if (!state?.scrollTarget) return;
    setLongScreenshotScrollTop(state.scrollTarget, state.startScrollTop || 0);
}

function getLongScreenshotMaxScrollTop(target) {
    if (target === document.scrollingElement || target === document.documentElement || target === document.body) {
        const doc = document.scrollingElement || document.documentElement;
        return Math.max(0, doc.scrollHeight - getLongScreenshotViewportSize().height);
    }
    return Math.max(0, target.scrollHeight - target.clientHeight);
}

function getLongScreenshotViewportSize() {
    const vv = window.visualViewport;
    const width = Math.max(
        1,
        Math.round(vv?.width || document.documentElement.clientWidth || window.innerWidth || 1),
    );
    const height = Math.max(
        1,
        Math.round(vv?.height || document.documentElement.clientHeight || window.innerHeight || 1),
    );
    return { width, height };
}

function createLongScreenshotOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'ggg-longshot-float';
    overlay.innerHTML = `
        <div class="ggg-longshot-float-status">准备截图...</div>
        <button class="menu_button ggg-longshot-stop" type="button">
            <i class="ggg-fa fa-solid fa-check"></i> 结束并保存
        </button>
        <button class="menu_button ggg-longshot-float-cancel" type="button">
            <i class="ggg-fa fa-solid fa-xmark"></i> 取消
        </button>
    `;
    overlay.querySelector('.ggg-longshot-stop')?.addEventListener('click', () => {
        if (longScreenshotState) longScreenshotState.stopRequested = true;
        updateLongScreenshotOverlay('正在收尾...');
    });
    overlay.querySelector('.ggg-longshot-float-cancel')?.addEventListener('click', cancelLongScreenshot);
    document.body.appendChild(overlay);
    return overlay;
}

function createLongScreenshotMarker() {
    const marker = document.createElement('div');
    marker.className = 'ggg-longshot-marker';
    marker.innerHTML = '<div class="ggg-longshot-marker-label">已截到这里</div>';
    document.body.appendChild(marker);
    return marker;
}

function updateLongScreenshotMarker(state) {
    const marker = state?.marker;
    if (!marker || !state?.scrollTarget || !state?.cropRect) return;

    const currentTop = getLongScreenshotScrollTop(state.scrollTarget);
    const rect = getLongScreenshotCropRect(state.cropTarget || state.scrollTarget);
    const markerTop = rect.top + (state.capturedUntil - currentTop);
    const minTop = rect.top;
    const maxTop = rect.top + rect.height;

    marker.style.left = `${Math.max(0, rect.left)}px`;
    marker.style.width = `${Math.max(1, rect.width)}px`;
    marker.style.top = `${Math.min(maxTop, Math.max(minTop, markerTop))}px`;
    marker.style.display = markerTop >= minTop - 2 && markerTop <= maxTop + 2 ? 'block' : 'none';
}

function updateLongScreenshotOverlay(text) {
    const node = longScreenshotState?.overlay?.querySelector('.ggg-longshot-float-status');
    if (node) node.textContent = text;
}

function cancelLongScreenshot() {
    if (!longScreenshotState?.active) return;
    longScreenshotState.cancelRequested = true;
    longScreenshotState.stopRequested = true;
    setLongScreenshotStatus('正在取消长截图...', 'warn');
    updateLongScreenshotOverlay('正在取消...');
}

async function createLongScreenshotVideo(stream) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = () => reject(new Error('无法读取采集画面'));
    });
    await video.play();
    return video;
}

async function exitLongScreenshotFullscreenIfNeeded() {
    if (!_gggIsFullscreen()) return false;
    const ok = await _gggExitFullscreen();
    if (!ok) {
        console.warn('[ggg] exit fullscreen before long screenshot failed');
        return false;
    }
    await waitLongScreenshotFrame(700);
    return true;
}

function waitLongScreenshotUserReadyAfterFullscreen(state) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'ggg-longshot-ready';
        overlay.innerHTML = `
            <div class="ggg-longshot-ready-text">已退出全屏。请滚动到想开始截图的位置。</div>
            <button class="menu_button ggg-longshot-ready-start" type="button">
                <i class="ggg-fa fa-solid fa-play"></i> 开始采集
            </button>
            <button class="menu_button ggg-longshot-ready-cancel" type="button">
                <i class="ggg-fa fa-solid fa-xmark"></i> 取消
            </button>
        `;
        const done = cancelled => {
            if (cancelled) {
                state.cancelRequested = true;
                state.stopRequested = true;
            }
            overlay.remove();
            resolve();
        };
        overlay.querySelector('.ggg-longshot-ready-start')?.addEventListener('click', () => done(false));
        overlay.querySelector('.ggg-longshot-ready-cancel')?.addEventListener('click', () => done(true));
        document.body.appendChild(overlay);
    });
}

async function withLongScreenshotOverlayHidden(callback) {
    const overlay = longScreenshotState?.overlay;
    const marker = longScreenshotState?.marker;
    const previous = overlay?.style.visibility;
    const previousMarker = marker?.style.visibility;
    if (overlay) overlay.style.visibility = 'hidden';
    if (marker) marker.style.display = 'none';
    try {
        await waitLongScreenshotFrame(220);
        return await callback();
    } finally {
        if (overlay) overlay.style.visibility = previous || '';
        if (marker) {
            marker.style.visibility = previousMarker || '';
            updateLongScreenshotMarker(longScreenshotState);
        }
    }
}

function waitLongScreenshotFrame(ms = 0) {
    return new Promise(resolve => {
        requestAnimationFrame(() => {
            if (ms > 0) setTimeout(resolve, ms);
            else resolve();
        });
    });
}

async function waitLongScreenshotDelay(state, ms) {
    const endAt = Date.now() + ms;
    while (Date.now() < endAt) {
        if (state?.cancelRequested || state?.stopRequested) return;
        await waitLongScreenshotFrame(Math.min(100, endAt - Date.now()));
    }
}

async function animateLongScreenshotScroll(state, fromTop, toTop, duration = 700) {
    const start = performance.now();
    const distance = toTop - fromTop;
    while (true) {
        if (state?.cancelRequested || state?.stopRequested) return;
        const elapsed = performance.now() - start;
        const t = Math.min(1, elapsed / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        setLongScreenshotScrollTop(state.scrollTarget, fromTop + distance * eased);
        updateLongScreenshotMarker(state);
        if (t >= 1) break;
        await waitLongScreenshotFrame(0);
    }
    setLongScreenshotScrollTop(state.scrollTarget, toTop);
    updateLongScreenshotMarker(state);
    await waitLongScreenshotDelay(state, 450);
}

function loadLongScreenshotImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('无法载入截图分段'));
        img.src = src;
    });
}

function downloadLongScreenshotBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatLongScreenshotDate(date) {
    const pad = value => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        '-',
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
    ].join('');
}

function setLongScreenshotStatus(text, type = '') {
    const status = document.getElementById('ggg-longshot-status');
    if (status) {
        status.textContent = text;
        status.classList.toggle('warn', type === 'warn');
        status.classList.toggle('error', type === 'error');
    }
    setLongScreenshotRangeStatus(text, type);
}

function setLongScreenshotControls(active) {
    const start = document.getElementById('ggg-longshot-start');
    const cancel = document.getElementById('ggg-longshot-cancel');
    if (start) start.disabled = !!active;
    if (cancel) cancel.disabled = !active;
}

function syncLongScreenshotOptionState() {
    const chatOnly = document.getElementById('ggg-longshot-chat-only');
    const keepBars = document.getElementById('ggg-longshot-keep-bars');
    if (!chatOnly || !keepBars) return;
    chatOnly.checked = getLongScreenshotChatOnly();
    keepBars.checked = getLongScreenshotKeepBars();
    keepBars.disabled = !chatOnly.checked;
    keepBars.closest?.('.ggg-longshot-option')?.classList.toggle('disabled', !chatOnly.checked);
    const panel = document.getElementById('ggg-longshot-range-panel');
    const panelChatOnly = panel?.querySelector('[data-role="chat-only"]');
    const panelKeepBars = panel?.querySelector('[data-role="keep-bars"]');
    if (panelChatOnly) panelChatOnly.checked = chatOnly.checked;
    if (panelKeepBars) {
        panelKeepBars.checked = keepBars.checked;
        panelKeepBars.disabled = !chatOnly.checked;
        panelKeepBars.closest('.ggg-longshot-chip')?.classList.toggle('disabled', !chatOnly.checked);
    }
}

function getLongScreenshotChatOnly() {
    return localStorage.getItem(LONGSHOT_CHAT_ONLY_KEY) !== '0';
}

function getLongScreenshotKeepBars() {
    return localStorage.getItem(LONGSHOT_KEEP_BARS_KEY) !== '0';
}

function setLongScreenshotChatOnly(enabled) {
    localStorage.setItem(LONGSHOT_CHAT_ONLY_KEY, enabled ? '1' : '0');
}

function setLongScreenshotKeepBars(enabled) {
    localStorage.setItem(LONGSHOT_KEEP_BARS_KEY, enabled ? '1' : '0');
}

function cleanupLongScreenshotState(state) {
    document.documentElement.classList.remove('ggg-longshot-capturing');
    state?.overlay?.remove();
    state?.marker?.remove();
    state?.stream?.getTracks?.().forEach(track => track.stop());
    if (state?.video) state.video.srcObject = null;
    if (longScreenshotState === state) longScreenshotState = null;
    setLongScreenshotControls(false);
}

function exportItems(items, filename) {
    const data = {
        type: 'ggg-global-beautify',
        version: 1,
        items: items.map(cloneItem),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFileName(name) {
    return String(name || 'global-beautify')
        .trim()
        .replace(/[\\/:*?"<>|]+/g, '_')
        .slice(0, 60) || 'global-beautify';
}
