/**
 * GuaGua Gadgets - 主入口（不含手机模块的备份版本）
 *
 * 用途：手机模块还在开发中、暂时不想发布手机功能时，
 *      把本文件改名为 index.js 覆盖原文件即可发布"无手机"版插件。
 *
 * 与正式 index.js 的差异：
 *   - 不 import './modules/phone/phone.js'
 *   - 不 loadModuleCSS('modules/phone/phone.css')
 *   - 不 initPhone()
 *   - 不在 saveAllSettings 中持久化 phone 字段
 *   - tab 顺序里去掉 'phone'
 */
import { eventSource, event_types } from '../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';

import { initUICustom, onThemeChangedUICustom, injectOverrideStyle } from './modules/ui-custom/ui-custom.js';
import { initGallery, updateAvatarShape } from './modules/gallery/gallery.js';
import { initFont } from './modules/font/font.js';
import { initCustomCSS, injectCustomCSS, injectAllCustomHTML, onThemeChangedCustomCSS } from './modules/custom-css/custom-css.js';
import { initWorldInfoSheet } from './modules/world-info-sheet/world-info-sheet.js';

// ============================================================
// 常量 & 导出
// ============================================================
export const EXTENSION_NAME = 'third-party/GuaGua-Gadgets';
export const SETTINGS_KEY = 'ggg';

const FEATURE_TAB_MAP = { beautify: 'beautifyEnabled', tools: 'toolsEnabled' };
// 没有 phone tab
const TAB_ORIGINAL_ORDER = ['main', 'beautify', 'tools', 'achievement', 'gallery'];

export let settings = {
    enabled: true,
    beautifyEnabled: true,
    uiCustomEnabled: true,
    toolsEnabled: true,
    gallery: [],
    avatars: [],
    themeOverrides: {},
    fonts: { enabled: true, list: [] },
};

export let currentThemeName = '';

export function getSettings() { return settings; }
export function getCurrentThemeName() { return currentThemeName; }
export function setCurrentThemeName(name) { currentThemeName = name; }

export function getThemeName() {
    return SillyTavern.getContext().powerUserSettings?.theme || '未知';
}

export function getThemeData() {
    if (!settings.themeOverrides[currentThemeName]) {
        settings.themeOverrides[currentThemeName] = { overrides: {}, presets: {}, currentPreset: '' };
    }
    return settings.themeOverrides[currentThemeName];
}

export function saveAllSettings() {
    extension_settings[SETTINGS_KEY] = {
        enabled: settings.enabled,
        beautifyEnabled: settings.beautifyEnabled,
        uiCustomEnabled: settings.uiCustomEnabled,
        toolsEnabled: settings.toolsEnabled,
        gallery: settings.gallery,
        avatars: settings.avatars,
        themeOverrides: settings.themeOverrides,
        fonts: settings.fonts,
        wiSheet: settings.wiSheet,
        // 注意：保留 phone 字段透明读写，避免覆盖用户已有手机数据
        phone: settings.phone,
        _migrated: true,
    };
    SillyTavern.getContext().saveSettingsDebounced();
}

// ============================================================
// 初始化
// ============================================================
eventSource.on(event_types.APP_READY, async () => {
    try {
        const html = await renderExtensionTemplateAsync(EXTENSION_NAME, 'settings');
        const target = document.getElementById('qr_container');
        if (target) $(target).before(html);
        else $('#extensions_settings').append(html);

        loadModuleCSS('modules/ui-custom/ui-custom.css');
        loadModuleCSS('modules/gallery/gallery.css');
        loadModuleCSS('modules/font/font.css');
        loadModuleCSS('modules/custom-css/custom-css.css');
        loadModuleCSS('modules/world-info-sheet/world-info-sheet.css');
        // 不加载 phone.css

        loadSettings();
        initTabs();
        initMainPanel();
        initGuides();
        initCopyable();

        initUICustom();
        initGallery();
        initBeautifyNav();
        initFont();
        initCustomCSS();
        injectCustomCSS();
        injectAllCustomHTML();
        initWorldInfoSheet();
        // 不调用 initPhone()

        updateTabStates();
        updateUICustomVisibility();

        setTimeout(() => document.dispatchEvent(new CustomEvent('ggg-custom-css-saved')), 200);

        eventSource.on(event_types.SETTINGS_UPDATED, () => {
            updateAvatarShape();
            const newTheme = getThemeName();
            if (newTheme !== currentThemeName) {
                onThemeChangedUICustom(newTheme);
                onThemeChangedCustomCSS();
            }
        });

        // 隐藏设置页里"手机"那个 tab（如果 settings.html 里仍写着）
        const phoneTab = document.querySelector('#ggg-tabs .ggg-tab[data-tab="phone"]');
        if (phoneTab) phoneTab.style.display = 'none';
        const phonePanel = document.getElementById('ggg-panel-phone');
        if (phonePanel) phonePanel.style.display = 'none';

        console.log('[ggg] 呱呱小工具已加载（无手机模块版）');
    } catch (err) {
        console.error('[ggg] 加载失败:', err);
    }
});

