/**
 * 注入HTML 模块（原"自定义CSS"模块）
 * 每个条目同时包含 CSS（注入为独立 <style>）+ HTML（注入到 DOM）
 * 数据结构：theme.customHTML[] = { id, label, css, html, target, position, enabled }
 * 旧版 theme.customCSS 字符串会在首次读取时迁移成一条独立条目
 */
import { getThemeData, saveAllSettings, getCurrentThemeName } from '../../index.js';
const EVT_CSS_SAVED = 'ggg-custom-css-saved';

// ============================================================
// 数据：获取并自动迁移
// ============================================================
function getCustomData() {
    const theme = getThemeData();
    if (!Array.isArray(theme.customHTML)) theme.customHTML = [];
    // 旧版 customCSS（单一字符串）→ 迁移为一条独立条目
    if (theme.customCSS && !theme._cssMigrated) {
        theme.customHTML.unshift({
            id: `migrated_${Date.now()}`,
            label: '已迁移：旧版自定义CSS',
            css: theme.customCSS,
            html: '',
            target: '',
            position: 'beforeend',
            enabled: true,
        });
        theme.customCSS = '';
        theme._cssMigrated = true;
    }
    // 兼容旧 customHTML（无 css 字段的条目）
    theme.customHTML.forEach(it => {
        if (it.css === undefined) it.css = '';
        if (it.html === undefined) it.html = '';
    });
    return theme;
}

// ============================================================
// CSS 注入（按条目独立 style 标签）
// ============================================================
const cssEls = new Map(); // itemId → <style>

function injectItemCSS(item) {
    removeItemCSS(item.id);
    if (!item.enabled || !item.css?.trim()) return;
    const el = document.createElement('style');
    el.id = `ggg-css-${item.id}`;
    el.dataset.gggCss = item.id;
    el.textContent = item.css;
    document.head.appendChild(el);
    cssEls.set(item.id, el);
}

function removeItemCSS(id) {
    const el = cssEls.get(id);
    if (el) { el.remove(); cssEls.delete(id); }
    else document.getElementById(`ggg-css-${id}`)?.remove();
}

/** 兼容旧 API：注入所有条目的 CSS */
export function injectCustomCSS() {
    [...cssEls.keys()].forEach(removeItemCSS);
    for (const item of getCustomData().customHTML) injectItemCSS(item);
}

// ============================================================
// HTML 注入
// ============================================================
const injectedEls = new Map();

function activateScripts(wrapper) {
    wrapper.querySelectorAll('script').forEach(old => {
        const s = document.createElement('script');
        [...old.attributes].forEach(a => s.setAttribute(a.name, a.value));
        s.textContent = old.textContent;
        old.replaceWith(s);
    });
}

