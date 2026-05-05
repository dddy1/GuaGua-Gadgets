/**
 * UI主题自定义模块
 */
import { getSettings, getCurrentThemeName, setCurrentThemeName, getThemeName, getThemeData, saveAllSettings } from '../../index.js';
import { getAllTags } from '../gallery/gallery.js';

// 酒馆主题变量定义
const THEME_VARS = [
    { variable: '--SmartThemeBodyColor', label: '主要文本' },
    { variable: '--SmartThemeEmColor', label: '斜体文本' },
    { variable: '--SmartThemeUnderlineColor', label: '下划线文本' },
    { variable: '--SmartThemeQuoteColor', label: '引用文本' },
    { variable: '--SmartThemeShadowColor', label: '阴影颜色' },
    { variable: '--SmartThemeBorderColor', label: '边框颜色' },
    { variable: '--SmartThemeBlurTintColor', label: 'UI背景' },
    { variable: '--SmartThemeChatTintColor', label: '聊天背景' },
    { variable: '--SmartThemeUserMesBlurTintColor', label: '用户消息模糊色调' },
    { variable: '--SmartThemeBotMesBlurTintColor', label: 'AI消息模糊色调' },
];

const OVERRIDE_STYLE_ID = 'ggg-overrides';

// 正则
const GGG_IMG_RE = /\/\*\s*ggg-img(?:-(user|char))?\s*:\s*(.+?)\s*\*\/\s*(?:[^;]*?)url\(\s*['"]([^'"]*)['"]\s*\)/gi;
const GGG_TEXT_RE = /\/\*\s*ggg-text(?:-(user|char))?\s*:\s*(.+?)\s*\*\/\s*(?:[^;]*?)content:\s*"([^"]*)"/gi;
const GGG_COLOR_ABOVE_RE = /\/\*\s*ggg-color(?:-(user|char))?\s*:\s*(.+?)\s*\*\/\s*\n\s*([\w-]+)\s*:\s*([^;]+);/gi;
const GGG_COLOR_INLINE_RE = /([\w-]+)\s*:\s*\/\*\s*ggg-color(?:-(user|char))?\s*:\s*(.+?)\s*\*\/\s*([^;]+);/gi;
const GGG_DIM_RE = /\/\*\s*ggg-dim(?:-(user|char))?\s*:\s*(.+?)\s*\*\/\s*\n\s*([\w-]+)\s*:\s*([^;]+);/gi;

let parsedImages = [];
let parsedTexts = [];
let parsedColors = [];
let parsedDims = [];
let expandedImageIndex = -1;
let expandedColorIndex = -1;
let expandedThemeVarIndex = -1;
let overrides = {};
let imagePreviewResizeInstalled = false;
let imagePreviewResizeTimer = null;
let imagePreviewResizeObserver = null;

function colorPickerValue(evt, fallback = '#000000') {
    return evt?.detail?.rgba || evt?.detail?.hex || evt?.target?.rgba || evt?.target?.hex || fallback;
}

// ============================================================
// 导出
// ============================================================
export function initUICustom() {
    injectUICustomPanel();
    loadCurrentThemeData();
    initPresets();
    scanCSS();
    renderThemeVars();
    injectOverrideStyle();
    installImagePreviewResizeHandler();
}

export function onThemeChangedUICustom(newTheme) {
    saveCurrentThemeData();
    const styleEl = document.getElementById(OVERRIDE_STYLE_ID);
    if (styleEl) styleEl.textContent = '';
    setCurrentThemeName(newTheme);
    loadCurrentThemeData();
    // 若无存档，自动创建并加载默认空存档
    const data = getThemeData();
    if (!data.presets) data.presets = {};
    if (Object.keys(data.presets).length === 0) {
        data.presets['默认'] = {
            overrides: {},
            themeVars: {},
        };
        data.currentPreset = '默认';
        overrides = {};
        data.themeVars = {};
        saveAllSettings();
    }
    scanCSS();
    injectOverrideStyle();
    requestAnimationFrame(() => injectOverrideStyle());
    refreshPresetList();
    renderThemeVars();
    const el = document.getElementById('ggg-ui-custom-theme-name');
    if (el) el.textContent = newTheme;
}

/** 监听自定义CSS保存事件，重新扫描 ggg 标记（让颜色/图片等面板即时更新） */
document.addEventListener('ggg-custom-css-saved', () => scanCSS());

export function injectOverrideStyle() {
    let styleEl = document.getElementById(OVERRIDE_STYLE_ID);
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = OVERRIDE_STYLE_ID;
        document.head.appendChild(styleEl);
    }

    const settings = getSettings();
    if (!settings.enabled || !settings.beautifyEnabled) {
        styleEl.textContent = '';
        return;
    }

    let css = '/* ggg overrides */\n';
    for (const [key, data] of Object.entries(overrides)) {
        if (!data || !data.selector) continue;
        let declarations = '';
        if (data._multiProps && data._multiProps.length > 0) {
            declarations = data._multiProps.map(p => `${p} !important`).join('; ') + ';';
        } else if (data.property && data.value) {
            declarations = `${data.property}: ${data.value} !important;`;
        } else continue;

        let rule = '';
        if (data.atRule) {
            rule = `${data.atRule} { ${data.selector} { ${declarations} } }`;
        } else {
            const sel = data.selector === ':root' ? ':root' :
                        data.selector.startsWith('body') ? data.selector : `body ${data.selector}`;
            rule = `${sel} { ${declarations} }`;
        }
        css += rule + '\n';
    }

    // 主题变量覆盖
    const themeData = getThemeData();
    const themeVars = themeData.themeVars || {};
    if (Object.keys(themeVars).length > 0) {
        let varDecls = '';
        for (const [varName, value] of Object.entries(themeVars)) {
            varDecls += `${varName}: ${value} !important; `;
        }
        css += `:root { ${varDecls} }\n`;
    }

    styleEl.textContent = css;
}

// ============================================================
// 主题数据
// ============================================================
function saveCurrentThemeData() {
    const themeName = getCurrentThemeName();
    if (!themeName) return;
    const data = getThemeData();
    data.overrides = JSON.parse(JSON.stringify(overrides));
    // 同步到活动存档
    if (data.currentPreset && data.presets?.[data.currentPreset]) {
        data.presets[data.currentPreset].overrides = JSON.parse(JSON.stringify(overrides));
        data.presets[data.currentPreset].themeVars = JSON.parse(JSON.stringify(data.themeVars || {}));
    }
    saveAllSettings();
}

function loadCurrentThemeData() {
    const data = getThemeData();
    if (!data.themeVars) data.themeVars = {};
    overrides = {};
    // 如果有活动存档，从存档加载（修复切换存档后刷新显示旧存档的问题）
    if (data.currentPreset && data.presets?.[data.currentPreset]) {
        const preset = data.presets[data.currentPreset];
        overrides = JSON.parse(JSON.stringify(preset.overrides || {}));
        data.themeVars = JSON.parse(JSON.stringify(preset.themeVars || {}));
    } else {
        overrides = JSON.parse(JSON.stringify(data.overrides || {}));
        data.themeVars = JSON.parse(JSON.stringify(data.themeVars || {}));
    }
}



// ============================================================
// 面板注入
// ============================================================
function injectUICustomPanel() {
    if (document.getElementById('ggg-ui-custom-panel')) return;

    const panelHTML = `
    <div id="ggg-ui-custom-panel" class="inline-drawer wide100p flexFlowColumn">
        <div id="ggg-ui-custom-toggle" class="inline-drawer-toggle inline-drawer-header userSettingsInnerExpandable">
            <b><span>UI主题自定义</span></b>
            <div id="ggg-ui-custom-chevron" class="fa-solid inline-drawer-icon interactable down fa-circle-chevron-down" tabindex="0" role="button"></div>
        </div>
        <div id="ggg-ui-custom-content" class="inline-drawer-content" style="display: none; max-height: 0; overflow: hidden;">
            <div id="ggg-ui-custom-toolbar">
                <div id="ggg-ui-custom-status">
                    <span class="ggg-label">当前主题：</span>
                    <span id="ggg-ui-custom-theme-name">-</span>
                </div>
                <div id="ggg-ui-custom-actions">
                    <div id="ggg-btn-reset-all" class="menu_button menu_button_icon ggg-btn-small" title="恢复所有默认"><i class="ggg-fa fa-solid fa-rotate-left"></i></div>
                    <div id="ggg-btn-refresh" class="menu_button menu_button_icon ggg-btn-small" title="重新扫描CSS"><i class="ggg-fa fa-solid fa-arrows-rotate"></i></div>
                </div>
            </div>
            <div id="ggg-presets-bar">
                <span class="ggg-label" style="font-size:0.8em;">存档：</span>
                <select id="ggg-preset-select" class="text_pole"></select>
                <div id="ggg-btn-save-preset" class="menu_button menu_button_icon ggg-btn-small" title="另存为新存档"><i class="ggg-fa fa-solid fa-file-circle-plus"></i></div>
                <div id="ggg-btn-update-preset" class="menu_button menu_button_icon ggg-btn-small" title="更新当前存档"><i class="ggg-fa fa-solid fa-floppy-disk"></i></div>
                <div id="ggg-btn-delete-preset" class="menu_button menu_button_icon ggg-btn-small" title="删除当前存档"><i class="ggg-fa fa-solid fa-trash"></i></div>
                <div id="ggg-btn-export-preset" class="menu_button menu_button_icon ggg-btn-small" title="导出存档"><i class="ggg-fa fa-solid fa-file-export"></i></div>
                <div id="ggg-btn-import-preset" class="menu_button menu_button_icon ggg-btn-small" title="导入存档"><i class="ggg-fa fa-solid fa-file-import"></i></div>
            </div>
            <div id="ggg-ui-custom-subtabs">
                <div class="ggg-subtab active" data-subtab="images"><i class="ggg-fa fa-solid fa-image"></i> 图片</div>
                <div class="ggg-subtab" data-subtab="texts"><i class="ggg-fa fa-solid fa-pen"></i> 文字</div>
                <div class="ggg-subtab" data-subtab="colors"><i class="ggg-fa fa-solid fa-droplet"></i> 颜色</div>
                <div class="ggg-subtab" data-subtab="dims"><i class="ggg-fa fa-solid fa-ruler-combined"></i> 尺寸</div>
            </div>
            <div id="ggg-subpanel-images" class="ggg-subpanel active">
                <div id="ggg-images-list"></div>
                <div id="ggg-no-images" class="ggg-empty-state"><div class="ggg-empty-icon"><i class="ggg-fa fa-solid fa-image"></i></div><div>没有找到图片标记</div><div class="ggg-empty-hint">在CSS中添加 <code>/* ggg-img: 名称 */</code></div></div>
            </div>
            <div id="ggg-subpanel-texts" class="ggg-subpanel">
                <div id="ggg-texts-list"></div>
                <div id="ggg-no-texts" class="ggg-empty-state"><div class="ggg-empty-icon"><i class="ggg-fa fa-solid fa-pen"></i></div><div>没有找到文字标记</div><div class="ggg-empty-hint">在CSS中添加 <code>/* ggg-text: 名称 */</code></div></div>
            </div>
            <div id="ggg-subpanel-colors" class="ggg-subpanel">
                <div class="ggg-drawer open" data-drawer="css-colors">
                    <div class="ggg-drawer-header"><i class="ggg-fa fa-solid fa-chevron-down ggg-drawer-arrow"></i> 自定义CSS颜色</div>
                    <div class="ggg-drawer-body">
                        <div id="ggg-colors-list"></div>
                        <div id="ggg-no-colors" class="ggg-empty-state"><div class="ggg-empty-icon"><i class="ggg-fa fa-solid fa-droplet"></i></div><div>没有找到颜色标记</div><div class="ggg-empty-hint">在CSS中添加 <code>/* ggg-color: 名称 */</code></div></div>
                    </div>
                </div>
                <div class="ggg-drawer" data-drawer="theme-colors">
                    <div class="ggg-drawer-header"><i class="ggg-fa fa-solid fa-chevron-right ggg-drawer-arrow"></i> 主题颜色</div>
                    <div class="ggg-drawer-body" style="display:none;">
                        <div id="ggg-themevars-list"></div>
                    </div>
                </div>
            </div>
            <div id="ggg-subpanel-dims" class="ggg-subpanel">
                <div id="ggg-dims-list"></div>
                <div id="ggg-no-dims" class="ggg-empty-state"><div class="ggg-empty-icon"><i class="ggg-fa fa-solid fa-ruler-combined"></i></div><div>没有找到尺寸标记</div><div class="ggg-empty-hint">在CSS中添加 <code>/* ggg-dim: 名称 */</code></div></div>
            </div>
        </div>
    </div>`;

    const allDrawers = document.querySelectorAll('.inline-drawer.wide100p.flexFlowColumn');
    let themeColorDrawer = null;
    allDrawers.forEach(el => {
        const header = el.querySelector('.inline-drawer-header b span, .inline-drawer-header strong');
        if (header && header.textContent.trim() === '主题颜色') themeColorDrawer = el;
    });

    if (themeColorDrawer) $(themeColorDrawer).before(panelHTML);
    else {
        const userSettings = document.getElementById('user-settings-block');
        if (userSettings) $(userSettings).append(panelHTML);
    }

    // 折叠展开
    const toggleEl = document.getElementById('ggg-ui-custom-toggle');
    const contentEl = document.getElementById('ggg-ui-custom-content');
    const chevronEl = document.getElementById('ggg-ui-custom-chevron');

    if (toggleEl && contentEl && chevronEl) {
        toggleEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isOpen = contentEl.style.display !== 'none';
            if (isOpen) {
                const h = contentEl.scrollHeight;
                contentEl.style.maxHeight = h + 'px';
                contentEl.offsetHeight;
                contentEl.classList.add('ggg-collapsing');
                contentEl.style.maxHeight = '0';
                setTimeout(() => {
                    contentEl.style.display = 'none';
                    contentEl.classList.remove('ggg-collapsing');
                    contentEl.style.maxHeight = '';
                    contentEl.style.overflow = 'hidden';
                }, 350);
                chevronEl.classList.remove('up', 'fa-circle-chevron-up');
                chevronEl.classList.add('down', 'fa-circle-chevron-down');
            } else {
                contentEl.style.display = 'block';
                contentEl.style.maxHeight = '0';
                contentEl.style.overflow = 'hidden';
                contentEl.offsetHeight;
                const targetH = contentEl.scrollHeight;
                contentEl.classList.add('ggg-expanding');
                contentEl.style.maxHeight = targetH + 'px';
                setTimeout(() => {
                    contentEl.classList.remove('ggg-expanding');
                    contentEl.style.maxHeight = '';
                    contentEl.style.overflow = '';
                }, 350);
                chevronEl.classList.remove('down', 'fa-circle-chevron-down');
                chevronEl.classList.add('up', 'fa-circle-chevron-up');
            }
        });
    }

    // 子标签
    const panel = document.getElementById('ggg-ui-custom-panel');
    if (panel) {
        panel.querySelectorAll('.ggg-subtab').forEach(tab => {
            tab.addEventListener('click', () => {
                panel.querySelectorAll('.ggg-subtab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                panel.querySelectorAll('.ggg-subpanel').forEach(p => p.classList.remove('active'));
                document.getElementById(`ggg-subpanel-${tab.dataset.subtab}`)?.classList.add('active');
            });
        });

        // 抽屉折叠
        panel.querySelectorAll('.ggg-drawer-header').forEach(header => {
            header.addEventListener('click', () => {
                const drawer = header.closest('.ggg-drawer');
                const body = drawer.querySelector('.ggg-drawer-body');
                const arrow = header.querySelector('.ggg-drawer-arrow');
                const isOpen = drawer.classList.contains('open');
                if (isOpen) {
                    drawer.classList.remove('open');
                    body.style.display = 'none';
                    arrow.classList.remove('fa-chevron-down');
                    arrow.classList.add('fa-chevron-right');
                } else {
                    drawer.classList.add('open');
                    body.style.display = '';
                    arrow.classList.remove('fa-chevron-right');
                    arrow.classList.add('fa-chevron-down');
                }
            });
        });
    }

    // 按钮绑定
    document.getElementById('ggg-btn-refresh')?.addEventListener('click', () => scanCSS());
    document.getElementById('ggg-btn-reset-all')?.addEventListener('click', () => resetAllOverrides());

    const el = document.getElementById('ggg-ui-custom-theme-name');
    if (el) el.textContent = getCurrentThemeName() || getThemeName();
}

