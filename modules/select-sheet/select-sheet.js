/**
 * Select Sheet：把酒馆里所有原生 <select>（含 select2 包装的）的下拉，
 * 替换为底部升起的可视化面板。复用 world-info-sheet.css 的 .ggg-wi-* 类。
 *
 * 设置：
 *   settings.selectSheet = { mobileEnabled, pcEnabled }
 *   settings.selectFavs  = { '<selectKey>': ['value', ...], ... }   // 收藏的选项值
 *
 * 实现要点：
 *   1. capture 阶段监听 mousedown/touchstart/keydown：
 *      - 命中可见原生 <select> → preventDefault + 弹面板
 *      - 命中 .select2-selection / .select2-container → 找到关联原生 select 弹面板
 *   2. 单选 / 多选 自适应；写回时派发原生 + jQuery change（兼容 select2 与酒馆代码）
 *   3. 收藏：每项右侧爱心按钮；面板列表按"已收藏 → 普通"排序，普通保持原顺序
 *   4. 在指定 select（settings_preset_openai / world_info / themes）右边注入爱心按钮
 *      点击 = 收藏当前选中项
 *   5. 排除已被 world-info-sheet 接管的 #world_info（避免双重劫持）
 */
import { getSettings, saveAllSettings } from '../../index.js';

let inited = false;

const MOBILE_BREAKPOINT = 1000;

// 需要在原 select 旁边注入"收藏当前选中"按钮的目标 select id
// 注：#world_info 已被 world-info-sheet 模块在面板内置爱心按钮，外面不再插
const FAV_BTN_TARGETS = ['settings_preset_openai', 'themes'];

// ============================================================
// 入口
// ============================================================
export function initSelectSheet() {
    if (inited) return;
    inited = true;

    const s = getSettings();
    if (!s.selectSheet) s.selectSheet = { mobileEnabled: true, pcEnabled: true };
    if (!s.selectFavs)  s.selectFavs  = {};

    // 全局劫持原生 select（capture 阶段）
    document.addEventListener('mousedown',  onSelectInteract, true);
    document.addEventListener('touchstart', onSelectInteract, true);
    document.addEventListener('keydown',    onSelectKey,      true);

    // select2 劫持（点击 .select2-selection 时弹我们的面板）
    document.addEventListener('mousedown',  onSelect2Interact, true);
    document.addEventListener('touchstart', onSelect2Interact, true);

    // 注入"收藏当前选中"按钮 + DOM 变化时持续补发
    installFavButtons();

    // 绑定扩展面板里的两个开关
    bindPanelControls();

    console.log('[ggg-select-sheet] 已初始化');
}

// ============================================================
// 收藏存储 helpers（导出，供 world-info-sheet 共享）
// ============================================================
export function getFavs(key) {
    const all = getSettings().selectFavs || {};
    return Array.isArray(all[key]) ? all[key] : [];
}
export function setFavs(key, arr) {
    const s = getSettings();
    if (!s.selectFavs) s.selectFavs = {};
    s.selectFavs[key] = Array.from(new Set(arr.filter(v => v != null && v !== '')));
    saveAllSettings();
}
export function isFav(key, value) {
    return getFavs(key).includes(String(value));
}
export function toggleFav(key, value, forceOn) {
    const arr = getFavs(key);
    const v = String(value);
    const idx = arr.indexOf(v);
    let next;
    if (forceOn === true)        next = idx >= 0 ? arr : [...arr, v];
    else if (forceOn === false)  next = idx >= 0 ? arr.filter(x => x !== v) : arr;
    else                         next = idx >= 0 ? arr.filter(x => x !== v) : [...arr, v];
    setFavs(key, next);
    return next.includes(v);
}
/** 把 options 数组按"收藏置顶"排序，普通项保持原顺序 */
export function sortOptionsByFavs(opts, key) {
    const favs = getFavs(key);
    if (favs.length === 0) return opts.slice();
    const favSet = new Set(favs);
    const head = [];
    const tail = [];
    opts.forEach(o => (favSet.has(String(o.value)) ? head : tail).push(o));
    // 收藏内部按收藏顺序排（用户最近加的在后面，但先按 value 在 favs 中的索引）
    head.sort((a, b) => favs.indexOf(String(a.value)) - favs.indexOf(String(b.value)));
    return head.concat(tail);
}
/** select id → 收藏 key 的别名表（让多个等价的 select 共享同一份收藏） */
const SELECT_KEY_ALIAS = {
    'world_editor_select': 'world_info', // 世界书编辑选择器与主开关共享
};
/** 取一个 select 的稳定 key —— 优先 id，其次 name，最后 class 兜底；并应用别名 */
export function getSelectKey(sel) {
    let raw = sel.id || sel.name || '';
    if (!raw) {
        // 用 class 列表里第一个非工具类作为 key（去掉酒馆/通用样式类）
        const skip = new Set(['flex1','text_pole','textarea_compact','widthFreeExpand','margin0','margin0auto']);
        const cls = (sel.className || '').split(/\s+/).filter(c => c && !skip.has(c));
        if (cls.length) raw = 'cls:' + cls[0];
    }
    return SELECT_KEY_ALIAS[raw] || raw;
}