// ============================================================
// 加载模块CSS
// ============================================================
function loadModuleCSS(path) {
    const fullPath = `/scripts/extensions/${EXTENSION_NAME}/${path}`;
    if (document.querySelector(`link[href="${fullPath}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = fullPath;
    document.head.appendChild(link);
}

// ============================================================
// 设置
// ============================================================
function loadSettings() {
    if (!extension_settings[SETTINGS_KEY]) extension_settings[SETTINGS_KEY] = {};
    const saved = extension_settings[SETTINGS_KEY];

    settings.enabled = saved.enabled !== false;
    settings.beautifyEnabled = saved.beautifyEnabled !== false;
    settings.uiCustomEnabled = saved.uiCustomEnabled !== false;
    settings.toolsEnabled = saved.toolsEnabled !== false;
    settings.gallery = saved.gallery || [];
    settings.avatars = saved.avatars || [];
    settings.themeOverrides = saved.themeOverrides || {};
    settings.fonts = saved.fonts || { enabled: true, list: [] };
    settings.wiSheet = saved.wiSheet || { enabled: false, pcMode: false };
    // 保留旧的 phone 数据但不主动初始化
    if (saved.phone) settings.phone = saved.phone;

    if (saved.overrides && Object.keys(saved.overrides).length > 0 && !saved._migrated) {
        const theme = getThemeName();
        if (!settings.themeOverrides[theme]) {
            settings.themeOverrides[theme] = { overrides: {}, presets: {}, currentPreset: '' };
        }
        settings.themeOverrides[theme].overrides = saved.overrides;
        if (saved.presets) settings.themeOverrides[theme].presets = saved.presets;
        if (saved.currentPreset) settings.themeOverrides[theme].currentPreset = saved.currentPreset;
        saved._migrated = true;
    }

    currentThemeName = getThemeName();
    syncToggleUI();
}

function syncToggleUI() {
    const master   = document.getElementById('ggg-master-toggle');
    const beautify = document.getElementById('ggg-toggle-beautify');
    const tools    = document.getElementById('ggg-toggle-tools');
    const uiCustom = document.getElementById('ggg-toggle-ui-custom');
    if (master)   master.checked   = settings.enabled;
    if (beautify) beautify.checked = settings.beautifyEnabled;
    if (tools)    tools.checked    = settings.toolsEnabled;
    if (uiCustom) uiCustom.checked = settings.uiCustomEnabled;

    const featureSection = document.getElementById('ggg-feature-toggles-section');
    if (featureSection) featureSection.style.display = settings.enabled ? '' : 'none';
}

// ============================================================
// Tab
// ============================================================
export function updateTabStates() {
    const tabContainer = document.getElementById('ggg-tabs');
    if (!tabContainer) return;

    tabContainer.querySelectorAll('.ggg-tab').forEach(tab => {
        const tabName = tab.dataset.tab;
        if (tabName === 'main') return;
        if (tabName === 'phone') { tab.classList.add('disabled'); return; }
        if (!settings.enabled) {
            tab.classList.add('disabled');
        } else {
            const featureKey = FEATURE_TAB_MAP[tabName];
            if (featureKey && !settings[featureKey]) tab.classList.add('disabled');
            else tab.classList.remove('disabled');
        }
    });

    const allTabs = [...tabContainer.querySelectorAll('.ggg-tab')]
        .filter(t => t.dataset.tab !== 'phone');
    const enabled = allTabs.filter(t => !t.classList.contains('disabled'))
        .sort((a, b) => TAB_ORIGINAL_ORDER.indexOf(a.dataset.tab) - TAB_ORIGINAL_ORDER.indexOf(b.dataset.tab));
    const disabled = allTabs.filter(t => t.classList.contains('disabled'))
        .sort((a, b) => TAB_ORIGINAL_ORDER.indexOf(a.dataset.tab) - TAB_ORIGINAL_ORDER.indexOf(b.dataset.tab));
    [...enabled, ...disabled].forEach(t => tabContainer.appendChild(t));

    const activeTab = tabContainer.querySelector('.ggg-tab.active');
    if (activeTab?.classList.contains('disabled')) {
        tabContainer.querySelectorAll('.ggg-tab').forEach(t => t.classList.remove('active'));
        tabContainer.querySelector('[data-tab="main"]')?.classList.add('active');
        document.querySelectorAll('#ggg-settings .ggg-panel').forEach(p => p.classList.remove('active'));
        document.getElementById('ggg-panel-main')?.classList.add('active');
    }
}

export function updateUICustomVisibility() {
    const panel = document.getElementById('ggg-ui-custom-panel');
    if (panel) {
        const shouldShow = settings.enabled && settings.beautifyEnabled && settings.uiCustomEnabled;
        panel.style.display = shouldShow ? '' : 'none';
    }
}

function initTabs() {
    document.querySelectorAll('#ggg-settings .ggg-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.classList.contains('disabled')) return;
            document.querySelectorAll('#ggg-settings .ggg-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('#ggg-settings .ggg-panel').forEach(p => p.classList.remove('active'));
            document.getElementById(`ggg-panel-${tab.dataset.tab}`)?.classList.add('active');
        });
    });
}

// ============================================================
// 美化面板导航栏
// ============================================================
function initBeautifyNav() {
    document.querySelectorAll('.ggg-beautify-nav-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.ggg-beautify-nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            document.querySelectorAll('.ggg-beautify-subpanel').forEach(p => p.classList.remove('active'));
            document.getElementById(`ggg-bpanel-${item.dataset.btab}`)?.classList.add('active');
        });
    });
}

// ============================================================
// 主面板
// ============================================================
function initMainPanel() {
    document.getElementById('ggg-master-toggle')?.addEventListener('change', (e) => {
        settings.enabled = e.target.checked;
        syncToggleUI();
        updateTabStates();
        updateUICustomVisibility();
        injectOverrideStyle();
        saveAllSettings();
    });

    document.getElementById('ggg-toggle-beautify')?.addEventListener('change', (e) => {
        settings.beautifyEnabled = e.target.checked;
        updateTabStates();
        updateUICustomVisibility();
        injectOverrideStyle();
        saveAllSettings();
    });

    document.getElementById('ggg-toggle-tools')?.addEventListener('change', (e) => {
        settings.toolsEnabled = e.target.checked;
        updateTabStates();
        saveAllSettings();
    });

    document.getElementById('ggg-toggle-ui-custom')?.addEventListener('change', (e) => {
        settings.uiCustomEnabled = e.target.checked;
        updateUICustomVisibility();
        saveAllSettings();
    });
}

// ============================================================
// 使用说明 & 复制
// ============================================================
function initGuides() {
    document.querySelectorAll('.ggg-guide-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => {
            const key = toggle.dataset.guide;
            const content = document.querySelector(`.ggg-guide-content[data-guide-content="${key}"]`);
            if (!content) return;
            toggle.classList.toggle('open');
            content.classList.toggle('open');
        });
    });
}

function initCopyable() {
    document.addEventListener('click', (e) => {
        const target = e.target.closest('.ggg-copyable');
        if (!target) return;
        e.stopPropagation();
        const text = target.dataset.copy || target.textContent.trim();
        navigator.clipboard.writeText(text).then(() => showCopiedFeedback(target)).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            showCopiedFeedback(target);
        });
    });
}

function showCopiedFeedback(iconEl) {
    iconEl.classList.add('copied');
    iconEl.classList.remove('fa-copy');
    iconEl.classList.add('fa-check');
    setTimeout(() => {
        iconEl.classList.remove('fa-check', 'copied');
        iconEl.classList.add('fa-copy');
    }, 1200);
}
