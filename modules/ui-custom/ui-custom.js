/**
 * UI主题自定义模块
 */
import {
  getCurrentThemeName,
  getSettings,
  getThemeData,
  getThemeName,
  saveAllSettings,
  setCurrentThemeName,
} from '../../index.js';

const OVERRIDE_STYLE_ID = 'ggg-overrides';

// 原有正则
const GGG_IMG_RE = /\/\*\s*ggg-img(?:-(user|char))?\s*:\s*(.+?)\s*\*\/\s*(?:[^;]*?)url\(\s*['"]([^'"]*)['"]\s*\)/gi;
const GGG_TEXT_RE = /\/\*\s*ggg-text(?:-(user|char))?\s*:\s*(.+?)\s*\*\/\s*(?:[^;]*?)content:\s*"([^"]*)"/gi;
const GGG_COLOR_ABOVE_RE = /\/\*\s*ggg-color(?:-(user|char))?\s*:\s*(.+?)\s*\*\/\s*\n\s*([\w-]+)\s*:\s*([^;]+);/gi;
const GGG_COLOR_INLINE_RE = /([\w-]+)\s*:\s*\/\*\s*ggg-color(?:-(user|char))?\s*:\s*(.+?)\s*\*\/\s*([^;]+);/gi;

// 新增 SVG 正则
// 匹配: /* ggg-svg-text: 名称 */ 后面跟含有 SVG data URL 的属性
// SVG URL 用双引号包裹时，内部可能含单引号和空格，所以用 [^"]+ 匹配
// 同时支持三种包裹方式: url("...") url('...') url(...)
const GGG_SVG_TEXT_RE =
  /\/\*\s*ggg-svg-text(?:-(user|char))?\s*:\s*(.+?)\s*\*\/[\s\S]*?url\(\s*"(data:image\/svg\+xml[^"]+)"\s*\)/gi;
const GGG_SVG_COLOR_RE =
  /\/\*\s*ggg-svg-color(?:-(user|char))?\s*:\s*(.+?)\s*\*\/[\s\S]*?url\(\s*"(data:image\/svg\+xml[^"]+)"\s*\)/gi;

let parsedImages = [];
let parsedTexts = [];
let parsedColors = [];
let parsedSvgTexts = [];
let parsedSvgColors = [];
let expandedImageIndex = -1;
let expandedColorIndex = -1;
let overrides = {};

// ============================================================
// 导出
// ============================================================
export function initUICustom() {
  injectUICustomPanel();
  loadCurrentThemeData();
  initPresets();
  scanCSS();
  injectOverrideStyle();
}

export function onThemeChangedUICustom(newTheme) {
  saveCurrentThemeData();
  setCurrentThemeName(newTheme);
  loadCurrentThemeData();
  scanCSS();
  injectOverrideStyle();
  refreshPresetList();
  const el = document.getElementById('ggg-ui-custom-theme-name');
  if (el) el.textContent = newTheme;
}

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
      // SVG覆盖时，value 需为完整 url()
      declarations = `${data.property}: ${data.value} !important;`;
    } else continue;

    let rule = '';
    if (data.atRule) {
      rule = `${data.atRule} { ${data.selector} { ${declarations} } }`;
    } else {
      const sel =
        data.selector === ':root'
          ? ':root'
          : data.selector.startsWith('body')
          ? data.selector
          : `body ${data.selector}`;
      rule = `${sel} { ${declarations} }`;
    }
    css += rule + '\n';
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
  saveAllSettings();
}

function loadCurrentThemeData() {
  const data = getThemeData();
  // 优先加载当前存档的 overrides
  if (data.currentPreset && data.presets && data.presets[data.currentPreset]) {
    overrides = JSON.parse(JSON.stringify(data.presets[data.currentPreset]));
  } else {
    overrides = JSON.parse(JSON.stringify(data.overrides || {}));
  }
}

// ============================================================
// SVG 工具函数
// ============================================================

/**
 * 解码 SVG data URL 为 SVG 字符串
 */
function decodeSvgDataUrl(dataUrl) {
  if (!dataUrl) return '';
  // 去掉 data:image/svg+xml, 前缀
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) return '';
  const prefix = dataUrl.substring(0, commaIdx);
  const body = dataUrl.substring(commaIdx + 1);

  if (prefix.includes('base64')) {
    try {
      return atob(body);
    } catch {
      return '';
    }
  } else {
    try {
      return decodeURIComponent(body);
    } catch {
      return body;
    }
  }
}

/**
 * 编码 SVG 字符串为 data URL（URL编码方式）
 */
function encodeSvgDataUrl(svgString) {
  // 使用 URL 编码方式（比 base64 更紧凑且可读）
  const encoded = svgString.replace(/\n/g, '').replace(/\t/g, '').replace(/\s+/g, ' ').trim();
  return (
    'data:image/svg+xml,' +
    encodeURIComponent(encoded)
      .replace(/%20/g, ' ')
      .replace(/%3D/g, '=')
      .replace(/%3A/g, ':')
      .replace(/%2F/g, '/')
      .replace(/%22/g, "'")
  ); // 双引号变单引号避免CSS冲突
}

/**
 * 从 SVG 字符串中提取 <text> 标签的文本内容
 */
function extractSvgText(svgString) {
  // 匹配 <text ...>内容</text>
  const match = svgString.match(/<text[^>]*>([^<]*)<\/text>/i);
  return match ? match[1] : '';
}

/**
 * 从 SVG 字符串中提取 fill 颜色
 */
function extractSvgFillColor(svgString) {
  // 匹配 fill='...' 或 fill="..."
  const match = svgString.match(/fill\s*=\s*['"]([^'"]+)['"]/i);
  return match ? match[1] : '';
}

/**
 * 替换 SVG 字符串中的 <text> 内容
 */
function replaceSvgText(svgString, newText) {
  return svgString.replace(/(<text[^>]*>)[^<]*(<\/text>)/i, `$1${newText}$2`);
}

/**
 * 替换 SVG 字符串中的 fill 颜色
 */
function replaceSvgFillColor(svgString, newColor) {
  return svgString.replace(/(fill\s*=\s*['"])[^'"]+(['"])/i, `$1${newColor}$2`);
}

/**
 * 构建 SVG 覆盖：替换 data URL 中的文字或颜色，生成完整的属性覆盖
 */
