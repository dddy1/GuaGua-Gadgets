import { settings } from '../../../index.js';
import { enterPhone, exitPhone, isPhoneOpen } from '../phone.js';
import { hasLongScreenshotEntry, toggleLongScreenshotRangePanel } from '../../tools/tools.js';
import { RELEASE_MODE } from '../release-flag.js';

const BALL_ID = 'ggg-floating-ball';
const PANEL_ID = 'ggg-floating-ball-panel';
const POS_KEY = 'ggg-floating-ball-pos';
const IDLE_MS = 3200;
const EDGE_SNAP_THRESHOLD = 28;
const TOP_BAR_HIDDEN_CLASS = 'ggg-phone-topbar-hidden';
const FLOATING_BALL_MOUNTED_CLASS = 'ggg-floating-ball-mounted';

let dragged = false;
let outsideBound = false;

export function initFloatingBall() {
    ensureDefaults();
    syncFloatingBall();
    window.addEventListener('ggg-floating-ball-config-changed', syncFloatingBall);
    window.addEventListener('fullscreenchange', syncFloatingBallState);
    window.addEventListener('ggg-phone-open-changed', syncFloatingBallState);
}

function ensureDefaults() {
    if (!settings.floatingBall || typeof settings.floatingBall !== 'object') {
        settings.floatingBall = { enabled: true, showTopbar: false, showFullscreen: false };
    }
    if (typeof settings.floatingBall.enabled !== 'boolean') settings.floatingBall.enabled = true;
    if (typeof settings.floatingBall.showTopbar !== 'boolean') settings.floatingBall.showTopbar = false;
    if (typeof settings.floatingBall.showFullscreen !== 'boolean') settings.floatingBall.showFullscreen = false;
}

function shouldMount() {
    ensureDefaults();
    return settings.enabled !== false && settings.floatingBall.enabled !== false;
}

function syncFloatingBall() {
    if (!shouldMount()) {
        unmountFloatingBall();
        return;
    }
    mountFloatingBall();
    renderPanelActions();
    syncFloatingBallState();
}

function mountFloatingBall() {
    if (document.getElementById(BALL_ID)) return;
    // 贴边隐藏时按钮会有一部分在视口外，锁住横向溢出避免移动端被拖出空白边。
    document.documentElement.classList.add(FLOATING_BALL_MOUNTED_CLASS);
    const ball = document.createElement('button');
    ball.id = BALL_ID;
    ball.type = 'button';
    ball.setAttribute('aria-label', '呱呱悬浮球');
    ball.innerHTML = '<span class="ggg-floating-ball-frog" aria-hidden="true"></span>';
    document.body.appendChild(ball);

    const saved = readPos();
    const width = ball.offsetWidth || 64;
    const margin = 12;
    const defaultLeft = window.innerWidth - width - margin;
    const defaultTop = Math.round(window.innerHeight * 0.52);
    ball.style.setProperty('left', `${saved?.left ?? defaultLeft}px`, 'important');
    ball.style.setProperty('top', `${saved?.top ?? defaultTop}px`, 'important');

    enableDrag(ball);
    bindBallInteractions(ball);
    resetIdleSnap(ball);
}

function unmountFloatingBall() {
    document.getElementById(BALL_ID)?.remove();
    document.getElementById(PANEL_ID)?.remove();
    document.documentElement.classList.remove('ggg-floating-ball-panel-open');
    document.documentElement.classList.remove(FLOATING_BALL_MOUNTED_CLASS);
    if (window.__ggg_floating_ball_idle) {
        clearTimeout(window.__ggg_floating_ball_idle);
        window.__ggg_floating_ball_idle = null;
    }
    if (outsideBound) {
        document.removeEventListener('pointerdown', onOutsidePointerDown, true);
        outsideBound = false;
    }
}

function bindBallInteractions(ball) {
    ball.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
    });
    ball.addEventListener('click', (event) => {
        if (dragged) return;
        event.preventDefault();
        event.stopPropagation();
        if (isPhoneOpen() && openPhoneControls(ball)) {
            resetIdleSnap(ball);
            return;
        }
        togglePanel();
        resetIdleSnap(ball);
    });

    ['mousedown', 'touchstart', 'mouseenter', 'mousemove'].forEach(type => {
        ball.addEventListener(type, () => resetIdleSnap(ball), { passive: true });
    });
}

function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
    });
    document.body.appendChild(panel);
    return panel;
}

