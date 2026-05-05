/**
 * 呱呱手机 —— 主入口
 * 负责：
 *   - 读取 / 持久化设置（启用、始终全屏、顶掉手机系统状态栏、主题、背景）
 *   - 进入/退出全屏壳，按需加载 Vue 并挂载手机 App
 *   - 管理状态栏、背景、主题
 *
 * 详细规划见同目录下 ../../PHONE_PLAN.md
 */
import { settings, saveAllSettings } from '../../index.js';
import { loadVue } from './core/vue-loader.js';
import { mountPhoneShell, unmountPhoneShell, isPhoneShellOpen, isPcMode } from './shell/fullscreen.js';
import { mountStatusBar, unmountStatusBar } from './shell/status-bar.js';
import { ensureDefaultBg, applyBgToShell } from './core/background.js';
import { applyTheme, setTheme } from './core/theme.js';
import { createPhoneRoot } from './core/root.js';
import { syncBridgedMessages } from './apps/pp/messages.js';
import { mountPPPreviewNotifier, unmountPPPreviewNotifier } from './core/pp-notifier.js';
import { RELEASE_MODE } from './release-flag.js';
import {
    ensurePhoneTimeSettings,
    registerPhoneTimeMacro,
    savePhoneTimeSettings,
    scanCustomPhoneTimeFromLatest,
    setPhoneTimeMode,
} from './core/phone-time.js';

let vueApp = null;
let _phoneInitialized = false;

const THEMES = ['dark', 'light'];

export function initPhone() {
    if (_phoneInitialized) {
        applyEnabledState();
        return;
    }
    _phoneInitialized = true;
    if (!settings.phone) settings.phone = {};
    const p = settings.phone;
    let migrated = false;
    if (typeof p.enabled !== 'boolean') p.enabled = false;
    if (typeof p.hideMobileStatusBar !== 'boolean') p.hideMobileStatusBar = false;
    if (typeof p.alwaysFullscreen !== 'boolean') p.alwaysFullscreen = true;
    if (!THEMES.includes(p.theme)) p.theme = 'dark';
    if (typeof p.backgroundUrl !== 'string') p.backgroundUrl = '';
    if (RELEASE_MODE) p.enabled = false;
    ensurePhoneTimeSettings();
    registerPhoneTimeMacro();

    bindSettingUI();
    if (migrated) saveAllSettings();
    applyEnabledState();

    // v0.2.43：暴露给 PC 悬浮手机的关闭按钮（让它能走完整的 exitPhone 流程）
    window.__ggg_phone_exit = exitPhone;
    window.__ggg_phone_enter = enterPhone;
}

