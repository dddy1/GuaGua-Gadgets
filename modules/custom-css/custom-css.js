/**
 * 自定义CSS/HTML注入模块
 * CSS：注入为 <style> 标签到 <head>，绑定当前主题
 * HTML：支持任意 HTML（含 <script>），注入到指定 DOM 位置
 */
import { getThemeData, saveAllSettings, getCurrentThemeName } from '../../index.js';
// 不直接导入 ui-custom，避免循环依赖；改用自定义事件通知扫描刷新
const EVT_CSS_SAVED = 'ggg-custom-css-saved';

// ============================================================
// 辅助：获取当前主题数据（自动初始化缺失字段）
// ============================================================
function getCustomData() {
    const theme = getThemeData();
    if (theme.customCSS === undefined) theme.customCSS = '';
    if (!Array.isArray(theme.customHTML)) theme.customHTML = [];
    return theme;
}

// ============================================================
// CSS 注入
// ============================================================
let cssStyleEl = null;

export function injectCustomCSS() {
    const css = getThemeData().customCSS || '';
    if (!cssStyleEl) {
        cssStyleEl = document.createElement('style');
        cssStyleEl.id = 'ggg-custom-css-inject';
        document.head.appendChild(cssStyleEl);
    }
    cssStyleEl.textContent = css;
}

// ============================================================
// HTML 注入
// ============================================================
// 已注入的 wrapper 元素 Map<id, Element>
const injectedEls = new Map();

/**
 * 修复：innerHTML 插入的 <script> 标签不会执行。
 * 将 wrapper 内所有 <script> 替换为新建的 script 元素，触发浏览器执行。
 */
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
    if (!item.enabled) return;

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

    // 用 MutationObserver 追踪脚本激活时在 wrapper 外部添加的节点，删除时一并清理
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
        // 清理脚本在 wrapper 外部添加的元素（如 head 里的 style、body 里的 overlay span）
        el._ext?.forEach(node => { try { node.remove(); } catch {} });
        el.remove();
        injectedEls.delete(id);
    } else {
        document.getElementById(`ggg-html-${id}`)?.remove();
    }
}

export function injectAllCustomHTML() {
    [...injectedEls.keys()].forEach(removeHTMLItem);
    for (const item of getCustomData().customHTML) injectHTMLItem(item);
}

// ============================================================
// 面板 UI
// ============================================================
export function initCustomCSS() {
    bindCSSSection();
    bindHTMLSection();
    bindExportImport();
    bindAIPromptCopy();
    bindSillyTavernThemeSave();
}

// ---- CSS 区 ----
function bindCSSSection() {
    const ta = document.getElementById('ggg-custom-css-textarea');
    if (!ta) return;
    ta.value = getCustomData().customCSS || '';

    document.getElementById('ggg-custom-css-save')?.addEventListener('click', () => {
        getCustomData().customCSS = ta.value;
        saveAllSettings();
        injectCustomCSS();
        // 通知 UI主题自定义 面板重新扫描 ggg 标记
        document.dispatchEvent(new CustomEvent(EVT_CSS_SAVED));
        // 尝试同时保存酒馆主题（best-effort）
        triggerSillyTavernThemeSave();
        flashTip('ggg-custom-css-tip', '✓ 已保存并生效');
    });
}

// ---- HTML 区 ----
function bindHTMLSection() {
    document.getElementById('ggg-custom-html-add')?.addEventListener('click', addHTMLItem);
    refreshHTMLList();
}

