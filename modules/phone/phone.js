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
import { isFullscreen, enterFullscreen, exitFullscreen, enablePersistentFullscreen, disablePersistentFullscreen, markFullscreenRestoreNeeded } from './shell/browser-fullscreen.js';
import { setupOverlayGuard, teardownOverlayGuard } from './shell/overlay-guard.js';

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
    if (typeof p.fsFixDialog !== 'boolean') p.fsFixDialog = true;
    if (typeof p.fsFixInput !== 'boolean') p.fsFixInput = true;
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

    const fsFixDialogEl = document.getElementById('ggg-fs-fix-dialog');
    const fsFixInputEl = document.getElementById('ggg-fs-fix-input');
    if (fsFixDialogEl) {
        fsFixDialogEl.checked = !!settings.phone.fsFixDialog;
        fsFixDialogEl.addEventListener('change', () => {
            settings.phone.fsFixDialog = fsFixDialogEl.checked;
            saveAllSettings();
        });
    }
    if (fsFixInputEl) {
        fsFixInputEl.checked = !!settings.phone.fsFixInput;
        fsFixInputEl.addEventListener('change', () => {
            settings.phone.fsFixInput = fsFixInputEl.checked;
            saveAllSettings();
        });
    }
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
    } else {
        if (isPhoneShellOpen()) exitPhone();
    }

    setupDialogFullscreenWorkaround();
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