/** phone 模块内的 select：在手机壳层中始终接管（无视 PC/手机开关） */
function isPhoneInternalSelect(sel) {
    if (!sel) return false;
    if (sel.classList && sel.classList.contains('ggg-set-select')) return true;
    // 闭合在手机外壳容器内的任何原生 select 也接管
    return !!sel.closest?.('.ggg-phone-root, .ggg-phone, .ggg-phone-pc-floater-frame');
}

/** 编辑（删除）支持表：select id → ST 删除按钮 selector */
const DELETE_BTN_MAP = {
    'settings_preset_openai': '#delete_oai_preset',
    'themes':                 '#ui-preset-delete-button',
    'world_info':             '#world_popup_delete',
    'world_editor_select':    '#world_popup_delete',
};
/** 哪些 select 启用编辑模式（铅笔按钮） */
const EDIT_MODE_TARGETS = new Set(Object.keys(DELETE_BTN_MAP));

// ============================================================
// 扩展面板里的开关
// ============================================================
function bindPanelControls() {
    document.addEventListener('change', e => {
        const t = e.target;
        if (!t || !t.id) return;
        const s = getSettings();
        if (!s.selectSheet) s.selectSheet = { mobileEnabled: true, pcEnabled: false };
        if (t.id === 'ggg-ss-toggle-mobile') {
            s.selectSheet.mobileEnabled = !!t.checked;
            saveAllSettings();
        } else if (t.id === 'ggg-ss-toggle-pc') {
            s.selectSheet.pcEnabled = !!t.checked;
            saveAllSettings();
        }
    });
    document.addEventListener('ggg-tab-shown', refreshControls);
    refreshControls();
}

function refreshControls() {
    const s = getSettings().selectSheet || {};
    const a = document.getElementById('ggg-ss-toggle-mobile');
    const b = document.getElementById('ggg-ss-toggle-pc');
    if (a) a.checked = !!s.mobileEnabled;
    if (b) b.checked = !!s.pcEnabled;
}

// ============================================================
// 启用判定
// ============================================================
function isMobileViewport() { return window.innerWidth < MOBILE_BREAKPOINT; }
function shouldEnable() {
    const s = getSettings();
    if (!s.enabled) return false;
    const ss = s.selectSheet || {};
    return isMobileViewport() ? !!ss.mobileEnabled : !!ss.pcEnabled;
}

function shouldHijack(sel) {
    if (!sel || sel.tagName !== 'SELECT') return false;
    if (sel.disabled) return false;
    if (sel.size && sel.size > 1) return false;
    if (sel.id && sel.id.startsWith('ggg-')) return false;
    if (sel.classList.contains('ggg-wi-hidden')) return false;
    if (sel.classList.contains('ggg-wi-trigger')) return false;
    if (!sel.options || sel.options.length < 1) return false;
    return true; // 不再检查 offsetParent —— select2 会把原 select 隐藏
}

// ============================================================
// 事件处理
// ============================================================
function onSelectInteract(e) {
    const sel = e.target;
    if (!sel || sel.tagName !== 'SELECT') return;
    if (!shouldHijack(sel)) return;
    // 手机模块内的 select 始终接管；其它 select 受开关控制
    if (!isPhoneInternalSelect(sel) && !shouldEnable()) return;
    if (sel.offsetParent === null && getComputedStyle(sel).display === 'none') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openSheet(sel);
}

