import { settings } from '../../../index.js';
import { enterPhone, exitPhone, isPhoneOpen } from '../phone.js';
import { hasLongScreenshotEntry, toggleLongScreenshotRangePanel } from '../../tools/tools.js';
import { RELEASE_MODE } from '../release-flag.js';
import { isFullscreen, toggleFullscreen, onFullscreenChange } from './browser-fullscreen.js';
// ─── 后台调试记录器（临时，修完删除）───
let _dbgRecording = false;
let _dbgLogs = [];
let _dbgCleanups = [];
const _DBG_MAX = 200;

function _dbgElInfo(el) {
    if (!el) return null;
    const tag = el.tagName?.toLowerCase() || '?';
    const id = el.id ? '#' + el.id : '';
    const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    const r = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    return { sel: tag + id + cls, t: Math.round(r.top), l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), pos: cs.position, z: cs.zIndex, vis: cs.visibility, disp: cs.display, ov: cs.overflow, tf: cs.transform !== 'none' ? cs.transform.slice(0, 40) : '-' };
}

function _dbgAncestors(el, n) {
    const chain = []; let cur = el?.parentElement; let i = 0;
    while (cur && i < n) {
        const cs = window.getComputedStyle(cur);
        const tag = cur.tagName.toLowerCase();
        const id = cur.id ? '#' + cur.id : '';
        chain.push(tag + id + ' [' + cs.position + '/' + cs.visibility + '/' + cs.display + '/' + cs.overflow + (cs.transform !== 'none' ? '/TF=' + cs.transform.slice(0, 30) : '') + ']');
        cur = cur.parentElement; i++;
    }
    return chain;
}

function _dbgPush(type, msg) {
    const d = new Date();
    const ts = String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0') + '.' + String(d.getMilliseconds()).padStart(3, '0');
    _dbgLogs.push(ts + ' [' + type + '] ' + msg);
    if (_dbgLogs.length > _DBG_MAX) _dbgLogs.shift();
}

function _dbgListen(target, event, handler, opts) {
    target.addEventListener(event, handler, opts);
    _dbgCleanups.push(() => target.removeEventListener(event, handler, opts));
}

function _dbgSnapshot() {
    const vv = window.visualViewport;
    const hcs = window.getComputedStyle(document.documentElement);
    const bcs = window.getComputedStyle(document.body);
    const ae = document.activeElement;
    const ai = _dbgElInfo(ae);
    const vpM = document.querySelector('meta[name="viewport"]');
    const lines = [
        '=== GGG DEBUG SNAPSHOT ===',
        'Time: ' + new Date().toLocaleString(),
        'UA: ' + navigator.userAgent,
        'Viewport: ' + window.innerWidth + 'x' + window.innerHeight,
        'VV: ' + (vv ? Math.round(vv.width) + 'x' + Math.round(vv.height) + ' off(' + Math.round(vv.offsetTop) + ',' + Math.round(vv.offsetLeft) + ') scale=' + vv.scale : 'N/A'),
        'Scroll: docEl(' + Math.round(document.documentElement.scrollTop) + ',' + Math.round(document.documentElement.scrollLeft) + ') body(' + Math.round(document.body.scrollTop) + ',' + Math.round(document.body.scrollLeft) + ')',
        'FS: ' + !!(document.fullscreenElement || document.webkitFullscreenElement),
        'html: ov=' + hcs.overflow + ' ovx=' + hcs.overflowX + ' ovy=' + hcs.overflowY + ' pos=' + hcs.position + ' tf=' + hcs.transform + ' inline=' + (document.documentElement.style.cssText || 'none'),
        'body: ov=' + bcs.overflow + ' ovx=' + bcs.overflowX + ' ovy=' + bcs.overflowY + ' pos=' + bcs.position + ' tf=' + bcs.transform,
        vpM ? 'meta[viewport]: ' + vpM.content : 'meta[viewport]: none',
        'tf-fix-style: ' + (document.getElementById('ggg-phone-html-tf-fix')?.textContent || 'NOT FOUND'),
        'html.classList: ' + document.documentElement.className,
    ];
    if (ai) {
        lines.push('ActiveElement: ' + ai.sel + ' rect(' + ai.t + ',' + ai.l + ',' + ai.w + 'x' + ai.h + ') pos=' + ai.pos + ' z=' + ai.z + ' vis=' + ai.vis + ' disp=' + ai.disp + ' tf=' + ai.tf);
        lines.push('  Ancestors:');
        _dbgAncestors(ae, 10).forEach((c, i) => { lines.push('    ' + '  '.repeat(i) + '↑ ' + c); });
    }
    lines.push('', '=== EVENT LOG (' + _dbgLogs.length + ' entries) ===');
    lines.push(..._dbgLogs);
    return lines.join('\n');
}