function buildSvgOverride(item, newValue) {
  const cssText = SillyTavern.getContext().powerUserSettings?.custom_css || '';
  let svgString = decodeSvgDataUrl(item.svgDataUrl);
  if (!svgString) return null;

  // 从现有覆盖中获取已修改的SVG（可能文字和颜色都改了）
  const existingOverride = overrides[item.linkedKey] || overrides[item.key];
  if (existingOverride?._svgString) {
    svgString = existingOverride._svgString;
  }

  if (item.type === 'svg-text') {
    svgString = replaceSvgText(svgString, newValue);
  } else if (item.type === 'svg-color') {
    svgString = replaceSvgFillColor(svgString, newValue);
  }

  const newDataUrl = encodeSvgDataUrl(svgString);

  // 查找原始CSS中的完整声明
  const decl = extractFullDeclaration(cssText, item.matchIndex);
  if (decl) {
    // 保证 value 是完整 url()
    const newFullValue = decl.fullValue.replace(
      /url\(\s*['"]?(data:image\/svg\+xml[^'")\s]+)['"]?\s*\)/,
      `url('${newDataUrl}')`,
    );
    return {
      selector: item.selector,
      atRule: item.atRule,
      property: decl.propertyName,
      value: newFullValue,
      _svgString: svgString,
      _svgDataUrl: newDataUrl,
    };
  }

  // 回退方案
  return {
    selector: item.selector,
    atRule: item.atRule,
    property: 'background-image',
    value: `url('${newDataUrl}')`,
    _svgString: svgString,
    _svgDataUrl: newDataUrl,
  };
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
            </div>
            <div id="ggg-ui-custom-subtabs">
                <div class="ggg-subtab active" data-subtab="images"><i class="ggg-fa fa-solid fa-image"></i> 自定义图片</div>
                <div class="ggg-subtab" data-subtab="texts"><i class="ggg-fa fa-solid fa-pen"></i> 自定义文字</div>
                <div class="ggg-subtab" data-subtab="colors"><i class="ggg-fa fa-solid fa-droplet"></i> 自定义颜色</div>
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
                <div id="ggg-colors-list"></div>
                <div id="ggg-no-colors" class="ggg-empty-state"><div class="ggg-empty-icon"><i class="ggg-fa fa-solid fa-droplet"></i></div><div>没有找到颜色标记</div><div class="ggg-empty-hint">在CSS中添加 <code>/* ggg-color: 名称 */</code></div></div>
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
    toggleEl.addEventListener('click', e => {
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
    data.presets[trimmed] = JSON.parse(JSON.stringify(overrides));
    data.currentPreset = trimmed;
    saveAllSettings();
    refreshPresetList();
    toastr.success(`已保存存档: ${trimmed}`);
  });

  document.getElementById('ggg-btn-update-preset')?.addEventListener('click', () => {
    const name = document.getElementById('ggg-preset-select')?.value;
    if (!name || name === '__current__') {
      toastr.info('请先选择一个存档再更新');
      return;
    }
    const data = getThemeData();
    data.presets[name] = JSON.parse(JSON.stringify(overrides));
    saveAllSettings();
    toastr.success(`已更新存档: ${name}`);
  });

  document.getElementById('ggg-btn-delete-preset')?.addEventListener('click', async () => {
    const name = document.getElementById('ggg-preset-select')?.value;
    if (!name || name === '__current__') {
      toastr.info('请先选择一个存档');
      return;
    }
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

  document.getElementById('ggg-preset-select')?.addEventListener('change', e => {
    const name = e.target.value;
    if (name === '__current__') return;
    const data = getThemeData();
    const preset = data.presets[name];
    if (preset) {
      overrides = JSON.parse(JSON.stringify(preset));
      data.currentPreset = name;
      injectOverrideStyle();
      saveAllSettings();
      renderImages();
      renderTexts();
      renderColors();
      toastr.success(`已加载存档: ${name}`);
    }
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
function scanSmartThemeVars() {
  const rootStyles = getComputedStyle(document.documentElement);
  const smartThemeList = [
    { name: '--SmartThemeBodyColor', label: '主要文本' },
    { name: '--SmartThemeEmColor', label: '斜体文本' },
    { name: '--SmartThemeUnderlineColor', label: '下划线文本' },
    { name: '--SmartThemeQuoteColor', label: '引用文本' },
    { name: '--SmartThemeBlurTintColor', label: 'UI背景' },
    { name: '--SmartThemeChatTintColor', label: '聊天背景' },
    { name: '--SmartThemeUserMesBlurTintColor', label: '用户消息模糊色调' },
    { name: '--SmartThemeBotMesBlurTintColor', label: 'AI消息模糊色调' },
    { name: '--SmartThemeShadowColor', label: '阴影颜色' },
    { name: '--SmartThemeBorderColor', label: '边框颜色' },
  ];
  return smartThemeList.map(item => ({
    type: 'smart-theme',
    name: item.name,
    originalValue: rootStyles.getPropertyValue(item.name).trim(),
    key: 'smart-theme:' + item.name,
    selector: ':root',
    atRule: null,
    propertyName: item.name,
    label: item.label,
  }));
}

function scanCSS() {
  const ctx = SillyTavern.getContext();
  const cssText = ctx.powerUserSettings?.custom_css || '';

  parsedImages = [];
  parsedTexts = [];
  parsedColors = [];
  parsedSvgTexts = [];
  parsedSvgColors = [];
  let match;

  // 图片
  GGG_IMG_RE.lastIndex = 0;
  while ((match = GGG_IMG_RE.exec(cssText)) !== null) {
    const role = (match[1] || '').toLowerCase();
    const name = match[2].trim();
    const value = match[3];
    const key = `img:${role ? role + ':' : ''}${name}`;
    const si = findSelectorForMatch(cssText, match.index);
    parsedImages.push({ type: 'img', role, name, originalValue: value, key, selector: si.selector, atRule: si.atRule });
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

  // SVG 文字
  GGG_SVG_TEXT_RE.lastIndex = 0;
  while ((match = GGG_SVG_TEXT_RE.exec(cssText)) !== null) {
    const role = (match[1] || '').toLowerCase();
    const name = match[2].trim();
    const svgDataUrl = match[3];
    const svgString = decodeSvgDataUrl(svgDataUrl);
    const textContent = extractSvgText(svgString);
    const key = `svg-text:${role ? role + ':' : ''}${name}`;
    const si = findSelectorForMatch(cssText, match.index);

    // 查找是否有同位置的 svg-color 标记（用于关联）
    const linkedColorKey = `svg-color:${role ? role + ':' : ''}`;

    parsedSvgTexts.push({
      type: 'svg-text',
      role,
      name,
      originalValue: textContent,
      key,
      selector: si.selector,
      atRule: si.atRule,
      svgDataUrl,
      matchIndex: match.index,
    });

    // 同时加入普通文字列表显示
    parsedTexts.push({
      type: 'svg-text',
      role,
      name,
      originalValue: textContent,
      key,
      selector: si.selector,
      atRule: si.atRule,
      svgDataUrl,
      matchIndex: match.index,
      isSvg: true,
    });
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
    parsedColors.push({
      type: 'color',
      role,
      name,
      originalValue: value,
      key,
      selector: si.selector,
      atRule: si.atRule,
      propertyName,
    });
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
      parsedColors.push({
        type: 'color',
        role,
        name,
        originalValue: value,
        key,
        selector: si.selector,
        atRule: si.atRule,
        propertyName,
      });
    }
  }

  // SVG 颜色
  GGG_SVG_COLOR_RE.lastIndex = 0;
  while ((match = GGG_SVG_COLOR_RE.exec(cssText)) !== null) {
    const role = (match[1] || '').toLowerCase();
    const name = match[2].trim();
    const svgDataUrl = match[3];
    const svgString = decodeSvgDataUrl(svgDataUrl);
    const fillColor = extractSvgFillColor(svgString);
    const key = `svg-color:${role ? role + ':' : ''}${name}`;
    const si = findSelectorForMatch(cssText, match.index);

    parsedSvgColors.push({
      type: 'svg-color',
      role,
      name,
      originalValue: fillColor,
      key,
      selector: si.selector,
      atRule: si.atRule,
      svgDataUrl,
      matchIndex: match.index,
    });

    // 加入普通颜色列表显示
    parsedColors.push({
      type: 'svg-color',
      role,
      name,
      originalValue: fillColor,
      key,
      selector: si.selector,
      atRule: si.atRule,
      svgDataUrl,
      matchIndex: match.index,
      isSvg: true,
      propertyName: null, // SVG颜色没有独立的CSS属性名
    });
  }

  // 合并 SmartTheme 变量（只收集指定11个）
  parsedColors = parsedColors.concat(scanSmartThemeVars());

  expandedImageIndex = -1;
  expandedColorIndex = -1;
  renderImages();
  renderTexts();
  renderColors();
}

function resetAllOverrides() {
  if (Object.keys(overrides).length === 0) {
    toastr.info('没有需要恢复的修改');
    return;
  }
  overrides = {};
  injectOverrideStyle();
  saveAllSettings();
  renderImages();
  renderTexts();
  renderColors();
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
    } else if (item.type === 'svg-text') {
      if (override._svgString) return extractSvgText(override._svgString);
      return item.originalValue;
    } else if (item.type === 'svg-color') {
      if (override._svgString) return extractSvgFillColor(override._svgString);
      return item.originalValue;
    }
  }
  return item.originalValue;
}

// ============================================================
// CSS 解析工具
// ============================================================
function findSelectorForMatch(cssText, matchIndex) {
  let braceCount = 0,
    i = matchIndex;
  while (i >= 0) {
    if (cssText[i] === '}') braceCount++;
    if (cssText[i] === '{') {
      if (braceCount === 0) break;
      braceCount--;
    }
    i--;
  }
  if (i < 0) return { selector: null, atRule: null };

  let selectorEnd = i,
    selectorStart = i - 1;
  while (selectorStart >= 0 && /\s/.test(cssText[selectorStart])) selectorStart--;
  let nestedBrace = 0;
  while (selectorStart >= 0) {
    if (cssText[selectorStart] === '}') {
      selectorStart++;
      break;
    }
    if (cssText[selectorStart] === '{') {
      nestedBrace++;
      if (nestedBrace > 0) {
        selectorStart++;
        break;
      }
    }
    selectorStart--;
  }
  if (selectorStart < 0) selectorStart = 0;
  let selector = cssText.substring(selectorStart, selectorEnd).trim();

  // 清理选择器中的注释
  selector = selector.replace(/\/\*[\s\S]*?\*\//g, '').trim();

  let atRule = null,
    checkPos = selectorStart - 1,
    outerBrace = 0;
  while (checkPos >= 0) {
    if (cssText[checkPos] === '}') outerBrace++;
    if (cssText[checkPos] === '{') {
      if (outerBrace === 0) {
        let atStart = checkPos - 1;
        while (atStart >= 0 && /\s/.test(cssText[atStart])) atStart--;
        let atRuleStart = atStart;
        while (
          atRuleStart >= 0 &&
          cssText[atRuleStart] !== '}' &&
          cssText[atRuleStart] !== ';' &&
          cssText[atRuleStart] !== '{'
        )
          atRuleStart--;
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
  let braceEnd = matchIndex,
    depth = 0;
  while (braceEnd < cssText.length) {
    if (cssText[braceEnd] === '{') depth++;
    if (cssText[braceEnd] === '}') {
      depth--;
      if (depth <= 0) break;
    }
    braceEnd++;
  }
  const blockContent = cssText.substring(braceStart + 1, braceEnd);
  const relativeIndex = matchIndex - braceStart - 1;
  const declarations = parseDeclarations(blockContent);
  for (const decl of declarations) {
    if (relativeIndex >= decl.start && relativeIndex < decl.end)
      return { propertyName: decl.property, fullValue: decl.value };
  }
  return null;
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
        if (ce === -1) {
          i = len;
          break;
        }
        i = ce + 2;
        continue;
      }
      if (blockContent[i] === ':') {
        colonPos = i;
        break;
      }
      if (blockContent[i] === '}' || blockContent[i] === ';') break;
      i++;
    }
    if (colonPos === -1) {
      i++;
      continue;
    }
    const property = blockContent
      .substring(propStart, colonPos)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();
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
    const value = blockContent
      .substring(valueStart, i)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();
    if (property && value) results.push({ property, value, start: propStart, end: i });
    if (blockContent[i] === ';') i++;
  }
  return results;
}

function replaceUrlInValue(fullValue, oldUrl, newUrl) {
  const escaped = oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return fullValue.replace(new RegExp(`url\\(\\s*['"]?${escaped}['"]?\\s*\\)`, 'g'), `url('${newUrl}')`);
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildImageOverride(item, newUrl, props) {
  const cssText = SillyTavern.getContext().powerUserSettings?.custom_css || '';
  const re = new RegExp(
    `\\/\\*\\s*ggg-img(?:-(user|char))?\\s*:\\s*${escapeRegExp(
      item.name,
    )}\\s*\\*\\/\\s*(?:[^;]*?)url\\(\\s*['"]([^'"]*)['"]\\s*\\)`,
    'gi',
  );
  let match;
  re.lastIndex = 0;
  while ((match = re.exec(cssText)) !== null) {
    const role = (match[1] || '').toLowerCase();
    if (role === item.role) {
      const decl = extractFullDeclaration(cssText, match.index);
      if (decl) {
        let newFullValue = replaceUrlInValue(decl.fullValue, item.originalValue, newUrl);
        const cssProps = [`${decl.propertyName}: ${newFullValue}`];
        if (props) {
          if (props.size) cssProps.push(`background-size: ${props.size}`);
          if (props.position) cssProps.push(`background-position: ${props.position}`);
          if (props.repeat) cssProps.push(`background-repeat: ${props.repeat}`);
        }
        return {
          selector: item.selector,
          atRule: item.atRule,
          property: decl.propertyName,
          value: newFullValue,
          _newUrl: newUrl,
          _props: props || {},
          _multiProps: cssProps.length > 1 ? cssProps : undefined,
        };
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
  return {
    selector: item.selector,
    atRule: item.atRule,
    property: 'background-image',
    value: `url('${newUrl}')`,
    _newUrl: newUrl,
    _props: props || {},
    _multiProps: cssProps.length > 1 ? cssProps : undefined,
  };
}

// ============================================================
// 图片渲染
// ============================================================
function renderImages() {
  const list = document.getElementById('ggg-images-list');
  const empty = document.getElementById('ggg-no-images');
  if (!list) return;
  if (parsedImages.length === 0) {
    list.innerHTML = '';
    list.style.display = 'none';
    if (empty) empty.style.display = '';
    return;
  }
  list.style.display = '';
  if (empty) empty.style.display = 'none';

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
      html += `<div class="ggg-img-card ${
        isExpanded ? 'expanded' : ''
      }" data-index="${i}"><div class="ggg-img-card-preview" style="background-image: url('${escapeAttr(
        currentUrl,
      )}');"></div><div class="ggg-img-card-label" title="${escapeAttr(item.name)}">${escapeHtml(
        item.name,
      )}</div></div>`;
      if (isExpanded) html += buildExpandPanel(i, item);
    }
  }
  list.innerHTML = html;

  list.querySelectorAll('.ggg-img-card').forEach(card => {
    card.addEventListener('click', e => {
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
  const sizeOpts = [
    { value: '', label: '不覆盖（保持原样）' },
    { value: 'cover', label: '填满区域（可能裁切）' },
    { value: 'contain', label: '完整显示（可能留白）' },
    { value: 'auto', label: '原始大小' },
    { value: '100% 100%', label: '拉伸填满（可能变形）' },
    { value: 'auto 100%', label: '高度撑满，宽度自适应' },
    { value: '100% auto', label: '宽度撑满，高度自适应' },
    { value: 'custom', label: '自定义...' },
  ];
  const posOpts = [
    { value: '', label: '不覆盖（保持原样）' },
    { value: 'center', label: '居中' },
    { value: 'top', label: '顶部' },
    { value: 'bottom', label: '底部' },
    { value: 'left', label: '靠左' },
    { value: 'right', label: '靠右' },
    { value: 'center top', label: '水平居中 + 顶部' },
    { value: 'center bottom', label: '水平居中 + 底部' },
    { value: 'left top', label: '左上角' },
    { value: 'right top', label: '右上角' },
    { value: 'left bottom', label: '左下角' },
    { value: 'right bottom', label: '右下角' },
    { value: 'custom', label: '自定义...' },
  ];
  const repeatOpts = [
    { value: '', label: '不覆盖（保持原样）' },
    { value: 'no-repeat', label: '不平铺（只显示一张）' },
    { value: 'repeat', label: '水平+垂直平铺' },
    { value: 'repeat-x', label: '仅水平平铺' },
    { value: 'repeat-y', label: '仅垂直平铺' },
  ];

  const isCustomSize = props.size && !sizeOpts.slice(0, -1).some(o => o.value === props.size);
  const isCustomPos = props.position && !posOpts.slice(0, -1).some(o => o.value === props.position);
  const makeOpts = (options, current, isCustom) =>
    options
      .map(o => {
        let sel = '';
        if (o.value === 'custom' && isCustom) sel = 'selected';
        else if (o.value === current && !isCustom) sel = 'selected';
        return `<option value="${o.value}" ${sel}>${o.label}</option>`;
      })
      .join('');

  return `<div class="ggg-img-expand" data-expand-index="${index}">
        <div class="ggg-img-expand-tabs"><div class="ggg-img-expand-tab active" data-source="backgrounds">背景</div><div class="ggg-img-expand-tab" data-source="gallery">图库</div></div>
        <div class="ggg-img-expand-grid" id="ggg-expand-grid-${index}"></div>
        <div class="ggg-img-props">
            <div class="ggg-img-prop-item"><span class="ggg-img-prop-label">图片大小</span><select class="ggg-img-prop-select" data-prop="size">${makeOpts(
              sizeOpts,
              props.size,
              isCustomSize,
            )}</select><input type="text" class="ggg-img-prop-input ggg-prop-size-custom" placeholder="如: 50% auto" value="${
    isCustomSize ? props.size : ''
  }" style="display:${isCustomSize ? '' : 'none'}"></div>
            <div class="ggg-img-prop-item"><span class="ggg-img-prop-label">显示位置</span><select class="ggg-img-prop-select" data-prop="position">${makeOpts(
              posOpts,
              props.position,
              isCustomPos,
            )}</select><input type="text" class="ggg-img-prop-input ggg-prop-position-custom" placeholder="如: 50% 30%" value="${
    isCustomPos ? props.position : ''
  }" style="display:${isCustomPos ? '' : 'none'}"></div>
            <div class="ggg-img-prop-item"><span class="ggg-img-prop-label">平铺方式</span><select class="ggg-img-prop-select" data-prop="repeat">${makeOpts(
              repeatOpts,
              props.repeat,
              false,
            )}</select></div>
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

  expand.addEventListener('click', e => e.stopPropagation());
  expand.querySelectorAll('.ggg-img-prop-select').forEach(select => {
    select.addEventListener('change', () => {
      const ci = expand.querySelector(`.ggg-prop-${select.dataset.prop}-custom`);
      if (ci) ci.style.display = select.value === 'custom' ? '' : 'none';
    });
    ['keydown', 'keyup', 'keypress'].forEach(evt => select.addEventListener(evt, e => e.stopPropagation()));
  });
  expand.querySelectorAll('.ggg-img-prop-input').forEach(input => {
    ['keydown', 'keyup', 'keypress', 'input'].forEach(evt => input.addEventListener(evt, e => e.stopPropagation()));
  });

  function getSelectedProps() {
    const props = {};
    expand.querySelectorAll('.ggg-img-prop-select').forEach(select => {
      let val = select.value;
      if (val === 'custom') {
        const ci = expand.querySelector(`.ggg-prop-${select.dataset.prop}-custom`);
        val = ci?.value?.trim() || '';
      }
      if (val) props[select.dataset.prop] = val;
    });
    return Object.keys(props).length > 0 ? props : null;
  }

  function loadGrid(source) {
    if (!grid) return;
    grid.innerHTML = '';
    let items = [];
    if (source === 'backgrounds') {
      document.querySelectorAll('#bg_menu_content .bg_example').forEach(el => {
        const f = el.getAttribute('bgfile');
        if (f && !f.startsWith('ggg_')) items.push({ url: `/backgrounds/${f}`, name: f });
      });
    } else {
      const settings = getSettings();
      items = (settings.gallery || []).map(img => ({ url: img.url, name: img.name }));
    }
    if (items.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:12px;opacity:0.5;font-size:0.8em;">${
        source === 'gallery' ? '图库为空' : '没有背景图片'
      }</div>`;
      return;
    }

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
        const card = document.querySelector(`.ggg-img-card[data-index="${index}"] .ggg-img-card-preview`);
        if (card) card.style.backgroundImage = `url('${imgItem.url}')`;
      });
      grid.appendChild(div);
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
    const handler = async e => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const event = new CustomEvent('ggg-upload-request', {
        detail: {
          files,
          callback: () => {
            expand.querySelectorAll('.ggg-img-expand-tab').forEach(t => t.classList.remove('active'));
            expand.querySelector('[data-source="gallery"]')?.classList.add('active');
            loadGrid('gallery');
          },
        },
      });
      document.dispatchEvent(event);
      fileInput.value = '';
      fileInput.removeEventListener('change', handler);
    };
    fileInput.addEventListener('change', handler);
    fileInput.click();
  });

  expand.querySelector('.ggg-expand-reset')?.addEventListener('click', () => {
    delete overrides[item.key];
    injectOverrideStyle();
    saveAllSettings();
    selectedUrl = item.originalValue;
    const card = document.querySelector(`.ggg-img-card[data-index="${index}"] .ggg-img-card-preview`);
    if (card) card.style.backgroundImage = `url('${selectedUrl}')`;
    grid.querySelectorAll('.ggg-img-expand-item').forEach(d => d.classList.remove('selected'));
    expand.querySelectorAll('.ggg-img-prop-select').forEach(s => (s.value = ''));
    expand.querySelectorAll('.ggg-img-prop-input').forEach(inp => {
      inp.value = '';
      inp.style.display = 'none';
    });
    toastr.success(`已恢复默认: ${item.name}`);
  });

  expand.querySelector('.ggg-expand-cancel')?.addEventListener('click', () => {
    expandedImageIndex = -1;
    renderImages();
  });
  expand.querySelector('.ggg-expand-confirm')?.addEventListener('click', () => {
    const props = getSelectedProps();
    const hasUrlChange = selectedUrl !== item.originalValue;
    const hasPropsChange = props !== null;
    const hadOverride = !!overrides[item.key];
    if (!hasUrlChange && !hasPropsChange && !hadOverride) {
      expandedImageIndex = -1;
      renderImages();
      return;
    }
    const urlToUse = hasUrlChange ? selectedUrl : overrides[item.key]?._newUrl || item.originalValue;
    if (urlToUse === item.originalValue && !hasPropsChange) delete overrides[item.key];
    else overrides[item.key] = buildImageOverride(item, urlToUse, props);
    injectOverrideStyle();
    saveAllSettings();
    expandedImageIndex = -1;
    renderImages();
    toastr.success(`已更新: ${item.name}`);
  });
}

// ============================================================
// 文字渲染（含 SVG 文字）
// ============================================================
function renderTexts() {
  const list = document.getElementById('ggg-texts-list');
  const empty = document.getElementById('ggg-no-texts');
  if (!list) return;
  if (parsedTexts.length === 0) {
    list.innerHTML = '';
    list.style.display = 'none';
    if (empty) empty.style.display = '';
    return;
  }
  list.style.display = '';
  if (empty) empty.style.display = 'none';

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
      const svgBadge = item.isSvg ? '<span class="ggg-svg-badge">SVG</span>' : '';
      html += `<div class="ggg-text-row" data-index="${i}"><div class="ggg-text-row-name">${escapeHtml(
        item.name,
      )}${svgBadge}</div><div class="ggg-text-row-value">${escapeHtml(
        cv,
      )}</div><div class="ggg-text-row-actions"><span class="ggg-text-btn ggg-text-reset" data-index="${i}" title="恢复默认"><i class="ggg-fa fa-solid fa-rotate-left"></i></span><span class="ggg-text-btn ggg-text-edit" data-index="${i}" title="编辑"><i class="ggg-fa fa-solid fa-pen-to-square"></i></span></div></div>`;
    }
  }
  list.innerHTML = html;

  list.querySelectorAll('.ggg-text-edit').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      enterTextEditMode(parseInt(btn.dataset.index));
    }),
  );
  list.querySelectorAll('.ggg-text-reset').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const item = parsedTexts[parseInt(btn.dataset.index)];
      if (overrides[item.key]) {
        delete overrides[item.key];
        injectOverrideStyle();
        saveAllSettings();
        renderTexts();
        toastr.success(`已恢复默认: ${item.name}`);
      } else toastr.info('已是默认值');
    }),
  );
}