function bindSettingUI() {
    const enableEl = document.getElementById('ggg-phone-enable');
    const hideStatusEl = document.getElementById('ggg-phone-hide-mobile-status');
    const fullscreenEl = document.getElementById('ggg-phone-always-fullscreen');
    const themeEl = document.getElementById('ggg-phone-theme');
    const timeModeEl = document.getElementById('ggg-phone-time-mode');
    const timePatternEl = document.getElementById('ggg-phone-time-pattern');
    const timeDateGroupEl = document.getElementById('ggg-phone-time-date-group');
    const timeClockGroupEl = document.getElementById('ggg-phone-time-clock-group');
    const timeWeekGroupEl = document.getElementById('ggg-phone-time-week-group');
    const timeWeatherGroupEl = document.getElementById('ggg-phone-time-weather-group');
    const timeScanBtn = document.getElementById('ggg-phone-time-scan');
    const timeScanStatusEl = document.getElementById('ggg-phone-time-scan-status');

    if (enableEl) {
        enableEl.checked = !!settings.phone.enabled;
        enableEl.addEventListener('change', () => {
            settings.phone.enabled = enableEl.checked;
            saveAllSettings();
            applyEnabledState();
            window.dispatchEvent(new CustomEvent('ggg-floating-ball-config-changed'));
        });
    }
    if (hideStatusEl) {
        hideStatusEl.checked = !!settings.phone.hideMobileStatusBar;
        hideStatusEl.addEventListener('change', () => {
            settings.phone.hideMobileStatusBar = hideStatusEl.checked;
            saveAllSettings();
            applyMobileStatusBarPolicy();
        });
    }
    if (fullscreenEl) {
        fullscreenEl.checked = !!settings.phone.alwaysFullscreen;
        fullscreenEl.addEventListener('change', () => {
            settings.phone.alwaysFullscreen = fullscreenEl.checked;
            saveAllSettings();
        });
    }
    if (themeEl) {
        themeEl.value = settings.phone.theme;
        themeEl.addEventListener('change', () => setTheme(themeEl.value));
    }

    const syncTimeFields = () => {
        const t = ensurePhoneTimeSettings();
        if (timeModeEl) timeModeEl.value = t.mode;
        if (timePatternEl) timePatternEl.value = t.pattern || '';
        if (timeDateGroupEl) timeDateGroupEl.value = t.dateGroup || '';
        if (timeClockGroupEl) timeClockGroupEl.value = t.timeGroup || '';
        if (timeWeekGroupEl) timeWeekGroupEl.value = t.weekGroup || '';
        if (timeWeatherGroupEl) timeWeatherGroupEl.value = t.weatherGroup || '';
    };
    const saveTimeFields = () => {
        savePhoneTimeSettings({
            mode: timeModeEl?.value === 'custom' ? 'custom' : 'local',
            pattern: timePatternEl?.value || '',
            dateGroup: timeDateGroupEl?.value || '',
            timeGroup: timeClockGroupEl?.value || '',
            weekGroup: timeWeekGroupEl?.value || '',
            weatherGroup: timeWeatherGroupEl?.value || '',
        });
    };
    const runTimeScan = () => {
        const hit = scanCustomPhoneTimeFromLatest({ force: true });
        if (timeScanStatusEl) {
            timeScanStatusEl.textContent = hit
                ? `已匹配第 ${hit.floor + 1} 楼：${new Date(hit.baseMs).toLocaleString()}`
                : '未匹配到可解析时间';
        }
    };
    syncTimeFields();
    if (timeModeEl) timeModeEl.addEventListener('change', () => {
        setPhoneTimeMode(timeModeEl.value === 'custom' ? 'custom' : 'local');
        syncTimeFields();
        if (timeModeEl.value === 'custom') runTimeScan();
    });
    [timePatternEl, timeDateGroupEl, timeClockGroupEl, timeWeekGroupEl, timeWeatherGroupEl]
        .filter(Boolean)
        .forEach(el => el.addEventListener('change', () => {
            saveTimeFields();
            if (timeModeEl?.value === 'custom') runTimeScan();
        }));
    if (timeScanBtn) timeScanBtn.addEventListener('click', runTimeScan);
}
function applyEnabledState() {
    unmountPPPreviewNotifier();
    // 不论开/关，先停掉 TopInfoBar 修正循环、清掉之前的 transform；
    //   下面再按 mode 决定要不要重启
    if (window.__ggg_topbar_fix_interval) {
        clearInterval(window.__ggg_topbar_fix_interval);
        window.__ggg_topbar_fix_interval = null;
    }
    document.querySelectorAll('#extensionTopBar, .extension-top-bar, #top-info-bar, .top-info-bar')
        .forEach(el => { el.style.removeProperty('transform'); });

    if (settings.phone?.enabled) {
        mountPPPreviewNotifier({ onOpenPPChat: openPPChatFromPreview });
        applyMobileStatusBarPolicy();
        // v0.2.30：彻底取消把 TopInfoBar 推 36px 的做法——
        //   旧实现导致 PC 端 TopInfoBar 与 #top-bar 之间留 36px 空隙，
        //   且因为 transform 残留还会和 topbar 产生层叠/遮挡问题。
        //   现在让 TopInfoBar 走酒馆默认布局（紧贴 #top-bar 之下），
        // v0.2.42：启动全屏键盘补偿
        setupFullscreenKeyboardFix();
    } else {
        if (isPhoneShellOpen()) exitPhone();
        teardownFullscreenKeyboardFix();
    }
}

function openPPChatFromPreview(target) {
    const route = { app: 'pp', ppChat: target || null, ts: Date.now() };
    window.__ggg_phone_pending_route = route;
    if (isPhoneShellOpen() && typeof window.__ggg_phone_open_pp_chat === 'function') {
        window.__ggg_phone_open_pp_chat(route.ppChat);
        return;
    }
    enterPhone();
}