function injectHTMLItem(item) {
    removeHTMLItem(item.id);
    if (!item.enabled || !item.html?.trim()) return;

    let wrapper;
    try {
        const tpl = document.createElement('div');
        tpl.innerHTML = item.html.trim();
        wrapper = document.createElement('div');
        wrapper.id = `ggg-html-${item.id}`;
        wrapper.dataset.gggHtml = item.id;
        wrapper.style.display = 'contents';
        while (tpl.firstChild) wrapper.appendChild(tpl.firstChild);
    } catch (err) {
        console.warn('[ggg] HTML片段解析失败:', item.label, err);
        return;
    }

    // 追踪脚本激活时在 wrapper 外部添加的节点，删除时一并清理
    const externalNodes = [];
    const mo = new MutationObserver(muts => {
        for (const m of muts) {
            for (const node of m.addedNodes) {
                if (node.nodeType === 1 && !wrapper.contains(node)) {
                    externalNodes.push(node);
                }
            }
        }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    const selector = (item.target || '').trim();
    const position = item.position || 'beforeend';

    if (selector) {
        const target = document.querySelector(selector);
        if (target) {
            try {
                target.insertAdjacentElement(position, wrapper);
                injectedEls.set(item.id, wrapper);
                activateScripts(wrapper);
                mo.disconnect();
                wrapper._ext = externalNodes;
                return;
            } catch (err) {
                console.warn(`[ggg] 插入失败（${selector} / ${position}）:`, err);
            }
        } else {
            console.warn(`[ggg] 找不到选择器: ${selector}，改为注入到 body 末尾`);
        }
    }

    document.body.appendChild(wrapper);
    injectedEls.set(item.id, wrapper);
    activateScripts(wrapper);
    mo.disconnect();
    wrapper._ext = externalNodes;
}

function removeHTMLItem(id) {
    const el = injectedEls.get(id);
    if (el) {
        el._ext?.forEach(node => { try { node.remove(); } catch {} });
        el.remove();
        injectedEls.delete(id);
    } else {
        document.getElementById(`ggg-html-${id}`)?.remove();
    }
}

/** 注入所有启用的条目（CSS + HTML） */
export function injectAllCustomHTML() {
    [...injectedEls.keys()].forEach(removeHTMLItem);
    [...cssEls.keys()].forEach(removeItemCSS);
    for (const item of getCustomData().customHTML) {
        injectItemCSS(item);
        injectHTMLItem(item);
    }
}

// ============================================================
// 编辑状态
// ============================================================
let editingId = null;          // 当前正在编辑的条目 id
let originalCSS = '';          // 编辑时保留原值用于"取消"
let originalHTML = '';
let originalLabel = '';
let originalTarget = '';
let originalPosition = 'beforeend';

// ============================================================
// 面板初始化
// ============================================================
export function initCustomCSS() {
    bindCSSSection();
    bindHTMLSection();
    bindExportImport();
    bindAIPromptCopy();
    bindSillyTavernThemeSave();
    refreshHTMLList();
    updateEditUI();
}

// ---- CSS 区 ----
function bindCSSSection() {
    const ta = document.getElementById('ggg-custom-css-textarea');
    if (!ta) return;

    // CSS 实时生效（仅在编辑状态下）
    ta.addEventListener('input', () => {
        if (!editingId) return;
        const item = getCustomData().customHTML.find(i => i.id === editingId);
        if (!item) return;
        // 临时更新（不写入存储）
        const tmp = { ...item, css: ta.value };
        injectItemCSS(tmp);
    });

    // 保存 CSS（覆盖原数据）
    document.getElementById('ggg-custom-css-save')?.addEventListener('click', () => {
        if (editingId) {
            const item = getCustomData().customHTML.find(i => i.id === editingId);
            if (!item) return;
            item.css = ta.value;
            saveAllSettings();
            injectItemCSS(item);
            document.dispatchEvent(new CustomEvent(EVT_CSS_SAVED));
            triggerSillyTavernThemeSave();
            flashTip('ggg-custom-css-tip', '✓ CSS 已保存');
        } else {
            // 不在编辑模式：当作"新建条目"，只填了 CSS 框
            saveAsNewItem();
        }
    });

    // 取消 CSS 修改
    document.getElementById('ggg-custom-css-cancel')?.addEventListener('click', () => {
        if (!editingId) {
            ta.value = '';
            return;
        }
        const item = getCustomData().customHTML.find(i => i.id === editingId);
        if (!item) return;
        ta.value = item.css || '';
        injectItemCSS(item); // 恢复保存版
        flashTip('ggg-custom-css-tip', '已撤销修改');
    });
}

// ---- HTML 区 ----
function bindHTMLSection() {
    const ta = document.getElementById('ggg-custom-html-textarea');
    if (!ta) return;

    // 测试注入：用当前文本框的 HTML 临时注入（不写入存储）
    document.getElementById('ggg-custom-html-test')?.addEventListener('click', () => {
        const html  = ta.value;
        const label = document.getElementById('ggg-custom-html-label')?.value?.trim() || '测试';
        const sel   = document.getElementById('ggg-custom-html-target')?.value?.trim() || '';
        const pos   = document.getElementById('ggg-custom-html-pos')?.value || 'beforeend';
        const id    = editingId || `__test__`;
        const tmp   = { id, label, css: '', html, target: sel, position: pos, enabled: true };
        injectHTMLItem(tmp);
        flashTip('ggg-custom-html-tip', '✓ 已测试注入（未保存）');
    });

    // 保存 HTML
    document.getElementById('ggg-custom-html-save')?.addEventListener('click', () => {
        if (editingId) {
            const item = getCustomData().customHTML.find(i => i.id === editingId);
            if (!item) return;
            item.html     = ta.value;
            item.label    = document.getElementById('ggg-custom-html-label')?.value?.trim() || item.label;
            item.target   = document.getElementById('ggg-custom-html-target')?.value?.trim() || '';
            item.position = document.getElementById('ggg-custom-html-pos')?.value || 'beforeend';
            saveAllSettings();
            injectHTMLItem(item);
            refreshHTMLList();
            flashTip('ggg-custom-html-tip', '✓ HTML 已保存');
        } else {
            saveAsNewItem();
        }
    });

    // 取消 HTML 修改
    document.getElementById('ggg-custom-html-cancel')?.addEventListener('click', () => {
        if (!editingId) {
            ta.value = '';
            return;
        }
        const item = getCustomData().customHTML.find(i => i.id === editingId);
        if (!item) return;
        ta.value = item.html || '';
        injectHTMLItem(item);
        flashTip('ggg-custom-html-tip', '已撤销修改');
    });

    // 退出编辑模式
    document.getElementById('ggg-custom-edit-exit')?.addEventListener('click', exitEditMode);
}

/** 把当前输入框作为一条新条目保存 */
function saveAsNewItem() {
    const css   = document.getElementById('ggg-custom-css-textarea')?.value || '';
    const html  = document.getElementById('ggg-custom-html-textarea')?.value || '';
    const label = document.getElementById('ggg-custom-html-label')?.value?.trim() || '';
    const sel   = document.getElementById('ggg-custom-html-target')?.value?.trim() || '';
    const pos   = document.getElementById('ggg-custom-html-pos')?.value || 'beforeend';

    if (!css.trim() && !html.trim()) {
        toastr.warning('请至少在 CSS 框或 HTML 框输入内容');
        return;
    }
    // 残留清理：测试注入 / 上一条编辑的预览
    removeHTMLItem('__test__');
    if (editingId) {
        const prev = getCustomData().customHTML.find(i => i.id === editingId);
        if (prev) { injectItemCSS(prev); injectHTMLItem(prev); }
        editingId = null;
    }

    const item = {
        id:       `c_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,
        label:    label || (css.trim() ? '自定义CSS' : '自定义HTML'),
        css, html, target: sel, position: pos, enabled: true,
    };
    getCustomData().customHTML.push(item);
    saveAllSettings();
    injectItemCSS(item);
    injectHTMLItem(item);
    document.dispatchEvent(new CustomEvent(EVT_CSS_SAVED));
    clearAllInputs();
    updateEditUI();
    refreshHTMLList();
    flashTip('ggg-custom-html-tip', '✓ 已新建条目');
}

function clearAllInputs() {
    const ids = ['ggg-custom-css-textarea','ggg-custom-html-textarea','ggg-custom-html-label','ggg-custom-html-target'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const pos = document.getElementById('ggg-custom-html-pos');
    if (pos) pos.value = 'beforeend';
}

/** 进入编辑模式：把条目数据回填到输入框 */
function enterEditMode(id) {
    const item = getCustomData().customHTML.find(i => i.id === id);
    if (!item) return;

    // 先清理可能残留的"测试"注入和上次编辑的实时预览
    removeHTMLItem('__test__');
    if (editingId && editingId !== id) {
        const prev = getCustomData().customHTML.find(i => i.id === editingId);
        if (prev) { injectItemCSS(prev); injectHTMLItem(prev); }
    }

    editingId = id;
    originalCSS      = item.css || '';
    originalHTML     = item.html || '';
    originalLabel    = item.label || '';
    originalTarget   = item.target || '';
    originalPosition = item.position || 'beforeend';

    const cssTa   = document.getElementById('ggg-custom-css-textarea');
    const htmlTa  = document.getElementById('ggg-custom-html-textarea');
    const labelEl = document.getElementById('ggg-custom-html-label');
    const targEl  = document.getElementById('ggg-custom-html-target');
    const posEl   = document.getElementById('ggg-custom-html-pos');
    if (cssTa)   cssTa.value   = originalCSS;
    if (htmlTa)  htmlTa.value  = originalHTML;
    if (labelEl) labelEl.value = originalLabel;
    if (targEl)  targEl.value  = originalTarget;
    if (posEl)   posEl.value   = originalPosition;

    updateEditUI();
    refreshHTMLList();
    cssTa?.scrollIntoView({ behavior:'smooth', block:'center' });
}

function exitEditMode() {
    // 恢复正在编辑条目的原始 CSS/HTML（撤销未保存的实时预览）
    if (editingId) {
        const item = getCustomData().customHTML.find(i => i.id === editingId);
        if (item) {
            injectItemCSS(item);
            injectHTMLItem(item);
        }
        // 移除可能残留的"测试"注入
        if (editingId !== '__test__') removeHTMLItem('__test__');
    }
    editingId = null;
    clearAllInputs();
    updateEditUI();
    refreshHTMLList();
}

function updateEditUI() {
    const banner = document.getElementById('ggg-custom-edit-banner');
    const nameEl = document.getElementById('ggg-custom-edit-name');
    const saveCssBtn  = document.getElementById('ggg-custom-css-save');
    const saveHtmlBtn = document.getElementById('ggg-custom-html-save');

    if (editingId) {
        const item = getCustomData().customHTML.find(i => i.id === editingId);
        if (banner) banner.style.display = 'flex';
        if (nameEl) nameEl.textContent = item?.label || '未命名';
        if (saveCssBtn)  saveCssBtn.querySelector('span').textContent  = '保存 CSS';
        if (saveHtmlBtn) saveHtmlBtn.querySelector('span').textContent = '保存 HTML';
    } else {
        if (banner) banner.style.display = 'none';
        if (saveCssBtn)  saveCssBtn.querySelector('span').textContent  = '新建条目';
        if (saveHtmlBtn) saveHtmlBtn.querySelector('span').textContent = '新建条目';
    }
}

function refreshHTMLList() {
    const container = document.getElementById('ggg-custom-html-list');
    if (!container) return;
    const list = getCustomData().customHTML;

    if (!list.length) {
        container.innerHTML = '<div class="ggg-chtml-empty">暂无注入条目，下方填写 CSS/HTML 后点"新建条目"添加</div>';
        return;
    }

    container.innerHTML = list.map(item => {
        const hasCSS  = !!item.css?.trim();
        const hasHTML = !!item.html?.trim();
        const tags = [];
        if (hasCSS)  tags.push('<span class="ggg-chtml-typetag css" title="包含 CSS">CSS</span>');
        if (hasHTML) tags.push('<span class="ggg-chtml-typetag html" title="包含 HTML">HTML</span>');
        const isEditing = editingId === item.id;
        return `
        <div class="ggg-chtml-item ${item.enabled ? '' : 'ggg-chtml-disabled'} ${isEditing ? 'ggg-chtml-editing' : ''}" data-id="${item.id}">
            <label class="ggg-chtml-check-wrap" title="启用/停用">
                <input type="checkbox" class="ggg-chtml-toggle" data-id="${item.id}" ${item.enabled ? 'checked' : ''}>
            </label>
            <span class="ggg-chtml-label">${esc(item.label)}</span>
            ${tags.join('')}
            ${item.target ? `<span class="ggg-chtml-pos-badge">${esc(item.target)}</span>` : ''}
            <button class="ggg-chtml-btn-edit" data-id="${item.id}" title="${isEditing ? '正在编辑' : '编辑'}">
                <i class="ggg-fa fa-solid ${isEditing ? 'fa-pen' : 'fa-pen-to-square'}"></i>
            </button>
            <button class="ggg-chtml-btn-del" data-id="${item.id}" title="删除">✕</button>
        </div>`;
    }).join('');

    container.querySelectorAll('.ggg-chtml-toggle').forEach(cb => {
        cb.addEventListener('change', () => {
            const item = getCustomData().customHTML.find(i => i.id === cb.dataset.id);
            if (!item) return;
            item.enabled = cb.checked;
            saveAllSettings();
            if (item.enabled) { injectItemCSS(item); injectHTMLItem(item); }
            else { removeItemCSS(item.id); removeHTMLItem(item.id); }
            refreshHTMLList();
        });
    });

    container.querySelectorAll('.ggg-chtml-btn-edit').forEach(btn => {
        btn.addEventListener('click', () => enterEditMode(btn.dataset.id));
    });

    container.querySelectorAll('.ggg-chtml-btn-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            const data = getCustomData();
            removeItemCSS(id);
            removeHTMLItem(id);
            data.customHTML = data.customHTML.filter(i => i.id !== id);
            if (editingId === id) { editingId = null; clearAllInputs(); updateEditUI(); }
            saveAllSettings();
            refreshHTMLList();
        });
    });
}

// ---- 导出 / 导入 ----
function bindExportImport() {
    document.getElementById('ggg-custom-export')?.addEventListener('click', () => {
        const data  = getCustomData();
        const theme = getCurrentThemeName();
        const json  = JSON.stringify({
            _ggg: true, theme,
            customHTML: data.customHTML || [],
        }, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ggg-custom-${theme || 'data'}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        flashTip('ggg-export-tip', '✓ 已导出');
    });

    const fileInput = document.getElementById('ggg-custom-import-file');
    document.getElementById('ggg-custom-import')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        fileInput.value = '';
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            if (!parsed._ggg) { toastr.error('不是有效的呱呱导出文件'); return; }
            const data = getCustomData();
            // 兼容旧格式：单一 customCSS 字符串
            if (parsed.customCSS) {
                data.customHTML.unshift({
                    id: `imported_css_${Date.now()}`,
                    label: '导入：旧版自定义CSS',
                    css: parsed.customCSS,
                    html: '', target: '', position: 'beforeend', enabled: true,
                });
            }
            if (Array.isArray(parsed.customHTML)) {
                // 合并：导入条目都加新 id 防冲突
                parsed.customHTML.forEach(it => {
                    data.customHTML.push({
                        ...it,
                        id: `imp_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,
                        css:  it.css  || '',
                        html: it.html || '',
                    });
                });
            }
            saveAllSettings();
            injectAllCustomHTML();
            refreshHTMLList();
            document.dispatchEvent(new CustomEvent(EVT_CSS_SAVED));
            toastr.success('导入成功，已重新应用');
        } catch (e) {
            toastr.error('文件解析失败：' + e.message);
        }
    });
}