function onSelectKey(e) {
    const sel = e.target;
    if (!sel || sel.tagName !== 'SELECT') return;
    if (!shouldHijack(sel)) return;
    if (!isPhoneInternalSelect(sel) && !shouldEnable()) return;
    const k = e.key;
    if (k === ' ' || k === 'Enter' || k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        e.stopImmediatePropagation();
        openSheet(sel);
    }
}

/** select2 包装器拦截：从 .select2-container 反查相邻的原 <select> */
function onSelect2Interact(e) {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const container = target.closest('.select2-container');
    if (!container) return;
    const sel = findSelectForSelect2(container);
    if (!sel) return;
    if (!shouldHijack(sel)) return;
    if (!isPhoneInternalSelect(sel) && !shouldEnable()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openSheet(sel);
}

function findSelectForSelect2(container) {
    // 1. 紧邻的前一个 select 兄弟
    let n = container.previousElementSibling;
    while (n) {
        if (n.tagName === 'SELECT') return n;
        n = n.previousElementSibling;
    }
    // 2. 父节点里查 select
    return container.parentNode?.querySelector('select');
}

function isolateSheetPointerEvents(sheet) {
    const stop = (e) => e.stopPropagation();
    ['pointerdown','pointerup','mousedown','mouseup','touchstart','touchend','click']
        .forEach(ev => sheet.addEventListener(ev, stop));
}

// ============================================================
// 收藏按钮注入到指定 select 旁边
// ============================================================
function installFavButtons() {
    const tryInject = () => FAV_BTN_TARGETS.forEach(id => injectFavBtnFor(id));
    tryInject();
    const mo = new MutationObserver(() => tryInject());
    mo.observe(document.body, { childList: true, subtree: true });
}

function injectFavBtnFor(selId) {
    const sel = document.getElementById(selId);
    if (!sel) return;
    const btnId = `ggg-fav-cur-${selId}`;
    if (document.getElementById(btnId)) {
        // 仅刷新激活态
        updateFavBtnActiveState(document.getElementById(btnId), sel);
        return;
    }
    // 沿用酒馆原生 .menu_button 样式，不加额外装饰
    const btn = document.createElement('div');
    btn.id = btnId;
    btn.className = 'menu_button menu_button_icon ggg-fav-cur-btn';
    btn.title = '收藏当前选中条目（再次点击取消）';
    btn.innerHTML = '<i class="fa-solid fa-heart"></i>';
    btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const cur = currentSelectedValues(sel);
        if (cur.length === 0) {
            if (window.toastr) toastr.info('当前没有选中条目');
            return;
        }
        const key = getSelectKey(sel);
        const allFaved = cur.every(v => isFav(key, v));
        // 全部已收藏 → 取消；否则 → 全部加入收藏
        cur.forEach(v => toggleFav(key, v, !allFaved));
        if (window.toastr) {
            toastr.success(allFaved
                ? `已取消收藏 ${cur.length} 项`
                : `已收藏 ${cur.length} 项`);
        }
        updateFavBtnActiveState(btn, sel);
    });
    // 监听原 select 变化时刷新按钮态
    sel.addEventListener('change', () => updateFavBtnActiveState(btn, sel));
    // 找插入锚点：如果有 select2 容器就插到容器后；否则插 select 后
    const s2 = findSelect2Sibling(sel);
    const anchor = s2 || sel;
    anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    updateFavBtnActiveState(btn, sel);
}

function findSelect2Sibling(sel) {
    let n = sel.nextElementSibling;
    while (n) {
        if (n.classList && n.classList.contains('select2-container')) return n;
        n = n.nextElementSibling;
    }
    return null;
}

function currentSelectedValues(sel) {
    if (sel.multiple) {
        return Array.from(sel.selectedOptions).map(o => o.value).filter(v => v !== '');
    }
    return sel.value ? [sel.value] : [];
}

function updateFavBtnActiveState(btn, sel) {
    const cur = currentSelectedValues(sel);
    const key = getSelectKey(sel);
    const allFaved = cur.length > 0 && cur.every(v => isFav(key, v));
    btn.classList.toggle('on', allFaved);
}

// ============================================================
// 渲染底部面板
// ============================================================
let activeSheet = null;