// ============================================================
// 存档
// ============================================================
function initPresets() {
    refreshPresetList();

    document.getElementById('ggg-btn-save-preset')?.addEventListener('click', async () => {
        const { callGenericPopup, POPUP_TYPE } = SillyTavern.getContext();
        const name = await callGenericPopup('请输入存档名称：', POPUP_TYPE.INPUT, '', { rows: 1 });
        if (!name || !name.trim()) return;
        const trimmed = name.trim();
        const data = getThemeData();
        data.presets[trimmed] = {
            overrides: JSON.parse(JSON.stringify(overrides)),
            themeVars: JSON.parse(JSON.stringify(data.themeVars || {})),
        };
        data.currentPreset = trimmed;
        saveAllSettings();
        refreshPresetList();
        toastr.success(`已保存存档: ${trimmed}`);
    });

    document.getElementById('ggg-btn-update-preset')?.addEventListener('click', () => {
        const name = document.getElementById('ggg-preset-select')?.value;
        if (!name || name === '__current__') { toastr.info('请先选择一个存档再更新'); return; }
        const data = getThemeData();
        data.presets[name] = {
            overrides: JSON.parse(JSON.stringify(overrides)),
            themeVars: JSON.parse(JSON.stringify(data.themeVars || {})),
        };
        saveAllSettings();
        toastr.success(`已更新存档: ${name}`);
    });

    document.getElementById('ggg-btn-delete-preset')?.addEventListener('click', async () => {
        const name = document.getElementById('ggg-preset-select')?.value;
        if (!name || name === '__current__') { toastr.info('请先选择一个存档'); return; }
        const { callGenericPopup, POPUP_TYPE } = SillyTavern.getContext();
        const confirmed = await callGenericPopup(`确定删除存档 "${name}" 吗？`, POPUP_TYPE.CONFIRM);
        if (!confirmed) return;
        const data = getThemeData();
        delete data.presets[name];
        if (data.currentPreset === name) data.currentPreset = '';
        saveAllSettings();
        refreshPresetList();
        toastr.success(`已删除存档: ${name}`);
    });

    document.getElementById('ggg-preset-select')?.addEventListener('change', (e) => {
        const name = e.target.value;
        if (name === '__current__') return;
        const data = getThemeData();
        const preset = data.presets[name];
        if (preset) {
            overrides = JSON.parse(JSON.stringify(preset.overrides || preset));
            if (preset.themeVars) data.themeVars = JSON.parse(JSON.stringify(preset.themeVars));
            data.currentPreset = name;
            injectOverrideStyle();
            saveAllSettings();
            renderImages(); renderTexts(); renderColors(); renderDims(); renderThemeVars();
            toastr.success(`已加载存档: ${name}`);
        }
    });

    // 导出存档
    document.getElementById('ggg-btn-export-preset')?.addEventListener('click', () => {
        const data = getThemeData();
        const exportData = {
            version: 1,
            themeName: getCurrentThemeName(),
            overrides: JSON.parse(JSON.stringify(overrides)),
            themeVars: JSON.parse(JSON.stringify(data.themeVars || {})),
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ggg-preset-${getCurrentThemeName().replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toastr.success('已导出存档');
    });

    // 导入存档
    document.getElementById('ggg-btn-import-preset')?.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const importData = JSON.parse(text);
                if (!importData.overrides) { toastr.error('无效的存档文件'); return; }
                const { callGenericPopup, POPUP_TYPE } = SillyTavern.getContext();
                const name = await callGenericPopup(
                    `导入存档（来自主题: ${importData.themeName || '未知'}）\n请输入存档名称：`,
                    POPUP_TYPE.INPUT, file.name.replace('.json', ''), { rows: 1 }
                );
                if (!name || !name.trim()) return;
                const data = getThemeData();
                data.presets[name.trim()] = {
                    overrides: importData.overrides,
                    themeVars: importData.themeVars || {},
                };
                data.currentPreset = name.trim();
                overrides = JSON.parse(JSON.stringify(importData.overrides));
                if (importData.themeVars) data.themeVars = JSON.parse(JSON.stringify(importData.themeVars));
                injectOverrideStyle();
                saveAllSettings();
                refreshPresetList();
                renderImages(); renderTexts(); renderColors(); renderDims(); renderThemeVars();
                toastr.success(`已导入存档: ${name.trim()}`);
            } catch (err) {
                console.error('[ggg] 导入失败:', err);
                toastr.error('导入失败: 文件格式错误');
            }
        });
        input.click();
    });
}

function refreshPresetList() {
    const select = document.getElementById('ggg-preset-select');
    if (!select) return;
    const data = getThemeData();
    select.innerHTML = '<option value="__current__">当前设置</option>';
    for (const name of Object.keys(data.presets || {})) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        if (name === data.currentPreset) opt.selected = true;
        select.appendChild(opt);
    }
}

// ============================================================
// CSS 扫描
// ============================================================
function scanCSS() {
    const ctx = SillyTavern.getContext();
    // 同时扫描酒馆自带 custom_css 和呱呱插件的自定义CSS（支持所有 ggg 标记）
    const powerCSS  = ctx.powerUserSettings?.custom_css || '';
    // 兼容旧 customCSS 字符串 + 新 customHTML[].css 数组
    const themeData = getThemeData();
    const oldCSS    = themeData.customCSS || '';
    const itemsCSS  = (themeData.customHTML || [])
        .filter(it => it.css?.trim())
        .map(it => `/* --- ${it.label || it.id} --- */\n${it.css}`)
        .join('\n');
    const gggCSS    = [oldCSS, itemsCSS].filter(Boolean).join('\n');
    const cssText   = powerCSS + (gggCSS ? '\n/* === ggg-custom-css === */\n' + gggCSS : '');

    parsedImages = []; parsedTexts = []; parsedColors = []; parsedDims = [];
    let match;

    // 图片
    GGG_IMG_RE.lastIndex = 0;
    while ((match = GGG_IMG_RE.exec(cssText)) !== null) {
        const role = (match[1] || '').toLowerCase();
        const name = match[2].trim();
        const value = match[3];
        const key = `img:${role ? role + ':' : ''}${name}`;
        const si = findSelectorForMatch(cssText, match.index);
        parsedImages.push({ type: 'img', role, name, originalValue: value, key, selector: si.selector, atRule: si.atRule, previewBox: extractPreviewBox(cssText, match.index), defaultProps: extractImageDefaultProps(cssText, match.index) });
    }

    // 文字
    GGG_TEXT_RE.lastIndex = 0;
    while ((match = GGG_TEXT_RE.exec(cssText)) !== null) {
        const role = (match[1] || '').toLowerCase();
        const name = match[2].trim();
        const value = match[3];
        const key = `text:${role ? role + ':' : ''}${name}`;
        const si = findSelectorForMatch(cssText, match.index);
        parsedTexts.push({ type: 'text', role, name, originalValue: value, key, selector: si.selector, atRule: si.atRule });
    }

    // 颜色（上一行格式）
    GGG_COLOR_ABOVE_RE.lastIndex = 0;
    while ((match = GGG_COLOR_ABOVE_RE.exec(cssText)) !== null) {
        const role = (match[1] || '').toLowerCase();
        const name = match[2].trim();
        const propertyName = match[3].trim();
        const value = match[4].trim();
        const key = `color:${role ? role + ':' : ''}${name}`;
        const si = findSelectorForMatch(cssText, match.index);
        parsedColors.push({ type: 'color', role, name, originalValue: value, key, selector: si.selector, atRule: si.atRule, propertyName });
    }

    // 颜色（同一行格式）
    GGG_COLOR_INLINE_RE.lastIndex = 0;
    while ((match = GGG_COLOR_INLINE_RE.exec(cssText)) !== null) {
        const propertyName = match[1].trim();
        const role = (match[2] || '').toLowerCase();
        const name = match[3].trim();
        const value = match[4].trim();
        const key = `color:${role ? role + ':' : ''}${name}`;
        if (!parsedColors.some(c => c.key === key)) {
            const si = findSelectorForMatch(cssText, match.index);
            parsedColors.push({ type: 'color', role, name, originalValue: value, key, selector: si.selector, atRule: si.atRule, propertyName });
        }
    }

    // 尺寸
    GGG_DIM_RE.lastIndex = 0;
    while ((match = GGG_DIM_RE.exec(cssText)) !== null) {
        const role = (match[1] || '').toLowerCase();
        const name = match[2].trim();
        const propertyName = match[3].trim();
        const value = match[4].trim();
        const key = `dim:${role ? role + ':' : ''}${name}`;
        const si = findSelectorForMatch(cssText, match.index);
        parsedDims.push({ type: 'dim', role, name, originalValue: value, key, selector: si.selector, atRule: si.atRule, propertyName });
    }

    expandedImageIndex = -1;
    expandedColorIndex = -1;
    renderImages();
    renderTexts();
    renderColors();
    renderDims();
}

