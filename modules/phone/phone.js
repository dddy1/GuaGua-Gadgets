/**
 * 呱呱手机 —— 主入口
 * 负责：
 *   - 读取 / 持久化设置（启用、入口模式、始终全屏、顶掉手机系统状态栏、主题、背景）
 *   - 按入口模式挂载对应入口（灵动岛 / PC 悬浮窗 / 移动悬浮球）
 *   - 进入/退出全屏壳，按需加载 Vue 并挂载手机 App
 *   - 管理状态栏、背景、主题
 *
 * 详细规划见同目录下 ../../PHONE_PLAN.md
 */
import { settings, saveAllSettings } from '../../index.js';
import { loadVue } from './core/vue-loader.js';
import { mountDynamicIsland, unmountDynamicIsland, setIslandPhoneOpen } from './shell/dynamic-island.js';
import { mountPcFloater, unmountPcFloater, setPcFloaterPhoneOpen } from './shell/pc-floater.js';
import { mountMobileBall, unmountMobileBall, setMobileBallPhoneOpen } from './shell/mobile-ball.js';
import { mountPhoneShell, unmountPhoneShell, isPhoneShellOpen } from './shell/fullscreen.js';
import { mountStatusBar, unmountStatusBar } from './shell/status-bar.js';
import { ensureDefaultBg, applyBgToShell } from './core/background.js';
import { applyTheme, setTheme } from './core/theme.js';
import { createPhoneRoot } from './core/root.js';

let vueApp = null;

const ENTRY_MODES = ['island', 'pc-floater', 'mobile-ball'];
const THEMES = ['dark', 'light'];

export function initPhone() {
    if (!settings.phone) settings.phone = {};
    const p = settings.phone;
    if (typeof p.enabled !== 'boolean') p.enabled = false;
    if (typeof p.hideMobileStatusBar !== 'boolean') p.hideMobileStatusBar = false;
    if (!ENTRY_MODES.includes(p.entryMode)) p.entryMode = 'island';
    if (typeof p.alwaysFullscreen !== 'boolean') p.alwaysFullscreen = true;
    if (!THEMES.includes(p.theme)) p.theme = 'dark';
    if (typeof p.backgroundUrl !== 'string') p.backgroundUrl = '';

    bindSettingUI();
    applyEnabledState();
}

function bindSettingUI() {
    const enableEl = document.getElementById('ggg-phone-enable');
    const hideStatusEl = document.getElementById('ggg-phone-hide-mobile-status');
    const entryModeEl = document.getElementById('ggg-phone-entry-mode');
    const fullscreenEl = document.getElementById('ggg-phone-always-fullscreen');
    const themeEl = document.getElementById('ggg-phone-theme');

    if (enableEl) {
        enableEl.checked = !!settings.phone.enabled;
        enableEl.addEventListener('change', () => {
            settings.phone.enabled = enableEl.checked;
            saveAllSettings();
            applyEnabledState();
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
    if (entryModeEl) {
        entryModeEl.value = settings.phone.entryMode;
        entryModeEl.addEventListener('change', () => {
            const v = entryModeEl.value;
            if (!ENTRY_MODES.includes(v)) return;
            settings.phone.entryMode = v;
            saveAllSettings();
            applyEnabledState();
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
}

function unmountAllEntries() {
    unmountDynamicIsland();
    unmountPcFloater();
    unmountMobileBall();
}
function mountCurrentEntry() {
    const handlers = { onEnter: enterPhone, onExit: exitPhone };
    switch (settings.phone.entryMode) {
        case 'pc-floater':  mountPcFloater(handlers); break;
        case 'mobile-ball': mountMobileBall(handlers); break;
        case 'island':
        default:            mountDynamicIsland(handlers); break;
    }
}
function syncEntryOpenState(open) {
    setIslandPhoneOpen(open);
    setPcFloaterPhoneOpen(open);
    setMobileBallPhoneOpen(open);
}
function applyEnabledState() {
    unmountAllEntries();
    // 不论开/关，先停掉 TopInfoBar 修正循环、清掉之前的 transform；
    //   下面再按 mode 决定要不要重启
    if (window.__ggg_topbar_fix_interval) {
        clearInterval(window.__ggg_topbar_fix_interval);
        window.__ggg_topbar_fix_interval = null;
    }
    document.querySelectorAll('#extensionTopBar, .extension-top-bar, #top-info-bar, .top-info-bar')
        .forEach(el => { el.style.removeProperty('transform'); });

    if (settings.phone?.enabled) {
        mountCurrentEntry();
        applyMobileStatusBarPolicy();
        const mode = settings.phone.entryMode || 'island';
        document.documentElement.classList.toggle('ggg-phone-island-mode', mode === 'island');
        // v0.2.30：彻底取消把 TopInfoBar 推 36px 的做法——
        //   旧实现导致 PC 端 TopInfoBar 与 #top-bar 之间留 36px 空隙，
        //   且因为 transform 残留还会和 topbar 产生层叠/遮挡问题。
        //   现在让 TopInfoBar 走酒馆默认布局（紧贴 #top-bar 之下），
        //   灵动岛胶囊自己叠在 #top-bar 中央上方即可。
        // v0.2.42：启动全屏键盘补偿
        setupFullscreenKeyboardFix();
    } else {
        if (isPhoneShellOpen()) exitPhone();
        document.documentElement.classList.remove('ggg-phone-island-mode');
        teardownFullscreenKeyboardFix();
    }
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
           body  { bottom: ${kbH}px !important; }`
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

// v0.2.17：记录进入手机前酒馆是否已是浏览器全屏，决定退出时要不要解除全屏
let _wasFullscreenBefore = false;

async function enterPhone() {
    if (isPhoneShellOpen()) return;

    _wasFullscreenBefore = !!document.fullscreenElement;

    if (settings.phone?.alwaysFullscreen) {
        try {
            const docEl = document.documentElement;
            const req = docEl.requestFullscreen || docEl.webkitRequestFullscreen
                || docEl.mozRequestFullScreen || docEl.msRequestFullscreen;
            if (req && !document.fullscreenElement) {
                await req.call(docEl).catch(() => {});
            }
        } catch (e) {}
    }

    mountPhoneShell();
    syncEntryOpenState(true);

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

function exitPhone() {
    if (!isPhoneShellOpen()) return;
    if (vueApp) {
        try { vueApp.unmount(); } catch (e) {}
        vueApp = null;
    }
    unmountStatusBar();
    unmountPhoneShell();
    syncEntryOpenState(false);

    // v0.2.17：只有进入手机前酒馆"不是"全屏时，退出手机才解除全屏；
    //   如果用户进入手机前就在全屏看酒馆，退出时保持全屏
    if (!_wasFullscreenBefore) {
        try {
            const exit = document.exitFullscreen || document.webkitExitFullscreen
                || document.mozCancelFullScreen || document.msExitFullscreen;
            if (exit && document.fullscreenElement) {
                exit.call(document).catch(() => {});
            }
        } catch (e) {}
    }
}
