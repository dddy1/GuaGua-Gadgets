/**
 * 移动端悬浮球入口
 * 形态：圆形小球，松手后自动吸附到最近的左右页边
 * 行为：与灵动岛一致 —— 单击切换顶栏，双击进/退手机
 */
import { bindEntryGestures } from './entry-gestures.js';

const BALL_ID = 'ggg-phone-mobile-ball';
const POS_KEY = 'ggg-phone-mobile-ball-pos';

let _onEnter = null;
let _onExit = null;
let _isPhoneOpen = false;
let _dragged = false;

export function mountMobileBall({ onEnter, onExit }) {
    _onEnter = onEnter;
    _onExit = onExit;
    if (document.getElementById(BALL_ID)) return;

    const el = document.createElement('div');
    el.id = BALL_ID;
    el.className = 'ggg-phone-mobile-ball';
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', '呱呱手机入口（悬浮球）');
    el.innerHTML = `<div class="ggg-phone-mobile-ball-dot"></div>`;

    const s = el.style;
    s.setProperty('position', 'fixed', 'important');
    s.setProperty('z-index', '99998', 'important');

    document.body.appendChild(el);

    // 默认贴右边（用实际渲染宽度，而非硬编码）
    const saved = readPos();
    const W = el.offsetWidth || 56;
    const margin = 8;
    const defaultLeft = window.innerWidth - W - margin;
    const defaultTop = Math.round(window.innerHeight * 0.55);
    s.setProperty('left', `${saved?.left ?? defaultLeft}px`, 'important');
    s.setProperty('top', `${saved?.top ?? defaultTop}px`, 'important');

    enableDragWithSnap(el);
    bindEntryGestures(el, {
        isOpen: () => _isPhoneOpen,
        onEnter: () => _onEnter?.(),
        onExit: () => _onExit?.(),
        draggedRef: () => _dragged,
    });

    // v0.2.17：3 秒无交互后贴边半隐藏
    enableEdgeSnap(el);
}

export function unmountMobileBall() {
    if (window.__ggg_ball_idle_timer) {
        clearTimeout(window.__ggg_ball_idle_timer);
        window.__ggg_ball_idle_timer = null;
    }
    document.getElementById(BALL_ID)?.remove();
    document.documentElement.classList.remove('ggg-phone-topbar-hidden');
}

export function setMobileBallPhoneOpen(open) {
    _isPhoneOpen = open;
    document.getElementById(BALL_ID)?.classList.toggle('open', open);
}

/* ---------- 拖拽 + 吸附 ---------- */
function enableDragWithSnap(el) {
    let startX = 0, startY = 0, origLeft = 0, origTop = 0;
    let dragging = false;

    const onDown = (e) => {
        const p = pointer(e);
        startX = p.x; startY = p.y;
        const r = el.getBoundingClientRect();
        origLeft = r.left; origTop = r.top;
        dragging = true;
        _dragged = false;
        // 拖拽时关闭吸附动画
        el.style.transition = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
    };
    const onMove = (e) => {
        if (!dragging) return;
        const p = pointer(e);
        const dx = p.x - startX, dy = p.y - startY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) _dragged = true;
        if (_dragged) e.preventDefault?.();
        const left = clamp(origLeft + dx, 0, window.innerWidth - el.offsetWidth);
        const top = clamp(origTop + dy, 0, window.innerHeight - el.offsetHeight);
        el.style.setProperty('left', `${left}px`, 'important');
        el.style.setProperty('top', `${top}px`, 'important');
    };
    const onUp = () => {
        dragging = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        if (_dragged) {
            // 吸附到最近的左 / 右页边
            const r = el.getBoundingClientRect();
            const margin = 8;
            const snapLeft = (r.left + r.width / 2) < window.innerWidth / 2;
            const targetLeft = snapLeft ? margin : (window.innerWidth - el.offsetWidth - margin);
            el.style.transition = 'left 0.22s cubic-bezier(0.22,1,0.36,1)';
            el.style.setProperty('left', `${targetLeft}px`, 'important');
            writePos({ left: targetLeft, top: r.top });
            setTimeout(() => { _dragged = false; }, 50);
        }
    };

    el.addEventListener('mousedown', onDown);
    el.addEventListener('touchstart', onDown, { passive: true });
}

/* ---------- v0.2.17：3 秒无交互后贴屏幕边半隐藏 ---------- */
const IDLE_MS = 3000;
function enableEdgeSnap(el) {
    const reset = () => {
        // 任何交互 → 恢复全显示 + 重新计时
        if (el.classList.contains('edge-snap')) {
            el.classList.remove('edge-snap');
            // 把球从藏起的边外位置拉回原 normalLeft
            const normal = el.dataset.normalLeft;
            if (normal != null) el.style.setProperty('left', `${normal}px`, 'important');
        }
        if (window.__ggg_ball_idle_timer) clearTimeout(window.__ggg_ball_idle_timer);
        window.__ggg_ball_idle_timer = setTimeout(() => {
            doSnap(el);
        }, IDLE_MS);
    };
    // 监听任意交互
    ['mousedown', 'touchstart', 'mousemove', 'mouseenter'].forEach(evt => {
        el.addEventListener(evt, reset, { passive: true });
    });
    reset();
}
function doSnap(el) {
    if (!el || !el.parentNode) return;
    if (_dragged) return; // 拖拽过程中别吸
    const r = el.getBoundingClientRect();
    const W = el.offsetWidth || 48;
    // 已经贴边吗？取离哪条左/右边更近
    const snapLeft = (r.left + r.width / 2) < window.innerWidth / 2;
    const normalLeft = snapLeft ? 0 : (window.innerWidth - W);
    // 藏一半到屏幕外：左边 → -W/2；右边 → innerWidth - W/2
    const hideLeft = snapLeft ? -Math.round(W / 2) : (window.innerWidth - Math.round(W / 2));
    el.dataset.normalLeft = String(normalLeft);
    el.classList.add('edge-snap');
    el.style.setProperty('left', `${hideLeft}px`, 'important');
}

function pointer(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function readPos() {
    try { return JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch { return null; }
}
function writePos(p) {
    try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch {}
}