// ---- 主题切换 ----
export function onThemeChangedCustomCSS() {
    editingId = null;
    clearAllInputs();
    injectAllCustomHTML();
    refreshHTMLList();
    updateEditUI();
}

// ---- 工具 ----
function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function flashTip(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 2000);
}

// ============================================================
// AI 提示词复制按钮
// ============================================================
function bindAIPromptCopy() {
    const btn = document.getElementById('ggg-ai-prompt-copy');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        const pre = document.getElementById('ggg-ai-prompt-text');
        if (!pre) return;
        const text = pre.innerText || pre.textContent || '';
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
        const icon = btn.querySelector('i');
        const span = btn.querySelector('span');
        const origIcon = icon?.className || '';
        const origText = span?.textContent || '';
        if (icon) icon.className = 'ggg-fa fa-solid fa-check';
        if (span) span.textContent = '已复制！';
        btn.disabled = true;
        setTimeout(() => {
            if (icon) icon.className = origIcon;
            if (span) span.textContent = origText;
            btn.disabled = false;
        }, 1800);
    });
}

// ============================================================
// 与酒馆主题保存同步
// ============================================================
function bindSillyTavernThemeSave() {
    setTimeout(() => {
        const SELECTORS = ['#save_theme_name','#create_theme_name','[data-i18n="Save Theme"]','[data-i18n="Create Theme"]'];
        let btn = null;
        for (const sel of SELECTORS) { btn = document.querySelector(sel); if (btn) break; }
        if (!btn || btn.dataset.gggBound) return;
        btn.dataset.gggBound = '1';
        btn.addEventListener('click', () => saveAllSettings());
    }, 2500);
}

function triggerSillyTavernThemeSave() {
    // saveAllSettings 已经调用了 saveSettingsDebounced，无需额外操作
}