function resetAllOverrides() {
    if (Object.keys(overrides).length === 0) { toastr.info('没有需要恢复的修改'); return; }
    overrides = {};
    injectOverrideStyle(); saveAllSettings();
    renderImages(); renderTexts(); renderColors(); renderDims();
    toastr.success('已恢复所有默认');
}

function getCurrentValue(item) {
    const override = overrides[item.key];
    if (override) {
        if (item.type === 'img') {
            if (override._newUrl) return override._newUrl;
            const m = override.value?.match(/url\(\s*['"]([^'"]*)['"]\s*\)/);
            return m ? m[1] : item.originalValue;
        } else if (item.type === 'text') {
            const m = override.value?.match(/^"(.*)"$/);
            return m ? m[1] : item.originalValue;
        } else if (item.type === 'color') {
            return override.value || item.originalValue;
        } else if (item.type === 'dim') {
            return override.value || item.originalValue;
        }
    }
    return item.originalValue;
}

// ============================================================
// CSS 解析工具
// ============================================================
function findSelectorForMatch(cssText, matchIndex) {
    let braceCount = 0, i = matchIndex;
    while (i >= 0) {
        if (cssText[i] === '}') braceCount++;
        if (cssText[i] === '{') { if (braceCount === 0) break; braceCount--; }
        i--;
    }
    if (i < 0) return { selector: null, atRule: null };

    let selectorEnd = i, selectorStart = i - 1;
    while (selectorStart >= 0 && /\s/.test(cssText[selectorStart])) selectorStart--;
    let nestedBrace = 0;
    while (selectorStart >= 0) {
        if (cssText[selectorStart] === '}') { selectorStart++; break; }
        if (cssText[selectorStart] === '{') { nestedBrace++; if (nestedBrace > 0) { selectorStart++; break; } }
        selectorStart--;
    }
    if (selectorStart < 0) selectorStart = 0;
    let selector = cssText.substring(selectorStart, selectorEnd).trim();

    // 清理选择器中的注释
    selector = selector.replace(/\/\*[\s\S]*?\*\//g, '').trim();

    let atRule = null, checkPos = selectorStart - 1, outerBrace = 0;
    while (checkPos >= 0) {
        if (cssText[checkPos] === '}') outerBrace++;
        if (cssText[checkPos] === '{') {
            if (outerBrace === 0) {
                let atStart = checkPos - 1;
                while (atStart >= 0 && /\s/.test(cssText[atStart])) atStart--;
                let atRuleStart = atStart;
                while (atRuleStart >= 0 && cssText[atRuleStart] !== '}' && cssText[atRuleStart] !== ';' && cssText[atRuleStart] !== '{') atRuleStart--;
                atRuleStart++;
                const possibleAtRule = cssText.substring(atRuleStart, checkPos).trim();
                if (possibleAtRule.startsWith('@')) atRule = possibleAtRule;
                break;
            }
            outerBrace--;
        }
        checkPos--;
    }
    return { selector, atRule };
}

function extractFullDeclaration(cssText, matchIndex) {
    let braceStart = matchIndex;
    while (braceStart >= 0 && cssText[braceStart] !== '{') braceStart--;
    if (braceStart < 0) return null;
    let braceEnd = matchIndex, depth = 0;
    while (braceEnd < cssText.length) {
        if (cssText[braceEnd] === '{') depth++;
        if (cssText[braceEnd] === '}') { depth--; if (depth <= 0) break; }
        braceEnd++;
    }
    const blockContent = cssText.substring(braceStart + 1, braceEnd);
    const relativeIndex = matchIndex - braceStart - 1;
    const declarations = parseDeclarations(blockContent);
    for (const decl of declarations) {
        if (relativeIndex >= decl.start && relativeIndex < decl.end) return { propertyName: decl.property, fullValue: decl.value };
    }
    return null;
}

function extractRuleDeclarations(cssText, matchIndex) {
    let braceStart = matchIndex;
    while (braceStart >= 0 && cssText[braceStart] !== '{') braceStart--;
    if (braceStart < 0) return [];
    let braceEnd = matchIndex, depth = 0;
    while (braceEnd < cssText.length) {
        if (cssText[braceEnd] === '{') depth++;
        if (cssText[braceEnd] === '}') { depth--; if (depth <= 0) break; }
        braceEnd++;
    }
    return parseDeclarations(cssText.substring(braceStart + 1, braceEnd));
}

function parsePxLength(value) {
    const match = (value || '').trim().match(/^(-?\d+(?:\.\d+)?)px$/i);
    return match ? parseFloat(match[1]) : null;
}

function parseAspectRatioValue(value) {
    const normalized = (value || '').trim();
    const pair = normalized.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (pair) return parseFloat(pair[1]) / Math.max(0.001, parseFloat(pair[2]));
    const single = normalized.match(/^(\d+(?:\.\d+)?)$/);
    return single ? parseFloat(single[1]) : null;
}

function extractPreviewBox(cssText, matchIndex) {
    const props = {};
    extractRuleDeclarations(cssText, matchIndex).forEach(decl => { props[decl.property.toLowerCase()] = decl.value; });
    const width = parsePxLength(props.width);
    const height = parsePxLength(props.height);
    const aspect = parseAspectRatioValue(props['aspect-ratio']);
    if (width && height) return { width, height, source: 'css' };
    if (width && aspect) return { width, height: Math.round(width / aspect), source: 'css' };
    if (height && aspect) return { width: Math.round(height * aspect), height, source: 'css' };
    return null;
}

function extractImageDefaultProps(cssText, matchIndex) {
    const props = {};
    extractRuleDeclarations(cssText, matchIndex).forEach(decl => {
        props[decl.property.toLowerCase()] = decl.value;
    });
    return {
        size: props['background-size'] || 'auto auto',
        position: props['background-position'] || '0% 0%',
        repeat: props['background-repeat'] || 'repeat',
    };
}

function parseDeclarations(blockContent) {
    const results = [];
    let i = 0;
    const len = blockContent.length;
    while (i < len) {
        while (i < len && /\s/.test(blockContent[i])) i++;
        if (i >= len) break;
        if (blockContent[i] === '/' && blockContent[i + 1] === '*') {
            const ce = blockContent.indexOf('*/', i + 2);
            if (ce === -1) break;
            i = ce + 2;
            continue;
        }
        const propStart = i;
        let colonPos = -1;
        while (i < len) {
            if (blockContent[i] === '/' && blockContent[i + 1] === '*') {
                const ce = blockContent.indexOf('*/', i + 2);
                if (ce === -1) { i = len; break; }
                i = ce + 2;
                continue;
            }
            if (blockContent[i] === ':') { colonPos = i; break; }
            if (blockContent[i] === '}' || blockContent[i] === ';') break;
            i++;
        }
        if (colonPos === -1) { i++; continue; }
        const property = blockContent.substring(propStart, colonPos).replace(/\/\*[\s\S]*?\*\//g, '').trim();
        i = colonPos + 1;
        const valueStart = i;
        let parenDepth = 0;
        while (i < len) {
            if (blockContent[i] === '(') parenDepth++;
            if (blockContent[i] === ')') parenDepth--;
            if (blockContent[i] === ';' && parenDepth === 0) break;
            if (blockContent[i] === '}' && parenDepth === 0) break;
            i++;
        }
        const value = blockContent.substring(valueStart, i).replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (property && value) results.push({ property, value, start: propStart, end: i });
        if (blockContent[i] === ';') i++;
    }
    return results;
}

function replaceUrlInValue(fullValue, oldUrl, newUrl) {
    const escaped = oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return fullValue.replace(new RegExp(`url\\(\\s*['"]?${escaped}['"]?\\s*\\)`, 'g'), `url('${newUrl}')`);
}

function escapeRegExp(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function buildImageOverride(item, newUrl, props) {
    const powerCSS = SillyTavern.getContext().powerUserSettings?.custom_css || '';
    const themeData = getThemeData();
    const oldCSS = themeData.customCSS || '';
    const itemsCSS = (themeData.customHTML || [])
        .filter(it => it.css?.trim())
        .map(it => `/* --- ${it.label || it.id} --- */\n${it.css}`)
        .join('\n');
    const gggCSS = [oldCSS, itemsCSS].filter(Boolean).join('\n');
    const cssText = powerCSS + (gggCSS ? '\n/* === ggg-custom-css === */\n' + gggCSS : '');
    const re = new RegExp(`\\/\\*\\s*ggg-img(?:-(user|char))?\\s*:\\s*${escapeRegExp(item.name)}\\s*\\*\\/\\s*(?:[^;]*?)url\\(\\s*['"]([^'"]*)['"]\\s*\\)`, 'gi');
    let match;
    re.lastIndex = 0;
    while ((match = re.exec(cssText)) !== null) {
        const role = (match[1] || '').toLowerCase();
        if (role === item.role) {
            const urlOffsetInMatch = match[0].lastIndexOf('url(');
            const declIndex = urlOffsetInMatch >= 0 ? match.index + urlOffsetInMatch : match.index;
            const decl = extractFullDeclaration(cssText, declIndex);
            if (decl) {
                let newFullValue = replaceUrlInValue(decl.fullValue, item.originalValue, newUrl);
                const cssProps = [`${decl.propertyName}: ${newFullValue}`];
                if (props) {
                    if (props.size) cssProps.push(`background-size: ${props.size}`);
                    if (props.position) cssProps.push(`background-position: ${props.position}`);
                    if (props.repeat) cssProps.push(`background-repeat: ${props.repeat}`);
                }
                return { selector: item.selector, atRule: item.atRule, property: decl.propertyName, value: newFullValue, _newUrl: newUrl, _props: props || {}, _multiProps: cssProps.length > 1 ? cssProps : undefined };
            }
            break;
        }
    }
    const cssProps = [`background-image: url('${newUrl}')`];
    if (props) {
        if (props.size) cssProps.push(`background-size: ${props.size}`);
        if (props.position) cssProps.push(`background-position: ${props.position}`);
        if (props.repeat) cssProps.push(`background-repeat: ${props.repeat}`);
    }
    return { selector: item.selector, atRule: item.atRule, property: 'background-image', value: `url('${newUrl}')`, _newUrl: newUrl, _props: props || {}, _multiProps: cssProps.length > 1 ? cssProps : undefined };
}

// ============================================================
// 图片渲染
// ============================================================
function getRuntimePreviewBox(item) {
    if (!item?.selector) return null;
    const pseudoMatch = item.selector.match(/(::before|::after)\s*$/);
    const pseudo = pseudoMatch ? pseudoMatch[1] : null;
    const baseSelector = pseudo ? item.selector.replace(/(::before|::after)\s*$/, '').trim() : item.selector;
    const parseRenderedLength = (value, fallbackBase) => {
        const normalized = (value || '').trim();
        if (normalized.endsWith('px')) return parseFloat(normalized);
        if (normalized.endsWith('%') && fallbackBase > 0) return fallbackBase * parseFloat(normalized) / 100;
        return null;
    };
    try {
        const el = document.querySelector(baseSelector);
        if (!el) return null;
        const style = window.getComputedStyle(el, pseudo);
        const baseRect = el.getBoundingClientRect();
        const width = pseudo ? parseRenderedLength(style.width, baseRect.width) : baseRect.width;
        const height = pseudo ? parseRenderedLength(style.height, baseRect.height) : baseRect.height;
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
            return { width, height, source: 'runtime' };
        }
    } catch {
        return null;
    }
    return null;
}

function getPreviewBaseSelector(item) {
    if (!item?.selector) return null;
    return item.selector.replace(/(::before|::after)\s*$/, '').trim();
}

function getPreviewBox(item) {
    return item ? (getRuntimePreviewBox(item) || item.previewBox || null) : null;
}

function getPreviewBoxStyle(item) {
    const box = getPreviewBox(item);
    if (!box) return { style: '', title: '' };
    return {
        style: `aspect-ratio: ${box.width} / ${box.height};`,
        title: `${Math.round(box.width)} x ${Math.round(box.height)} (${box.source === 'runtime' ? '实际盒子' : 'CSS尺寸'})`,
    };
}

function applyCardPreviewAspect(preview, item) {
    applyPreviewBoxToElement(preview, item);
}

function applyPreviewBoxToElement(preview, item) {
    if (!preview || !item) return;
    const box = getPreviewBox(item);
    if (!box) {
        preview.style.removeProperty('aspect-ratio');
        preview.removeAttribute('title');
        return;
    }
    preview.style.aspectRatio = `${box.width} / ${box.height}`;
    preview.title = `${Math.round(box.width)} x ${Math.round(box.height)} (${box.source === 'runtime' ? '实际盒子' : 'CSS尺寸'})`;
}

function applyCardPreviewRender(preview, url, props) {
    if (!preview) return;
    preview.style.backgroundImage = `url('${url}')`;
    preview.style.backgroundPosition = props?.position || '0% 0%';
    preview.style.backgroundSize = props?.size || 'auto auto';
    preview.style.backgroundRepeat = props?.repeat || 'repeat';
}

function refreshImageCardPreview(index, url, props = null) {
    const card = document.querySelector(`.ggg-img-card[data-index="${index}"] .ggg-img-card-preview`);
    if (!card) return;
    applyCardPreviewRender(card, url, getEffectiveImageProps(parsedImages[index], props || overrides[parsedImages[index]?.key]?._props || null));
    applyCardPreviewAspect(card, parsedImages[index]);
}

function applyImageCardAspects(root) {
    root.querySelectorAll('.ggg-img-card-preview').forEach(preview => {
        applyCardPreviewAspect(preview, parsedImages[parseInt(preview.dataset.index)]);
    });
}

function refreshResponsiveImagePreviews() {
    const list = document.getElementById('ggg-images-list');
    if (list) applyImageCardAspects(list);
    if (expandedImageIndex >= 0) {
        const visualStage = document.querySelector(`.ggg-img-expand[data-expand-index="${expandedImageIndex}"] .ggg-img-visual-stage`);
        if (visualStage) applyPreviewBoxToElement(visualStage, parsedImages[expandedImageIndex]);
    }
}

function observeImagePreviewTargets() {
    if (!imagePreviewResizeObserver) return;
    const list = document.getElementById('ggg-images-list');
    if (list) imagePreviewResizeObserver.observe(list);
    const seen = new Set();
    parsedImages.forEach(item => {
        const selector = getPreviewBaseSelector(item);
        if (!selector || seen.has(selector)) return;
        seen.add(selector);
        try {
            const el = document.querySelector(selector);
            if (el) imagePreviewResizeObserver.observe(el);
        } catch {}
    });
}

function scheduleImagePreviewRefresh() {
    clearTimeout(imagePreviewResizeTimer);
    imagePreviewResizeTimer = setTimeout(refreshResponsiveImagePreviews, 80);
}

function installImagePreviewResizeHandler() {
    if (imagePreviewResizeInstalled) return;
    imagePreviewResizeInstalled = true;
    window.addEventListener('resize', scheduleImagePreviewRefresh);
    if (typeof ResizeObserver !== 'undefined') {
        imagePreviewResizeObserver = new ResizeObserver(scheduleImagePreviewRefresh);
        const observeTargets = () => {
            const chat = document.getElementById('chat');
            if (chat) imagePreviewResizeObserver.observe(chat);
            observeImagePreviewTargets();
        };
        observeTargets();
        setTimeout(observeTargets, 500);
    }
}

function getEffectiveImageProps(item, props = null) {
    return { ...(item?.defaultProps || { size: 'auto auto', position: '0% 0%', repeat: 'repeat' }), ...(props || {}) };
}

function renderImages() {
    const list = document.getElementById('ggg-images-list');
    const empty = document.getElementById('ggg-no-images');
    if (!list) return;
    if (parsedImages.length === 0) { list.innerHTML = ''; list.style.display = 'none'; if (empty) empty.style.display = ''; return; }
    list.style.display = ''; if (empty) empty.style.display = 'none';

    const groups = [
        { title: 'User', items: parsedImages.map((item, i) => ({ item, i })).filter(x => x.item.role === 'user') },
        { title: 'Char', items: parsedImages.map((item, i) => ({ item, i })).filter(x => x.item.role === 'char') },
        { title: '通用', items: parsedImages.map((item, i) => ({ item, i })).filter(x => !x.item.role) },
    ];

    let html = '';
    for (const { title, items } of groups) {
        if (items.length === 0) continue;
        html += `<div class="ggg-group-title">${title}</div>`;
        for (const { item, i } of items) {
            const isExpanded = i === expandedImageIndex;
            const currentUrl = getCurrentValue(item);
            const currentProps = getEffectiveImageProps(item, overrides[item.key]?._props || null);
            const previewBox = getPreviewBoxStyle(item);
            html += `<div class="ggg-img-card ${isExpanded ? 'expanded' : ''}" data-index="${i}"><div class="ggg-img-card-preview" data-index="${i}" title="${escapeAttr(previewBox.title)}" style="${previewBox.style} background-image: url('${escapeAttr(currentUrl)}'); background-position: ${escapeAttr(currentProps.position)}; background-size: ${escapeAttr(currentProps.size)}; background-repeat: ${escapeAttr(currentProps.repeat)};"></div><div class="ggg-img-card-label" title="${escapeAttr(item.name)}">${escapeHtml(item.name)}</div></div>`;
            if (isExpanded) html += buildExpandPanel(i, item);
        }
    }
    list.innerHTML = html;
    observeImagePreviewTargets();

    list.querySelectorAll('.ggg-img-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.ggg-img-expand')) return;
            const idx = parseInt(card.dataset.index);
            expandedImageIndex = expandedImageIndex === idx ? -1 : idx;
            renderImages();
        });
    });
    if (expandedImageIndex >= 0) bindExpandEvents(expandedImageIndex);
}