// 移动浏览器非全屏时，100vh 可能包含已收起的地址栏/底栏区域。
// 底部 sheet 必须按 visualViewport 的当前可见区域定位，否则最后几项会落在屏幕外。
function getSheetViewportRect() {
    const vv = window.visualViewport;
    return {
        width: Math.max(1, Math.floor(vv?.width || window.innerWidth || document.documentElement.clientWidth || 1)),
        height: Math.max(1, Math.floor(vv?.height || window.innerHeight || document.documentElement.clientHeight || 1)),
        top: Math.max(0, Math.floor(vv?.offsetTop || 0)),
        left: Math.max(0, Math.floor(vv?.offsetLeft || 0)),
    };
}

// 把可见视口尺寸写成 CSS 变量，保留 transform 定位方案以避开酒馆 html transform 的影响。
function applySheetViewport(panel, overlay) {
    const rect = getSheetViewportRect();
    const maxHeight = Math.floor(rect.height * (isMobileViewport() ? 0.80 : 0.75));
    [panel, overlay].filter(Boolean).forEach(el => {
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
    if (panel) {
        panel.style.setProperty('top', `${rect.top}px`, 'important');
        panel.style.setProperty('max-height', `${maxHeight}px`, 'important');
    }
}

// 地址栏/底栏、软键盘、横竖屏变化都会改变 visualViewport，sheet 打开期间需要持续跟随。
function bindSheetViewport(panel, overlay) {
    const apply = () => applySheetViewport(panel, overlay);
    apply();
    window.addEventListener('resize', apply, { passive: true });
    window.visualViewport?.addEventListener('resize', apply, { passive: true });
    window.visualViewport?.addEventListener('scroll', apply, { passive: true });
    return () => {
        window.removeEventListener('resize', apply);
        window.visualViewport?.removeEventListener('resize', apply);
        window.visualViewport?.removeEventListener('scroll', apply);
    };
}

function openSheet(sel) {
    if (activeSheet) closeSheet();

    const isMulti = !!sel.multiple;
    const allOpts = Array.from(sel.options);
    const selectKey = getSelectKey(sel);
    const editable = EDIT_MODE_TARGETS.has(sel.id || '');
    let pending = new Set(allOpts.filter(o => o.selected).map(o => o.value));

    // 编辑模式状态
    let editMode = false;
    let editChecked = new Set(); // 用于批量操作的勾选

    const overlay = document.createElement('div');
    overlay.className = 'ggg-wi-overlay ggg-ss-overlay';

    const panel = document.createElement('div');
    panel.className = 'ggg-wi-sheet ggg-ss-sheet';
    panel.style.cssText = `
        position: fixed !important;
        left: 0 !important; right: 0 !important;
        bottom: auto !important; top: 0 !important;
        margin: 0 auto !important;
        max-width: 720px !important;
        z-index: 99999 !important;
        display: flex !important; flex-direction: column !important;
        transform: translateY(var(--ggg-sheet-vh, 100vh)) !important;
    `;

    const labelText = guessLabelFor(sel) || (isMulti ? '请选择（多选）' : '请选择');

    panel.innerHTML = `
        <div class="ggg-wi-sheet-handle"></div>
        <div class="ggg-wi-sheet-header">
            <div class="ggg-wi-sheet-title">${escapeHtml(labelText)}</div>
            <input type="text" class="ggg-wi-search" placeholder="搜索…" />
            ${editable ? `
            <div class="menu_button menu_button_icon ggg-ss-edit-toggle" title="编辑模式（删除/批量收藏）">
                <i class="fa-solid fa-pen-to-square"></i>
            </div>` : ''}
            <button type="button" class="ggg-wi-close" title="关闭">✕</button>
        </div>
        ${isMulti ? `
        <div class="ggg-wi-sheet-toolbar">
            <button type="button" class="ggg-wi-btn-clear" data-act="clear">清空</button>
            <button type="button" class="ggg-wi-btn-clear" data-act="all">全选</button>
            <span class="ggg-wi-count"></span>
            <button type="button" class="ggg-wi-btn-clear" data-act="confirm" style="margin-left:6px;">完成</button>
        </div>` : ''}
        <div class="ggg-ss-edit-toolbar" style="display:none;">
            <button type="button" class="ggg-wi-btn-clear" data-eact="all">全选</button>
            <button type="button" class="ggg-wi-btn-clear" data-eact="invert">反选</button>
            <span class="ggg-ss-edit-count">已勾选 0</span>
            <button type="button" class="ggg-wi-btn-clear" data-eact="fav">批量收藏</button>
            <button type="button" class="ggg-wi-btn-clear" data-eact="unfav">批量取消收藏</button>
            <button type="button" class="ggg-wi-btn-clear danger" data-eact="del">批量删除</button>
        </div>
        <div class="ggg-wi-sheet-body"></div>
    `;
    document.body.appendChild(overlay);
    document.body.appendChild(panel);

    const body  = panel.querySelector('.ggg-wi-sheet-body');
    const search = panel.querySelector('.ggg-wi-search');
    const countEl = panel.querySelector('.ggg-wi-count');
    const editToolbar = panel.querySelector('.ggg-ss-edit-toolbar');
    const editToggle  = panel.querySelector('.ggg-ss-edit-toggle');
    const editCountEl = panel.querySelector('.ggg-ss-edit-count');

    const renderItems = (filter = '') => {
        body.innerHTML = '';
        const f = filter.trim().toLowerCase();

        // 收藏置顶
        const sortedOpts = sortOptionsByFavs(allOpts, selectKey);

        let visible = 0;
        let lastWasFav = null;
        sortedOpts.forEach((o) => {
            const optIndex = allOpts.indexOf(o);
            const selectedNow = isMulti ? pending.has(o.value) : sel.selectedIndex === optIndex;
            const text = (o.textContent || o.label || o.value || '').trim();
            if (f && !text.toLowerCase().includes(f)) return;
            visible++;

            const faved = isFav(selectKey, o.value);
            if (lastWasFav === true && faved === false) {
                const sep = document.createElement('div');
                sep.className = 'ggg-ss-fav-sep';
                body.appendChild(sep);
            }
            lastWasFav = faved;

            const item = document.createElement('div');
            item.className = 'ggg-wi-item'
                + (selectedNow ? ' selected' : '')
                + (faved ? ' ggg-ss-faved' : '');

            // 左侧：编辑模式 → 编辑勾选框；非编辑 → 原 checkbox/dot
            const leftPart = editMode
                ? `<input type="checkbox" class="ggg-ss-edit-cb" ${editChecked.has(o.value) ? 'checked' : ''} />`
                : (isMulti
                    ? `<input type="checkbox" ${pending.has(o.value) ? 'checked' : ''} />`
                    : (selectedNow
                        ? '<i class="ggg-ss-cur" title="当前">●</i>'
                        : '<i class="ggg-ss-cur" style="opacity:0;">●</i>'));

            // 右侧：编辑模式额外加 trash 单删按钮
            const trashPart = editMode
                ? `<div class="menu_button menu_button_icon ggg-ss-trash-btn" title="删除此条目">
                       <i class="fa-solid fa-trash"></i>
                   </div>`
                : '';

            item.innerHTML = `
                ${leftPart}
                <div class="ggg-wi-item-name">${escapeHtml(text)}</div>
                <div class="menu_button menu_button_icon ggg-ss-fav-btn ${faved ? 'on' : ''}" title="${faved ? '取消收藏' : '收藏'}">
                    <i class="fa-${faved ? 'solid' : 'regular'} fa-heart"></i>
                </div>
                ${trashPart}
            `;

            // 点条目本体
            item.addEventListener('click', (ev) => {
                if (ev.target.closest('.ggg-ss-fav-btn')) return;
                if (ev.target.closest('.ggg-ss-trash-btn')) return;
                ev.preventDefault();
                if (editMode) {
                    if (editChecked.has(o.value)) editChecked.delete(o.value);
                    else editChecked.add(o.value);
                    item.querySelector('.ggg-ss-edit-cb').checked = editChecked.has(o.value);
                    updateEditCount();
                } else if (isMulti) {
                    if (pending.has(o.value)) pending.delete(o.value);
                    else pending.add(o.value);
                    item.classList.toggle('selected');
                    const cb = item.querySelector('input[type=checkbox]');
                    if (cb) cb.checked = pending.has(o.value);
                    if (countEl) countEl.textContent = `已选 ${pending.size}`;
                } else {
                    pending = new Set([o.value]);
                    applySingleOptionByIndex(sel, optIndex);
                    closeSheet();
                }
            });
            // 爱心
            item.querySelector('.ggg-ss-fav-btn').addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                toggleFav(selectKey, o.value);
                renderItems(search.value);
                const curBtn = document.getElementById(`ggg-fav-cur-${sel.id}`);
                if (curBtn) updateFavBtnActiveState(curBtn, sel);
            });
            // trash 单删
            const trashBtn = item.querySelector('.ggg-ss-trash-btn');
            if (trashBtn) {
                trashBtn.addEventListener('click', async (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (!confirm(`确认删除「${text}」？\n这会触发酒馆的删除流程，可能还会再弹一次确认。`)) return;
                    await deleteOption(sel, o.value);
                });
            }
            body.appendChild(item);
        });

        if (visible === 0) {
            const empty = document.createElement('div');
            empty.className = 'ggg-wi-empty';
            empty.textContent = '没有匹配项';
            body.appendChild(empty);
        }
        if (countEl) countEl.textContent = `已选 ${pending.size}`;
        updateEditCount();
    };

    const updateEditCount = () => {
        if (editCountEl) editCountEl.textContent = `已勾选 ${editChecked.size}`;
    };

    // 编辑模式开关
    if (editToggle) {
        editToggle.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            editMode = !editMode;
            editToggle.classList.toggle('on', editMode);
            editToolbar.style.display = editMode ? 'flex' : 'none';
            // 退出编辑时清空勾选
            if (!editMode) editChecked.clear();
            renderItems(search.value);
        });
    }
    // 编辑工具栏动作
    panel.querySelectorAll('[data-eact]').forEach(btn => {
        btn.addEventListener('click', async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const act = btn.dataset.eact;
            const filteredOpts = allOpts.filter(o => {
                const t = (o.textContent || '').toLowerCase();
                const f = search.value.trim().toLowerCase();
                return !f || t.includes(f);
            });
            if (act === 'all') {
                filteredOpts.forEach(o => editChecked.add(o.value));
                renderItems(search.value); return;
            }
            if (act === 'invert') {
                filteredOpts.forEach(o => {
                    if (editChecked.has(o.value)) editChecked.delete(o.value);
                    else editChecked.add(o.value);
                });
                renderItems(search.value); return;
            }
            if (editChecked.size === 0) {
                if (window.toastr) toastr.info('请先勾选条目'); return;
            }
            const vals = Array.from(editChecked);
            if (act === 'fav') {
                vals.forEach(v => toggleFav(selectKey, v, true));
                if (window.toastr) toastr.success(`已收藏 ${vals.length} 项`);
                renderItems(search.value);
            } else if (act === 'unfav') {
                vals.forEach(v => toggleFav(selectKey, v, false));
                if (window.toastr) toastr.success(`已取消收藏 ${vals.length} 项`);
                renderItems(search.value);
            } else if (act === 'del') {
                if (!confirm(`确认删除已勾选的 ${vals.length} 项？\n会逐个触发酒馆删除流程，可能多次出现确认弹窗。`)) return;
                for (const v of vals) {
                    await deleteOption(sel, v);
                    await sleep(900);
                }
                editChecked.clear();
                renderItems(search.value);
            }
        });
    });

    // overlay 关闭：用 mousedown/touchstart（capture）即时关闭，
    // 后续 mouseup/click 全被 overlay 吞噬，避免误触发酒馆原生下拉
    // 注意：在移动端，触发本面板的 touchstart 之后浏览器会合成 mousedown/click
    //       立刻落到刚出现的 overlay 上，导致面板"闪现即关"。
    //       解决：先用一次性吞噬器吃掉首发合成事件，并把真正的关闭监听延后绑定。
    const swallowOnce = (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
    };
    ['mousedown','mouseup','click','touchstart','touchend','pointerdown','pointerup']
        .forEach(ev => overlay.addEventListener(ev, swallowOnce, true));
    const onOverlayDown = (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeSheet();
    };
    setTimeout(() => {
        // 解除一次性吞噬，绑定真正的关闭逻辑
        ['mousedown','mouseup','click','touchstart','touchend','pointerdown','pointerup']
            .forEach(ev => overlay.removeEventListener(ev, swallowOnce, true));
        overlay.addEventListener('mousedown',  onOverlayDown, true);
        overlay.addEventListener('touchstart', onOverlayDown, { capture: true, passive: false });
    }, 350);
    panel.querySelector('.ggg-wi-close').addEventListener('click', closeSheet);
    search.addEventListener('input', () => renderItems(search.value));
    ['keydown','keyup','keypress','input'].forEach(ev =>
        search.addEventListener(ev, e => e.stopPropagation()));
    isolateSheetPointerEvents(panel);

    if (isMulti) {
        panel.querySelectorAll('[data-act]').forEach(btn => {
            btn.addEventListener('click', () => {
                const act = btn.dataset.act;
                if (act === 'clear')   { pending = new Set(); renderItems(search.value); }
                if (act === 'all')     { pending = new Set(allOpts.map(o => o.value)); renderItems(search.value); }
                if (act === 'confirm') { applyToSelect(sel, pending); closeSheet(); }
            });
        });
    }

    const cleanupViewport = bindSheetViewport(panel, overlay);
    activeSheet = { overlay, panel, select: sel, cleanupViewport };
    renderItems('');

    // 入场动画（两次 rAF 让初始 transform 先 commit）
    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.classList.add('open');
        panel.style.setProperty('transform', 'translateY(calc(var(--ggg-sheet-vh, 100vh) - 100%))', 'important');
    }));

    // ESC 关闭
    const escH = e => { if (e.key === 'Escape') { closeSheet(); document.removeEventListener('keydown', escH); } };
    document.addEventListener('keydown', escH);

    if (!isMobileViewport()) setTimeout(() => search.focus(), 60);
}

