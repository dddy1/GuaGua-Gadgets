/**
 * PC 悬浮窗入口
 * 形态：贴在 #sheld 右 margin 区域的小胶囊，可拖拽（位置持久化）
 * 行为：与灵动岛一致 —— 单击切换顶栏，双击进/退手机
 */
import { bindEntryGestures } from './entry-gestures.js';

const FLOATER_ID = 'ggg-phone-pc-floater';
const POS_KEY = 'ggg-phone-pc-floater-pos';

let _onEnter = null;
let _onExit = null;
let _isPhoneOpen = false;
let _dragged = false;

export function mountPcFloater({ onEnter, onExit }) {
    _onEnter = onEnter;
    _onExit = onExit;
    if (document.getElementById(FLOATER_ID)) return;

    const el = document.createElement('div');
    el.id = FLOATER_ID;
    el.className = 'ggg-phone-pc-floater';
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', '呱呱手机入口');
    el.title = '呱呱手机：单击切换顶栏，双击进入手机，拖拽移动';
    el.innerHTML = `
        <div class="ggg-phone-pc-floater-icon">
            <i class="fa-solid fa-mobile-screen"></i>
        </div>
        <span class="ggg-phone-pc-floater-text">手机</span>
    `;

    // 关键定位（规避 <html> transform 包含块）
    const s = el.style;
    s.setProperty('position', 'fixed', 'important');
    s.setProperty('z-index', '99998', 'important');

    // 默认位置：贴右侧 sheld margin，纵向居中
    const saved = readPos();
    const defaultLeft = Math.max(window.innerWidth - 96, window.innerWidth * 0.92);
    const defaultTop = Math.round(window.innerHeight * 0.6);
    s.setProperty('left', `${saved?.left ?? defaultLeft}px`, 'important');
    s.setProperty('top', `${saved?.top ?? defaultTop}px`, 'important');

    document.body.appendChild(el);

    enableDrag(el);
    bindEntryGestures(el, {
        isOpen: () => _isPhoneOpen,
        onEnter: () => _onEnter?.(),
        onExit: () => _onExit?.(),
        draggedRef: () => _dragged,
    });

    // v0.2.17：3 秒无交互后贴最近的左/右边半隐藏（仅在确实贴近边缘时才隐藏）
    enablePcEdgeSnap(el);
}

const PC_IDLE_MS = 3000;
const PC_EDGE_THRESHOLD = 80; // 距边缘 ≤ 80px 才触发吸附隐藏
function enablePcEdgeSnap(el) {
    const reset = () => {
        if (el.classList.contains('edge-snap')) {
            el.classList.remove('edge-snap');
            const normal = el.dataset.normalLeft;
            if (normal != null) el.style.setProperty('left', `${normal}px`, 'important');
        }
        if (window.__ggg_pcfloater_idle) clearTimeout(window.__ggg_pcfloater_idle);
        window.__ggg_pcfloater_idle = setTimeout(() => doPcSnap(el), PC_IDLE_MS);
    };
    ['mousedown', 'touchstart', 'mousemove', 'mouseenter'].forEach(evt => {
        el.addEventListener(evt, reset, { passive: true });
    });
    reset();
}
function doPcSnap(el) {
    if (!el || !el.parentNode || _dragged) return;
    const r = el.getBoundingClientRect();
    const W = el.offsetWidth || 80;
    const distLeft = r.left;
    const distRight = window.innerWidth - r.right;
    const minDist = Math.min(distLeft, distRight);
    // 没贴近边缘就不藏
    if (minDist > PC_EDGE_THRESHOLD) return;
    const snapLeft = distLeft < distRight;
    const normalLeft = snapLeft ? 0 : (window.innerWidth - W);
    const hideLeft = snapLeft ? -Math.round(W / 2) : (window.innerWidth - Math.round(W / 2));
    el.dataset.normalLeft = String(normalLeft);
    el.classList.add('edge-snap');
    el.style.setProperty('left', `${hideLeft}px`, 'important');
}

export function unmountPcFloater() {
    if (window.__ggg_pcfloater_idle) {
        clearTimeout(window.__ggg_pcfloater_idle);
        window.__ggg_pcfloater_idle = null;
    }
    document.getElementById(FLOATER_ID)?.remove();
    document.documentElement.classList.remove('ggg-phone-topbar-hidden');
}

export function setPcFloaterPhoneOpen(open) {
    _isPhoneOpen = open;
    document.getElementById(FLOATER_ID)?.classList.toggle('open', open);
}

/* ---------- 拖拽 ---------- */
function enableDrag(el) {
    let startX = 0, startY = 0, origLeft = 0, origTop = 0;
    let dragging = false;

    const onDown = (e) => {
        const p = pointer(e);
        startX = p.x; startY = p.y;
        const r = el.getBoundingClientRect();
        origLeft = r.left; origTop = r.top;
        dragging = true;
        _dragged = false;
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
            const r = el.getBoundingClientRect();
            writePos({ left: r.left, top: r.top });
            // 延迟一点才允许下一次 tap，防 click 误触
            setTimeout(() => { _dragged = false; }, 50);
        }
    };

    el.addEventListener('mousedown', onDown);
    el.addEventListener('touchstart', onDown, { passive: true });
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