function buildExpandPanel(index, item) {
    const override = overrides[item.key];
    const props = override?._props || {};
    const sizeOpts = [{ value: '', label: '不覆盖（保持原样）' },{ value: 'cover', label: '填满区域（可能裁切）' },{ value: 'contain', label: '完整显示（可能留白）' },{ value: 'auto', label: '原始大小' },{ value: '100% 100%', label: '拉伸填满（可能变形）' },{ value: 'auto 100%', label: '高度撑满，宽度自适应' },{ value: '100% auto', label: '宽度撑满，高度自适应' },{ value: 'custom', label: '自定义...' }];
    const posOpts = [{ value: '', label: '不覆盖（保持原样）' },{ value: 'center', label: '居中' },{ value: 'top', label: '顶部' },{ value: 'bottom', label: '底部' },{ value: 'left', label: '靠左' },{ value: 'right', label: '靠右' },{ value: 'center top', label: '水平居中 + 顶部' },{ value: 'center bottom', label: '水平居中 + 底部' },{ value: 'left top', label: '左上角' },{ value: 'right top', label: '右上角' },{ value: 'left bottom', label: '左下角' },{ value: 'right bottom', label: '右下角' },{ value: 'custom', label: '自定义...' }];
    const repeatOpts = [{ value: '', label: '不覆盖（保持原样）' },{ value: 'no-repeat', label: '不平铺（只显示一张）' },{ value: 'repeat', label: '水平+垂直平铺' },{ value: 'repeat-x', label: '仅水平平铺' },{ value: 'repeat-y', label: '仅垂直平铺' }];

    const isCustomSize = props.size && !sizeOpts.slice(0, -1).some(o => o.value === props.size);
    const isCustomPos = props.position && !posOpts.slice(0, -1).some(o => o.value === props.position);
    const makeOpts = (options, current, isCustom) => options.map(o => {
        let sel = ''; if (o.value === 'custom' && isCustom) sel = 'selected'; else if (o.value === current && !isCustom) sel = 'selected';
        return `<option value="${o.value}" ${sel}>${o.label}</option>`;
    }).join('');

    return `<div class="ggg-img-expand" data-expand-index="${index}">
        <div class="ggg-img-visual-tools">
            <div class="ggg-img-visual-toggle menu_button menu_button_icon ggg-btn-small"><i class="ggg-fa fa-solid fa-up-down-left-right"></i> 拖拽定位</div>
            <span class="ggg-img-visual-status">拖动图片调整位置，滚轮/双指缩放</span>
        </div>
        <div class="ggg-img-visual-editor" style="display:none;">
            <div class="ggg-img-visual-stage"></div>
        </div>
        <div class="ggg-img-expand-tabs"><div class="ggg-img-expand-tab active" data-source="backgrounds">背景</div><div class="ggg-img-expand-tab" data-source="gallery">图库</div></div>
        <div class="ggg-expand-gallery-filter" id="ggg-expand-filter-${index}" style="display:none;"></div>
        <div class="ggg-img-expand-grid" id="ggg-expand-grid-${index}"></div>
        <div class="ggg-img-props">
            <div class="ggg-img-prop-item"><span class="ggg-img-prop-label">图片大小</span><select class="ggg-img-prop-select" data-prop="size">${makeOpts(sizeOpts, props.size, isCustomSize)}</select><input type="text" class="ggg-img-prop-input ggg-prop-size-custom" placeholder="如: 50% auto" value="${isCustomSize ? props.size : ''}" style="display:${isCustomSize ? '' : 'none'}"></div>
            <div class="ggg-img-prop-item"><span class="ggg-img-prop-label">显示位置</span><select class="ggg-img-prop-select" data-prop="position">${makeOpts(posOpts, props.position, isCustomPos)}</select><input type="text" class="ggg-img-prop-input ggg-prop-position-custom" placeholder="如: 50% 30%" value="${isCustomPos ? props.position : ''}" style="display:${isCustomPos ? '' : 'none'}"></div>
            <div class="ggg-img-prop-item"><span class="ggg-img-prop-label">平铺方式</span><select class="ggg-img-prop-select" data-prop="repeat">${makeOpts(repeatOpts, props.repeat, false)}</select></div>
        </div>
        <div class="ggg-img-expand-footer">
            <div style="display:flex;gap:4px;">
                <div class="ggg-img-expand-upload-btn menu_button menu_button_icon ggg-btn-small"><i class="ggg-fa fa-solid fa-upload"></i> 上传</div>
                <div class="ggg-expand-reset menu_button menu_button_icon ggg-btn-small" title="恢复默认"><i class="ggg-fa fa-solid fa-rotate-left"></i> 默认</div>
            </div>
            <div class="ggg-expand-btns">
                <div class="ggg-expand-cancel menu_button ggg-btn-small">取消</div>
                <div class="ggg-expand-confirm menu_button menu_button_icon ggg-btn-small"><i class="ggg-fa fa-solid fa-check"></i> 确认</div>
            </div>
        </div>
    </div>`;
}

