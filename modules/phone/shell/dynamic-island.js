/**
 * 灵动岛 —— 常驻视口顶部，跟随酒馆顶栏动态定位
 * v0.2.38：
 *   - 挂在 body 上、fixed 定位（不进入 #sheld 内部，避免被 #chat 滚动等影响）
 *   - top 由 JS 动态算：默认贴在 #extensionTopBar（若有）/ #top-bar 下方；
 *     单击隐藏顶栏后回到顶部 6px
 *   - top 变化用 CSS transition 平滑
 */

import { bindEntryGestures } from './entry-gestures.js';

const ISLAND_ID = 'ggg-phone-island';
const TOPBAR_HIDDEN_CLASS = 'ggg-phone-topbar-hidden';
const ISLAND_GAP = 4;

let _onEnterPhone = null;
let _onExitPhone = null;
let _isPhoneOpen = false;
let _recalcTimer = null;
let _resizeObserver = null;

function _findAnchorBottom() {
    if (document.documentElement.classList.contains(TOPBAR_HIDDEN_CLASS)) {
        return 6;
    }
    const ext = document.getElementById('extensionTopBar');
    if (ext && ext.offsetParent !== null) {
        const r = ext.getBoundingClientRect();
        if (r.height > 0) return r.bottom + ISLAND_GAP;
    }
    const topBar = document.getElementById('top-bar');
    if (topBar && topBar.offsetParent !== null) {
        const r = topBar.getBoundingClientRect();
        if (r.height > 0) return r.bottom + ISLAND_GAP;
    }
    return 36;
}

function recalcIslandPosition() {
    const island = document.getElementById(ISLAND_ID);
    if (!island) return;
    const top = _findAnchorBottom();
    island.style.setProperty('top', `${top}px`, 'important');
}

export function mountDynamicIsland({ onEnter, onExit }) {
    _onEnterPhone = onEnter;
    _onExitPhone = onExit;

    if (document.getElementById(ISLAND_ID)) return;

    const island = document.createElement('div');
    island.id = ISLAND_ID;
    island.className = 'ggg-phone-island';
    island.setAttribute('role', 'button');
    island.setAttribute('aria-label', '呱呱手机灵动岛');
    island.title = '单击：切换酒馆顶栏；双击：进入手机；三击：切换浏览器全屏';
    island.innerHTML = `<div class="ggg-phone-island-dot"></div>`;
    const s = island.style;
    s.setProperty('position', 'fixed', 'important');
    s.setProperty('left', '50%', 'important');
    s.setProperty('transform', 'translateX(-50%)', 'important');
    s.setProperty('z-index', '99998', 'important');

    document.body.appendChild(island);

    bindEntryGestures(island, {
        isOpen: () => _isPhoneOpen,
        onEnter: () => _onEnterPhone?.(),
        onExit: () => _onExitPhone?.(),
    });

    recalcIslandPosition();

    window.addEventListener('resize', recalcIslandPosition, { passive: true });

    if (window.ResizeObserver) {
        _resizeObserver = new ResizeObserver(() => recalcIslandPosition());
        const topBar = document.getElementById('top-bar');
        const ext = document.getElementById('extensionTopBar');
        if (topBar) _resizeObserver.observe(topBar);
        if (ext) _resizeObserver.observe(ext);
    }

    _recalcTimer = setInterval(recalcIslandPosition, 1000);
}

export function unmountDynamicIsland() {
    document.getElementById(ISLAND_ID)?.remove();
    document.documentElement.classList.remove(TOPBAR_HIDDEN_CLASS);
    window.removeEventListener('resize', recalcIslandPosition);
    if (_resizeObserver) {
        _resizeObserver.disconnect();
        _resizeObserver = null;
    }
    if (_recalcTimer) {
        clearInterval(_recalcTimer);
        _recalcTimer = null;
    }
}

export function setIslandPhoneOpen(open) {
    _isPhoneOpen = open;
    const island = document.getElementById(ISLAND_ID);
    if (!island) return;
    island.classList.toggle('open', open);
}

export function refreshIslandPosition() {
    recalcIslandPosition();
}