function addHTMLItem() {
    const html  = (document.getElementById('ggg-custom-html-textarea')?.value || '').trim();
    const label = (document.getElementById('ggg-custom-html-label')?.value   || '').trim();
    const sel   = (document.getElementById('ggg-custom-html-target')?.value  || '').trim();
    const pos   = document.getElementById('ggg-custom-html-pos')?.value || 'beforeend';

    if (!html) { toastr.warning('请先输入 HTML 或 Script 内容'); return; }

    const item = {
        id:       `h_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,
        label:    label || '自定义片段',
        html, target: sel, position: pos, enabled: true,
    };

    getCustomData().customHTML.push(item);
    saveAllSettings();
    injectHTMLItem(item);

    document.getElementById('ggg-custom-html-textarea').value = '';
    document.getElementById('ggg-custom-html-label').value    = '';
    document.getElementById('ggg-custom-html-target').value   = '';

    refreshHTMLList();
    flashTip('ggg-custom-html-tip', '✓ 已注入');
}

function refreshHTMLList() {
    const container = document.getElementById('ggg-custom-html-list');
    if (!container) return;
    const list = getCustomData().customHTML;

    if (!list.length) {
        container.innerHTML = '<div class="ggg-chtml-empty">暂无注入片段</div>';
        return;
    }

    container.innerHTML = list.map(item => `
        <div class="ggg-chtml-item ${item.enabled ? '' : 'ggg-chtml-disabled'}" data-id="${item.id}">
            <label class="ggg-chtml-check-wrap" title="启用/停用">
                <input type="checkbox" class="ggg-chtml-toggle" data-id="${item.id}" ${item.enabled ? 'checked' : ''}>
            </label>
            <span class="ggg-chtml-label">${esc(item.label)}</span>
            <span class="ggg-chtml-pos-badge">${item.target ? esc(item.target) : '&lt;body&gt;末尾'}</span>
            <button class="ggg-chtml-btn-del" data-id="${item.id}" title="删除">✕</button>
        </div>
    `).join('');

    container.querySelectorAll('.ggg-chtml-toggle').forEach(cb => {
        cb.addEventListener('change', () => {
            const item = getCustomData().customHTML.find(i => i.id === cb.dataset.id);
            if (!item) return;
            item.enabled = cb.checked;
            saveAllSettings();
            if (item.enabled) injectHTMLItem(item); else removeHTMLItem(item.id);
            refreshHTMLList();
        });
    });

    container.querySelectorAll('.ggg-chtml-btn-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const data = getCustomData();
            removeHTMLItem(btn.dataset.id);
            data.customHTML = data.customHTML.filter(i => i.id !== btn.dataset.id);
            saveAllSettings();
            refreshHTMLList();
        });
    });
}

// ---- 导出 / 导入 ----
function bindExportImport() {
    // 导出
    document.getElementById('ggg-custom-export')?.addEventListener('click', () => {
        const data  = getCustomData();
        const theme = getCurrentThemeName();
        const json  = JSON.stringify({
            _ggg: true, theme,
            customCSS:  data.customCSS  || '',
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

    // 导入
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
            if (parsed.customCSS !== undefined) {
                data.customCSS = parsed.customCSS;
                const ta = document.getElementById('ggg-custom-css-textarea');
                if (ta) ta.value = parsed.customCSS;
            }
            if (Array.isArray(parsed.customHTML)) {
                data.customHTML = parsed.customHTML;
                refreshHTMLList();
            }
            saveAllSettings();
            injectCustomCSS();
            injectAllCustomHTML();
            toastr.success('导入成功，已重新应用');
        } catch (e) {
            toastr.error('文件解析失败：' + e.message);
        }
    });
}

// ---- 主题切换 ----
export function onThemeChangedCustomCSS() {
    injectCustomCSS();
    injectAllCustomHTML();
    const ta = document.getElementById('ggg-custom-css-textarea');
    if (ta) ta.value = getCustomData().customCSS || '';
    refreshHTMLList();
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
        // 提取纯文本（HTML实体还原）
        const text = pre.innerText || pre.textContent || '';
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // 降级：创建临时 textarea 复制
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
        // 按钮反馈：短暂显示「已复制」
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
/**
 * 尝试找到酒馆的「保存主题」按钮并双向绑定：
 *  - 酒馆保存主题时 → 同时保存我们的 CSS/HTML 数据
 * 注：我们的「保存并应用」本身已调用 saveAllSettings()，
 *     不需要再反向触发酒馆保存（酒馆没有可编程调用的主题文件导出 API）。
 */
function bindSillyTavernThemeSave() {
    // 延迟等待酒馆 UI 完全渲染
    setTimeout(() => {
        // 常见酒馆主题保存按钮选择器（不同版本可能不同，用多个备用）
        const SELECTORS = [
            '#save_theme_name',
            '#create_theme_name',
            '[data-i18n="Save Theme"]',
            '[data-i18n="Create Theme"]',
        ];
        let btn = null;
        for (const sel of SELECTORS) {
            btn = document.querySelector(sel);
            if (btn) break;
        }
        if (!btn || btn.dataset.gggBound) return;
        btn.dataset.gggBound = '1';
        btn.addEventListener('click', () => {
            // 酒馆保存主题时，确保我们的数据也被一并持久化
            saveAllSettings();
        });
    }, 2500);
}

/** 尝试触发酒馆主题保存（best-effort，找不到按钮则静默跳过） */
function triggerSillyTavernThemeSave() {
    const SELECTORS = ['#save_theme_name', '#create_theme_name'];
    for (const sel of SELECTORS) {
        const btn = document.querySelector(sel);
        if (btn) {
            // 以编程方式触发（不执行原有 click 处理，避免重复导出文件）
            // 只需额外调用 saveSettingsDebounced 即可，已在 saveAllSettings 里完成
            break;
        }
    }
    // saveAllSettings 已经调用了 saveSettingsDebounced，此处无需额外操作
}