function bindExpandEvents(index) {
    const expand = document.querySelector(`.ggg-img-expand[data-expand-index="${index}"]`);
    if (!expand) return;
    const grid = expand.querySelector(`#ggg-expand-grid-${index}`);
    const item = parsedImages[index];
    let selectedUrl = getCurrentValue(item);
    const visualEditor = expand.querySelector('.ggg-img-visual-editor');
    const visualStage = expand.querySelector('.ggg-img-visual-stage');

    expand.addEventListener('click', (e) => e.stopPropagation());
    expand.querySelectorAll('.ggg-img-prop-select').forEach(select => {
        select.addEventListener('change', () => {
            const ci = expand.querySelector(`.ggg-prop-${select.dataset.prop}-custom`);
            if (ci) ci.style.display = select.value === 'custom' ? '' : 'none';
            updateVisualStage();
        });
        ['keydown', 'keyup', 'keypress'].forEach(evt => select.addEventListener(evt, (e) => e.stopPropagation()));
    });
    expand.querySelectorAll('.ggg-img-prop-input').forEach(input => {
        ['keydown', 'keyup', 'keypress', 'input'].forEach(evt => input.addEventListener(evt, (e) => {
            e.stopPropagation();
            if (evt === 'input') updateVisualStage();
        }));
    });

    function getSelectedProps() {
        const props = {};
        expand.querySelectorAll('.ggg-img-prop-select').forEach(select => {
            let val = select.value;
            if (val === 'custom') { const ci = expand.querySelector(`.ggg-prop-${select.dataset.prop}-custom`); val = ci?.value?.trim() || ''; }
            if (val) props[select.dataset.prop] = val;
        });
        return Object.keys(props).length > 0 ? props : null;
    }

    function setCustomProp(prop, value) {
        const select = expand.querySelector(`.ggg-img-prop-select[data-prop="${prop}"]`);
        const input = expand.querySelector(`.ggg-prop-${prop}-custom`);
        if (!select || !input) return;
        select.value = 'custom';
        input.style.display = '';
        input.value = value;
    }

    function parsePosition(value) {
        const normalized = (value || '').trim().toLowerCase();
        if (!normalized || normalized === 'center') return { x: 50, y: 50 };
        const keywordMap = { left: 0, center: 50, right: 100, top: 0, bottom: 100 };
        const parts = normalized.split(/\s+/);
        let x = 50, y = 50;
        if (parts.length === 1) {
            if (['left', 'center', 'right'].includes(parts[0])) x = keywordMap[parts[0]];
            if (['top', 'bottom'].includes(parts[0])) y = keywordMap[parts[0]];
        } else {
            const [a, b] = parts;
            if (a.endsWith('%')) x = parseFloat(a);
            else if (['left', 'center', 'right'].includes(a)) x = keywordMap[a];
            else if (['top', 'bottom'].includes(a)) y = keywordMap[a];
            if (b.endsWith('%')) y = parseFloat(b);
            else if (['top', 'center', 'bottom'].includes(b)) y = keywordMap[b];
            else if (['left', 'right'].includes(b)) x = keywordMap[b];
        }
        return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
    }

    function parseZoom(value) {
        const match = (value || '').match(/(\d+(?:\.\d+)?)%\s+auto/i);
        return match ? parseFloat(match[1]) : 100;
    }

    function updateVisualStage() {
        const selectedProps = getSelectedProps() || {};
        const props = getEffectiveImageProps(item, selectedProps);
        if (visualStage) {
            applyVisualStageBox();
            visualStage.style.backgroundImage = `url('${selectedUrl}')`;
            visualStage.style.backgroundPosition = props.position;
            visualStage.style.backgroundSize = props.size;
            visualStage.style.backgroundRepeat = props.repeat;
        }
        refreshImageCardPreview(index, selectedUrl, selectedProps);
    }

    function applyVisualStageBox() {
        if (!visualStage) return;
        applyPreviewBoxToElement(visualStage, item);
    }

    expand.querySelector('.ggg-img-visual-toggle')?.addEventListener('click', () => {
        if (!visualEditor || !visualStage) return;
        visualEditor.style.display = visualEditor.style.display === 'none' ? '' : 'none';
        if (visualEditor.style.display !== 'none') updateVisualStage();
    });

    if (visualStage) {
        applyVisualStageBox();
        let dragging = false;
        let startPoint = { x: 0, y: 0 };
        let startPosition = parsePosition((getSelectedProps() || {}).position);
        const activePointers = new Map();
        let pinchStartDistance = 0;
        let pinchStartZoom = 100;
        const commitPosition = (pos) => {
            const x = Math.round(Math.max(0, Math.min(100, pos.x)));
            const y = Math.round(Math.max(0, Math.min(100, pos.y)));
            setCustomProp('position', `${x}% ${y}%`);
            updateVisualStage();
        };
        const commitZoom = (zoom) => {
            const next = Math.max(20, Math.min(500, Math.round(zoom)));
            setCustomProp('size', `${next}% auto`);
            updateVisualStage();
        };
        const getPointerDistance = () => {
            const points = Array.from(activePointers.values());
            if (points.length < 2) return 0;
            return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        };
        visualStage.addEventListener('pointerdown', (e) => {
            activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            visualStage.setPointerCapture(e.pointerId);
            if (activePointers.size >= 2) {
                dragging = false;
                pinchStartDistance = getPointerDistance();
                pinchStartZoom = parseZoom((getSelectedProps() || {}).size);
            } else {
                dragging = true;
                startPoint = { x: e.clientX, y: e.clientY };
                startPosition = parsePosition((getSelectedProps() || {}).position);
                visualStage.classList.add('dragging');
            }
            e.preventDefault();
        });
        visualStage.addEventListener('pointermove', (e) => {
            if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (activePointers.size >= 2 && pinchStartDistance > 0) {
                commitZoom(pinchStartZoom * (getPointerDistance() / pinchStartDistance));
                return;
            }
            if (!dragging) return;
            const rect = visualStage.getBoundingClientRect();
            const dx = ((e.clientX - startPoint.x) / Math.max(1, rect.width)) * 100;
            const dy = ((e.clientY - startPoint.y) / Math.max(1, rect.height)) * 100;
            commitPosition({ x: startPosition.x - dx, y: startPosition.y - dy });
        });
        visualStage.addEventListener('pointerup', (e) => {
            activePointers.delete(e.pointerId);
            dragging = false;
            if (visualStage.hasPointerCapture(e.pointerId)) visualStage.releasePointerCapture(e.pointerId);
            visualStage.classList.remove('dragging');
        });
        visualStage.addEventListener('pointercancel', (e) => {
            activePointers.delete(e.pointerId);
            dragging = false;
            visualStage.classList.remove('dragging');
        });
        visualStage.addEventListener('wheel', (e) => {
            e.preventDefault();
            const props = getSelectedProps() || {};
            const current = parseZoom(props.size);
            commitZoom(current + (e.deltaY < 0 ? 8 : -8));
        }, { passive: false });
    }

    let expandFilterTags = [];
    let expandSizeSort = false;

    function loadGrid(source) {
        if (!grid) return;
        grid.innerHTML = '';
        const filterEl = expand.querySelector(`#ggg-expand-filter-${index}`);
        let items = [];
        if (source === 'backgrounds') {
            if (filterEl) filterEl.style.display = 'none';
            document.querySelectorAll('#bg_menu_content .bg_example').forEach(el => {
                const f = el.getAttribute('bgfile');
                if (f && !f.startsWith('ggg_')) items.push({ url: `/backgrounds/${f}`, name: f, tags: [] });
            });
        } else {
            const settings = getSettings();
            const galleryImgs = settings.gallery || [];
            const allTags = getAllTags();

            // 渲染 tag 筛选 + 尺寸分类 UI
            if (filterEl) {
                filterEl.style.display = 'flex';
                let filterHTML = '';
                if (allTags.length > 0) {
                    filterHTML += '<span class="ggg-expand-filter-label"><i class="ggg-fa fa-solid fa-filter"></i></span>';
                    filterHTML += allTags.map(tag =>
                        `<span class="ggg-tag-chip ${expandFilterTags.includes(tag) ? 'active' : ''}" data-expand-tag="${escapeAttr(tag)}">${escapeHtml(tag)}</span>`
                    ).join('');
                    if (expandFilterTags.length > 0) {
                        filterHTML += '<span class="ggg-tag-chip ggg-tag-clear" data-expand-clear><i class="ggg-fa fa-solid fa-xmark"></i></span>';
                    }
                }
                filterHTML += `<label class="ggg-expand-size-sort"><input type="checkbox" class="ggg-expand-size-cb" ${expandSizeSort ? 'checked' : ''}><i class="ggg-fa fa-solid fa-arrows-up-down"></i> 尺寸</label>`;
                filterEl.innerHTML = filterHTML;

                // tag 点击事件
                filterEl.querySelectorAll('[data-expand-tag]').forEach(chip => {
                    chip.addEventListener('click', () => {
                        const tag = chip.dataset.expandTag;
                        const idx = expandFilterTags.indexOf(tag);
                        if (idx >= 0) expandFilterTags.splice(idx, 1);
                        else expandFilterTags.push(tag);
                        loadGrid('gallery');
                    });
                });
                filterEl.querySelector('[data-expand-clear]')?.addEventListener('click', () => {
                    expandFilterTags = [];
                    loadGrid('gallery');
                });
                // 尺寸分类
                filterEl.querySelector('.ggg-expand-size-cb')?.addEventListener('change', (e) => {
                    expandSizeSort = e.target.checked;
                    loadGrid('gallery');
                });
            }

            // 筛选
            galleryImgs.forEach(img => {
                if (expandFilterTags.length > 0) {
                    const imgTags = img.tags || [];
                    if (!expandFilterTags.some(t => imgTags.includes(t))) return;
                }
                items.push({ url: img.url, name: img.name, tags: img.tags || [] });
            });
        }
        if (items.length === 0) { grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:12px;opacity:0.5;font-size:0.8em;">${source === 'gallery' ? '图库为空（或无匹配）' : '没有背景图片'}</div>`; return; }

        if (source === 'gallery' && expandSizeSort) {
            // 按尺寸分组渲染
            renderExpandGridWithSizeSort(grid, items, selectedUrl, index);
        } else {
            items.forEach(imgItem => {
                const div = document.createElement('div');
                div.className = 'ggg-img-expand-item';
                div.style.backgroundImage = `url('${imgItem.url}')`;
                if (selectedUrl === imgItem.url) div.classList.add('selected');
                div.title = imgItem.name || '';
                div.addEventListener('click', () => {
                    grid.querySelectorAll('.ggg-img-expand-item').forEach(d => d.classList.remove('selected'));
                    div.classList.add('selected');
                    selectedUrl = imgItem.url;
                    refreshImageCardPreview(index, imgItem.url);
                    updateVisualStage();
                });
                grid.appendChild(div);
            });
        }
    }

    function renderExpandGridWithSizeSort(gridEl, items, currentSelectedUrl, cardIndex) {
        const ASPECT_SQUARE_MIN = 0.8, ASPECT_SQUARE_MAX = 1.25;
        const SIZE_LABELS = { 'square': '⬜ 正方形', 'wide': '▬ 宽长方形', 'tall': '▮ 窄长方形', 'unknown': '❓ 加载中...' };

        // 预加载图片尺寸
        const loadPromises = items.map(imgItem => new Promise(resolve => {
            if (imgItem._aspectRatio) { resolve(); return; }
            const image = new Image();
            image.onload = () => { imgItem._aspectRatio = image.naturalWidth / image.naturalHeight; resolve(); };
            image.onerror = () => { imgItem._aspectRatio = 0; resolve(); };
            image.src = imgItem.url;
        }));

        Promise.all(loadPromises).then(() => {
            const groups = { square: [], wide: [], tall: [] };
            items.forEach(imgItem => {
                const r = imgItem._aspectRatio || 0;
                if (r >= ASPECT_SQUARE_MIN && r <= ASPECT_SQUARE_MAX) groups.square.push(imgItem);
                else if (r > ASPECT_SQUARE_MAX) groups.wide.push(imgItem);
                else groups.tall.push(imgItem);
            });

            gridEl.innerHTML = '';
            for (const [cat, entries] of Object.entries(groups)) {
                if (entries.length === 0) continue;
                const titleDiv = document.createElement('div');
                titleDiv.className = 'ggg-expand-size-group-title';
                titleDiv.textContent = `${SIZE_LABELS[cat]} (${entries.length})`;
                gridEl.appendChild(titleDiv);

                entries.forEach(imgItem => {
                    const div = document.createElement('div');
                    div.className = 'ggg-img-expand-item';
                    div.style.backgroundImage = `url('${imgItem.url}')`;
                    if (currentSelectedUrl === imgItem.url) div.classList.add('selected');
                    div.title = imgItem.name || '';
                    div.addEventListener('click', () => {
                        gridEl.querySelectorAll('.ggg-img-expand-item').forEach(d => d.classList.remove('selected'));
                        div.classList.add('selected');
                        selectedUrl = imgItem.url;
                        refreshImageCardPreview(cardIndex, imgItem.url);
                        updateVisualStage();
                    });
                    gridEl.appendChild(div);
                });
            }
        });
    }

    loadGrid('backgrounds');
    expand.querySelectorAll('.ggg-img-expand-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            expand.querySelectorAll('.ggg-img-expand-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            loadGrid(tab.dataset.source);
        });
    });

    expand.querySelector('.ggg-img-expand-upload-btn')?.addEventListener('click', () => {
        const fileInput = document.getElementById('ggg-file-input');
        if (!fileInput) return;
        const handler = async (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            const event = new CustomEvent('ggg-upload-request', { detail: { files, callback: () => {
                expand.querySelectorAll('.ggg-img-expand-tab').forEach(t => t.classList.remove('active'));
                expand.querySelector('[data-source="gallery"]')?.classList.add('active');
                loadGrid('gallery');
            }}});
            document.dispatchEvent(event);
            fileInput.value = '';
            fileInput.removeEventListener('change', handler);
        };
        fileInput.addEventListener('change', handler);
        fileInput.click();
    });

    expand.querySelector('.ggg-expand-reset')?.addEventListener('click', () => {
        delete overrides[item.key];
        injectOverrideStyle(); saveAllSettings();
        selectedUrl = item.originalValue;
        refreshImageCardPreview(index, selectedUrl);
        grid.querySelectorAll('.ggg-img-expand-item').forEach(d => d.classList.remove('selected'));
        expand.querySelectorAll('.ggg-img-prop-select').forEach(s => s.value = '');
        expand.querySelectorAll('.ggg-img-prop-input').forEach(inp => { inp.value = ''; inp.style.display = 'none'; });
        updateVisualStage();
        toastr.success(`已恢复默认: ${item.name}`);
    });

    expand.querySelector('.ggg-expand-cancel')?.addEventListener('click', () => { expandedImageIndex = -1; renderImages(); });
    expand.querySelector('.ggg-expand-confirm')?.addEventListener('click', () => {
        const props = getSelectedProps();
        const hasUrlChange = selectedUrl !== item.originalValue;
        const hasPropsChange = props !== null;
        const hadOverride = !!overrides[item.key];
        if (!hasUrlChange && !hasPropsChange && !hadOverride) { expandedImageIndex = -1; renderImages(); return; }
        const urlToUse = hasUrlChange ? selectedUrl : (overrides[item.key]?._newUrl || item.originalValue);
        if (urlToUse === item.originalValue && !hasPropsChange) delete overrides[item.key];
        else overrides[item.key] = buildImageOverride(item, urlToUse, props);
        injectOverrideStyle(); saveAllSettings(); expandedImageIndex = -1; renderImages();
        toastr.success(`已更新: ${item.name}`);
    });
}