function enterTextEditMode(index) {
  const item = parsedTexts[index];
  const row = document.querySelector(`.ggg-text-row[data-index="${index}"]`);
  if (!row || !item) return;
  const valueEl = row.querySelector('.ggg-text-row-value');
  const actionsEl = row.querySelector('.ggg-text-row-actions');
  const currentVal = getCurrentValue(item);
  valueEl.style.display = 'none';

  const textarea = document.createElement('textarea');
  textarea.className = 'ggg-text-row-input';
  textarea.value = currentVal;
  textarea.rows = Math.max(1, Math.ceil(currentVal.length / 30));
  ['keydown', 'keyup', 'keypress', 'mousedown', 'input'].forEach(evt =>
    textarea.addEventListener(evt, e => e.stopPropagation()),
  );
  valueEl.parentNode.insertBefore(textarea, valueEl);

  actionsEl.innerHTML = `<span class="ggg-text-btn ggg-text-cancel" title="取消"><i class="ggg-fa fa-solid fa-xmark"></i></span><span class="ggg-text-btn ggg-text-confirm" title="确认"><i class="ggg-fa fa-solid fa-check"></i></span>`;
  setTimeout(() => {
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
  }, 50);

  actionsEl.querySelector('.ggg-text-cancel')?.addEventListener('click', e => {
    e.stopPropagation();
    renderTexts();
  });
  actionsEl.querySelector('.ggg-text-confirm')?.addEventListener('click', e => {
    e.stopPropagation();
    const newValue = textarea.value;

    if (item.isSvg) {
      // SVG 文字处理
      if (newValue === item.originalValue) {
        delete overrides[item.key];
      } else {
        overrides[item.key] = buildSvgOverride(item, newValue);
      }
    } else {
      // 普通文字处理
      if (newValue === item.originalValue) delete overrides[item.key];
      else
        overrides[item.key] = {
          selector: item.selector,
          atRule: item.atRule,
          property: 'content',
          value: `"${newValue}"`,
        };
    }
    injectOverrideStyle();
    saveAllSettings();
    renderTexts();
    toastr.success(`已更新文字: ${item.name}`);
  });
}