function _dbgStartRecording() {
    if (_dbgRecording) return;
    _dbgRecording = true;
    _dbgLogs = [];
    _dbgCleanups = [];

    _dbgPush('INIT', 'Recording started | VP ' + window.innerWidth + 'x' + window.innerHeight);

    _dbgListen(document, 'focusin', (e) => {
        const info = _dbgElInfo(e.target);
        if (!info) return;
        _dbgPush('FOCUS', info.sel + ' rect(' + info.t + ',' + info.l + ',' + info.w + 'x' + info.h + ') pos=' + info.pos + ' z=' + info.z + ' vis=' + info.vis + ' disp=' + info.disp + ' tf=' + info.tf);
        const tag = e.target?.tagName?.toLowerCase();
        if (tag === 'textarea' || tag === 'input') {
            _dbgAncestors(e.target, 12).forEach((c, i) => _dbgPush('  ANC', '  '.repeat(i) + '↑ ' + c));
        }
    }, true);
    _dbgListen(document, 'focusout', (e) => {
        const tag = e.target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
            _dbgPush('BLUR', tag + (e.target.id ? '#' + e.target.id : '') + (e.target.className ? '.' + String(e.target.className).trim().split(/\s+/)[0] : ''));
        }
    }, true);
    _dbgListen(window, 'resize', () => {
        const vv = window.visualViewport;
        _dbgPush('RESIZE', 'inner=' + window.innerWidth + 'x' + window.innerHeight + ' vv=' + (vv ? Math.round(vv.width) + 'x' + Math.round(vv.height) : '-'));
    }, { passive: true });
    if (window.visualViewport) {
        _dbgListen(window.visualViewport, 'resize', () => {
            const vv = window.visualViewport;
            _dbgPush('VV-RSZ', Math.round(vv.width) + 'x' + Math.round(vv.height) + ' off(' + Math.round(vv.offsetTop) + ',' + Math.round(vv.offsetLeft) + ') scale=' + vv.scale);
        }, { passive: true });
        _dbgListen(window.visualViewport, 'scroll', () => {
            const vv = window.visualViewport;
            _dbgPush('VV-SCR', 'off(' + Math.round(vv.offsetTop) + ',' + Math.round(vv.offsetLeft) + ')');
        }, { passive: true });
    }
    let _lastScrollLog = 0;
    _dbgListen(document, 'scroll', () => {
        const now = Date.now();
        if (now - _lastScrollLog < 500) return;
        _lastScrollLog = now;
        _dbgPush('SCROLL', 'docEl(' + Math.round(document.documentElement.scrollTop) + ') body(' + Math.round(document.body.scrollTop) + ')');
    }, { passive: true, capture: true });
    _dbgListen(document, 'fullscreenchange', () => {
        _dbgPush('FS', String(!!(document.fullscreenElement || document.webkitFullscreenElement)));
    });
}

function _dbgStopRecording() {
    _dbgRecording = false;
    _dbgCleanups.forEach(fn => { try { fn(); } catch {} });
    _dbgCleanups = [];
}

function _dbgCopyLogs() {
    const text = _dbgSnapshot();
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(
            () => alert('调试日志已复制到剪贴板（' + _dbgLogs.length + ' 条）'),
            () => _dbgFallbackCopy(text),
        );
    } else {
        _dbgFallbackCopy(text);
    }
}

function _dbgFallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:50vh;z-index:2147483647;font:11px monospace;background:#000;color:#0f0;padding:8px;';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        alert('已复制（' + _dbgLogs.length + ' 条）— 关闭此框后文本框会消失');
    } catch {
        alert('自动复制失败 — 请手动全选复制文本框内容');
        return;
    }
    ta.remove();
}

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
    syncFloatingBall(false);
    window.addEventListener('ggg-floating-ball-config-changed', () => syncFloatingBall(true));
    onFullscreenChange(syncFloatingBallState);
    window.addEventListener('ggg-phone-open-changed', syncFloatingBallState);
}

function ensureDefaults() {
    if (!settings.floatingBall || typeof settings.floatingBall !== 'object') {
        settings.floatingBall = {};
    }
    if (typeof settings.floatingBall.enabled !== 'boolean') settings.floatingBall.enabled = true;
    if (typeof settings.floatingBall.showTopbar !== 'boolean') settings.floatingBall.showTopbar = false;
    if (typeof settings.floatingBall.showFullscreen !== 'boolean') settings.floatingBall.showFullscreen = false;
    if (typeof settings.floatingBall.stickToEdgeVisible !== 'boolean') settings.floatingBall.stickToEdgeVisible = false;
    settings.floatingBall.opacity = clampNumber(settings.floatingBall.opacity, 20, 100, 100);
    settings.floatingBall.radius = clampNumber(settings.floatingBall.radius, 0, 32, 20);
    settings.floatingBall.size = clampNumber(settings.floatingBall.size, 40, 120, 56);
}