function applyMobileStatusBarPolicy() {
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
        vp = document.createElement('meta');
        vp.name = 'viewport';
        document.head.appendChild(vp);
    }
    // v0.2.42 关键修正：加上 interactive-widget=resizes-content
    // 让软键盘弹出时 Chromium 直接缩 layout viewport 高度，
    // 所有 position:fixed 元素跟着缩，不会被"视觉上顶出屏幕"。
    const base = 'width=device-width, initial-scale=1, interactive-widget=resizes-content';
    vp.content = settings.phone?.hideMobileStatusBar
        ? `${base}, viewport-fit=cover`
        : base;
}

/* ============================================================
 * v0.2.42：浏览器全屏（三击）下的键盘补偿
 * 全屏时 interactive-widget 可能失效，layout viewport 不缩，
 * 主动监听 visualViewport，把 #sheld 高度压成 vv.height，
 * 这样 #form_sheld 会自动浮到键盘上方。
 * ============================================================ */
let _vvHandler = null;
const KB_STYLE_ID = 'ggg-fullscreen-kb-style';
const EXTERNAL_OVERLAY_CLASS = 'ggg-phone-external-overlay-open';
const EXTERNAL_OVERLAY_SELECTORS = [
    '#shadow_popup',
    '#dialogue_popup',
    '.dialogue_popup',
    '.popup',
    '.popup-container',
    '.popup_container',
    '.modal',
    '.drawer',
    '.drawer-content',
    '.drawer-content-open',
    '.textarea_companion',
    '.expanded_textarea',
    'textarea.expanded_textarea',
    'body > textarea',
];
const INTERNAL_OVERLAY_SELECTORS = [
    '#ggg-phone-shell',
    '#ggg-floating-ball',
    '#ggg-floating-ball-panel',
    '.ggg-wi-overlay',
    '.ggg-wi-sheet',
    '.ggg-ss-overlay',
    '.ggg-ss-sheet',
    '#ggg-longshot-range-panel',
];

let _externalOverlayObserver = null;
let _externalOverlayRefresh = null;

function _isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
}
function _kbApply(kbH) {
    let s = document.getElementById(KB_STYLE_ID);
    if (!s) {
        s = document.createElement('style');
        s.id = KB_STYLE_ID;
        document.head.appendChild(s);
    }
    s.textContent = kbH > 50
        ? `#sheld { bottom: ${kbH}px !important; transition: bottom .15s ease; }
           #form_sheld { bottom: ${kbH}px !important; transition: bottom .15s ease; }`
        : '';
}
function _kbCheck() {
    if (!_isFullscreen()) { _kbApply(0); return; }
    const vv = window.visualViewport;
    if (!vv) return;
    const kb = Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0));
    _kbApply(kb);
}
function setupFullscreenKeyboardFix() {
    if (_vvHandler || !window.visualViewport) return;
    _vvHandler = () => _kbCheck();
    window.visualViewport.addEventListener('resize', _vvHandler);
    window.visualViewport.addEventListener('scroll', _vvHandler);
    document.addEventListener('fullscreenchange', _vvHandler);
    document.addEventListener('webkitfullscreenchange', _vvHandler);
}
function teardownFullscreenKeyboardFix() {
    if (_vvHandler && window.visualViewport) {
        window.visualViewport.removeEventListener('resize', _vvHandler);
        window.visualViewport.removeEventListener('scroll', _vvHandler);
    }
    document.removeEventListener('fullscreenchange', _vvHandler);
    document.removeEventListener('webkitfullscreenchange', _vvHandler);
    _vvHandler = null;
    document.getElementById(KB_STYLE_ID)?.remove();
}

function isInternalOverlay(el) {
    return INTERNAL_OVERLAY_SELECTORS.some(sel => el.matches?.(sel) || el.closest?.(sel));
}

