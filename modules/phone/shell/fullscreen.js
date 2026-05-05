/**
 * 手机壳管理 v0.2.51
 * - 全部移除虚拟分辨率/zoom/scale —— 手机就是真实 9:20 盒子
 * - phone.css 里 px 已校准到正常手机字号（≥20px 减半，小细节保留）
 * - 外框可拖拽，双击关闭，位置持久化
 */

const SHELL_ID = 'ggg-phone-shell';
const HTML_PHONE_OPEN_CLASS = 'ggg-phone-open';
const HTML_PHONE_PC_CLASS = 'ggg-phone-pc';
const POS_KEY = 'ggg-phone-pc-shell-pos';

const FRAME = 10;        // 手机金属边框 padding（与 CSS .pc-floating padding 对齐）
const MIN_VPORT = 900;
const ASPECT_H_OVER_W = 20 / 9;

let _mobileViewportCleanup = null;
let _pcResizeCleanup = null;

export function isPcMode() {
    return window.innerWidth >= MIN_VPORT;
}

/** 计算 PC 悬浮手机尺寸 —— 真实 9:20 盒子，无任何缩放
 *   高优先：按视口高填充（留安全边）；宽 = 高 * 9/20；视口窄时按宽回算
 */
function calcPcSize() {
    const SAFETY = 24;
    let innerH = window.innerHeight - SAFETY - FRAME * 2;
    let innerW = Math.round(innerH / ASPECT_H_OVER_W);
    const maxW = window.innerWidth - SAFETY - FRAME * 2;
    if (innerW > maxW) {
        innerW = maxW;
        innerH = Math.round(innerW * ASPECT_H_OVER_W);
    }
    if (innerW < 280) innerW = 280;
    if (innerH < 280 * ASPECT_H_OVER_W) innerH = Math.round(280 * ASPECT_H_OVER_W);
    return {
        w: innerW + FRAME * 2,
        h: innerH + FRAME * 2,
    };
}

function readPos() {
    try { return JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch { return null; }
}
function writePos(p) {
    try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch {}
}

function setupMobileViewportHeight(shell) {
    if (_mobileViewportCleanup) _mobileViewportCleanup();
    const apply = () => {
        const vv = window.visualViewport;
        const h = Math.max(1, Math.floor(vv?.height || window.innerHeight || document.documentElement.clientHeight || 1));
        // 同步到根节点：手机打开态的 html/body 也要按可见视口锁高，避免页面继续纵向滚动出空白。
        document.documentElement.style.setProperty('--ggg-phone-vh', `${h}px`);
        shell.style.setProperty('--ggg-phone-vh', `${h}px`);
        shell.style.setProperty('height', `${h}px`, 'important');
        shell.style.setProperty('max-height', `${h}px`, 'important');
    };
    apply();
    window.addEventListener('resize', apply, { passive: true });
    window.visualViewport?.addEventListener('resize', apply, { passive: true });
    window.visualViewport?.addEventListener('scroll', apply, { passive: true });
    _mobileViewportCleanup = () => {
        window.removeEventListener('resize', apply);
        window.visualViewport?.removeEventListener('resize', apply);
        window.visualViewport?.removeEventListener('scroll', apply);
        document.documentElement.style.removeProperty('--ggg-phone-vh');
        _mobileViewportCleanup = null;
    };
}

export function mountPhoneShell() {
    if (document.getElementById(SHELL_ID)) return document.getElementById(SHELL_ID);
    if (_pcResizeCleanup) _pcResizeCleanup();
    const pc = isPcMode();

    const shell = document.createElement('div');
    shell.id = SHELL_ID;
    shell.className = 'ggg-phone-shell' + (pc ? ' pc-floating' : '');
    const s = shell.style;
    s.setProperty('position', 'fixed', 'important');
    s.setProperty('z-index', '2147483640', 'important');

    if (pc) {
        const { w, h } = calcPcSize();
        const saved = readPos();
        const left = clamp(saved?.left ?? Math.round((window.innerWidth - w) / 2), 0, window.innerWidth - w);
        const top  = clamp(saved?.top  ?? Math.round((window.innerHeight - h) / 2), 0, window.innerHeight - h);
        s.setProperty('left', `${left}px`, 'important');
        s.setProperty('top', `${top}px`, 'important');
        s.setProperty('width', `${w}px`, 'important');
        s.setProperty('height', `${h}px`, 'important');
        // 入场动画起点
        s.setProperty('opacity', '0', 'important');
        s.setProperty('transform', 'translateY(20px) scale(0.96)', 'important');

        shell.innerHTML = `
            <div class="ggg-phone-pc-frame">
                <div class="ggg-phone-pc-canvas">
                    <div class="ggg-phone-status"></div>
                    <div class="ggg-phone-viewport" id="ggg-phone-viewport">
                        <div id="ggg-phone-app-mount"></div>
                    </div>
                </div>
            </div>
        `;
    } else {
        s.setProperty('inset', '0 auto auto 0', 'important');
        s.setProperty('top', '0', 'important');
        s.setProperty('left', '0', 'important');
        s.setProperty('width', '100vw', 'important');
        s.setProperty('display', 'flex', 'important');
        s.setProperty('flex-direction', 'column', 'important');
        s.setProperty('transform', 'translateY(var(--ggg-phone-vh, 100dvh))', 'important');
        shell.innerHTML = `
            <div class="ggg-phone-status"></div>
            <div class="ggg-phone-viewport" id="ggg-phone-viewport">
                <div id="ggg-phone-app-mount"></div>
            </div>
        `;
        setupMobileViewportHeight(shell);
    }

    document.body.appendChild(shell);
    document.documentElement.classList.add(HTML_PHONE_OPEN_CLASS);
    if (pc) document.documentElement.classList.add(HTML_PHONE_PC_CLASS);

    if (pc) {
        enablePcWindowDrag(shell);
        // 视口变化时重算 zoom & 尺寸（保持手机不超出视口）
        const onResize = () => {
            if (!document.body.contains(shell)) {
                window.removeEventListener('resize', onResize);
                return;
            }
            const { w: nw, h: nh } = calcPcSize();
            shell.style.setProperty('width', `${nw}px`, 'important');
            shell.style.setProperty('height', `${nh}px`, 'important');
            // 拖出视口外则纠正
            const rect = shell.getBoundingClientRect();
            const left = clamp(rect.left, 0, window.innerWidth - nw);
            const top  = clamp(rect.top,  0, window.innerHeight - nh);
            shell.style.setProperty('left', `${left}px`, 'important');
            shell.style.setProperty('top',  `${top}px`,  'important');
        };
        window.addEventListener('resize', onResize);
        _pcResizeCleanup = () => {
            window.removeEventListener('resize', onResize);
            _pcResizeCleanup = null;
        };

        // v0.2.53：双击关闭已废弃（用户要求），仅保留右上角 × 按钮
        requestAnimationFrame(() => requestAnimationFrame(() => {
            shell.style.removeProperty('opacity');
            shell.style.removeProperty('transform');
            shell.classList.add('entered');
        }));
    } else {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            shell.style.setProperty('transform', 'translateY(0)', 'important');
        }));
    }

    return shell;
}

