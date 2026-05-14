/**
 * 世界书底部面板：把 #world_info 选择器替换为底部升起的可视化面板
 * - 移动端默认启用；PC 端可通过开关启用（用于测试）
 * - 同步原 <select multiple> 的选中状态，触发原生 change 事件，确保酒馆功能正常
 */
import { getSettings, saveAllSettings } from '../../index.js';
// 与 select-sheet 共享收藏存储（key 用 'world_info'）
import { getFavs, isFav, toggleFav, sortOptionsByFavs } from '../select-sheet/select-sheet.js';

const FAV_KEY = 'world_info';

let inited = false;
let observer = null;

const WI_SELECTOR = '#world_info';
const TRIGGER_ID = 'ggg-wi-trigger';
const SHEET_ID = 'ggg-wi-sheet';
let sheetViewportCleanup = null;

// ============================================================
// 初始化
// ============================================================
export function initWorldInfoSheet() {
    if (inited) return;
    inited = true;

    // 默认设置兜底
    const s = getSettings();
    if (!s.wiSheet) s.wiSheet = { enabled: false, pcMode: false };

    // 绑定面板内开关
    bindPanelControls();

    // 应用一次当前状态
    applyState();

    // 监听窗口尺寸变化（影响 mobile 判定）
    window.addEventListener('resize', () => debounce(applyState, 200));

    // 用 MutationObserver 等待 #world_info 出现 / 重建
    observer = new MutationObserver(() => {
        const sel = document.querySelector(WI_SELECTOR);
        if (sel && !sel.dataset.gggWiBound) applyState();
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

let _debTimer = null;
function debounce(fn, ms) {
    clearTimeout(_debTimer);
    _debTimer = setTimeout(fn, ms);
}

// ============================================================
// 状态判定 & 应用
// ============================================================
function isMobile() {
    // 与酒馆默认断点保持一致：宽度 < 1000px 视为移动
    return window.innerWidth < 1000;
}

function shouldEnable() {
    const s = getSettings();
    if (!s.enabled) return false;
    const ws = s.wiSheet || {};
    if (!ws.enabled) return false;
    return isMobile() || ws.pcMode;
}

// 导出供主入口在总开关切换时调用
export function reapplyWiSheetState() { applyState(); }

function applyState() {
    const sel = document.querySelector(WI_SELECTOR);
    if (!sel) return;
    if (shouldEnable()) {
        enableSheet(sel);
    } else {
        disableSheet(sel);
    }
}

// ============================================================
// 启用：隐藏原 select，注入触发按钮
// ============================================================
function enableSheet(sel) {
    sel.dataset.gggWiBound = '1';
    sel.classList.add('ggg-wi-hidden');

    // 同步隐藏 select2 包装器（select2 渲染的自定义下拉）
    hideSelect2For(sel);

    // 注入触发按钮 —— 使用 <select> 元素以继承酒馆原生 select 样式，
    // 但拦截原生下拉行为，改为打开我们的底部面板
    let trigger = document.getElementById(TRIGGER_ID);
    if (!trigger) {
        trigger = document.createElement('select');
        trigger.id = TRIGGER_ID;
        trigger.className = 'ggg-wi-trigger text_pole';
        trigger.innerHTML = '<option value="">选择世界书...</option>';
        // 阻止原生下拉，改为打开自定义面板
        // 移动端只走 touchend（避免 touchstart 后的合成 click 触发 overlay 关闭）
        // 桌面端走 mousedown
        let touchUsed = false;
        trigger.addEventListener('touchend', e => {
            touchUsed = true;
            e.preventDefault();
            e.stopPropagation();
            trigger.blur();
            openSheet(sel);
        }, { passive: false });
        trigger.addEventListener('mousedown', e => {
            if (touchUsed) { touchUsed = false; return; }
            e.preventDefault();
            e.stopPropagation();
            trigger.blur();
            openSheet(sel);
        });
        // 屏蔽 click（防止合成 click 二次触发）
        trigger.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
        trigger.addEventListener('keydown', e => {
            if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
                e.preventDefault();
                openSheet(sel);
            }
        });
        // 找到 select 的最后一个兄弟相关节点（select 或 select2-container），按钮插在其后
        const anchor = findSelect2For(sel) || sel;
        anchor.parentNode.insertBefore(trigger, anchor.nextSibling);
    }
    updateTriggerLabel(sel, trigger);

    // 同步：原 select 变化时刷新按钮文字
    if (!sel.dataset.gggWiListener) {
        sel.dataset.gggWiListener = '1';
        sel.addEventListener('change', () => {
            updateTriggerLabel(sel, document.getElementById(TRIGGER_ID));
        });
    }
}

function disableSheet(sel) {
    sel.classList.remove('ggg-wi-hidden');
    delete sel.dataset.gggWiBound;
    // 恢复 select2 包装器
    const s2 = findSelect2For(sel);
    if (s2) s2.classList.remove('ggg-wi-hidden');
    document.getElementById(TRIGGER_ID)?.remove();
    closeSheet();
}

/** 在 #world_info 周围找 select2 自动生成的容器节点 */
function findSelect2For(sel) {
    if (!sel || !sel.parentNode) return null;
    // select2 通常把 .select2-container 作为 select 的相邻兄弟插入
    let n = sel.nextElementSibling;
    while (n) {
        if (n.classList && n.classList.contains('select2-container')) return n;
        n = n.nextElementSibling;
    }
    // 退路：在父节点内查找含有 select2-world_info-container 的容器
    return sel.parentNode.querySelector('.select2-container');
}

function hideSelect2For(sel) {
    const s2 = findSelect2For(sel);
    if (s2) s2.classList.add('ggg-wi-hidden');
}

function isolateSheetPointerEvents(sheet) {
    const stop = (e) => e.stopPropagation();
    ['pointerdown','pointerup','mousedown','mouseup','touchstart','touchend','click']
        .forEach(ev => sheet.addEventListener(ev, stop));
}

function updateTriggerLabel(sel, trigger) {
    if (!trigger) return;
    const selected = Array.from(sel.selectedOptions);
    const total = sel.options.length;
    const count = selected.length;
    let preview = '';
    if (count === 0) {
        preview = `📖 未选择世界书 (共 ${total} 本)`;
    } else if (count <= 2) {
        preview = `📖 ${selected.map(o => o.textContent.trim()).join('、')}`;
    } else {
        preview = `📖 已选 ${count}/${total} 本`;
    }
    // 用单 option 显示当前状态
    const opt = trigger.options[0] || trigger.appendChild(document.createElement('option'));
    opt.textContent = preview;
    opt.value = '';
}

// ============================================================
// 底部面板
// ============================================================
// 移动浏览器非全屏时，100vh 可能包含浏览器栏收起后的额外高度。
// 这里用 visualViewport 作为真实可见区域，避免 sheet 底部被放到屏幕外。
function getSheetViewportRect() {
    const vv = window.visualViewport;
    return {
        width: Math.max(1, Math.floor(vv?.width || window.innerWidth || document.documentElement.clientWidth || 1)),
        height: Math.max(1, Math.floor(vv?.height || window.innerHeight || document.documentElement.clientHeight || 1)),
        top: Math.max(0, Math.floor(vv?.offsetTop || 0)),
        left: Math.max(0, Math.floor(vv?.offsetLeft || 0)),
    };
}

// 继续用 transform 拉到底部，以绕开酒馆 html transform 对 fixed/bottom 的干扰。
function applySheetViewport(sheet, overlay) {
    const rect = getSheetViewportRect();
    [sheet, overlay].filter(Boolean).forEach(el => {
        el.style.setProperty('--ggg-sheet-vh', `${rect.height}px`);
        el.style.setProperty('--ggg-sheet-vw', `${rect.width}px`);
        el.style.setProperty('--ggg-sheet-vv-top', `${rect.top}px`);
        el.style.setProperty('--ggg-sheet-vv-left', `${rect.left}px`);
    });
    if (overlay) {
        overlay.style.setProperty('top', `${rect.top}px`, 'important');
        overlay.style.setProperty('left', `${rect.left}px`, 'important');
        overlay.style.setProperty('width', `${rect.width}px`, 'important');
        overlay.style.setProperty('height', `${rect.height}px`, 'important');
    }
    if (sheet) {
        sheet.style.setProperty('top', `${rect.top}px`, 'important');
        sheet.style.setProperty('max-height', `${Math.floor(rect.height * 0.75)}px`, 'important');
    }
}

// sheet 打开期间监听可见视口变化，地址栏、软键盘、横竖屏变化时立即重新贴底。
function bindSheetViewport(sheet, overlay) {
    sheetViewportCleanup?.();
    const apply = () => applySheetViewport(sheet, overlay);
    apply();
    window.addEventListener('resize', apply, { passive: true });
    window.visualViewport?.addEventListener('resize', apply, { passive: true });
    window.visualViewport?.addEventListener('scroll', apply, { passive: true });
    sheetViewportCleanup = () => {
        window.removeEventListener('resize', apply);
        window.visualViewport?.removeEventListener('resize', apply);
        window.visualViewport?.removeEventListener('scroll', apply);
        sheetViewportCleanup = null;
    };
}

function openSheet(sel) {
    closeSheet();
    // overlay 与 sheet 拆为两个独立的 body 子节点 ——
    // 避免 overlay 的 backdrop-filter 在部分浏览器（尤其移动端）
    // 给后代 position:fixed 创建包含块，导致 sheet 定位错位/不可见
    const overlay = document.createElement('div');
    overlay.id = SHEET_ID;
    overlay.className = 'ggg-wi-overlay';

    const sheet = document.createElement('div');
    sheet.className = 'ggg-wi-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', '选择世界书');
    // 关键定位：酒馆可能给 <html> 设 transform，fixed 不能稳定依赖 bottom。
    // 用 visualViewport 写入可见高度，再通过 transform 把面板拉到当前可见底部。
    const inline = sheet.style;
    inline.setProperty('position', 'fixed', 'important');
    inline.setProperty('top', '0', 'important');
    inline.setProperty('bottom', 'auto', 'important');
    inline.setProperty('left', '0', 'important');
    inline.setProperty('right', '0', 'important');
    inline.setProperty('margin', '0 auto', 'important');
    inline.setProperty('width', '100%', 'important');
    inline.setProperty('max-width', '720px', 'important');
    inline.setProperty('z-index', '99999', 'important');
    inline.setProperty('transform', 'translateY(var(--ggg-sheet-vh, 100vh))', 'important');
    inline.setProperty('display', 'flex', 'important');
    inline.setProperty('flex-direction', 'column', 'important');
    sheet.innerHTML = `
        <div class="ggg-wi-sheet-handle"></div>
        <div class="ggg-wi-sheet-header">
            <i class="ggg-fa fa-solid fa-book-open"></i>
            <span class="ggg-wi-sheet-title">选择世界书</span>
            <input type="text" class="ggg-wi-search" placeholder="搜索…">
            <button class="ggg-wi-close" title="关闭"><i class="ggg-fa fa-solid fa-xmark"></i></button>
        </div>
        <div class="ggg-wi-sheet-toolbar">
            <button class="ggg-wi-btn-clear"><i class="ggg-fa fa-solid fa-eraser"></i> 全不选</button>
            <span class="ggg-wi-count">已选 0</span>
        </div>
        <div class="ggg-wi-sheet-body"></div>
    `;
    document.body.appendChild(overlay);
    document.body.appendChild(sheet);
    bindSheetViewport(sheet, overlay);

    // 渲染选项列表
    const body = sheet.querySelector('.ggg-wi-sheet-body');
    renderOptions(sel, body);

    // 事件
    sheet.querySelector('.ggg-wi-close').addEventListener('click', closeSheet);
    // overlay 关闭：mousedown 即时关 + 关后吞掉所有 pointer 事件，
    // 避免合成 click 穿透到下层 select / select2，触发酒馆原生下拉
    setTimeout(() => {
        const onDown = (e) => { e.preventDefault(); e.stopImmediatePropagation(); closeSheet(); };
        overlay.addEventListener('mousedown',  onDown, true);
        overlay.addEventListener('touchstart', onDown, { capture: true, passive: false });
    }, 250);

    sheet.querySelector('.ggg-wi-btn-clear').addEventListener('click', () => {
        Array.from(sel.options).forEach(o => o.selected = false);
        triggerNativeChange(sel);
        renderOptions(sel, body, sheet);
        updateTriggerLabel(sel, document.getElementById(TRIGGER_ID));
        updateSheetCount(sheet, sel);
    });

    const search = sheet.querySelector('.ggg-wi-search');
    search.addEventListener('input', () => {
        const kw = search.value.trim().toLowerCase();
        body.querySelectorAll('.ggg-wi-item').forEach(li => {
            const txt = li.dataset.text || '';
            li.style.display = (!kw || txt.includes(kw)) ? '' : 'none';
        });
    });
    // 阻止搜索框按键冒泡到酒馆快捷键
    ['keydown','keyup','keypress','input'].forEach(ev =>
        search.addEventListener(ev, e => e.stopPropagation()));

    // 阻止 sheet 内点击穿透到 overlay
    isolateSheetPointerEvents(sheet);

    // 重新渲染 + 计数
    renderOptions(sel, body, sheet);
    updateSheetCount(sheet, sel);

    // ESC 关闭
    const escHandler = e => { if (e.key === 'Escape') { closeSheet(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);

    // 触发动画 —— 用两次 rAF 确保浏览器先 commit 初始 transform，再 commit 动画终态
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            overlay.classList.add('open');
            sheet.classList.add('open');
            sheet.style.setProperty('transform', 'translateY(calc(var(--ggg-sheet-vh, 100vh) - 100%))', 'important');
        });
    });
}