function closeSheet() {
    if (!activeSheet) return;
    const { overlay, panel, cleanupViewport } = activeSheet;
    activeSheet = null;
    cleanupViewport?.();
    panel.style.setProperty('transform', 'translateY(var(--ggg-sheet-vh, 100vh))', 'important');
    overlay.classList.remove('open');
    // 关闭过程中保留 overlay 拦截一切 pointer 事件，避免合成 click 穿透到下层
    // 比如恰好点在某个 select / select2 上，会触发酒馆原生下拉
    const swallow = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
    ['click','mousedown','mouseup','touchstart','touchend','pointerdown','pointerup']
        .forEach(ev => overlay.addEventListener(ev, swallow, true));
    setTimeout(() => { overlay.remove(); panel.remove(); }, 240);
}

// ============================================================
// 删除单个 option（通过触发酒馆原生删除按钮）
// ============================================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function deleteOption(sel, value) {
    const btnSelector = DELETE_BTN_MAP[sel.id];
    if (!btnSelector) {
        if (window.toastr) toastr.warning('该下拉不支持删除');
        return false;
    }
    // 1. 写回该 value 让酒馆当前选中目标条目
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    try {
        const $ = window.jQuery || window.$;
        if ($) $(sel).trigger('change');
    } catch (e) {}
    await sleep(120);
    // 2. 触发酒馆删除按钮（可能弹 confirm，由用户确认）
    const btn = document.querySelector(btnSelector);
    if (!btn) {
        if (window.toastr) toastr.warning(`未找到删除按钮：${btnSelector}`);
        return false;
    }
    btn.click();
    return true;
}