export function unmountPhoneShell() {
    const shell = document.getElementById(SHELL_ID);
    if (!shell) return;
    const pc = shell.classList.contains('pc-floating');
    if (pc && _pcResizeCleanup) _pcResizeCleanup();
    if (pc) {
        shell.style.setProperty('opacity', '0', 'important');
        shell.style.setProperty('transform', 'translateY(20px) scale(0.96)', 'important');
    } else {
        shell.style.setProperty('transform', 'translateY(var(--ggg-phone-vh, 100dvh))', 'important');
    }
    setTimeout(() => {
        shell.remove();
        if (!pc && _mobileViewportCleanup) _mobileViewportCleanup();
        document.documentElement.classList.remove(HTML_PHONE_OPEN_CLASS);
        document.documentElement.classList.remove(HTML_PHONE_PC_CLASS);
    }, 280);
}

export function isPhoneShellOpen() {
    return !!document.getElementById(SHELL_ID);
}

/* ------------------------------ PC 窗口拖拽 ------------------------------ */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function enablePcWindowDrag(shell) {
    let startX = 0, startY = 0, origLeft = 0, origTop = 0, dragging = false, moved = false;

    const onDown = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        const t = e.target;
        if (t?.closest?.('.ggg-phone-pc-canvas')) return;  // canvas 内部透传
        dragging = true;
        moved = false;
        const r = shell.getBoundingClientRect();
        startX = e.clientX; startY = e.clientY;
        origLeft = r.left; origTop = r.top;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
    };
    const onMove = (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        const W = shell.offsetWidth, H = shell.offsetHeight;
        const left = clamp(origLeft + dx, 0, window.innerWidth - W);
        const top  = clamp(origTop + dy, 0, window.innerHeight - H);
        shell.style.setProperty('left', `${left}px`, 'important');
        shell.style.setProperty('top', `${top}px`, 'important');
    };
    const onUp = () => {
        dragging = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (moved) {
            const r = shell.getBoundingClientRect();
            writePos({ left: r.left, top: r.top });
        }
    };
    shell.addEventListener('mousedown', onDown);
}