// ============================================================
// 文字渲染
// ============================================================
function renderTexts() {
    const list = document.getElementById('ggg-texts-list');
    const empty = document.getElementById('ggg-no-texts');
    if (!list) return;
    if (parsedTexts.length === 0) { list.innerHTML = ''; list.style.display = 'none'; if (empty) empty.style.display = ''; return; }
    list.style.display = ''; if (empty) empty.style.display = 'none';

    const groups = [
        { title: 'User', items: parsedTexts.map((item, i) => ({ item, i })).filter(x => x.item.role === 'user') },
        { title: 'Char', items: parsedTexts.map((item, i) => ({ item, i })).filter(x => x.item.role === 'char') },
        { title: '通用', items: parsedTexts.map((item, i) => ({ item, i })).filter(x => !x.item.role) },
    ];

    let html = '';
    for (const { title, items } of groups) {
        if (items.length === 0) continue;
        html += `<div class="ggg-text-group-title">${title}</div>`;
        for (const { item, i } of items) {
            const cv = getCurrentValue(item);
            html += `<div class="ggg-text-row" data-index="${i}"><div class="ggg-text-row-head"><div class="ggg-text-row-name">${escapeHtml(item.name)}</div><div class="ggg-text-row-actions"><span class="ggg-text-btn ggg-text-reset" data-index="${i}" title="恢复默认"><i class="ggg-fa fa-solid fa-rotate-left"></i></span><span class="ggg-text-btn ggg-text-edit" data-index="${i}" title="编辑"><i class="ggg-fa fa-solid fa-pen-to-square"></i></span></div></div><div class="ggg-text-row-body"><div class="ggg-text-row-value">${escapeHtml(cv)}</div></div></div>`;
        }
    }
    list.innerHTML = html;

    list.querySelectorAll('.ggg-text-edit').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); enterTextEditMode(parseInt(btn.dataset.index)); }));
    list.querySelectorAll('.ggg-text-reset').forEach(btn => btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = parsedTexts[parseInt(btn.dataset.index)];
        if (overrides[item.key]) { delete overrides[item.key]; injectOverrideStyle(); saveAllSettings(); renderTexts(); toastr.success(`已恢复默认: ${item.name}`); }
        else toastr.info('已是默认值');
    }));
}

function enterTextEditMode(index) {
    const item = parsedTexts[index];
    const row = document.querySelector(`.ggg-text-row[data-index="${index}"]`);
    if (!row || !item) return;
    const actionsEl = row.querySelector('.ggg-text-row-actions');
    const bodyEl = row.querySelector('.ggg-text-row-body');
    const valueEl = row.querySelector('.ggg-text-row-value');
    const currentVal = getCurrentValue(item);
    if (!actionsEl || !bodyEl || !valueEl) return;
    valueEl.style.display = 'none';

    const oldInput = bodyEl.querySelector('.ggg-text-row-input');
    if (oldInput) oldInput.remove();

    actionsEl.innerHTML = `<span class="ggg-text-btn ggg-text-cancel" title="取消"><i class="ggg-fa fa-solid fa-xmark"></i></span><span class="ggg-text-btn ggg-text-confirm" title="确认"><i class="ggg-fa fa-solid fa-check"></i></span>`;

    const textarea = document.createElement('textarea');
    textarea.className = 'ggg-text-row-input';
    textarea.value = currentVal;
    textarea.rows = 2;
    const autoResize = () => {
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
    };
    ['keydown', 'keyup', 'keypress', 'mousedown', 'input'].forEach(evt => textarea.addEventListener(evt, (e) => e.stopPropagation()));
    textarea.addEventListener('input', autoResize);
    textarea.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            saveTextEdit(index, textarea.value);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            renderTexts();
        }
    });
    bodyEl.appendChild(textarea);
    autoResize();

    actionsEl.querySelector('.ggg-text-cancel')?.addEventListener('click', (e) => {
        e.stopPropagation();
        renderTexts();
    });
    actionsEl.querySelector('.ggg-text-confirm')?.addEventListener('click', (e) => {
        e.stopPropagation();
        saveTextEdit(index, textarea.value);
    });

    setTimeout(() => {
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    }, 50);
}

function saveTextEdit(index, newValue) {
    const item = parsedTexts[index];
    if (!item) return;
    if (newValue === item.originalValue) delete overrides[item.key];
    else overrides[item.key] = { selector: item.selector, atRule: item.atRule, property: 'content', value: `"${newValue}"` };
    injectOverrideStyle(); saveAllSettings(); renderTexts();
    toastr.success(`已更新文字: ${item.name}`);
}

// ============================================================
// 颜色渲染
// ============================================================
function renderColors() {
    const list = document.getElementById('ggg-colors-list');
    const empty = document.getElementById('ggg-no-colors');
    if (!list) return;
    if (parsedColors.length === 0) { list.innerHTML = ''; list.style.display = 'none'; if (empty) empty.style.display = ''; return; }
    list.style.display = ''; if (empty) empty.style.display = 'none';

    const groups = [
        { title: 'User', items: parsedColors.map((item, i) => ({ item, i })).filter(x => x.item.role === 'user') },
        { title: 'Char', items: parsedColors.map((item, i) => ({ item, i })).filter(x => x.item.role === 'char') },
        { title: '通用', items: parsedColors.map((item, i) => ({ item, i })).filter(x => !x.item.role) },
    ];

    let html = '';
    for (const { title, items } of groups) {
        if (items.length === 0) continue;
        html += `<div class="ggg-color-group-title">${title}</div>`;
        for (const { item, i } of items) {
            const cv = getCurrentValue(item);
            html += `<div class="ggg-color-row" data-index="${i}"><toolcool-color-picker class="ggg-color-picker" data-index="${i}" color="${escapeAttr(cv)}"></toolcool-color-picker><div class="ggg-color-row-name">${escapeHtml(item.name)}</div><div class="ggg-color-row-actions"><span class="ggg-text-btn ggg-color-reset" data-index="${i}" title="恢复默认"><i class="ggg-fa fa-solid fa-rotate-left"></i></span></div></div>`;
        }
    }
    list.innerHTML = html;

    list.querySelectorAll('.ggg-color-picker').forEach(picker => {
        picker.addEventListener('change', (e) => {
            const idx = parseInt(picker.dataset.index);
            const item = parsedColors[idx];
            const newColor = colorPickerValue(e, getCurrentValue(item));
            applyColorChange(item, newColor);
        });
        ['keydown', 'keyup', 'keypress'].forEach(evt => picker.addEventListener(evt, (e) => e.stopPropagation()));
    });

    list.querySelectorAll('.ggg-color-reset').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); const item = parsedColors[parseInt(btn.dataset.index)];
            if (overrides[item.key]) { delete overrides[item.key]; injectOverrideStyle(); saveAllSettings(); renderColors(); toastr.success(`已恢复默认: ${item.name}`); }
            else toastr.info('已是默认值');
        });
    });

    expandedColorIndex = -1;
}

function applyColorChange(item, newColor) {
    overrides[item.key] = { selector: item.selector, atRule: item.atRule, property: item.propertyName, value: newColor };
    injectOverrideStyle(); saveAllSettings();
}

function buildColorSliders(index, item) {
    const cv = getCurrentValue(item);
    const rgba = parseColorWithAlpha(cv);
    const hsv = rgbToHsv(rgba.r, rgba.g, rgba.b);
    const a = Math.round(rgba.a * 100);

    return `<div class="ggg-color-sliders" data-color-index="${index}">
        <div class="ggg-color-sliders-title"><div class="ggg-color-sliders-preview" style="background: ${escapeAttr(cv)};"></div><span>${escapeHtml(item.name)}</span></div>
        <div class="ggg-color-slider-group"><div class="ggg-color-slider-group-title">RGB</div>
            <div class="ggg-color-slider-row"><span class="ggg-color-slider-label" style="color:#f66;">R</span><input type="range" class="ggg-color-slider-track" data-channel="r" min="0" max="255" value="${rgba.r}" style="background: linear-gradient(to right, rgb(0,${rgba.g},${rgba.b}), rgb(255,${rgba.g},${rgba.b}));"><span class="ggg-color-slider-value" data-display="r">${rgba.r}</span></div>
            <div class="ggg-color-slider-row"><span class="ggg-color-slider-label" style="color:#6d6;">G</span><input type="range" class="ggg-color-slider-track" data-channel="g" min="0" max="255" value="${rgba.g}" style="background: linear-gradient(to right, rgb(${rgba.r},0,${rgba.b}), rgb(${rgba.r},255,${rgba.b}));"><span class="ggg-color-slider-value" data-display="g">${rgba.g}</span></div>
            <div class="ggg-color-slider-row"><span class="ggg-color-slider-label" style="color:#66f;">B</span><input type="range" class="ggg-color-slider-track" data-channel="b" min="0" max="255" value="${rgba.b}" style="background: linear-gradient(to right, rgb(${rgba.r},${rgba.g},0), rgb(${rgba.r},${rgba.g},255));"><span class="ggg-color-slider-value" data-display="b">${rgba.b}</span></div>
        </div>
        <div class="ggg-color-slider-group"><div class="ggg-color-slider-group-title">HSV</div>
            <div class="ggg-color-slider-row"><span class="ggg-color-slider-label">H</span><input type="range" class="ggg-color-slider-track" data-channel="h" min="0" max="360" value="${Math.round(hsv.h)}" style="background: linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%));"><span class="ggg-color-slider-value" data-display="h">${Math.round(hsv.h)}°</span></div>
            <div class="ggg-color-slider-row"><span class="ggg-color-slider-label">S</span><input type="range" class="ggg-color-slider-track" data-channel="s" min="0" max="100" value="${Math.round(hsv.s)}" style="background: linear-gradient(to right, hsl(${hsv.h},0%,${hsv.v/2}%), hsl(${hsv.h},100%,50%));"><span class="ggg-color-slider-value" data-display="s">${Math.round(hsv.s)}%</span></div>
            <div class="ggg-color-slider-row"><span class="ggg-color-slider-label">V</span><input type="range" class="ggg-color-slider-track" data-channel="v" min="0" max="100" value="${Math.round(hsv.v)}" style="background: linear-gradient(to right, #000, hsl(${hsv.h},${hsv.s}%,50%));"><span class="ggg-color-slider-value" data-display="v">${Math.round(hsv.v)}%</span></div>
        </div>
        <div class="ggg-color-slider-group"><div class="ggg-color-slider-group-title">透明度</div>
            <div class="ggg-color-slider-row"><span class="ggg-color-slider-label">A</span><input type="range" class="ggg-color-slider-track" data-channel="a" min="0" max="100" value="${a}" style="background: linear-gradient(to right, rgba(${rgba.r},${rgba.g},${rgba.b},0), rgba(${rgba.r},${rgba.g},${rgba.b},1));"><span class="ggg-color-slider-value" data-display="a">${a}%</span></div>
        </div>
        <div class="ggg-color-hex-row"><span class="ggg-color-slider-label">HEX</span><input type="text" class="ggg-color-hex-input" value="${colorToHex(cv)}" maxlength="7"></div>
    </div>`;
}