// ============================================================
// 写回 select + 派发事件
// ============================================================
function applyToSelect(sel, pending) {
    let changed = false;
    if (sel.multiple) {
        Array.from(sel.options).forEach(o => {
            const want = pending.has(o.value);
            if (o.selected !== want) { o.selected = want; changed = true; }
        });
    } else {
        const v = pending.size > 0 ? pending.values().next().value : '';
        if (sel.value !== v) { sel.value = v; changed = true; }
    }
    if (!changed) return;
    sel.dispatchEvent(new Event('input',  { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    try {
        const $ = window.jQuery || window.$;
        if ($) $(sel).trigger('change');
    } catch (e) {}
}

function applySingleOptionByIndex(sel, index) {
    if (index < 0 || index >= sel.options.length) return;
    const changed = sel.selectedIndex !== index;
    if (changed) sel.selectedIndex = index;
    if (!changed) return;
    sel.dispatchEvent(new Event('input',  { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    try {
        const $ = window.jQuery || window.$;
        if ($) $(sel).trigger('change');
    } catch (e) {}
}

// ============================================================
// 工具
// ============================================================
function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function guessLabelFor(sel) {
    if (sel.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(sel.id)}"]`);
        if (lbl) return lbl.textContent.trim();
    }
    const wrapLbl = sel.closest('label');
    if (wrapLbl) {
        const txt = wrapLbl.textContent.replace(sel.textContent || '', '').trim();
        if (txt) return txt;
    }
    const prev = sel.previousElementSibling;
    if (prev && prev.textContent && prev.textContent.length < 40) {
        return prev.textContent.trim();
    }
    return '';
}