function renderOptions(sel, body, sheet) {
    // 收藏置顶；按 select.options 的原始 index 记下来，便于点击时定位回原 select
    const optsWithIdx = Array.from(sel.options).map((o, idx) => ({ opt: o, idx }));
    const sorted = sortOptionsByFavs(
        optsWithIdx.map(x => ({ value: x.opt.value, _meta: x })),
        FAV_KEY
    ).map(x => x._meta);

    let lastWasFav = null;
    body.innerHTML = '';
    sorted.forEach(({ opt, idx }) => {
        const txt = (opt.textContent || '').trim();
        const checked = opt.selected ? 'checked' : '';
        const faved = isFav(FAV_KEY, opt.value);
        // 收藏与普通之间分隔
        if (lastWasFav === true && faved === false) {
            const sep = document.createElement('div');
            sep.className = 'ggg-ss-fav-sep';
            body.appendChild(sep);
        }
        lastWasFav = faved;

        const wrap = document.createElement('div');
        wrap.className = 'ggg-wi-item'
            + (opt.selected ? ' selected' : '')
            + (faved ? ' ggg-ss-faved' : '');
        wrap.dataset.idx = String(idx);
        wrap.dataset.text = escapeAttr(txt.toLowerCase());
        wrap.innerHTML = `
            <input type="checkbox" ${checked}>
            <span class="ggg-wi-item-name">${escapeHtml(txt)}</span>
            <div class="menu_button menu_button_icon ggg-ss-fav-btn ${faved ? 'on' : ''}" title="${faved ? '取消收藏' : '收藏'}">
                <i class="fa-${faved ? 'solid' : 'regular'} fa-heart"></i>
            </div>
        `;
        const cb = wrap.querySelector('input');
        cb.addEventListener('click', e => e.stopPropagation());
        cb.addEventListener('change', () => {
            sel.options[idx].selected = cb.checked;
            wrap.classList.toggle('selected', cb.checked);
            triggerNativeChange(sel);
            updateTriggerLabel(sel, document.getElementById(TRIGGER_ID));
            updateSheetCount(sheet || wrap.closest('.ggg-wi-sheet'), sel);
        });
        // 爱心按钮：与 select-sheet 共享同一份 selectFavs.world_info
        wrap.querySelector('.ggg-ss-fav-btn').addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            toggleFav(FAV_KEY, opt.value);
            renderOptions(sel, body, sheet);
        });
        body.appendChild(wrap);
    });
    if (sorted.length === 0) {
        body.innerHTML = '<div class="ggg-wi-empty">未发现世界书</div>';
    }
}