function shouldMount() {
    ensureDefaults();
    return settings.enabled !== false && settings.floatingBall.enabled !== false;
}

function syncFloatingBall(shouldRefreshSnap = false) {
    if (!shouldMount()) {
        unmountFloatingBall();
        return;
    }
    mountFloatingBall();
    renderPanelActions();
    syncFloatingBallState();
    if (shouldRefreshSnap) {
        const ball = document.getElementById(BALL_ID);
        if (ball) refreshSnapState(ball);
    }
}

function mountFloatingBall() {
    if (document.getElementById(BALL_ID)) return;
    // 贴边隐藏时按钮会有一部分在视口外，锁住横向溢出避免移动端被拖出空白边。
    document.documentElement.classList.add(FLOATING_BALL_MOUNTED_CLASS);
    ensureDefaults();
    const ball = document.createElement('button');
    ball.id = BALL_ID;
    ball.type = 'button';
    ball.setAttribute('aria-label', '呱呱悬浮球');
    ball.innerHTML = '<span class="ggg-floating-ball-frog" aria-hidden="true"></span>';
    document.body.appendChild(ball);

    const saved = readPos();
    const size = clampNumber(settings.floatingBall.size, 40, 120, 56);
    const margin = 12;
    const defaultLeft = window.innerWidth - size - margin;
    const defaultTop = Math.round(window.innerHeight * 0.52);
    ball.style.setProperty('left', `${clamp(saved?.left ?? defaultLeft, 0, Math.max(0, window.innerWidth - size))}px`, 'important');
    ball.style.setProperty('top', `${clamp(saved?.top ?? defaultTop, 0, Math.max(0, window.innerHeight - size))}px`, 'important');
    applyBallConfig(ball);

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
    ['pointerdown', 'mousedown', 'touchstart'].forEach(type => {
        ball.addEventListener(type, stopDrawerPressEvent, { capture: true });
    });
    ball.addEventListener('click', (event) => {
        stopDrawerDismissEvent(event);
        if (dragged) return;
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
    ['pointerdown', 'mousedown', 'touchstart'].forEach(type => {
        panel.addEventListener(type, stopDrawerPressEvent, { capture: true });
    });
    panel.addEventListener('click', stopDrawerPressEvent);
    document.body.appendChild(panel);
    return panel;
}

function stopDrawerPressEvent(event) {
    event.stopPropagation?.();
}

function stopDrawerDismissEvent(event) {
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
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
            label: isFullscreen() ? '退出全屏' : '全屏',
            icon: isFullscreen() ? 'fa-compress' : 'fa-expand',
            active: isFullscreen(),
            handler: () => toggleFullscreen(),
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
    // 临时调试入口（发布版隐藏）
    if (!RELEASE_MODE && _dbgRecording) {
        actions.push({
            key: 'debug-copy',
            label: '复制调试日志',
            icon: 'fa-clipboard',
            active: false,
            handler: () => _dbgCopyLogs(),
        });
        actions.push({
            key: 'debug-stop',
            label: '停止调试',
            icon: 'fa-stop',
            active: true,
            handler: () => _dbgStopRecording(),
        });
    } else if (!RELEASE_MODE) {
        actions.push({
            key: 'debug-start',
            label: '开始调试',
            icon: 'fa-bug',
            active: false,
            handler: () => _dbgStartRecording(),
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
    applyBallConfig(ball);
    const phoneOpen = isPhoneOpen();
    ball.classList.toggle('phone-open', phoneOpen);
    ball.classList.toggle('topbar-hidden', isTopBarHidden());
    ball.classList.toggle('fullscreen-on', isFullscreen());
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
        if (ball.classList.contains('edge-snap')) {
            ball.classList.remove('edge-snap');
            const normalLeft = Number.parseFloat(ball.dataset.normalLeft);
            if (Number.isFinite(normalLeft)) {
                ball.style.setProperty('left', `${normalLeft}px`, 'important');
            }
            ball.style.removeProperty('transform');
            applyBallConfig(ball);
        }
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
        ball.style.transition = '';
        const left = Number.parseFloat(ball.style.left);
        const top = Number.parseFloat(ball.style.top);
        if (Number.isFinite(left) && Number.isFinite(top)) {
            writePos({ left, top });
        }
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
        ball.style.removeProperty('transform');
        applyBallConfig(ball);
    }
    if (window.__ggg_floating_ball_idle) clearTimeout(window.__ggg_floating_ball_idle);
    window.__ggg_floating_ball_idle = setTimeout(() => doSnap(ball), IDLE_MS);
}

function refreshSnapState(ball) {
    if (!ball?.parentNode) return;
    if (window.__ggg_floating_ball_idle) {
        clearTimeout(window.__ggg_floating_ball_idle);
        window.__ggg_floating_ball_idle = null;
    }
    const rect = ball.getBoundingClientRect();
    const nearEdge = ball.classList.contains('edge-snap')
        || rect.left <= EDGE_SNAP_THRESHOLD
        || (window.innerWidth - rect.right) <= EDGE_SNAP_THRESHOLD;
    if (nearEdge) {
        doSnap(ball);
        return;
    }
    resetIdleSnap(ball);
}

function doSnap(ball) {
    if (!ball?.parentNode || dragged) return;
    ensureDefaults();
    const rect = ball.getBoundingClientRect();
    const width = ball.offsetWidth || 64;
    const distLeft = rect.left;
    const distRight = window.innerWidth - rect.right;
    const minDist = Math.min(distLeft, distRight);
    if (minDist > EDGE_SNAP_THRESHOLD) return;
    const snapLeft = distLeft <= distRight;
    const visibleLeft = snapLeft ? 12 : window.innerWidth - width - 12;
    // 把球定位在视口边缘，用 transform 做视觉隐藏偏移（不影响布局/滚动）
    const edgeLeft = snapLeft ? 0 : window.innerWidth - width;
    if (settings.floatingBall?.stickToEdgeVisible) {
        ball.classList.remove('edge-snap');
        ball.style.setProperty('left', `${visibleLeft}px`, 'important');
        ball.style.removeProperty('transform');
        applyBallConfig(ball);
        return;
    }
    ball.style.setProperty('left', `${edgeLeft}px`, 'important');
    const hideOffset = Math.round(width * 0.38);
    ball.dataset.normalLeft = String(visibleLeft);
    ball.classList.add('edge-snap');
    ball.style.setProperty('opacity', String(Math.min(clampNumber(settings.floatingBall?.opacity, 20, 100, 100) / 100, 0.5)), 'important');
    ball.style.setProperty('transform', `translateX(${snapLeft ? -hideOffset : hideOffset}px)`, 'important');
}

function pointer(event) {
    if (event.touches?.[0]) return { x: event.touches[0].clientX, y: event.touches[0].clientY };
    if (event.changedTouches?.[0]) return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
    return { x: event.clientX, y: event.clientY };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function clampNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return clamp(num, min, max);
}

function applyBallConfig(ball) {
    ensureDefaults();
    const config = settings.floatingBall;
    const size = clampNumber(config.size, 40, 120, 56);
    const radius = clampNumber(config.radius, 0, 32, 20);
    const opacity = clampNumber(config.opacity, 20, 100, 100) / 100;
    const frogSize = clampNumber(Math.round(size * 0.68), 16, 72, 38);

    ball.style.setProperty('width', `${size}px`, 'important');
    ball.style.setProperty('height', `${size}px`, 'important');
    ball.style.setProperty('border-radius', `${radius}px`, 'important');
    ball.style.setProperty('opacity', String(opacity), 'important');
    ball.querySelector('.ggg-floating-ball-frog')?.style.setProperty('width', `${frogSize}px`, 'important');
    ball.querySelector('.ggg-floating-ball-frog')?.style.setProperty('height', `${frogSize}px`, 'important');
    clampBallIntoViewport(ball);
}

function clampBallIntoViewport(ball) {
    const parsedLeft = Number.parseFloat(ball.style.left);
    const parsedTop = Number.parseFloat(ball.style.top);
    if (!Number.isFinite(parsedLeft) || !Number.isFinite(parsedTop)) return;
    const rect = ball.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - rect.width);
    const maxTop = Math.max(0, window.innerHeight - rect.height);
    const nextLeft = clamp(parsedLeft, 0, maxLeft);
    const nextTop = clamp(parsedTop, 0, maxTop);
    ball.style.setProperty('left', `${nextLeft}px`, 'important');
    ball.style.setProperty('top', `${nextTop}px`, 'important');
}

function readPos() {
    try { return JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch { return null; }
}

function writePos(pos) {
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch {}
}

function toggleTopBarHidden() {
    document.documentElement.classList.toggle(TOP_BAR_HIDDEN_CLASS);
}

function isTopBarHidden() {
    return document.documentElement.classList.contains(TOP_BAR_HIDDEN_CLASS);
}