// 酒馆/插件弹层的 class/id 不完全稳定，除固定选择器外再用命名特征兜住 textarea 弹窗等变体。
function hasOverlayLikeName(el) {
    const text = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`.toLowerCase();
    return /popup|dialog|modal|drawer|textarea_companion|expanded_textarea/.test(text);
}

// 外部弹层检测不能只查固定选择器：部分 textarea 展开层会换 class 或嵌套在 body 子节点里。
// 同时排除呱呱自己的手机壳、底部 sheet、悬浮球，避免误把内部控件当成外部弹窗。
function collectExternalOverlayCandidates() {
    const set = new Set();
    EXTERNAL_OVERLAY_SELECTORS.forEach(sel => {
        try { document.querySelectorAll(sel).forEach(el => set.add(el)); } catch {}
    });
    document.querySelectorAll('body > *, body > * *').forEach(el => {
        if (!(el instanceof Element)) return;
        if (isInternalOverlay(el)) return;
        if (el.matches?.('dialog, [role="dialog"], [aria-modal="true"]') || hasOverlayLikeName(el)) {
            set.add(el);
        }
    });
    return Array.from(set);
}

// 只要发现可见的酒馆弹层，就让手机壳/悬浮球让出点击层；全屏状态本身不改变。
function isVisibleExternalOverlay(el) {
    if (!el || !(el instanceof Element)) return false;
    const shell = document.getElementById('ggg-phone-shell');
    if (shell && shell.contains(el)) return false;
    if (isInternalOverlay(el)) return false;
    const style = window.getComputedStyle?.(el);
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number(style.opacity || '1') <= 0.01) return false;
    const rect = el.getBoundingClientRect?.();
    if (!rect || rect.width < 1 || rect.height < 1) return false;

    const isExplicitPopup = ['shadow_popup', 'dialogue_popup'].includes(el.id)
        || el.matches?.('body > .popup, body > .popup-container, body > .popup_container, body > .popup_wrapper, body > .popup-wrapper, body > .dialogue_popup, body > .drawer, body > .drawer-content, body > .textarea_companion, body > .expanded_textarea, body > textarea, body > textarea.expanded_textarea, .textarea_companion, .expanded_textarea, textarea.expanded_textarea');
    if (isExplicitPopup) return true;

    const zIndex = Number.parseInt(style.zIndex, 10);
    const hasOverlayLayer = Number.isFinite(zIndex) && zIndex >= 1000;
    const isOverlayPosition = ['fixed', 'absolute', 'sticky'].includes(style.position);
    return (hasOverlayLayer && isOverlayPosition) || (hasOverlayLikeName(el) && isOverlayPosition);
}

function refreshExternalOverlayState() {
    const html = document.documentElement;
    if (!html.classList.contains('ggg-phone-open')) {
        html.classList.remove(EXTERNAL_OVERLAY_CLASS);
        return;
    }
    const hasOverlay = collectExternalOverlayCandidates().some(isVisibleExternalOverlay);
    html.classList.toggle(EXTERNAL_OVERLAY_CLASS, hasOverlay);
}

function setupExternalOverlayGuard() {
    teardownExternalOverlayGuard();
    _externalOverlayRefresh = () => {
        try { refreshExternalOverlayState(); } catch {}
        // 有些弹层先插 DOM、下一帧才写入尺寸/层级，延迟复查能避免首轮漏判。
        requestAnimationFrame(() => {
            try { refreshExternalOverlayState(); } catch {}
        });
        setTimeout(() => {
            try { refreshExternalOverlayState(); } catch {}
        }, 120);
    };
    _externalOverlayObserver = new MutationObserver(_externalOverlayRefresh);
    _externalOverlayObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'open'],
    });
    document.addEventListener('focusin', _externalOverlayRefresh, true);
    window.addEventListener('resize', _externalOverlayRefresh, { passive: true });
    window.visualViewport?.addEventListener('resize', _externalOverlayRefresh, { passive: true });
    window.visualViewport?.addEventListener('scroll', _externalOverlayRefresh, { passive: true });
    _externalOverlayRefresh();
}

function teardownExternalOverlayGuard() {
    _externalOverlayObserver?.disconnect();
    _externalOverlayObserver = null;
    if (_externalOverlayRefresh) {
        document.removeEventListener('focusin', _externalOverlayRefresh, true);
        window.removeEventListener('resize', _externalOverlayRefresh);
        window.visualViewport?.removeEventListener('resize', _externalOverlayRefresh);
        window.visualViewport?.removeEventListener('scroll', _externalOverlayRefresh);
    }
    _externalOverlayRefresh = null;
    document.documentElement.classList.remove(EXTERNAL_OVERLAY_CLASS);
}

// v0.2.17：记录进入手机前酒馆是否已是浏览器全屏，决定退出时要不要解除全屏
let _wasFullscreenBefore = false;
let _restoreFullscreenOnGesture = false;

function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement
        || document.mozFullScreenElement || document.msFullscreenElement || null;
}

function requestPhoneBrowserFullscreen() {
    const docEl = document.documentElement;
    const req = docEl.requestFullscreen || docEl.webkitRequestFullscreen
        || docEl.mozRequestFullScreen || docEl.msRequestFullscreen;
    if (!req || getFullscreenElement()) return Promise.resolve();
    try {
        const ret = req.call(docEl);
        return ret?.catch ? ret.catch(() => {}) : Promise.resolve();
    } catch (e) {
        return Promise.resolve();
    }
}

function shouldKeepPhoneFullscreen() {
    return isPhoneShellOpen()
        && settings.phone?.alwaysFullscreen
        && !isPcMode();
}

function markFullscreenRestoreNeeded() {
    if (!shouldKeepPhoneFullscreen()) {
        _restoreFullscreenOnGesture = false;
        return;
    }
    if (!getFullscreenElement()) _restoreFullscreenOnGesture = true;
}

async function restoreFullscreenFromGesture() {
    if (_externalOverlayRefresh) _externalOverlayRefresh();
    if (!_restoreFullscreenOnGesture || !shouldKeepPhoneFullscreen() || getFullscreenElement()) return;
    _restoreFullscreenOnGesture = false;
    await requestPhoneBrowserFullscreen();
}

['pointerdown', 'touchstart', 'keydown'].forEach(evt => {
    document.addEventListener(evt, restoreFullscreenFromGesture, true);
});
document.addEventListener('fullscreenchange', markFullscreenRestoreNeeded);
document.addEventListener('webkitfullscreenchange', markFullscreenRestoreNeeded);

export async function enterPhone() {
    if (RELEASE_MODE) return;
    if (!settings.phone?.enabled) return;
    if (isPhoneShellOpen()) return;

    _wasFullscreenBefore = !!getFullscreenElement();
    scanCustomPhoneTimeFromLatest({ force: true });

    mountPhoneShell();
    window.dispatchEvent(new CustomEvent('ggg-phone-open-changed', { detail: { open: true } }));
    setupExternalOverlayGuard();

    // 先挂壳，再异步请求全屏，避免某些浏览器/移动端模拟把进入流程卡住。
    if (settings.phone?.alwaysFullscreen && !isPcMode()) {
        requestPhoneBrowserFullscreen().catch?.(() => {});
    }

    // 状态栏 + 主题 + 背景
    mountStatusBar();
    applyTheme();
    applyBgToShell();
    ensureDefaultBg(); // 异步：若没自定义背景就用酒馆第一张

    try {
        const Vue = await loadVue();
        const Root = createPhoneRoot(Vue);
        vueApp = Vue.createApp(Root);
        vueApp.mount('#ggg-phone-app-mount');
    } catch (err) {
        const mount = document.getElementById('ggg-phone-app-mount');
        if (mount) {
            mount.innerHTML = `
                <div style="padding:24px;color:#fff;text-align:center">
                    Vue 加载失败<br>
                    <small style="opacity:.7">${err?.message || err}</small>
                </div>`;
        }
    }
}

async function flushPPBridgeToTavern() {
    try {
        await syncBridgedMessages();
        const ctx = (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null;
        if (typeof ctx?.saveChat === 'function') await ctx.saveChat();
        if (typeof ctx?.reloadCurrentChat === 'function') await ctx.reloadCurrentChat();
        else if (typeof window.reloadAndRenderChatWithoutEvents === 'function') await window.reloadAndRenderChatWithoutEvents();
    } catch (e) {
        console.warn('[ggg-phone] 退出手机同步 PP 桥接失败', e);
    }
}

export async function exitPhone() {
    if (!isPhoneShellOpen()) return;
    await flushPPBridgeToTavern();
    if (vueApp) {
        try { vueApp.unmount(); } catch (e) {}
        vueApp = null;
    }
    unmountStatusBar();
    teardownExternalOverlayGuard();
    unmountPhoneShell();
    window.dispatchEvent(new CustomEvent('ggg-phone-open-changed', { detail: { open: false } }));

    // v0.2.17：只有进入手机前酒馆"不是"全屏时，退出手机才解除全屏；
    //   如果用户进入手机前就在全屏看酒馆，退出时保持全屏
    if (!_wasFullscreenBefore) {
        try {
            const exit = document.exitFullscreen || document.webkitExitFullscreen
                || document.mozCancelFullScreen || document.msExitFullscreen;
            if (exit && getFullscreenElement()) {
                exit.call(document).catch(() => {});
            }
        } catch (e) {}
    }
}

export function isPhoneOpen() {
    return isPhoneShellOpen();
}