// ============================================================
// 颜色渲染（含 SVG 颜色）
// ============================================================
function renderColors() {
  const list = document.getElementById('ggg-colors-list');
  const empty = document.getElementById('ggg-no-colors');
  if (!list) return;
  if (parsedColors.length === 0) {
    list.innerHTML = '';
    list.style.display = 'none';
    if (empty) empty.style.display = '';
    return;
  }
  list.style.display = '';
  if (empty) empty.style.display = 'none';

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
      const isExpanded = i === expandedColorIndex;
      const svgBadge = item.isSvg ? '<span class="ggg-svg-badge">SVG</span>' : '';
      const displayName = item.type === 'smart-theme' && item.label ? item.label : item.name;
      html += `<div class="ggg-color-row" data-index="${i}"><div class="ggg-color-swatch" data-index="${i}" style="background: ${escapeAttr(
        cv,
      )};"><input type="color" class="ggg-color-swatch-input" data-index="${i}" value="${colorToHex(
        cv,
      )}"></div><div class="ggg-color-row-name">${escapeHtml(
        displayName,
      )}${svgBadge}</div><div class="ggg-color-row-actions"><span class="ggg-text-btn ggg-color-slider-toggle" data-index="${i}" title="滑块调色"><i class="ggg-fa fa-solid fa-sliders"></i></span><span class="ggg-text-btn ggg-color-reset" data-index="${i}" title="恢复默认"><i class="ggg-fa fa-solid fa-rotate-left"></i></span></div></div>`;
      if (isExpanded) html += buildColorSliders(i, item);
    }
  }
  list.innerHTML = html;

  list.querySelectorAll('.ggg-color-swatch-input').forEach(input => {
    input.addEventListener('input', e => {
      const idx = parseInt(input.dataset.index);
      const item = parsedColors[idx];
      const newColor = e.target.value;
      const swatch = input.closest('.ggg-color-swatch');
      if (swatch) swatch.style.background = newColor;
      applyColorChange(item, newColor);
      if (idx === expandedColorIndex) syncSlidersFromHex(newColor);
    });
    ['keydown', 'keyup', 'keypress'].forEach(evt => input.addEventListener(evt, e => e.stopPropagation()));
  });

  list.querySelectorAll('.ggg-color-slider-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      expandedColorIndex = expandedColorIndex === idx ? -1 : idx;
      renderColors();
    });
  });

  list.querySelectorAll('.ggg-color-reset').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const item = parsedColors[parseInt(btn.dataset.index)];
      if (overrides[item.key]) {
        delete overrides[item.key];
        injectOverrideStyle();
        saveAllSettings();
        renderColors();
        toastr.success(`已恢复默认: ${item.name}`);
      } else toastr.info('已是默认值');
    });
  });

  if (expandedColorIndex >= 0) bindColorSliderEvents(expandedColorIndex);
}