function bindColorSliderEvents(index) {
    const panel = document.querySelector(`.ggg-color-sliders[data-color-index="${index}"]`);
    if (!panel) return;
    const item = parsedColors[index];
    const preview = panel.querySelector('.ggg-color-sliders-preview');
    const hexInput = panel.querySelector('.ggg-color-hex-input');
    const swatch = document.querySelector(`.ggg-color-swatch[data-index="${index}"]`);
    const swatchInput = swatch?.querySelector('.ggg-color-swatch-input');

    function getAlpha() { return parseInt(panel.querySelector('[data-channel="a"]')?.value || '100'); }

    function applyColor(r, g, b, a) {
        const colorStr = a >= 100 ? rgbToHex(r, g, b) : `rgba(${r}, ${g}, ${b}, ${(a / 100).toFixed(2)})`;
        if (preview) preview.style.background = colorStr;
        if (swatch) swatch.style.background = colorStr;
        if (swatchInput) swatchInput.value = rgbToHex(r, g, b);
        applyColorChange(item, colorStr);
    }

    function updateFromRGB() {
        const r = parseInt(panel.querySelector('[data-channel="r"]').value);
        const g = parseInt(panel.querySelector('[data-channel="g"]').value);
        const b = parseInt(panel.querySelector('[data-channel="b"]').value);
        const a = getAlpha();
        const hsv = rgbToHsv(r, g, b);
        panel.querySelector('[data-channel="h"]').value = Math.round(hsv.h);
        panel.querySelector('[data-channel="s"]').value = Math.round(hsv.s);
        panel.querySelector('[data-channel="v"]').value = Math.round(hsv.v);
        updateDisplays(panel, r, g, b, hsv, a);
        if (hexInput) hexInput.value = rgbToHex(r, g, b);
        updateSliderGradients(panel, r, g, b, hsv);
        applyColor(r, g, b, a);
    }

    function updateFromHSV() {
        const h = parseInt(panel.querySelector('[data-channel="h"]').value);
        const s = parseInt(panel.querySelector('[data-channel="s"]').value);
        const v = parseInt(panel.querySelector('[data-channel="v"]').value);
        const a = getAlpha();
        const rgb = hsvToRgb(h, s, v);
        panel.querySelector('[data-channel="r"]').value = rgb.r;
        panel.querySelector('[data-channel="g"]').value = rgb.g;
        panel.querySelector('[data-channel="b"]').value = rgb.b;
        updateDisplays(panel, rgb.r, rgb.g, rgb.b, { h, s, v }, a);
        if (hexInput) hexInput.value = rgbToHex(rgb.r, rgb.g, rgb.b);
        updateSliderGradients(panel, rgb.r, rgb.g, rgb.b, { h, s, v });
        applyColor(rgb.r, rgb.g, rgb.b, a);
    }

    function updateFromAlpha() {
        const r = parseInt(panel.querySelector('[data-channel="r"]').value);
        const g = parseInt(panel.querySelector('[data-channel="g"]').value);
        const b = parseInt(panel.querySelector('[data-channel="b"]').value);
        const a = getAlpha();
        panel.querySelector('[data-display="a"]').textContent = a + '%';
        const aSlider = panel.querySelector('[data-channel="a"]');
        if (aSlider) aSlider.style.background = `linear-gradient(to right, rgba(${r},${g},${b},0), rgba(${r},${g},${b},1))`;
        applyColor(r, g, b, a);
    }

    ['r', 'g', 'b'].forEach(ch => {
        const slider = panel.querySelector(`[data-channel="${ch}"]`);
        if (slider) { slider.addEventListener('input', updateFromRGB); ['keydown', 'keyup', 'keypress'].forEach(evt => slider.addEventListener(evt, (e) => e.stopPropagation())); }
    });
    ['h', 's', 'v'].forEach(ch => {
        const slider = panel.querySelector(`[data-channel="${ch}"]`);
        if (slider) { slider.addEventListener('input', updateFromHSV); ['keydown', 'keyup', 'keypress'].forEach(evt => slider.addEventListener(evt, (e) => e.stopPropagation())); }
    });
    const aSlider = panel.querySelector('[data-channel="a"]');
    if (aSlider) { aSlider.addEventListener('input', updateFromAlpha); ['keydown', 'keyup', 'keypress'].forEach(evt => aSlider.addEventListener(evt, (e) => e.stopPropagation())); }

    if (hexInput) {
        ['keydown', 'keyup', 'keypress', 'input'].forEach(evt => hexInput.addEventListener(evt, (e) => e.stopPropagation()));
        hexInput.addEventListener('change', () => {
            let val = hexInput.value.trim();
            if (!val.startsWith('#')) val = '#' + val;
            if (/^#[0-9a-fA-F]{6}$/.test(val)) {
                const rgb = hexToRgb(val); const a = getAlpha(); const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
                syncSlidersFromHex(val, panel);
                applyColor(rgb.r, rgb.g, rgb.b, a);
            }
        });
    }
}

function updateDisplays(panel, r, g, b, hsv, a) {
    const d = (sel) => panel.querySelector(sel);
    if (d('[data-display="r"]')) d('[data-display="r"]').textContent = r;
    if (d('[data-display="g"]')) d('[data-display="g"]').textContent = g;
    if (d('[data-display="b"]')) d('[data-display="b"]').textContent = b;
    if (d('[data-display="h"]')) d('[data-display="h"]').textContent = Math.round(hsv.h) + '°';
    if (d('[data-display="s"]')) d('[data-display="s"]').textContent = Math.round(hsv.s) + '%';
    if (d('[data-display="v"]')) d('[data-display="v"]').textContent = Math.round(hsv.v) + '%';
    if (d('[data-display="a"]')) d('[data-display="a"]').textContent = (a !== undefined ? a : 100) + '%';
}

function syncSlidersFromHex(hex, panel) {
    if (!panel) panel = document.querySelector(`.ggg-color-sliders[data-color-index="${expandedColorIndex}"]`);
    if (!panel) return;
    const rgb = hexToRgb(hex); const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    panel.querySelector('[data-channel="r"]').value = rgb.r;
    panel.querySelector('[data-channel="g"]').value = rgb.g;
    panel.querySelector('[data-channel="b"]').value = rgb.b;
    panel.querySelector('[data-channel="h"]').value = Math.round(hsv.h);
    panel.querySelector('[data-channel="s"]').value = Math.round(hsv.s);
    panel.querySelector('[data-channel="v"]').value = Math.round(hsv.v);
    const a = parseInt(panel.querySelector('[data-channel="a"]')?.value || '100');
    updateDisplays(panel, rgb.r, rgb.g, rgb.b, hsv, a);
    const hexInput = panel.querySelector('.ggg-color-hex-input');
    if (hexInput) hexInput.value = hex;
    const preview = panel.querySelector('.ggg-color-sliders-preview');
    if (preview) preview.style.background = hex;
    updateSliderGradients(panel, rgb.r, rgb.g, rgb.b, hsv);
}

function updateSliderGradients(panel, r, g, b, hsv) {
    const rs = panel.querySelector('[data-channel="r"]'), gs = panel.querySelector('[data-channel="g"]'), bs = panel.querySelector('[data-channel="b"]');
    const ss = panel.querySelector('[data-channel="s"]'), vs = panel.querySelector('[data-channel="v"]');
    const as = panel.querySelector('[data-channel="a"]');
    if (rs) rs.style.background = `linear-gradient(to right, rgb(0,${g},${b}), rgb(255,${g},${b}))`;
    if (gs) gs.style.background = `linear-gradient(to right, rgb(${r},0,${b}), rgb(${r},255,${b}))`;
    if (bs) bs.style.background = `linear-gradient(to right, rgb(${r},${g},0), rgb(${r},${g},255))`;
    if (ss) ss.style.background = `linear-gradient(to right, hsl(${hsv.h},0%,${hsv.v/2}%), hsl(${hsv.h},100%,50%))`;
    if (vs) vs.style.background = `linear-gradient(to right, #000, hsl(${hsv.h},${hsv.s}%,50%))`;
    if (as) as.style.background = `linear-gradient(to right, rgba(${r},${g},${b},0), rgba(${r},${g},${b},1))`;
}

// ============================================================
// 尺寸渲染
// ============================================================
function renderDims() {
    const list = document.getElementById('ggg-dims-list');
    const empty = document.getElementById('ggg-no-dims');
    if (!list) return;
    if (parsedDims.length === 0) { list.innerHTML = ''; list.style.display = 'none'; if (empty) empty.style.display = ''; return; }
    list.style.display = ''; if (empty) empty.style.display = 'none';

    const groups = [
        { title: 'User', items: parsedDims.map((item, i) => ({ item, i })).filter(x => x.item.role === 'user') },
        { title: 'Char', items: parsedDims.map((item, i) => ({ item, i })).filter(x => x.item.role === 'char') },
        { title: '通用', items: parsedDims.map((item, i) => ({ item, i })).filter(x => !x.item.role) },
    ];

    let html = '';
    for (const { title, items } of groups) {
        if (items.length === 0) continue;
        html += `<div class="ggg-text-group-title">${title}</div>`;
        for (const { item, i } of items) {
            const cv = getCurrentValue(item);
            const numMatch = cv.match(/^([+-]?[\d.]+)\s*(.*)$/);
            const numVal = numMatch ? numMatch[1] : cv;
            const unit = numMatch ? numMatch[2] || 'px' : 'px';
            html += `<div class="ggg-dim-row" data-index="${i}">
                <div class="ggg-dim-row-name">${escapeHtml(item.name)}<span class="ggg-dim-prop-name">${item.propertyName}</span></div>
                <div class="ggg-dim-row-controls">
                    <div class="ggg-dim-slider-wrap">
                        <input type="range" class="ggg-dim-slider" data-index="${i}" min="-500" max="500" value="${parseFloat(numVal) || 0}" step="1">
                    </div>
                    <div class="ggg-dim-value-row">
                        <input type="number" class="ggg-dim-input" data-index="${i}" value="${numVal}" step="1">
                        <select class="ggg-dim-unit" data-index="${i}">
                            ${['px','%','em','rem','vw','vh'].map(u => `<option value="${u}" ${u === unit ? 'selected' : ''}>${u}</option>`).join('')}
                        </select>
                        <span class="ggg-text-btn ggg-dim-reset" data-index="${i}" title="恢复默认"><i class="ggg-fa fa-solid fa-rotate-left"></i></span>
                    </div>
                </div>
            </div>`;
        }
    }
    list.innerHTML = html;

    list.querySelectorAll('.ggg-dim-slider').forEach(slider => {
        slider.addEventListener('input', () => {
            const idx = parseInt(slider.dataset.index);
            const item = parsedDims[idx];
            const row = slider.closest('.ggg-dim-row');
            const inp = row.querySelector('.ggg-dim-input');
            const unit = row.querySelector('.ggg-dim-unit').value;
            if (inp) inp.value = slider.value;
            const newVal = `${slider.value}${unit}`;
            overrides[item.key] = { selector: item.selector, atRule: item.atRule, property: item.propertyName, value: newVal };
            injectOverrideStyle(); saveAllSettings();
        });
        ['keydown','keyup','keypress'].forEach(evt => slider.addEventListener(evt, e => e.stopPropagation()));
    });

    list.querySelectorAll('.ggg-dim-input').forEach(inp => {
        inp.addEventListener('change', () => {
            const idx = parseInt(inp.dataset.index);
            const item = parsedDims[idx];
            const row = inp.closest('.ggg-dim-row');
            const slider = row.querySelector('.ggg-dim-slider');
            const unit = row.querySelector('.ggg-dim-unit').value;
            if (slider) slider.value = inp.value;
            const newVal = `${inp.value}${unit}`;
            overrides[item.key] = { selector: item.selector, atRule: item.atRule, property: item.propertyName, value: newVal };
            injectOverrideStyle(); saveAllSettings();
        });
        ['keydown','keyup','keypress','input'].forEach(evt => inp.addEventListener(evt, e => e.stopPropagation()));
    });

    list.querySelectorAll('.ggg-dim-unit').forEach(sel => {
        sel.addEventListener('change', () => {
            const idx = parseInt(sel.dataset.index);
            const item = parsedDims[idx];
            const row = sel.closest('.ggg-dim-row');
            const inp = row.querySelector('.ggg-dim-input');
            const newVal = `${inp.value}${sel.value}`;
            overrides[item.key] = { selector: item.selector, atRule: item.atRule, property: item.propertyName, value: newVal };
            injectOverrideStyle(); saveAllSettings();
        });
    });

    list.querySelectorAll('.ggg-dim-reset').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.index);
            const item = parsedDims[idx];
            if (overrides[item.key]) { delete overrides[item.key]; injectOverrideStyle(); saveAllSettings(); renderDims(); toastr.success(`已恢复默认: ${item.name}`); }
            else toastr.info('已是默认值');
        });
    });
}