function togglePanel(force) {
    const panel = ensurePanel();
    const open = force ?? !panel.classList.contains('active');
    panel.classList.toggle('active', open);
    document.documentElement.classList.toggle('ggg-floating-ball-panel-open', open);
    if (!open) return;
    renderPanelActions();
    positionPanel(panel);
    if (!outsideBound) {
        document.addEventListener('pointerdown', onOutsidePointerDown, true);
        outsideBound = true;
    }
}

function closePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.classList.remove('active');
    document.documentElement.classList.remove('ggg-floating-ball-panel-open');
}

function openPhoneControls(ball) {
    if (typeof window.gggPhoneOpenControls === 'function') {
        closePanel();
        window.gggPhoneOpenControls(ball?.getBoundingClientRect?.() || null);
        return true;
    }

    // Vue 根组件刚挂载的瞬间可能还没暴露控制面板入口，稍后补一次。
    setTimeout(() => {
        if (isPhoneOpen() && typeof window.gggPhoneOpenControls === 'function') {
            window.gggPhoneOpenControls(ball?.getBoundingClientRect?.() || null);
        }
    }, 80);
    return true;
}

function onOutsidePointerDown(event) {
    const panel = document.getElementById(PANEL_ID);
    const ball = document.getElementById(BALL_ID);
    if (!panel?.classList.contains('active')) return;
    if (panel.contains(event.target) || ball?.contains(event.target)) return;
    closePanel();
}

function renderPanelActions() {
    const panel = ensurePanel();
    const actions = [];

    if (settings.floatingBall?.showTopbar) {
        actions.push({
            key: 'topbar',
            label: isTopBarHidden() ? '显示顶栏' : '隐藏顶栏',
            icon: isTopBarHidden() ? 'fa-panorama' : 'fa-window-maximize',
            active: isTopBarHidden(),
            handler: () => toggleTopBarHidden(),
        });
    }
    if (settings.floatingBall?.showFullscreen) {
        actions.push({
            key: 'fullscreen',
            label: isBrowserFullscreen() ? '退出全屏' : '全屏',
            icon: isBrowserFullscreen() ? 'fa-compress' : 'fa-expand',
            active: isBrowserFullscreen(),
            handler: () => toggleBrowserFullscreen(),
        });
    }
    if (!RELEASE_MODE && settings.phone?.enabled) {
        const open = isPhoneOpen();
        actions.push({
            key: 'phone',
            label: open ? '退出手机' : '进入手机',
            icon: open ? 'fa-power-off' : 'fa-mobile-screen',
            active: open,
            handler: () => open ? exitPhone() : enterPhone(),
        });
    }
    if (hasLongScreenshotEntry()) {
        actions.push({
            key: 'longshot',
            label: '长截图',
            icon: 'fa-camera',
            active: !!document.getElementById('ggg-longshot-range-panel')?.classList.contains('active'),
            handler: () => toggleLongScreenshotRangePanel(true, document.getElementById(BALL_ID)?.getBoundingClientRect?.() || null),
        });
    }

    panel.innerHTML = `
        <div class="ggg-floating-ball-panel-head">
            <span class="ggg-floating-ball-panel-title">呱呱悬浮面板</span>
            <span class="ggg-floating-ball-panel-subtitle">${actions.length} 个快捷动作</span>
        </div>
        <div class="ggg-floating-ball-panel-actions">
            ${actions.length ? actions.map(action => `
                <button type="button" class="ggg-floating-ball-action${action.active ? ' active' : ''}" data-action="${action.key}">
                    <i class="ggg-fa fa-solid ${action.icon}"></i>
                    <span>${action.label}</span>
                </button>
            `).join('') : '<div class="ggg-floating-ball-empty">当前没有已启用的悬浮动作</div>'}
        </div>
    `;

    actions.forEach(action => {
        panel.querySelector(`[data-action="${action.key}"]`)?.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await action.handler();
            closePanel();
            queueMicrotask(() => {
                renderPanelActions();
                syncFloatingBallState();
            });
        });
    });
}

function syncFloatingBallState() {
    const ball = document.getElementById(BALL_ID);
    if (!ball) return;
    const phoneOpen = isPhoneOpen();
    ball.classList.toggle('phone-open', phoneOpen);
    ball.classList.toggle('topbar-hidden', isTopBarHidden());
    ball.classList.toggle('fullscreen-on', isBrowserFullscreen());
    ball.setAttribute('aria-label', phoneOpen ? '手机控制面板' : '呱呱悬浮球');
    if (phoneOpen) closePanel();
    const panel = document.getElementById(PANEL_ID);
    if (panel?.classList.contains('active')) {
        renderPanelActions();
        positionPanel(panel);
    }
}