/**
 * 统一处理颜色修改（普通颜色 + SVG 颜色）
 */
function applyColorChange(item, newColor) {
  if (item.isSvg) {
    overrides[item.key] = buildSvgOverride(item, newColor);
  } else {
    overrides[item.key] = {
      selector: item.selector,
      atRule: item.atRule,
      property: item.propertyName,
      value: newColor,
    };
  }
  injectOverrideStyle();
  saveAllSettings();
}

function buildColorSliders(index, item) {
  const cv = getCurrentValue(item);
  const rgb = hexToRgb(colorToHex(cv));
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const displayName = item.type === 'smart-theme' && item.label ? item.label : item.name;
  return `<div class="ggg-color-sliders" data-color-index="${index}">
        <div class="ggg-color-sliders-title"><div class="ggg-color-sliders-preview" style="background: ${escapeAttr(
          cv,
        )};"></div><span>${escapeHtml(displayName)}</span></div>
        <div class="ggg-color-slider-group"><div class="ggg-color-slider-group-title">RGB</div>
            <div class="ggg-color-slider-row"><span class="ggg-color-slider-label" style="color:#f66;">R</span><input type="range" class="ggg-color-slider-track" data-channel="r" min="0" max="255" value="${
              rgb.r
            }" style="background: linear-gradient(to right, rgb(0,${rgb.g},${rgb.b}), rgb(255,${rgb.g},${
    rgb.b
  }));"><span class="ggg-color-slider-value" data-display="r">${rgb.r}</span></div>
            <div class="ggg-color-slider-row"><span class="ggg-color-slider-label" style="color:#6d6;">G</span><input type="range" class="ggg-color-slider-track" data-channel="g" min="0" max="255" value="${
              rgb.g
            }" style="background: linear-gradient(to right, rgb(${rgb.r},0,${rgb.b}), rgb(${rgb.r},255,${
    rgb.b
  }));"><span class="ggg-color-slider-value" data-display="g">${rgb.g}</span></div>
            <div class="ggg-color-slider-row"><span class="ggg-color-slider-label" style="color:#66f;">B</span><input type="range" class="ggg-color-slider-track" data-channel="b" min="0" max="255" value="${
              rgb.b
            }" style="background: linear-gradient(to right, rgb(${rgb.r},${rgb.g},0), rgb(${rgb.r},${
    rgb.g
  },255));"><span class="ggg-color-slider-value" data-display="b">${rgb.b}</span></div>
        </div>
        <div class="ggg-color-slider-group"><div class="ggg-color-slider-group-title">HSV</div>
            <div class="ggg-color-slider-row"><span class="ggg-color-slider-label">H</span><input type="range" class="ggg-color-slider-track" data-channel="h" min="0" max="360" value="${Math.round(
              hsv.h,
            )}" style="background: linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%));"><span class="ggg-color-slider-value" data-display="h">${Math.round(
    hsv.h,
  )}°</span></div>
            <div class="ggg-color-slider-row"><span class="ggg-color-slider-label">S</span><input type="range" class="ggg-color-slider-track" data-channel="s" min="0" max="100" value="${Math.round(
              hsv.s,
            )}" style="background: linear-gradient(to right, hsl(${hsv.h},0%,${hsv.v / 2}%), hsl(${
    hsv.h
  },100%,50%));"><span class="ggg-color-slider-value" data-display="s">${Math.round(hsv.s)}%</span></div>
            <div class="ggg-color-slider-row"><span class="ggg-color-slider-label">V</span><input type="range" class="ggg-color-slider-track" data-channel="v" min="0" max="100" value="${Math.round(
              hsv.v,
            )}" style="background: linear-gradient(to right, #000, hsl(${hsv.h},${
    hsv.s
  }%,50%));"><span class="ggg-color-slider-value" data-display="v">${Math.round(hsv.v)}%</span></div>
        </div>
        <div class="ggg-color-hex-row"><span class="ggg-color-slider-label">HEX</span><input type="text" class="ggg-color-hex-input" value="${colorToHex(
          cv,
        )}" maxlength="7"></div>
        <div class="ggg-color-slider-group"><div class="ggg-color-slider-group-title">Alpha</div>
            <div class="ggg-color-slider-row"><span class="ggg-color-slider-label">A</span><input type="range" class="ggg-color-slider-track ggg-color-alpha-slider" data-channel="a" min="0" max="100" value="100" style="background: linear-gradient(to right, rgba(0,0,0,0), rgba(0,0,0,1));"><span class="ggg-color-slider-value" data-display="a">100%</span></div>
        </div>
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
  const alphaSliders = panel.querySelectorAll('.ggg-color-alpha-slider');

  function getAlpha() {
    const slider = panel.querySelector('.ggg-color-alpha-slider');
    return slider ? parseInt(slider.value) : 100;
  }

  function applyColor(hex) {
    const alpha = getAlpha();
    let rgba = hexToRgb(hex);
    let color = `rgba(${rgba.r},${rgba.g},${rgba.b},${(alpha / 100).toFixed(2)})`;
    if (preview) preview.style.background = color;
    if (swatch) swatch.style.background = color;
    if (swatchInput) swatchInput.value = color;
    applyColorChange(item, color);
    panel.querySelectorAll('[data-display="a"]').forEach(el => el.textContent = `${alpha}%`);
  }

  function updateFromRGB() {
    const r = parseInt(panel.querySelector('[data-channel="r"]').value);
    const g = parseInt(panel.querySelector('[data-channel="g"]').value);
    const b = parseInt(panel.querySelector('[data-channel="b"]').value);
    const alpha = getAlpha();
    const hex = rgbToHex(r, g, b);
    const hsv = rgbToHsv(r, g, b);
    panel.querySelector('[data-channel="h"]').value = Math.round(hsv.h);
    panel.querySelector('[data-channel="s"]').value = Math.round(hsv.s);
    panel.querySelector('[data-channel="v"]').value = Math.round(hsv.v);
    panel.querySelector('[data-display="r"]').textContent = r;
    panel.querySelector('[data-display="g"]').textContent = g;
    panel.querySelector('[data-display="b"]').textContent = b;
    panel.querySelector('[data-display="h"]').textContent = Math.round(hsv.h) + '°';
    panel.querySelector('[data-display="s"]').textContent = Math.round(hsv.s) + '%';
    panel.querySelector('[data-display="v"]').textContent = Math.round(hsv.v) + '%';
    if (hexInput) hexInput.value = hex;
    updateSliderGradients(panel, r, g, b, hsv);
    applyColor(hex);
  }

  function updateFromHSV() {
    const h = parseInt(panel.querySelector('[data-channel="h"]').value);
    const s = parseInt(panel.querySelector('[data-channel="s"]').value);
    const v = parseInt(panel.querySelector('[data-channel="v"]').value);
    const alpha = getAlpha();
    const rgb = hsvToRgb(h, s, v);
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    panel.querySelector('[data-channel="r"]').value = rgb.r;
    panel.querySelector('[data-channel="g"]').value = rgb.g;
    panel.querySelector('[data-channel="b"]').value = rgb.b;
    panel.querySelector('[data-display="r"]').textContent = rgb.r;
    panel.querySelector('[data-display="g"]').textContent = rgb.g;
    panel.querySelector('[data-display="b"]').textContent = rgb.b;
    panel.querySelector('[data-display="h"]').textContent = h + '°';
    panel.querySelector('[data-display="s"]').textContent = s + '%';
    panel.querySelector('[data-display="v"]').textContent = v + '%';
    if (hexInput) hexInput.value = hex;
    updateSliderGradients(panel, rgb.r, rgb.g, rgb.b, { h, s, v });
    applyColor(hex);
  }

  function updateFromAlpha() {
    // 联动所有alpha滑块
    const val = getAlpha();
    alphaSliders.forEach(slider => { slider.value = val; });
    applyColor(hexInput.value || rgbToHex(
      parseInt(panel.querySelector('[data-channel="r"]').value),
      parseInt(panel.querySelector('[data-channel="g"]').value),
      parseInt(panel.querySelector('[data-channel="b"]').value)
    ));
  }

  ['r', 'g', 'b'].forEach(ch => {
    const slider = panel.querySelector(`[data-channel="${ch}"]`);
    if (slider) {
      slider.addEventListener('input', updateFromRGB);
      ['keydown', 'keyup', 'keypress'].forEach(evt => slider.addEventListener(evt, e => e.stopPropagation()));
    }
  });
  ['h', 's', 'v'].forEach(ch => {
    const slider = panel.querySelector(`[data-channel="${ch}"]`);
    if (slider) {
      slider.addEventListener('input', updateFromHSV);
      ['keydown', 'keyup', 'keypress'].forEach(evt => slider.addEventListener(evt, e => e.stopPropagation()));
    }
  });

  alphaSliders.forEach(slider => {
    slider.addEventListener('input', updateFromAlpha);
    ['keydown', 'keyup', 'keypress'].forEach(evt => slider.addEventListener(evt, e => e.stopPropagation()));
  });

  if (hexInput) {
    ['keydown', 'keyup', 'keypress', 'input'].forEach(evt => hexInput.addEventListener(evt, e => e.stopPropagation()));
    hexInput.addEventListener('change', () => {
      let val = hexInput.value.trim();
      if (!val.startsWith('#')) val = '#' + val;
      if (/^#[0-9a-fA-F]{6}$/.test(val)) {
        syncSlidersFromHex(val, panel);
        applyColor(val);
      }
    });
  }
}

function syncSlidersFromHex(hex, panel) {
  if (!panel) panel = document.querySelector(`.ggg-color-sliders[data-color-index="${expandedColorIndex}"]`);
  if (!panel) return;
  const rgb = hexToRgb(hex);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  panel.querySelector('[data-channel="r"]').value = rgb.r;
  panel.querySelector('[data-channel="g"]').value = rgb.g;
  panel.querySelector('[data-channel="b"]').value = rgb.b;
  panel.querySelector('[data-channel="h"]').value = Math.round(hsv.h);
  panel.querySelector('[data-channel="s"]').value = Math.round(hsv.s);
  panel.querySelector('[data-channel="v"]').value = Math.round(hsv.v);
  panel.querySelector('[data-display="r"]').textContent = rgb.r;
  panel.querySelector('[data-display="g"]').textContent = rgb.g;
  panel.querySelector('[data-display="b"]').textContent = rgb.b;
  panel.querySelector('[data-display="h"]').textContent = Math.round(hsv.h) + '°';
  panel.querySelector('[data-display="s"]').textContent = Math.round(hsv.s) + '%';
  panel.querySelector('[data-display="v"]').textContent = Math.round(hsv.v) + '%';
  const hexInput = panel.querySelector('.ggg-color-hex-input');
  if (hexInput) hexInput.value = hex;
  const preview = panel.querySelector('.ggg-color-sliders-preview');
  if (preview) preview.style.background = hex;
  updateSliderGradients(panel, rgb.r, rgb.g, rgb.b, hsv);
}

function updateSliderGradients(panel, r, g, b, hsv) {
  const rs = panel.querySelector('[data-channel="r"]'),
    gs = panel.querySelector('[data-channel="g"]'),
    bs = panel.querySelector('[data-channel="b"]');
  const ss = panel.querySelector('[data-channel="s"]'),
    vs = panel.querySelector('[data-channel="v"]');
  if (rs) rs.style.background = `linear-gradient(to right, rgb(0,${g},${b}), rgb(255,${g},${b}))`;
  if (gs) gs.style.background = `linear-gradient(to right, rgb(${r},0,${b}), rgb(${r},255,${b}))`;
  if (bs) bs.style.background = `linear-gradient(to right, rgb(${r},${g},0), rgb(${r},${g},255))`;
  if (ss) ss.style.background = `linear-gradient(to right, hsl(${hsv.h},0%,${hsv.v / 2}%), hsl(${hsv.h},100%,50%))`;
  if (vs) vs.style.background = `linear-gradient(to right, #000, hsl(${hsv.h},${hsv.s}%,50%))`;
}

// ============================================================
// 颜色工具
// ============================================================
function colorToHex(color) {
  if (!color) return '#000000';
  color = color.trim();
  const hexMatch = color.match(/^#([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    if (hex.length >= 6) return '#' + hex.substring(0, 6);
  }
  const rgbaMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbaMatch) return rgbToHex(parseInt(rgbaMatch[1]), parseInt(rgbaMatch[2]), parseInt(rgbaMatch[3]));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx2d = canvas.getContext('2d');
    ctx2d.fillStyle = color;
    ctx2d.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx2d.getImageData(0, 0, 1, 1).data;
    return rgbToHex(r, g, b);
  } catch {
    return '#000000';
  }
}

function rgbToHex(r, g, b) {
  return (
    '#' +
    [r, g, b]
      .map(c =>
        Math.max(0, Math.min(255, Math.round(c)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  return { r: parseInt(hex.substr(0, 2), 16), g: parseInt(hex.substr(2, 2), 16), b: parseInt(hex.substr(4, 2), 16) };
}

function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0,
    s = max === 0 ? 0 : d / max,
    v = max;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s: s * 100, v: v * 100 };
}

function hsvToRgb(h, s, v) {
  h /= 360;
  s /= 100;
  v /= 100;
  let r, g, b;
  const i = Math.floor(h * 6),
    f = h * 6 - i,
    p = v * (1 - s),
    q = v * (1 - f * s),
    t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function escapeHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
function escapeAttr(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