let _dialogFsCleanup = null;
function setupDialogFullscreenWorkaround() {
    if (_dialogFsCleanup) return;
    let closeObserver = null;
    let overlayWatchTimer = 0;
    let watchedOverlay = null;
    let exitedForDialog = false;
    let exitedForInput = false;
    let inputRestoreTimer = 0;
    let lastTextareaInteraction = { key: '', at: 0 };
    const TEXTAREA_LINK_TTL = 15_000;

    function isDialogOverlay(el) {
        return !!(el instanceof Element && el.matches?.('dialog[open], [role="dialog"]'));
    }

    function findDialogOverlay(el) {
        return el?.closest?.('dialog[open], [role="dialog"]') || null;
    }

    function isTextLikeInput(el) {
        if (!(el instanceof HTMLInputElement)) return false;
        const type = (el.type || 'text').toLowerCase();
        return ![
            'button',
            'checkbox',
            'color',
            'file',
            'hidden',
            'image',
            'radio',
            'range',
            'reset',
            'submit',
        ].includes(type);
    }

    function getTextareaLinkKey(el) {
        if (!(el instanceof HTMLTextAreaElement)) return '';
        const key = el.getAttribute('data-for') || el.id || el.name || '';
        return String(key).trim();
    }

    function rememberTextareaInteraction(el) {
        const key = getTextareaLinkKey(el);
        if (!key) return;
        lastTextareaInteraction = { key, at: Date.now() };
    }

    function hasRecentTextareaInteraction(key) {
        return !!key
            && lastTextareaInteraction.key === key
            && Date.now() - lastTextareaInteraction.at <= TEXTAREA_LINK_TTL;
    }

    function findMatchingDialogTextarea(dialog) {
        if (!(dialog instanceof Element)) return null;
        const textareas = dialog.querySelectorAll('textarea');
        for (const ta of textareas) {
            const key = getTextareaLinkKey(ta);
            if (hasRecentTextareaInteraction(key)) return ta;
        }
        return null;
    }

    function isOverlayClosed(overlay) {
        if (!overlay || !overlay.isConnected) return true;
        if (overlay.tagName === 'DIALOG' && !overlay.open) return true;
        const style = window.getComputedStyle?.(overlay);
        if (!style) return false;
        return style.display === 'none'
            || style.visibility === 'hidden'
            || Number(style.opacity || '1') <= 0.01;
    }

    async function restoreFullscreenFromDialog() {
        if (!exitedForDialog) return;
        exitedForDialog = false;
        watchedOverlay = null;
        if (overlayWatchTimer) {
            clearInterval(overlayWatchTimer);
            overlayWatchTimer = 0;
        }
        const ok = await enterFullscreen();
        if (!ok) markFullscreenRestoreNeeded();
    }

    function watchOverlayClose(overlay) {
        if (closeObserver) closeObserver.disconnect();
        if (overlayWatchTimer) clearInterval(overlayWatchTimer);
        watchedOverlay = overlay;
        closeObserver = new MutationObserver(async () => {
            if (isOverlayClosed(overlay) && exitedForDialog) {
                closeObserver.disconnect();
                closeObserver = null;
                await restoreFullscreenFromDialog();
            }
        });
        closeObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'hidden', 'open'],
        });
        overlayWatchTimer = setInterval(() => {
            if (watchedOverlay === overlay && isOverlayClosed(overlay) && exitedForDialog) {
                closeObserver?.disconnect();
                closeObserver = null;
                void restoreFullscreenFromDialog();
            }
        }, 200);
    }

    function exitForLinkedDialog(dialog) {
        if (!isFullscreen() || !settings.phone?.fsFixDialog || exitedForDialog) return false;
        if (!isDialogOverlay(dialog)) return false;
        const matchedTextarea = findMatchingDialogTextarea(dialog);
        if (!matchedTextarea) return false;
        if (exitedForInput) {
            clearTimeout(inputRestoreTimer);
            exitedForInput = false;
        }
        exitFullscreen();
        exitedForDialog = true;
        watchOverlayClose(dialog);
        return true;
    }

    const exitForDialogTextarea = (el) => {
        if (!isFullscreen() || !settings.phone?.fsFixDialog || exitedForDialog) return false;
        if (!el || el.tagName !== 'TEXTAREA') return false;
        rememberTextareaInteraction(el);
        const overlay = findDialogOverlay(el);
        if (!overlay || !isDialogOverlay(overlay)) return false;
        if (exitedForInput) {
            clearTimeout(inputRestoreTimer);
            exitedForInput = false;
        }
        exitFullscreen();
        exitedForDialog = true;
        watchOverlayClose(overlay);
        return true;
    };

    const onPointerDown = (e) => {
        if (e.target instanceof HTMLTextAreaElement) rememberTextareaInteraction(e.target);
        exitForDialogTextarea(e.target);
    };

    const onFocusIn = (e) => {
        const el = e.target;
        if (el instanceof HTMLTextAreaElement) rememberTextareaInteraction(el);
        if (exitForDialogTextarea(el)) {
            return;
        }

        if (!isFullscreen()) return;
        if (!settings.phone?.fsFixInput) return;
        if (!isTextLikeInput(el)) return;
        if (exitedForDialog || exitedForInput) return;
        clearTimeout(inputRestoreTimer);
        exitFullscreen();
        exitedForInput = true;
    };

    const onDialogMutated = (mutations) => {
        if (!isFullscreen() || !settings.phone?.fsFixDialog || exitedForDialog) return;
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (!(node instanceof Element)) continue;
                if (isDialogOverlay(node) && exitForLinkedDialog(node)) return;
                const nestedDialog = node.querySelector?.('dialog[open], [role="dialog"]');
                if (nestedDialog && exitForLinkedDialog(nestedDialog)) return;
            }
        }
    };

    const bodyObserver = new MutationObserver(onDialogMutated);
    bodyObserver.observe(document.body, { childList: true, subtree: true });

    const onFocusOut = (e) => {
        if (!exitedForInput) return;
        const el = e.target;
        if (!isTextLikeInput(el)) return;
        clearTimeout(inputRestoreTimer);
        inputRestoreTimer = setTimeout(async () => {
            if (!exitedForInput) return;
            exitedForInput = false;
            const ok = await enterFullscreen();
            if (!ok) markFullscreenRestoreNeeded();
        }, 300);
    };

    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    _dialogFsCleanup = () => {
        document.removeEventListener('focusin', onFocusIn, true);
        document.removeEventListener('focusout', onFocusOut, true);
        document.removeEventListener('pointerdown', onPointerDown, true);
        bodyObserver.disconnect();
        if (closeObserver) { closeObserver.disconnect(); closeObserver = null; }
        if (overlayWatchTimer) {
            clearInterval(overlayWatchTimer);
            overlayWatchTimer = 0;
        }
        watchedOverlay = null;
        clearTimeout(inputRestoreTimer);
        _dialogFsCleanup = null;
    };
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

let _wasFullscreenBeforePhone = false;

export async function enterPhone() {
    if (RELEASE_MODE) return;
    if (!settings.phone?.enabled) return;
    if (isPhoneShellOpen()) return;

    _wasFullscreenBeforePhone = isFullscreen();
    scanCustomPhoneTimeFromLatest({ force: true });

    mountPhoneShell();
    window.dispatchEvent(new CustomEvent('ggg-phone-open-changed', { detail: { open: true } }));
    setupOverlayGuard();

    // 移动端 + 设置启用 → 开启持久全屏
    if (settings.phone?.alwaysFullscreen && !isPcMode()) {
        await enablePersistentFullscreen();
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
    teardownOverlayGuard();
    disablePersistentFullscreen();
    unmountPhoneShell();
    window.dispatchEvent(new CustomEvent('ggg-phone-open-changed', { detail: { open: false } }));

    // 进入手机前酒馆不是全屏 → 退出手机时也退出全屏；否则保持全屏
    if (!_wasFullscreenBeforePhone && isFullscreen()) {
        const fn = document.exitFullscreen || document.webkitExitFullscreen;
        if (fn) try { await fn.call(document); } catch {}
    }
}

export function isPhoneOpen() {
    return isPhoneShellOpen();
}