// ============================================================
// 主题变量渲染
// ============================================================
function renderThemeVars() {
    const list = document.getElementById('ggg-themevars-list');
    if (!list) return;
    const data = getThemeData();
    const themeVars = data.themeVars || {};

    let html = '';
    THEME_VARS.forEach((tv, i) => {
        const saved = themeVars[tv.variable];
        const computedVal = saved || getComputedStyle(document.documentElement).getPropertyValue(tv.variable).trim() || '#000000';
        html += `<div class="ggg-color-row" data-tv-index="${i}">
            <toolcool-color-picker class="ggg-color-picker ggg-tv-swatch" data-tv-index="${i}" color="${escapeAttr(computedVal)}"></toolcool-color-picker>
            <div class="ggg-color-row-name">${escapeHtml(tv.label)}</div>
            <div class="ggg-color-row-actions">
                <span class="ggg-text-btn ggg-tv-reset" data-tv-index="${i}" title="恢复默认"><i class="ggg-fa fa-solid fa-rotate-left"></i></span>
            </div>
        </div>`;
    });
    list.innerHTML = html;

    // 色块直接选色
    list.querySelectorAll('.ggg-tv-swatch').forEach(input => {
        input.addEventListener('change', (e) => {
            const idx = parseInt(input.dataset.tvIndex);
            const tv = THEME_VARS[idx];
            const data = getThemeData();
            data.themeVars[tv.variable] = colorPickerValue(e, getComputedStyle(document.documentElement).getPropertyValue(tv.variable).trim() || '#000000');
            injectOverrideStyle(); saveAllSettings();
        });
        ['keydown','keyup','keypress'].forEach(evt => input.addEventListener(evt, e => e.stopPropagation()));
    });

    // 重置
    list.querySelectorAll('.ggg-tv-reset').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.tvIndex);
            const tv = THEME_VARS[idx];
            const data = getThemeData();
            delete data.themeVars[tv.variable];
            injectOverrideStyle(); saveAllSettings(); renderThemeVars();
            toastr.success(`已恢复默认: ${tv.label}`);
        });
    });

    expandedThemeVarIndex = -1;
}

function bindThemeVarSliderEvents(index) {
    const panel = document.querySelector(`.ggg-color-sliders[data-tv-slider-index="${index}"]`);
    if (!panel) return;
    const tv = THEME_VARS[index];
    const preview = panel.querySelector('.ggg-color-sliders-preview');
    const hexInput = panel.querySelector('.ggg-color-hex-input');
    const swatch = document.querySelector(`.ggg-tv-swatch[data-tv-index="${index}"]`);
    const swatchDiv = swatch?.closest('.ggg-color-swatch');

    function applyTV(colorStr) {
        if (preview) preview.style.background = colorStr;
        if (swatchDiv) swatchDiv.style.background = colorStr;
        if (swatch) swatch.value = colorToHex(colorStr);
        const data = getThemeData();
        data.themeVars[tv.variable] = colorStr;
        injectOverrideStyle(); saveAllSettings();
    }

    function getAlpha() { return parseInt(panel.querySelector('[data-channel="a"]')?.value || '100'); }

    function updateFromRGB() {
        const r = parseInt(panel.querySelector('[data-channel="r"]').value);
        const g = parseInt(panel.querySelector('[data-channel="g"]').value);
        const b = parseInt(panel.querySelector('[data-channel="b"]').value);
        const a = getAlpha();
        const hsv = rgbToHsv(r, g, b);
        panel.querySelector('[data-channel="h"]').value = Math.round(hsv.h);
        panel.querySelector('[data-channel="s"]').value = Math.round(hsv.s);
        panel.querySelector('[data-channel="v"]').value = Math.round(hsv.v);
        updateDisplays(r, g, b, hsv, a);
        const colorStr = a >= 100 ? rgbToHex(r, g, b) : `rgba(${r}, ${g}, ${b}, ${(a / 100).toFixed(2)})`;
        if (hexInput) hexInput.value = rgbToHex(r, g, b);
        updateSliderGradients(panel, r, g, b, hsv);
        applyTV(colorStr);
    }

    function updateFromHSV() {
        const h = parseInt(panel.querySelector('[data-channel="h"]').value);
        const s = parseInt(panel.querySelector('[data-channel="s"]').value);
        const v = parseInt(panel.querySelector('[data-channel="v"]').value);
        const a = getAlpha();
        const rgb = hsvToRgb(h, s, v);
        panel.querySelector('[data-channel="r"]').value = rgb.r;
        panel.querySelector('[data-channel="g"]').value = rgb.g;
        panel.querySelector('[data-channel="b"]').value = rgb.b;
        updateDisplays(rgb.r, rgb.g, rgb.b, { h, s, v }, a);
        const colorStr = a >= 100 ? rgbToHex(rgb.r, rgb.g, rgb.b) : `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${(a / 100).toFixed(2)})`;
        if (hexInput) hexInput.value = rgbToHex(rgb.r, rgb.g, rgb.b);
        updateSliderGradients(panel, rgb.r, rgb.g, rgb.b, { h, s, v });
        applyTV(colorStr);
    }

    function updateFromAlpha() {
        const r = parseInt(panel.querySelector('[data-channel="r"]').value);
        const g = parseInt(panel.querySelector('[data-channel="g"]').value);
        const b = parseInt(panel.querySelector('[data-channel="b"]').value);
        const a = getAlpha();
        panel.querySelector('[data-display="a"]').textContent = a + '%';
        const aSlider = panel.querySelector('[data-channel="a"]');
        if (aSlider) aSlider.style.background = `linear-gradient(to right, rgba(${r},${g},${b},0), rgba(${r},${g},${b},1))`;
        const colorStr = a >= 100 ? rgbToHex(r, g, b) : `rgba(${r}, ${g}, ${b}, ${(a / 100).toFixed(2)})`;
        applyTV(colorStr);
    }

    function updateDisplays(r, g, b, hsv, a) {
        panel.querySelector('[data-display="r"]').textContent = r;
        panel.querySelector('[data-display="g"]').textContent = g;
        panel.querySelector('[data-display="b"]').textContent = b;
        panel.querySelector('[data-display="h"]').textContent = Math.round(hsv.h) + '°';
        panel.querySelector('[data-display="s"]').textContent = Math.round(hsv.s) + '%';
        panel.querySelector('[data-display="v"]').textContent = Math.round(hsv.v) + '%';
        panel.querySelector('[data-display="a"]').textContent = a + '%';
    }

    ['r', 'g', 'b'].forEach(ch => {
        const sl = panel.querySelector(`[data-channel="${ch}"]`);
        if (sl) { sl.addEventListener('input', updateFromRGB); ['keydown','keyup','keypress'].forEach(evt => sl.addEventListener(evt, e => e.stopPropagation())); }
    });
    ['h', 's', 'v'].forEach(ch => {
        const sl = panel.querySelector(`[data-channel="${ch}"]`);
        if (sl) { sl.addEventListener('input', updateFromHSV); ['keydown','keyup','keypress'].forEach(evt => sl.addEventListener(evt, e => e.stopPropagation())); }
    });
    const aSlider = panel.querySelector('[data-channel="a"]');
    if (aSlider) { aSlider.addEventListener('input', updateFromAlpha); ['keydown','keyup','keypress'].forEach(evt => aSlider.addEventListener(evt, e => e.stopPropagation())); }

    if (hexInput) {
        ['keydown','keyup','keypress','input'].forEach(evt => hexInput.addEventListener(evt, e => e.stopPropagation()));
        hexInput.addEventListener('change', () => {
            let val = hexInput.value.trim();
            if (!val.startsWith('#')) val = '#' + val;
            if (/^#[0-9a-fA-F]{6}$/.test(val)) {
                const rgb = hexToRgb(val);
                const a = getAlpha();
                const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
                panel.querySelector('[data-channel="r"]').value = rgb.r;
                panel.querySelector('[data-channel="g"]').value = rgb.g;
                panel.querySelector('[data-channel="b"]').value = rgb.b;
                panel.querySelector('[data-channel="h"]').value = Math.round(hsv.h);
                panel.querySelector('[data-channel="s"]').value = Math.round(hsv.s);
                panel.querySelector('[data-channel="v"]').value = Math.round(hsv.v);
                updateDisplays(rgb.r, rgb.g, rgb.b, hsv, a);
                updateSliderGradients(panel, rgb.r, rgb.g, rgb.b, hsv);
                const colorStr = a >= 100 ? val : `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${(a / 100).toFixed(2)})`;
                applyTV(colorStr);
            }
        });
    }
}

// ============================================================
// 颜色工具
// ============================================================
function parseColorWithAlpha(color) {
    if (!color) return { r: 0, g: 0, b: 0, a: 1 };
    color = color.trim();
    const rgbaMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
    if (rgbaMatch) return { r: parseInt(rgbaMatch[1]), g: parseInt(rgbaMatch[2]), b: parseInt(rgbaMatch[3]), a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1 };
    const hexMatch = color.match(/^#([0-9a-f]{3,8})$/i);
    if (hexMatch) {
        let hex = hexMatch[1];
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        return { r: parseInt(hex.substr(0, 2), 16), g: parseInt(hex.substr(2, 2), 16), b: parseInt(hex.substr(4, 2), 16), a: hex.length >= 8 ? parseInt(hex.substr(6, 2), 16) / 255 : 1 };
    }
    try { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx2d = canvas.getContext('2d'); ctx2d.fillStyle = color; ctx2d.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx2d.getImageData(0, 0, 1, 1).data; return { r, g, b, a: a / 255 }; } catch { return { r: 0, g: 0, b: 0, a: 1 }; }
}

function colorToHex(color) {
    if (!color) return '#000000';
    color = color.trim();
    const hexMatch = color.match(/^#([0-9a-f]{3,8})$/i);
    if (hexMatch) { let hex = hexMatch[1]; if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2]; if (hex.length >= 6) return '#' + hex.substring(0, 6); }
    const rgbaMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbaMatch) return rgbToHex(parseInt(rgbaMatch[1]), parseInt(rgbaMatch[2]), parseInt(rgbaMatch[3]));
    try { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx2d = canvas.getContext('2d'); ctx2d.fillStyle = color; ctx2d.fillRect(0, 0, 1, 1); const [r, g, b] = ctx2d.getImageData(0, 0, 1, 1).data; return rgbToHex(r, g, b); } catch { return '#000000'; }
}

function rgbToHex(r, g, b) { return '#' + [r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join(''); }
function hexToRgb(hex) { hex = hex.replace('#', ''); if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2]; return { r: parseInt(hex.substr(0, 2), 16), g: parseInt(hex.substr(2, 2), 16), b: parseInt(hex.substr(4, 2), 16) }; }

function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0, s = max === 0 ? 0 : d / max, v = max;
    if (d !== 0) { if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6; else if (max === g) h = ((b - r) / d + 2) / 6; else h = ((r - g) / d + 4) / 6; }
    return { h: h * 360, s: s * 100, v: v * 100 };
}

function hsvToRgb(h, s, v) {
    h /= 360; s /= 100; v /= 100;
    let r, g, b;
    const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    switch (i % 6) { case 0: r = v; g = t; b = p; break; case 1: r = q; g = v; b = p; break; case 2: r = p; g = v; b = t; break; case 3: r = p; g = q; b = v; break; case 4: r = t; g = p; b = v; break; case 5: r = v; g = p; b = q; break; }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function escapeHtml(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
function escapeAttr(str) { if (!str) return ''; return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