function positionPanel(panel) {
    const ball = document.getElementById(BALL_ID);
    if (!ball || !panel) return;
    const rect = ball.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    panel.style.setProperty('width', `${width}px`, 'important');
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width));
    panel.style.setProperty('left', `${left}px`, 'important');
    panel.style.setProperty('top', `${Math.max(12, rect.top - panel.offsetHeight - 12)}px`, 'important');
}

function enableDrag(ball) {
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;
    let dragging = false;

    const onDown = (event) => {
        const p = pointer(event);
        startX = p.x;
        startY = p.y;
        const rect = ball.getBoundingClientRect();
        origLeft = rect.left;
        origTop = rect.top;
        dragging = true;
        dragged = false;
        closePanel();
        ball.style.transition = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
    };

    const onMove = (event) => {
        if (!dragging) return;
        const p = pointer(event);
        const dx = p.x - startX;
        const dy = p.y - startY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragged = true;
        if (dragged) event.preventDefault?.();
        const left = clamp(origLeft + dx, 0, window.innerWidth - ball.offsetWidth);
        const top = clamp(origTop + dy, 0, window.innerHeight - ball.offsetHeight);
        ball.style.setProperty('left', `${left}px`, 'important');
        ball.style.setProperty('top', `${top}px`, 'important');
    };

    const onUp = () => {
        dragging = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        const rect = ball.getBoundingClientRect();
        ball.style.transition = '';
        writePos({ left: rect.left, top: rect.top });
        resetIdleSnap(ball);
        setTimeout(() => { dragged = false; }, 60);
    };

    ball.addEventListener('mousedown', onDown);
    ball.addEventListener('touchstart', onDown, { passive: true });
}

function resetIdleSnap(ball) {
    if (!ball) return;
    if (ball.classList.contains('edge-snap')) {
        ball.classList.remove('edge-snap');
        const normalLeft = ball.dataset.normalLeft;
        if (normalLeft != null) ball.style.setProperty('left', `${normalLeft}px`, 'important');
    }
    if (window.__ggg_floating_ball_idle) clearTimeout(window.__ggg_floating_ball_idle);
    window.__ggg_floating_ball_idle = setTimeout(() => doSnap(ball), IDLE_MS);
}

function doSnap(ball) {
    if (!ball?.parentNode || dragged) return;
    const rect = ball.getBoundingClientRect();
    const width = ball.offsetWidth || 64;
    const distLeft = rect.left;
    const distRight = window.innerWidth - rect.right;
    const minDist = Math.min(distLeft, distRight);
    if (minDist > EDGE_SNAP_THRESHOLD) return;
    const snapLeft = distLeft <= distRight;
    const normalLeft = snapLeft ? 12 : window.innerWidth - width - 12;
    const hideLeft = snapLeft ? -Math.round(width * 0.38) : window.innerWidth - Math.round(width * 0.62);
    ball.dataset.normalLeft = String(normalLeft);
    ball.classList.add('edge-snap');
    ball.style.setProperty('left', `${hideLeft}px`, 'important');
}

function pointer(event) {
    if (event.touches?.[0]) return { x: event.touches[0].clientX, y: event.touches[0].clientY };
    if (event.changedTouches?.[0]) return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
    return { x: event.clientX, y: event.clientY };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function readPos() {
    try { return JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch { return null; }
}

function writePos(pos) {
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch {}
}

function requestBrowserFullscreen() {
    if (document.fullscreenElement) return;
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen
        || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (fn) {
        try { fn.call(el); } catch {}
    }
}

function exitBrowserFullscreen() {
    if (!document.fullscreenElement) return;
    const fn = document.exitFullscreen || document.webkitExitFullscreen
        || document.mozCancelFullScreen || document.msExitFullscreen;
    if (fn) {
        try { fn.call(document); } catch {}
    }
}

function toggleBrowserFullscreen() {
    if (document.fullscreenElement) exitBrowserFullscreen();
    else requestBrowserFullscreen();
}

function isBrowserFullscreen() {
    return !!document.fullscreenElement;
}

function toggleTopBarHidden() {
    document.documentElement.classList.toggle(TOP_BAR_HIDDEN_CLASS);
}

function isTopBarHidden() {
    return document.documentElement.classList.contains(TOP_BAR_HIDDEN_CLASS);
}