function updateSheetCount(scope, sel) {
    if (!scope) return;
    const cnt = scope.querySelector('.ggg-wi-count');
    if (cnt) cnt.textContent = `已选 ${Array.from(sel.selectedOptions).length}`;
}

function closeSheet() {
    const overlay = document.getElementById(SHEET_ID);
    const sheet = document.querySelector('.ggg-wi-sheet:not(.ggg-ss-sheet)');
    if (!overlay && !sheet) return;
    sheetViewportCleanup?.();
    overlay?.classList.remove('open');
    sheet?.classList.remove('open');
    sheet?.style.setProperty('transform', 'translateY(var(--ggg-sheet-vh, 100vh))', 'important');
    if (overlay) {
        const swallow = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
        ['click','mousedown','mouseup','touchstart','touchend','pointerdown','pointerup']
            .forEach(ev => overlay.addEventListener(ev, swallow, true));
    }
    setTimeout(() => { overlay?.remove(); sheet?.remove(); }, 220);
}

function triggerNativeChange(sel) {
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    // jQuery 兼容（酒馆很多代码监听 jQuery change）
    if (window.jQuery) window.jQuery(sel).trigger('change');
}

// ============================================================
// 设置面板内开关绑定
// ============================================================
function bindPanelControls() {
    document.addEventListener('change', e => {
        const t = e.target;
        if (!t || !t.id) return;
        const s = getSettings();
        if (!s.wiSheet) s.wiSheet = { enabled: false, pcMode: false };
        if (t.id === 'ggg-wi-toggle-enabled') {
            s.wiSheet.enabled = !!t.checked;
            saveAllSettings();
            applyState();
        } else if (t.id === 'ggg-wi-toggle-pc') {
            s.wiSheet.pcMode = !!t.checked;
            saveAllSettings();
            applyState();
        }
    });

    // 面板首次渲染时回填开关状态
    document.addEventListener('ggg-tab-shown', refreshControls);
    refreshControls();
}

function refreshControls() {
    const s = getSettings().wiSheet || {};
    const a = document.getElementById('ggg-wi-toggle-enabled');
    const b = document.getElementById('ggg-wi-toggle-pc');
    if (a) a.checked = !!s.enabled;
    if (b) b.checked = !!s.pcMode;
}

// ============================================================
// 工具函数
// ============================================================
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
