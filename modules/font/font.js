/**
 * 字体管理模块（重构版）
 * - Phase 1: IndexedDB 存储 + FontFace API 注册（替代服务端上传）
 * - Phase 2: 字体档案导入/导出
 * - Phase 3: 在线字体有效性验证
 * - Phase 5: 完整的字体面板 UI（标签分类、分页、编辑模式、全局选择器）
 */
import { getSettings, saveAllSettings } from '../../index.js';
import { saveFontData, getFontData, deleteFontData, getAllFontData } from './font-db.js';

// ============================================================
// 常量
// ============================================================

/** 预设作用范围 */
const FONT_SCOPES = [
    { key: 'global',    label: '全局',     selector: 'body, button, input, select, textarea, #options a, ul, li, pre, code, .text_pole, #send_textarea, textarea.mdHotkeys, #send_textarea.mdHotkeys, .swipes-counter' },
    { key: 'chat',      label: '聊天窗口', selector: '#chat' },
    { key: 'mes_text',  label: '消息文字', selector: '.mes_text' },
    { key: 'name_text', label: '角色名称', selector: '.name_text' },
    { key: 'quote',     label: '引用(q)',  selector: 'q' },
    { key: 'em',        label: '斜体(em)', selector: 'em' },
    { key: 'strong',    label: '粗体',     selector: 'strong' },
    { key: 'headings',  label: '大标题/抽屉', selector: '#user-settings-block h4, #AdvancedFormatting h4, #openai_api-presets .margin0.title_restorable.standoutHeader, #persona-management-block .standoutHeader, .inline-drawer-toggle.inline-drawer-header, #world_popup > div:nth-child(2), #completion_prompt_manager .completion_prompt_manager_header' },
    { key: 'topbar',    label: '顶栏名称', selector: '#rm_button_selected_ch h2, #PersonaManagement h3, #rm_extensions_block h3, #bg-header-fixed h3, #user-settings-block h3, #WorldInfo h3, #AdvancedFormatting h3, #rm_api_block h3' },
    { key: 'code_all',  label: '代码(全)', selector: 'code' },
    { key: 'code_block', label: '代码块',  selector: 'pre code' },
    { key: 'code_inline', label: '行内代码', selector: 'code:not(pre code)' },
];

/** 每页显示字体数量 */
const PAGE_SIZE = 7;

// ============================================================
// 模块状态
// ============================================================

let fontSettings = { enabled: true, list: [], globalSelectors: [] };

/** fontId → Blob URL（本地字体专用） */
const blobUrls = new Map();

/** 当前页（0-indexed） */
let currentPage = 0;

/** 类型筛选：'all' | 'file' | 'online' */
let typeFilter = 'all';

/** 当前激活的 tag 筛选（null = 全部） */
let activeTagFilter = null;

/** 是否处于编辑模式 */
let editMode = false;

/** 编辑模式下选中的字体 ID 集合 */
const selectedFontIds = new Set();

/** 展开设置面板的字体 ID（null = 全部折叠） */
let expandedFontId = null;

// ============================================================
// 公开入口
// ============================================================

export async function initFont() {
    const settings = getSettings();
    if (!settings.fonts) settings.fonts = { enabled: true, list: [], globalSelectors: [] };
    if (!settings.fonts.globalSelectors) settings.fonts.globalSelectors = [];
    // 给现有字体补齐 tags 字段
    settings.fonts.list.forEach(f => { if (!f.tags) f.tags = []; });
    fontSettings = settings.fonts;

    // 从 IndexedDB 恢复本地字体的 Blob URL + FontFace 注册
    await loadFontsFromIndexedDB();

    // 注入字体样式
    injectFontStyles();

    // 渲染面板
    renderFontPanel();
}

// ============================================================
// IndexedDB → FontFace API（页面加载时恢复字体）
// ============================================================

async function loadFontsFromIndexedDB() {
    try {
        const allData = await getAllFontData();
        const dataMap = new Map(allData.map(d => [d.id, d]));

        // 恢复已知字体的 FontFace
        const localFonts = fontSettings.list.filter(f => f.type === 'file');
        for (const font of localFonts) {
            const record = dataMap.get(font.id);
            if (record) {
                try {
                    await registerFontFace(font, record.data);
                } catch (err) {
                    console.warn(`[ggg] 恢复字体失败: ${font.name}`, err);
                }
            } else {
                // IndexedDB 中找不到数据（可能被清除），标记为丢失
                font._missing = true;
                console.warn(`[ggg] 字体数据丢失: ${font.name} (${font.id})`);
            }
        }

        // 检测孤立字体（IndexedDB 中有但 settings 中不存在的记录）
        const knownIds = new Set(fontSettings.list.map(f => f.id));
        const orphans = allData.filter(d => !knownIds.has(d.id) && d.metadata);
        if (orphans.length > 0) {
            console.warn(`[ggg] 发现 ${orphans.length} 个孤立字体（IndexedDB 有数据但设置中丢失）`);
            // 将孤立记录数量存储，供面板渲染时显示恢复提示
            fontSettings._orphanCount = orphans.length;
            fontSettings._orphans = orphans;
        } else {
            fontSettings._orphanCount = 0;
            fontSettings._orphans = [];
        }
    } catch (err) {
        console.error('[ggg] 从 IndexedDB 恢复字体失败:', err);
    }
}

/** 从孤立 IndexedDB 记录恢复字体到列表 */
async function recoverOrphanFonts() {
    const orphans = fontSettings._orphans || [];
    if (orphans.length === 0) { toastr.info('没有可恢复的字体数据'); return; }

    let recovered = 0;
    for (const record of orphans) {
        const meta = record.metadata;
        if (!meta) continue;
        try {
            await registerFontFace({ id: meta.id, fontFaceName: meta.fontFaceName, format: meta.format || 'truetype' }, record.data);
        } catch (err) {
            console.warn(`[ggg] 恢复字体 FontFace 失败: ${meta.name}`, err);
        }
        fontSettings.list.push({
            id: meta.id,
            name: meta.name || record.filename || '恢复的字体',
            zhName: meta.zhName || '',
            enName: meta.enName || '',
            fontFaceName: meta.fontFaceName,
            type: 'file',
            format: meta.format || 'truetype',
            filename: meta.filename || record.filename || '',
            enabled: false,
            scopes: ['global'],
            customSelector: '',
            fontSize: null,
            tags: [],
            addedAt: record.savedAt || Date.now(),
            _recovered: true,
        });
        recovered++;
    }

    fontSettings._orphanCount = 0;
    fontSettings._orphans = [];
    saveAllSettings();
    refreshFontPanel();
    injectFontStyles();
    toastr.success(`已恢复 ${recovered} 个字体，请检查并启用需要的字体`);
}

/**
 * 用 FontFace API 注册字体，并创建 Blob URL
 * @param {object} font - 字体元数据
 * @param {ArrayBuffer} arrayBuffer - 字体二进制数据
 */
async function registerFontFace(font, arrayBuffer) {
    // 清理旧的 Blob URL（如果存在）
    revokeFont(font.id);

    const mimeType = getMimeType(font.format);
    const blob = new Blob([arrayBuffer], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    blobUrls.set(font.id, blobUrl);

    const faceName = font.fontFaceName || `ggg-${font.id}`;
    try {
        const fontFace = new FontFace(faceName, `url(${blobUrl})`);
        await fontFace.load();
        document.fonts.add(fontFace);
    } catch (err) {
        // FontFace 加载失败不是致命错误，CSS @font-face 仍可作为备用
        console.warn(`[ggg] FontFace API 注册失败: ${font.name}`, err);
    }
}

/** 撤销字体的 Blob URL 并从 document.fonts 中移除 */
function revokeFont(fontId) {
    const url = blobUrls.get(fontId);
    if (url) {
        URL.revokeObjectURL(url);
        blobUrls.delete(fontId);
        // 从 document.fonts 中移除同名字体
        const font = fontSettings.list.find(f => f.id === fontId);
        if (font) {
            const faceName = font.fontFaceName || `ggg-${fontId}`;
            document.fonts.forEach(ff => {
                if (ff.family === faceName) document.fonts.delete(ff);
            });
        }
    }
}

// ============================================================
// 字体导入 — 本地文件
// ============================================================

async function handleFileImport(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['ttf', 'otf', 'woff', 'woff2'].includes(ext)) {
        toastr.error('不支持的字体格式，请选择 ttf/otf/woff/woff2');
        return;
    }

    let arrayBuffer;
    try {
        arrayBuffer = await file.arrayBuffer();
    } catch (err) {
        toastr.error('读取字体文件失败');
        return;
    }

    // 解析 name table 获取中/英文字体名
    const nameInfo = parseFontNameTable(arrayBuffer);
    const baseName = file.name.replace(/\.(ttf|otf|woff2?)$/i, '');
    const defaultName = nameInfo.zhName || nameInfo.enName || baseName;

    // 让用户确认/修改字体名
    const { callGenericPopup, POPUP_TYPE } = SillyTavern.getContext();
    const userName = await callGenericPopup('请输入字体名称：', POPUP_TYPE.INPUT, defaultName, { rows: 1 });
    if (userName === null || userName === undefined) return;
    const finalName = userName.trim() || defaultName;

    const id = `font_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const fontFaceName = `ggg-local-${id}`;
    const format = ext === 'ttf' ? 'truetype' : ext === 'otf' ? 'opentype' : ext;

    // 存入 IndexedDB（同步保存元数据，便于 extension_settings 丢失后恢复）
    const metaSnapshot = {
        id, name: finalName,
        zhName: nameInfo.zhName || '', enName: nameInfo.enName || '',
        fontFaceName, type: 'file', format, filename: file.name,
    };
    try {
        await saveFontData(id, arrayBuffer, file.name, format, metaSnapshot);
    } catch (err) {
        // 处理 QuotaExceededError
        if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
            toastr.error('浏览器存储空间已满，请删除部分字体后再试');
        } else {
            toastr.error(`字体存储失败: ${err?.message || err}`);
            console.error('[ggg] IndexedDB 存储失败:', err);
        }
        return;
    }

    // 注册 FontFace（Blob URL）
    const fontEntry = { id, fontFaceName, format };
    await registerFontFace(fontEntry, arrayBuffer);

    // 添加元数据到列表：用户改过名字则不再使用解析出的 zh/en 名（否则显示处会覆盖用户输入）
    const userCustomized = finalName !== defaultName;
    const newFont = {
        id,
        name: finalName,
        zhName: userCustomized ? '' : (nameInfo.zhName || ''),
        enName: userCustomized ? '' : (nameInfo.enName || ''),
        fontFaceName,
        type: 'file',
        format,
        filename: file.name,
        enabled: false,
        scopes: ['global'],
        customSelector: '',
        fontSize: null,
        tags: [],
        addedAt: Date.now(),
    };
    fontSettings.list.push(newFont);
    saveAllSettings();
    refreshFontPanel();
    injectFontStyles();
    toastr.success(`已导入字体: ${finalName}`);
}

// ============================================================
// 字体 URL 有效性预检
// ============================================================

/**
 * 对字体 URL 做 HEAD 预检，返回 { ok, warn, reason }
 *   ok=true  → 有效
 *   ok=false → 确认无效，reason 为原因
 *   ok=null  → 无法判断（CORS / 网络限制），warn=true 时降级为软警告
 */
async function prefetchCheckFontUrl(url) {
    // 判断 URL 类型
    const isFontFile = /\.(woff2?|ttf|otf|eot)(\?.*)?$/i.test(url);
    const isCssFile  = /\.(css)(\?.*)?$/i.test(url)
        || /fonts\.googleapis\.com|fonts\.gstatic\.com|fonts\.font\.im/i.test(url);

    // 有效 Content-Type 白名单
    const FONT_CTYPES = ['font/', 'application/font', 'application/x-font',
                         'application/octet-stream', 'binary/octet-stream'];
    const CSS_CTYPES  = ['text/css'];

    try {
        // 优先用 HEAD（速度快），CORS 失败再用 no-cors GET（只能拿状态）
        let resp;
        try {
            resp = await fetch(url, { method: 'HEAD', mode: 'cors' });
        } catch {
            // HEAD 被 CORS 阻断，退回 no-cors（无法读 headers）
            resp = await fetch(url, { method: 'GET', mode: 'no-cors' });
            // no-cors 模式下 type=opaque，无法读状态码和 headers，降级为软警告
            if (resp.type === 'opaque') {
                return { ok: null, warn: true, reason: '受 CORS 限制，无法预检该 URL（可能正常，也可能无效）' };
            }
        }

        const status = resp.status;
        const ct = (resp.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();

        // 204：HEAD 请求时众多字体 CDN（含 fonts.gstatic.com）会返回 204，
        // 表示"资源存在但无响应体"，属于合法行为，不视为错误，跳过 Content-Type 校验
        if (status === 204)        return { ok: true };
        if (status === 403)        return { ok: false, reason: '服务器返回 403（禁止访问），该字体链接需要授权' };
        if (status === 404)        return { ok: false, reason: '服务器返回 404，找不到该字体文件' };
        if (status >= 400)         return { ok: false, reason: `服务器返回 ${status}，请检查链接是否正确` };
        if (status >= 300 && status < 400) {
            // 重定向一般正常，信任它
            return { ok: true };
        }

        // 根据 URL 类型校验 Content-Type
        if (isFontFile) {
            const isFont = FONT_CTYPES.some(t => ct.startsWith(t));
            if (!isFont) {
                // text/html 几乎肯定是错误页
                if (ct === 'text/html' || ct === 'text/plain') {
                    return { ok: false, reason: `Content-Type 为 "${ct}"，疑似页面/文本而非字体文件` };
                }
                // 其他未知类型：软警告
                return { ok: null, warn: true, reason: `Content-Type 为 "${ct}"，与预期字体类型不符，请确认链接` };
            }
        } else if (isCssFile) {
            const isCss = CSS_CTYPES.some(t => ct.startsWith(t));
            if (!isCss && ct !== '' && ct !== 'text/plain') {
                return { ok: null, warn: true, reason: `Content-Type 为 "${ct}"，可能不是字体 CSS` };
            }
        }

        return { ok: true };
    } catch (err) {
        // 网络完全不通
        return { ok: null, warn: true, reason: '无法连接到该服务器，请检查网络或 URL' };
    }
}

/**
 * 显示预检失败提示，返回用户是否仍要继续导入
 *   mode='error'  → 确认无效，询问是否强制导入
 *   mode='warn'   → 不确定，以 toastr 提示即可
 */
async function showPrefetchWarning(reason, mode) {
    if (mode === 'warn') {
        toastr.warning(`⚠️ ${reason}`, '字体链接预检', { timeOut: 5000 });
        return true; // 软警告不阻断
    }
    // 确认无效 → 弹窗询问用户是否强制导入
    const { callGenericPopup, POPUP_TYPE } = SillyTavern.getContext();
    const html = `
    <div style="line-height:1.6">
        <p><b>字体链接预检未通过</b></p>
        <p style="font-size:0.9em;opacity:0.8;">${escapeHtml(reason)}</p>
        <p style="font-size:0.85em;opacity:0.6;">仍可强制导入，但字体可能无法正常显示。</p>
    </div>`;
    return !!(await callGenericPopup(html, POPUP_TYPE.CONFIRM, '', { okButton: '仍要导入', cancelButton: '取消' }));
}

// ============================================================
// 字体导入 — 在线字体
// ============================================================

/** 从原始 CSS 文本（含注释）里提取中/英文字体名，优先中文。
 *  支持 ZeoSeven / cn-font-split 风格的 `FontFamilyName 名字` 注释行。 */
function extractNamesFromCSSText(rawCss) {
    const result = { zhName: '', enName: '' };
    if (!rawCss) return result;
    const isCJK = s => /[\u3400-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(s);
    // 1) FontFamilyName / FullFontName 注释行（cn-font-split 元数据）
    const lineRe = /(?:FontFamilyName|FullFontName)\s+([^\n*\/]+?)\s*(?:\n|\*\/|\*)/g;
    let m;
    while ((m = lineRe.exec(rawCss)) !== null) {
        const name = m[1].trim().replace(/^[:\s]+|[:\s]+$/g, '');
        if (!name) continue;
        if (isCJK(name) && !result.zhName) result.zhName = name;
        else if (!result.enName) result.enName = name;
    }
    // 2) 退路：@font-face 内的 font-family 中含 CJK 字符也算中文名
    if (!result.zhName) {
        const famRe = /font-family\s*:\s*["']?([^"';\n}]+?)["']?\s*[;\n}]/gi;
        while ((m = famRe.exec(rawCss)) !== null) {
            const n = m[1].trim();
            if (isCJK(n)) { result.zhName = n; break; }
        }
    }
    return result;
}

async function importOnlineFont(input) {
    const trimmed = input.trim();

    // ---- 情况1：输入包含 @font-face 原始 CSS 块（如 zeoseven 格式）----
    const rawFontFaceMatch = trimmed.match(/@font-face\s*\{[^}]*\}/i);
    if (rawFontFaceMatch) {
        // 收集所有 @font-face 块
        const allFontFaceBlocks = [...trimmed.matchAll(/@font-face\s*\{[^}]*\}/gi)].map(m => m[0]);
        // 优先从 CSS 注释（FontFamilyName/FullFontName）提取中文名
        const cssNames = extractNamesFromCSSText(trimmed);
        // 提取第一个 font-family 名作为英文回退
        let fontName = '';
        for (const block of allFontFaceBlocks) {
            const fam = block.match(/font-family\s*:\s*["']?([^"';\n}]+?)["']?\s*[;\n}]/i);
            if (fam) { fontName = fam[1].trim(); break; }
        }
        // 中文名优先：注释里的中文 > 注释里的英文 > font-family
        const preferredName = cssNames.zhName || cssNames.enName || fontName;
        if (preferredName) fontName = preferredName;
        if (!fontName) fontName = '自定义字体';

        // 尝试从 @font-face 的 src 中提取并下载字体文件（绕过 CDN Origin 限制）
        // 优先顺序：woff2 > woff > ttf > otf > eot
        const FORMAT_PRIORITY = ['woff2', 'woff', 'ttf', 'otf', 'eot'];
        // 收集所有 src 行中的 url+format 对
        const urlCandidates = [];
        const srcRegex = /url\s*\(\s*['"]?(https?:\/\/[^'")\s]+)['"]?\s*\)(?:\s*format\s*\(\s*['"]?([^'")\s]+)['"]?\s*\))?/gi;
        for (const block of allFontFaceBlocks) {
            let m;
            while ((m = srcRegex.exec(block)) !== null) {
                const url = m[1];
                // format 来自 format(...) 声明或 URL 扩展名
                const fmtHint = (m[2] || '').toLowerCase().replace('truetype', 'ttf').replace('opentype', 'otf');
                const extMatch = url.match(/\.(woff2?|ttf|otf|eot)(\?|$)/i);
                const ext = (fmtHint || (extMatch && extMatch[1]) || 'woff2').toLowerCase();
                urlCandidates.push({ url, ext });
            }
        }
        // 按优先级排序
        urlCandidates.sort((a, b) =>
            (FORMAT_PRIORITY.indexOf(a.ext) + 1 || 99) - (FORMAT_PRIORITY.indexOf(b.ext) + 1 || 99)
        );

        // 如果有可下载的 URL，先询问用户是否同意本地化存储
        if (urlCandidates.length > 0) {
            const confirmed = await new Promise(resolve => {
                const dialog = document.createElement('div');
                dialog.className = 'ggg-confirm-dialog-overlay';
                dialog.innerHTML = `
                    <div class="ggg-confirm-dialog">
                        <div class="ggg-confirm-dialog-title">
                            <i class="fa-solid fa-circle-info" style="color:#7ba7ff;margin-right:6px;"></i>
                            字体将下载到本地
                        </div>
                        <div class="ggg-confirm-dialog-body">
                            检测到 <b>@font-face</b> CSS 块，插件将尝试把字体文件下载到浏览器的 IndexedDB 本地存储，以避免 CDN 来源限制导致字体不显示。
                            <br><br>
                            <span style="opacity:0.75;font-size:0.9em;">下载完成后字体文件将保存在本地，刷新页面不需要重新下载。占用空间取决于字体大小（通常 1–10 MB）。</span>
                        </div>
                        <div class="ggg-confirm-dialog-footer">
                            <button class="ggg-confirm-btn ggg-confirm-cancel">取消导入</button>
                            <button class="ggg-confirm-btn ggg-confirm-ok">确定，开始下载</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(dialog);
                dialog.querySelector('.ggg-confirm-ok').addEventListener('click', () => {
                    dialog.remove();
                    resolve(true);
                });
                dialog.querySelector('.ggg-confirm-cancel').addEventListener('click', () => {
                    dialog.remove();
                    resolve(false);
                });
            });
            if (!confirmed) return;
        }

        // 尝试下载最佳格式
        let downloaded = null;
        for (const { url, ext } of urlCandidates) {
            try {
                const resp = await fetch(url, { mode: 'cors' });
                if (resp.ok && resp.status !== 204) {
                    const buffer = await resp.arrayBuffer();
                    if (buffer.byteLength > 0) {
                        const fmt = ext === 'ttf' ? 'truetype' : ext === 'otf' ? 'opentype' : ext;
                        const filename = url.split('/').pop().replace(/\?.*$/, '') || `${fontName}.${ext}`;
                        downloaded = { buffer, format: fmt, filename, url };
                        break;
                    }
                }
            } catch (err) {
                // CORS 或网络问题，尝试下一个格式
                console.warn(`[ggg] 下载字体文件失败 ${url}:`, err);
            }
        }

        if (downloaded) {
            // 成功下载 → 存为本地文件字体，彻底绕过 CDN 限制
            // 优先级：CSS 注释中文名 > 字体文件 name table > CSS @font-face 名
            // (cn-font-split 切片字体的 name table 通常被剥离，CSS 注释最可靠)
            const niBuf = parseFontNameTable(downloaded.buffer);
            const displayName = cssNames.zhName || niBuf.zhName || cssNames.enName || niBuf.enName || fontName;
            const ni = {
                zhName: cssNames.zhName || niBuf.zhName || '',
                enName: cssNames.enName || niBuf.enName || '',
            };

            const id = `font_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            const fontFaceName = `ggg-local-${id}`;
            const metaSnapshot = {
                id, name: displayName,
                zhName: ni.zhName || '', enName: ni.enName || '',
                fontFaceName, type: 'file',
                format: downloaded.format, filename: downloaded.filename,
            };
            try {
                await saveFontData(id, downloaded.buffer, downloaded.filename, downloaded.format, metaSnapshot);
            } catch (err) {
                if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
                    toastr.error('浏览器存储空间已满，请删除部分字体后再试');
                } else {
                    console.error('[ggg] 字体本地存储失败:', err);
                }
            }
            await registerFontFace({ id, fontFaceName, format: downloaded.format }, downloaded.buffer);
            fontSettings.list.push({
                id,
                name: displayName,
                zhName: ni.zhName || '',
                enName: ni.enName || '',
                fontFaceName,
                type: 'file',
                format: downloaded.format,
                filename: downloaded.filename,
                enabled: false,
                scopes: ['global'],
                customSelector: '',
                fontSize: null,
                tags: [],
                addedAt: Date.now(),
                _valid: true,
            });
            saveAllSettings();
            refreshFontPanel();
            injectFontStyles();
            toastr.success(`已下载并本地化字体: ${displayName}（避免 CDN 来源限制）`);
        } else {
            // 无法下载（全部 URL 均被 CORS 阻断）→ 退回 rawCSS 存储，并提示用户
            const id = `font_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            fontSettings.list.push({
                id,
                name: fontName,
                fontFaceName: fontName,
                type: 'online',
                src: '',
                rawCSS: allFontFaceBlocks.join('\n'),
                enabled: false,
                scopes: ['global'],
                customSelector: '',
                fontSize: null,
                tags: [],
                addedAt: Date.now(),
                _valid: true,
            });
            saveAllSettings();
            refreshFontPanel();
            injectFontStyles();
            if (urlCandidates.length > 0) {
                // 有 URL 但无法下载，说明 CDN 限制了来源
                toastr.warning(
                    `字体 "${fontName}" 已导入，但 CDN 限制了来源访问，字体可能无法正常显示。` +
                    `建议下载字体文件后改用"本地文件"方式导入。`,
                    '字体来源受限', { timeOut: 8000 }
                );
            } else {
                // rawCSS 没有 https:// URL（如 data URI 或相对路径），直接存储
                toastr.success(`已导入在线字体（自定义CSS）: ${fontName}`);
            }
        }
        return;
    }

    // ---- 情况2：@import url(...) 或 CSS/字体直链 URL ----
    let importUrl = trimmed;
    let fontName = '';

    const importMatch = importUrl.match(/@import\s+url\s*\(\s*['"]?(.*?)['"]?\s*\)/i);
    if (importMatch) importUrl = importMatch[1];
    importUrl = importUrl.replace(/^['"]|['"]$/g, '').trim();

    if (!importUrl.startsWith('http') && !importUrl.startsWith('//')) {
        toastr.error('请输入有效的字体 URL、@import 语句或 @font-face CSS 块');
        return;
    }

    // ---- 有效性预检 ----
    const check = await prefetchCheckFontUrl(importUrl);
    if (check.ok === false) {
        const proceed = await showPrefetchWarning(check.reason, 'error');
        if (!proceed) return;
    } else if (check.ok === null && check.warn) {
        await showPrefetchWarning(check.reason, 'warn');
    }

    // 尝试 fetch CSS 提取 font-family（仅对 CSS 类 URL）
    const isFontFileDirect = /\.(woff2?|ttf|otf|eot)(\?.*)?$/i.test(importUrl);
    if (!isFontFileDirect) {
        try {
            const resp = await fetch(importUrl);
            if (resp.ok) {
                const cssText = await resp.text();
                const ffMatches = cssText.matchAll(/@font-face\s*\{([^}]*)\}/gi);
                for (const m of ffMatches) {
                    const fam = m[1].match(/font-family:\s*['"]?([^'";\n}]+?)['"]?\s*[;\n}]/i);
                    if (fam) { fontName = fam[1].trim(); break; }
                }
            }
        } catch (e) {
            console.warn('[ggg] 无法获取在线字体 CSS:', e);
        }
    }

    // 后备：从 Google Fonts URL 中提取 / 直链字体名从文件名推断
    if (!fontName) {
        const m = importUrl.match(/family=([^&:]+)/i);
        if (m) fontName = decodeURIComponent(m[1]).replace(/\+/g, ' ').trim();
    }
    if (!fontName && isFontFileDirect) {
        // 从文件名推断字体名称
        const filename = importUrl.split('/').pop().replace(/\?.*$/, '');
        fontName = filename.replace(/\.(woff2?|ttf|otf|eot)$/i, '').replace(/[-_]/g, ' ').trim() || '在线字体';
    }
    if (!fontName) fontName = '在线字体';

    const id = `font_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    fontSettings.list.push({
        id,
        name: fontName,
        fontFaceName: fontName,
        type: 'online',
        src: importUrl,
        enabled: false,
        scopes: ['global'],
        customSelector: '',
        fontSize: null,
        tags: [],
        addedAt: Date.now(),
        _valid: check.ok === true ? true : null,
    });

    saveAllSettings();
    refreshFontPanel();
    injectFontStyles();
    toastr.success(`已导入在线字体: ${fontName}`);
}

// ============================================================
// CDN 动态加载工具：JSZip + wawoff2
// ============================================================

/** 动态加载 JSZip（通过 esm.sh），缓存 default export */
async function loadJSZip() {
    if (window._gggJSZip) return window._gggJSZip;
    try {
        const mod = await import('https://esm.sh/jszip@3');
        window._gggJSZip = mod.default || mod;
        return window._gggJSZip;
    } catch (err) {
        console.error('[ggg] JSZip 加载失败:', err);
        throw new Error('JSZip 库加载失败，请检查网络连接');
    }
}

// ============================================================
// Phase 2: 导出/导入字体档案（ZIP 压缩包格式）
// ============================================================

/** 显示导出选项弹窗，返回用户选择的 scope，取消则返回 null */
async function promptExportScope() {
    const { callGenericPopup, POPUP_TYPE } = SillyTavern.getContext();

    const html = `
        <div style="min-width:260px;">
            <div style="font-size:0.95em;font-weight:bold;margin-bottom:10px;">
                <i class="ggg-fa fa-solid fa-file-export" style="margin-right:6px;"></i>导出字体档案
            </div>
            <div style="font-size:0.85em;margin-bottom:12px;opacity:0.8;">选择要导出的字体范围：</div>
            <label style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:6px;cursor:pointer;background:rgba(255,255,255,0.04);margin-bottom:6px;">
                <input type="radio" name="ggg-export-scope" value="all" checked>
                <div>
                    <div style="font-size:0.88em;font-weight:bold;">全部字体</div>
                    <div style="font-size:0.78em;opacity:0.6;">包含本地字体文件和在线字体链接</div>
                </div>
            </label>
            <label style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:6px;cursor:pointer;background:rgba(255,255,255,0.04);margin-bottom:6px;">
                <input type="radio" name="ggg-export-scope" value="online">
                <div>
                    <div style="font-size:0.88em;font-weight:bold;">仅在线字体</div>
                    <div style="font-size:0.78em;opacity:0.6;">只导出 URL/CSS 链接，无字体文件</div>
                </div>
            </label>
            <label style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:6px;cursor:pointer;background:rgba(255,255,255,0.04);margin-bottom:10px;">
                <input type="radio" name="ggg-export-scope" value="local">
                <div>
                    <div style="font-size:0.88em;font-weight:bold;">仅本地字体</div>
                    <div style="font-size:0.78em;opacity:0.6;">只导出本地字体文件，不含在线字体</div>
                </div>
            </label>
            <div style="background:rgba(255,193,7,0.1);border:1px solid rgba(255,193,7,0.3);border-radius:5px;padding:7px 9px;font-size:0.78em;line-height:1.6;opacity:0.9;">
                <b>⚠ 字体版权提醒：</b>导出本地字体仅为方便个人跨设备使用。
                请勿二次传播禁止再分发的字体文件，使用前请确认您拥有相应授权。
            </div>
        </div>`;

    let scopeValue = 'all';
    setTimeout(() => {
        document.querySelectorAll('input[name="ggg-export-scope"]').forEach(r => {
            r.addEventListener('change', () => { if (r.checked) scopeValue = r.value; });
        });
    }, 80);

    const ok = await callGenericPopup(html, POPUP_TYPE.CONFIRM, '', {
        okButton: '开始导出', cancelButton: '取消', wide: false,
    });
    return ok ? scopeValue : null;
}

async function exportFontsZip() {
    if (fontSettings.list.length === 0) { toastr.info('没有字体可导出'); return; }

    const scope = await promptExportScope();
    if (!scope) return;

    let JSZip;
    try {
        JSZip = await loadJSZip();
    } catch (err) {
        toastr.error(err.message);
        return;
    }

    // 按 scope 过滤字体列表
    let toExport = fontSettings.list;
    if (scope === 'online') toExport = fontSettings.list.filter(f => f.type === 'online');
    if (scope === 'local')  toExport = fontSettings.list.filter(f => f.type === 'file');

    if (toExport.length === 0) { toastr.info('所选范围内没有字体'); return; }

    toastr.info('正在打包字体，请稍候…');

    const zip = new JSZip();
    const manifest = {
        version: 2,
        type: 'ggg-font-archive',
        exported: Date.now(),
        globalSelectors: fontSettings.globalSelectors || [],
        fonts: [],
    };

    const fontsFolder = zip.folder('fonts');

    for (const font of toExport) {
        // 元数据（不含二进制数据）
        const metaCopy = { ...font };
        delete metaCopy._valid;
        delete metaCopy._missing;
        delete metaCopy._recovered;

        const entry = { meta: metaCopy };

        if (font.type === 'file') {
            try {
                const record = await getFontData(font.id);
                if (record?.data) {
                    // 确定文件扩展名（以实际存储格式为准）
                    const storedFormat = record.format || font.format || 'truetype';
                    const extMap = { truetype: 'ttf', opentype: 'otf', woff: 'woff', woff2: 'woff2' };
                    const ext = extMap[storedFormat] || storedFormat || 'ttf';
                    const filename = `${font.id}.${ext}`;

                    fontsFolder.file(filename, record.data);
                    entry.fontFile = `fonts/${filename}`;
                    entry.fontExt = ext;
                }
            } catch (err) {
                console.warn(`[ggg] 导出字体数据失败: ${font.name}`, err);
            }
        }
        manifest.fonts.push(entry);
    }

    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ggg-fonts-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    const localCount = toExport.filter(f => f.type === 'file').length;
    const onlineCount = toExport.filter(f => f.type === 'online').length;
    toastr.success(`已打包 ${toExport.length} 个字体（本地 ${localCount} / 在线 ${onlineCount}）`);
}

async function importFontArchive(file) {
    // 兼容旧版 .json 和新版 .zip
    if (file.name.endsWith('.zip')) {
        await importFontArchiveZip(file);
    } else {
        await importFontArchiveJson(file);
    }
}

/** 导入旧版 JSON 格式档案（向下兼容） */
async function importFontArchiveJson(file) {
    let archive;
    try {
        const text = await file.text();
        archive = JSON.parse(text);
    } catch (err) {
        toastr.error('档案文件解析失败，请检查文件格式');
        return;
    }

    if (archive.type !== 'ggg-font-archive' || !Array.isArray(archive.fonts)) {
        toastr.error('不是有效的字体档案文件');
        return;
    }

    let imported = 0, skipped = 0;

    for (const entry of archive.fonts) {
        const meta = entry.meta;
        if (!meta?.id || !meta?.name) { skipped++; continue; }
        if (fontSettings.list.find(f => f.id === meta.id)) { skipped++; continue; }

        if (meta.type === 'file' && entry.data) {
            try {
                const binary = atob(entry.data);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                const ab = bytes.buffer;
                await saveFontData(meta.id, ab, meta.filename || meta.name, meta.format || 'truetype');
                await registerFontFace(meta, ab);
            } catch (err) {
                console.warn(`[ggg] 导入字体数据失败: ${meta.name}`, err);
            }
        }

        fontSettings.list.push({ ...meta, tags: meta.tags || [] });
        imported++;
    }

    if (Array.isArray(archive.globalSelectors)) {
        const existing = new Set((fontSettings.globalSelectors || []).map(s => s.selector));
        archive.globalSelectors.forEach(s => {
            if (!existing.has(s.selector)) { fontSettings.globalSelectors.push(s); existing.add(s.selector); }
        });
    }

    saveAllSettings();
    refreshFontPanel();
    injectFontStyles();
    toastr.success(`导入完成（旧版格式）：${imported} 个成功，${skipped} 个跳过`);
}

/** 导入新版 ZIP 格式档案 */
async function importFontArchiveZip(file) {
    let JSZip;
    try {
        JSZip = await loadJSZip();
    } catch (err) {
        toastr.error(err.message);
        return;
    }

    let zip, manifest;
    try {
        zip = await JSZip.loadAsync(file);
        const manifestFile = zip.file('manifest.json');
        if (!manifestFile) throw new Error('找不到 manifest.json');
        manifest = JSON.parse(await manifestFile.async('string'));
    } catch (err) {
        toastr.error(`ZIP 档案解析失败：${err.message}`);
        return;
    }

    if (manifest.type !== 'ggg-font-archive' || !Array.isArray(manifest.fonts)) {
        toastr.error('不是有效的字体档案 ZIP');
        return;
    }

    toastr.info(`正在导入 ${manifest.fonts.length} 个字体…`);
    let imported = 0, skipped = 0;

    for (const entry of manifest.fonts) {
        const meta = entry.meta;
        if (!meta?.id || !meta?.name) { skipped++; continue; }
        if (fontSettings.list.find(f => f.id === meta.id)) { skipped++; continue; }

        if (meta.type === 'file' && entry.fontFile) {
            try {
                const fontFileObj = zip.file(entry.fontFile);
                if (!fontFileObj) throw new Error(`找不到字体文件: ${entry.fontFile}`);

                const ab = await fontFileObj.async('arraybuffer');
                const format = meta.format || 'truetype';
                await saveFontData(meta.id, ab, meta.filename || meta.name, format, {
                    id: meta.id, name: meta.name, zhName: meta.zhName || '',
                    enName: meta.enName || '', fontFaceName: meta.fontFaceName,
                    type: 'file', format, filename: meta.filename || meta.name,
                });
                await registerFontFace(meta, ab);
            } catch (err) {
                console.warn(`[ggg] 导入字体文件失败: ${meta.name}`, err);
            }
        }

        fontSettings.list.push({ ...meta, tags: meta.tags || [], enabled: false });
        imported++;
    }

    if (Array.isArray(manifest.globalSelectors)) {
        const existing = new Set((fontSettings.globalSelectors || []).map(s => s.selector));
        manifest.globalSelectors.forEach(s => {
            if (!existing.has(s.selector)) { fontSettings.globalSelectors.push(s); existing.add(s.selector); }
        });
    }

    saveAllSettings();
    refreshFontPanel();
    injectFontStyles();
    toastr.success(`导入完成：${imported} 个成功，${skipped} 个跳过`);
}

// ============================================================
// Phase 3: 在线字体有效性验证
// ============================================================

async function validateAllOnlineFonts() {
    const onlineFonts = fontSettings.list.filter(f => f.type === 'online');
    if (onlineFonts.length === 0) { toastr.info('没有在线字体需要验证'); return; }

    toastr.info(`正在验证 ${onlineFonts.length} 个在线字体...`);
    let invalid = 0;

    for (const font of onlineFonts) {
        const ok = await checkOnlineFontValid(font);
        font._valid = ok;
        font._lastChecked = Date.now();
        if (!ok) invalid++;
    }

    saveAllSettings();
    refreshFontPanel();

    if (invalid > 0) toastr.warning(`发现 ${invalid} 个失效字体，已标红置顶`);
    else toastr.success('所有在线字体均有效 ✓');
}

/** 检查单个在线字体是否有效 */
async function checkOnlineFontValid(font) {
    if (font.type !== 'online') return true;
    // rawCSS 类型直接视为有效（已在本地定义）
    if (font.rawCSS) return true;
    if (!font.src) return false;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch(font.src, { signal: controller.signal });
        clearTimeout(timeout);
        if (!resp.ok) return false;
        const text = await resp.text();
        return /@font-face/i.test(text);
    } catch {
        return false;
    }
}

/** 显示无效字体的更新弹窗 */
async function showUpdateFontPopup(font) {
    const { callGenericPopup, POPUP_TYPE } = SillyTavern.getContext();
    const html = `
        <div style="padding:4px 0;">
            <div style="font-size:0.9em;font-weight:bold;margin-bottom:10px;color:var(--SmartThemeBodyColor,#eee)">
                <i class="ggg-fa fa-solid fa-triangle-exclamation" style="color:#ff6b6b;margin-right:6px;"></i>
                更新失效字体
            </div>
            <div style="font-size:0.8em;opacity:0.7;margin-bottom:8px;">字体名称（可复制后重新搜索）：</div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:14px;">
                <code style="flex:1;padding:6px 10px;border-radius:6px;background:rgba(255,255,255,0.07);font-size:0.9em;word-break:break-all;">${escapeHtml(font.name)}</code>
                <button class="menu_button ggg-btn-small" id="ggg-update-copy-name"><i class="ggg-fa fa-solid fa-copy"></i> 复制</button>
            </div>
            <div style="font-size:0.8em;opacity:0.7;margin-bottom:6px;">输入新的字体 CSS URL：</div>
            <input type="text" id="ggg-update-font-url" class="text_pole" placeholder="@import url(...) 或 CSS 字体 URL" value="${escapeAttr(font.src || '')}" style="width:100%;font-size:0.85em;">
        </div>`;

    setTimeout(() => {
        document.getElementById('ggg-update-copy-name')?.addEventListener('click', () => {
            navigator.clipboard.writeText(font.name).catch(() => {});
            toastr.info('已复制字体名');
        });
        const input = document.getElementById('ggg-update-font-url');
        if (input) ['keydown','keyup','keypress','input'].forEach(e => input.addEventListener(e, ev => ev.stopPropagation()));
    }, 100);

    const result = await callGenericPopup(html, POPUP_TYPE.CONFIRM, '', { okButton: '更新', cancelButton: '取消' });
    if (!result) return;

    const newUrl = document.getElementById('ggg-update-font-url')?.value?.trim();
    if (!newUrl) return;

    // 解析新 URL
    const importMatch = newUrl.match(/@import\s+url\s*\(\s*['"]?(.*?)['"]?\s*\)/i);
    font.src = importMatch ? importMatch[1].replace(/^['"]|['"]$/g, '').trim() : newUrl;
    font._valid = null; // 重置为未验证
    delete font._lastChecked;

    saveAllSettings();
    refreshFontPanel();
    injectFontStyles();
    toastr.success('字体 URL 已更新');
}

// ============================================================
// 样式注入
// ============================================================

// 字号越界复原后，防抖保存（避免一次循环里多次保存）
let _clampSaveTimer = null;
function _scheduleSaveAfterClamp() {
    if (_clampSaveTimer) return;
    _clampSaveTimer = setTimeout(() => {
        _clampSaveTimer = null;
        try { saveAllSettings(); } catch (e) { console.warn('[ggg-font] 复原后保存失败：', e); }
    }, 300);
}

// 导出供主入口在开关切换时调用
export function reapplyFontStyles() { injectFontStyles(); }

function injectFontStyles() {
    let styleEl = document.getElementById('ggg-fonts');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'ggg-fonts';
        document.head.appendChild(styleEl);
    }

    // 清理旧的在线字体 <link>
    document.querySelectorAll('link[data-ggg-font]').forEach(el => el.remove());

    // 总开关、美化开关、字体开关任一关闭时，清除所有字体样式
    const masterSettings = getSettings();
    if (!masterSettings.enabled || !masterSettings.beautifyEnabled || !fontSettings.enabled) {
        styleEl.textContent = '';
        return;
    }

    let fontFaces = '';
    let rules = '';

    // 收集全局自定义选择器
    const globalExtraSelectors = (fontSettings.globalSelectors || [])
        .filter(s => s.selector?.trim())
        .map(s => s.selector.trim());

    fontSettings.list.forEach(font => {
        if (font.type === 'file') {
            const faceName = font.fontFaceName || `ggg-${font.id}`;
            const blobUrl = blobUrls.get(font.id);
            if (blobUrl) {
                // 使用 Blob URL（已通过 FontFace API 注册）
                fontFaces += `@font-face { font-family: '${faceName}'; src: url('${blobUrl}') format('${font.format || 'truetype'}'); font-display: swap; }\n`;
            }
        } else if (font.type === 'online') {
            if (font.rawCSS) {
                // rawCSS 类型（如 @font-face 原始 CSS 块），直接注入
                fontFaces += font.rawCSS + '\n';
            } else if (font.src) {
                // 在线字体：添加 <link>
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = font.src;
                link.setAttribute('data-ggg-font', font.id);
                document.head.appendChild(link);
            }
        }

        if (!font.enabled) return;

        // 构建选择器列表
        const allScopes = getAllScopes();
        const selectors = [];
        (font.scopes || []).forEach(key => {
            const scope = allScopes.find(s => s.key === key);
            if (scope) selectors.push(scope.selector);
        });
        if (font.customSelector) selectors.push(font.customSelector);
        // 追加全局自定义选择器
        globalExtraSelectors.forEach(sel => {
            if (!selectors.includes(sel)) selectors.push(sel);
        });
        if (selectors.length === 0) return;

        const fontFamily = `'${font.fontFaceName || font.name}'`;

        // 紧急救援：字号越界 ( > 3em/48px 或 < 0.5em/10px ) 自动复原为默认 (null)
        if (font.fontSize?.value != null) {
            const v = parseFloat(font.fontSize.value);
            const unit = (font.fontSize.unit || 'px').toLowerCase();
            const px = (unit === 'em' || unit === 'rem') ? v * 16
                : (unit === '%') ? v * 0.16
                : v;
            if (!isFinite(px) || px > 48 || px < 10) {
                console.warn(`[ggg-font] 字号越界 (${v}${unit} ≈ ${px}px)，已自动复原默认`);
                font.fontSize = null;
                _scheduleSaveAfterClamp();
            }
        }

        const sizeCSS = font.fontSize?.value ? `font-size: ${font.fontSize.value}${font.fontSize.unit || 'px'} !important;` : '';
        rules += `${selectors.join(', ')} { font-family: ${fontFamily}, sans-serif !important; ${sizeCSS} }\n`;
    });

    styleEl.textContent = fontFaces + rules;
}

/** 获取所有可用 scope（内置 + 高级自定义全局选择器） */
function getAllScopes() {
    const scopes = [...FONT_SCOPES];
    (fontSettings.globalSelectors || []).forEach((s, i) => {
        const key = `_gs_${i}`;
        if (s.selector?.trim()) {
            scopes.push({ key, label: s.name || `自定义${i+1}`, selector: s.selector.trim() });
        }
    });
    return scopes;
}

// ============================================================
// 面板渲染（Phase 5 完整重设计）
// ============================================================

function renderFontPanel() {
    const container = document.getElementById('ggg-panel-font');
    if (!container) return;

    container.innerHTML = `
        <!-- 总开关 -->
        <div class="ggg-font-master-row">
            <label class="ggg-toggle-label">
                <input type="checkbox" id="ggg-font-master-toggle" ${fontSettings.enabled ? 'checked' : ''}>
                <i class="ggg-fa fa-solid fa-font ggg-toggle-icon"></i>
                <span>启用字体管理</span>
            </label>
        </div>

        <div id="ggg-font-content" ${!fontSettings.enabled ? 'style="display:none"' : ''}>
            <!-- 使用说明（可折叠，默认折叠） -->
            <div class="ggg-guide-wrapper" style="margin-bottom:8px;">
                <div class="ggg-guide-toggle" data-guide="font-usage">
                    <i class="ggg-fa fa-solid fa-circle-info"></i> 使用说明
                    <i class="ggg-fa fa-solid fa-chevron-down ggg-guide-arrow"></i>
                </div>
                <div class="ggg-guide-content" data-guide-content="font-usage">
                    <p><b>本地字体：</b>支持 ttf/otf/woff/woff2 格式，文件存储在浏览器本地（IndexedDB），无需服务器。</p>
                    <p><b>在线字体：</b>粘贴以下任意格式：</p>
                    <ul style="font-size:0.9em;margin:2px 0 6px;padding-left:18px;line-height:1.7;">
                        <li><code style="font-size:0.9em;">@import url('https://...')</code> 格式（Google Fonts 等）</li>
                        <li><code style="font-size:0.9em;">@font-face { font-family: ...; src: url(...); }</code> 原始 CSS 块</li>
                    </ul>
                    <p>
                        <b>推荐字体站：</b>
                        <span class="ggg-copyable" data-copy="https://fonts.zeoseven.com/" style="cursor:pointer;color:var(--SmartThemeQuoteColor,#aaa);text-decoration:underline;font-size:0.9em;">
                            fonts.zeoseven.com
                        </span>
                        <i class="ggg-fa fa-solid fa-copy ggg-copy-icon ggg-copyable" data-copy="https://fonts.zeoseven.com/" title="复制链接"></i>
                        （支持直接复制 @font-face CSS 块）
                    </p>
                    <p><b>标签：</b>可以给字体打标签，方便分组管理和筛选。</p>
                    <p><b>导出/导入：</b>可将字体连同文件数据一起打包导出，在其他设备/浏览器上导入使用。</p>
                    <p style="background:rgba(255,193,7,0.1);border:1px solid rgba(255,193,7,0.3);border-radius:5px;padding:5px 8px;"><b>⚠ 备份提醒：</b>强烈建议定期使用"导出档案"功能备份字体数据。本地字体存储在浏览器 IndexedDB 中，清除浏览器数据/更换浏览器会导致字体文件丢失（元数据保留），届时需重新导入。</p>
                </div>
            </div>

            <!-- 孤立字体恢复横幅（仅 IndexedDB 有数据但 settings 中找不到时显示） -->
            ${fontSettings._orphanCount > 0 ? `
            <div id="ggg-font-orphan-banner" class="ggg-font-orphan-banner">
                <i class="ggg-fa fa-solid fa-circle-exclamation"></i>
                检测到 ${fontSettings._orphanCount} 个本地字体数据可能因更新丢失元数据，点击恢复：
                <div id="ggg-font-btn-recover" class="menu_button menu_button_icon ggg-btn-small" style="margin-left:6px;">
                    <i class="ggg-fa fa-solid fa-rotate-left"></i> 从本地恢复
                </div>
            </div>` : ''}

            <!-- 工具栏 -->
            <div class="ggg-font-toolbar">
                <div id="ggg-font-btn-import" class="menu_button menu_button_icon ggg-btn-small" title="导入字体">
                    <i class="ggg-fa fa-solid fa-plus"></i> 导入
                </div>
                <div id="ggg-font-btn-edit" class="menu_button menu_button_icon ggg-btn-small" title="编辑模式">
                    <i class="ggg-fa fa-solid fa-pen-to-square"></i> 编辑
                </div>
                <div id="ggg-font-btn-validate" class="menu_button menu_button_icon ggg-btn-small" title="验证在线字体有效性">
                    <i class="ggg-fa fa-solid fa-circle-check"></i> 验证
                </div>
                <div id="ggg-font-btn-import-archive" class="menu_button menu_button_icon ggg-btn-small" title="从档案导入">
                    <i class="ggg-fa fa-solid fa-file-import"></i>
                </div>
                <div id="ggg-font-btn-export" class="menu_button menu_button_icon ggg-btn-small" title="导出字体档案">
                    <i class="ggg-fa fa-solid fa-file-export"></i>
                </div>
            </div>

            <!-- 编辑模式操作栏（隐藏，编辑模式时显示） -->
            <div id="ggg-font-edit-bar" class="ggg-font-edit-bar" style="display:none;">
                <div id="ggg-font-btn-select-all" class="menu_button menu_button_icon ggg-btn-small"><i class="ggg-fa fa-solid fa-check-double"></i> 全选</div>
                <div id="ggg-font-btn-deselect" class="menu_button menu_button_icon ggg-btn-small"><i class="ggg-fa fa-solid fa-xmark"></i> 取消</div>
                <div id="ggg-font-btn-batch-tag" class="menu_button menu_button_icon ggg-btn-small"><i class="ggg-fa fa-solid fa-tag"></i> 加标签</div>
                <div id="ggg-font-btn-batch-del-tag" class="menu_button menu_button_icon ggg-btn-small"><i class="ggg-fa fa-solid fa-tag" style="position:relative;"></i><i class="ggg-fa fa-solid fa-minus" style="font-size:0.6em;margin-left:1px;"></i> 删标签</div>
                <div id="ggg-font-btn-batch-delete" class="menu_button menu_button_icon ggg-btn-small ggg-btn-danger"><i class="ggg-fa fa-solid fa-trash"></i> 删除</div>
                <span id="ggg-font-edit-count" class="ggg-font-edit-count">已选 0 个</span>
            </div>

            <!-- 导入弹出区（隐藏） -->
            <div id="ggg-font-import-popup" class="ggg-font-import-popup" style="display:none;">
                <div class="ggg-font-import-tabs">
                    <div class="ggg-font-itab active" data-itab="file"><i class="ggg-fa fa-solid fa-file"></i> 本地文件</div>
                    <div class="ggg-font-itab" data-itab="online"><i class="ggg-fa fa-solid fa-globe"></i> 在线字体</div>
                </div>
                <div class="ggg-font-ipanel active" data-ipanel="file">
                    <div class="ggg-font-import-hint">支持 ttf / otf / woff / woff2 格式</div>
                    <div id="ggg-font-btn-pick-file" class="menu_button menu_button_icon ggg-btn-small" style="margin-top:4px;"><i class="ggg-fa fa-solid fa-upload"></i> 选择文件</div>
                </div>
                <div class="ggg-font-ipanel" data-ipanel="online">
                    <div class="ggg-font-import-hint">粘贴 @import url(...) 或 CSS 字体 URL</div>
                    <input type="text" id="ggg-font-url-input" class="ggg-font-url-input" placeholder="例: @import url('https://fonts.googleapis.com/...')">
                    <div style="display:flex;gap:6px;margin-top:6px;">
                        <div id="ggg-font-btn-import-online" class="menu_button menu_button_icon ggg-btn-small"><i class="ggg-fa fa-solid fa-download"></i> 导入</div>
                        <div id="ggg-font-btn-cancel-import" class="menu_button menu_button_icon ggg-btn-small"><i class="ggg-fa fa-solid fa-xmark"></i> 取消</div>
                    </div>
                </div>
            </div>

            <!-- 类型筛选 -->
            <div class="ggg-font-filter-row">
                <span class="ggg-font-type-chip ${typeFilter==='all'?'active':''}" data-ftype="all">全部</span>
                <span class="ggg-font-type-chip ${typeFilter==='file'?'active':''}" data-ftype="file">本地</span>
                <span class="ggg-font-type-chip ${typeFilter==='online'?'active':''}" data-ftype="online">在线</span>
            </div>

            <!-- Tag 横向滚动导航 -->
            <div id="ggg-font-tag-bar" class="ggg-font-tag-bar"></div>

            <!-- 字体列表 -->
            <div id="ggg-font-list-area"></div>

            <!-- 分页 -->
            <div id="ggg-font-pagination" class="ggg-font-pagination"></div>

            <!-- 高级：全局自定义选择器 -->
            <div class="ggg-guide-wrapper" style="margin-top:10px;">
                <div class="ggg-guide-toggle" data-guide="font-advanced">
                    <i class="ggg-fa fa-solid fa-gear"></i> 高级 — 全局自定义选择器
                    <i class="ggg-fa fa-solid fa-chevron-down ggg-guide-arrow"></i>
                </div>
                <div class="ggg-guide-content" data-guide-content="font-advanced">
                    <div style="font-size:0.8em;opacity:0.7;margin-bottom:8px;">
                        以下选择器会自动追加到<b>所有启用字体</b>的作用范围，无需逐个设置。
                    </div>
                    <div id="ggg-font-global-selectors"></div>
                    <div id="ggg-font-btn-add-selector" class="menu_button menu_button_icon ggg-btn-small" style="margin-top:6px;">
                        <i class="ggg-fa fa-solid fa-plus"></i> 添加选择器
                    </div>
                </div>
            </div>
        </div>
    `;

    bindFontPanelEvents();
    refreshFontList();
    refreshTagBar();
    renderGlobalSelectors();
}

/** 仅刷新面板内容（不重建 HTML 骨架） */
function refreshFontPanel() {
    refreshFontList();
    refreshTagBar();
    renderGlobalSelectors();
}

// ============================================================
// 正在使用的字体（字体卡片行）
// ============================================================

function refreshActiveFonts() {
    const row = document.getElementById('ggg-font-active-row');
    if (!row) return;

    const active = fontSettings.list.filter(f => f.enabled);
    if (active.length === 0) {
        row.innerHTML = '<span style="font-size:0.78em;opacity:0.5;">（无）</span>';
        return;
    }

    const allScopes = getAllScopes();
    row.innerHTML = active.map(f => {
        const ff = `'${f.fontFaceName || f.name}', sans-serif`;
        const displayName = f.zhName || f.name;
        const scopes = f.scopes || [];
        // 已选 chip：横向滚动显示
        const activeChips = allScopes
            .filter(s => scopes.includes(s.key))
            .map(s => `<span class="ggg-fscope-chip active" data-fid="${escapeAttr(f.id)}" data-scope="${s.key}">${s.label}</span>`)
            .join('');
        // 未选 chip：默认折叠，点 + 展开
        const inactiveChips = allScopes
            .filter(s => !scopes.includes(s.key))
            .map(s => `<span class="ggg-fscope-chip" data-fid="${escapeAttr(f.id)}" data-scope="${s.key}">${s.label}</span>`)
            .join('');
        return `
        <div class="ggg-font-active-item" data-fid="${escapeAttr(f.id)}">
            <span class="ggg-font-active-name" style="font-family:${ff} !important;">${escapeHtml(displayName)}</span>
            <div class="ggg-font-active-scopes-active">${activeChips || '<span class="ggg-font-active-empty">未选范围</span>'}</div>
            ${inactiveChips ? `<button class="ggg-font-active-add" data-fid="${escapeAttr(f.id)}" title="添加范围"><i class="ggg-fa fa-solid fa-plus"></i></button>` : ''}
            <div class="ggg-font-active-scopes-more" data-fid="${escapeAttr(f.id)}" style="display:none;">${inactiveChips}</div>
            <button class="ggg-font-active-disable" data-fid="${escapeAttr(f.id)}" title="取消选择此字体"><i class="ggg-fa fa-solid fa-xmark"></i></button>
        </div>`;
    }).join('');

    // 绑定 chip 点击：增减字体的 scope
    row.querySelectorAll('.ggg-fscope-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const fid = chip.dataset.fid;
            const key = chip.dataset.scope;
            const font = fontSettings.list.find(f => f.id === fid);
            if (!font) return;
            if (!font.scopes) font.scopes = [];
            const idx = font.scopes.indexOf(key);
            if (idx >= 0) font.scopes.splice(idx, 1);
            else font.scopes.push(key);
            saveAllSettings();
            injectFontStyles();
            refreshActiveFonts();
            const expandedSettings = document.querySelector(`.ggg-fitem-settings[data-fsettings="${CSS.escape(fid)}"]`);
            if (expandedSettings) {
                expandedSettings.querySelectorAll('.ggg-fscope-chip').forEach(c => {
                    c.classList.toggle('active', font.scopes.includes(c.dataset.scope));
                });
            }
        });
    });

    // 「+」按钮：展开/收起未选 chip
    row.querySelectorAll('.ggg-font-active-add').forEach(btn => {
        btn.addEventListener('click', () => {
            const more = row.querySelector(`.ggg-font-active-scopes-more[data-fid="${CSS.escape(btn.dataset.fid)}"]`);
            if (!more) return;
            more.style.display = more.style.display === 'none' ? 'flex' : 'none';
            btn.classList.toggle('open', more.style.display !== 'none');
        });
    });

    // 「✕」取消选择：禁用此字体
    row.querySelectorAll('.ggg-font-active-disable').forEach(btn => {
        btn.addEventListener('click', () => {
            const font = fontSettings.list.find(f => f.id === btn.dataset.fid);
            if (!font) return;
            font.enabled = false;
            saveAllSettings();
            injectFontStyles();
            refreshFontPanel();
        });
    });
}

// ============================================================
// Tag 横向滚动导航
// ============================================================

function refreshTagBar() {
    const bar = document.getElementById('ggg-font-tag-bar');
    if (!bar) return;

    const tagSet = new Set();
    fontSettings.list.forEach(f => (f.tags || []).forEach(t => tagSet.add(t)));
    const allTags = [...tagSet].sort((a, b) => a.localeCompare(b, 'zh'));

    if (allTags.length === 0) { bar.innerHTML = ''; bar.style.display = 'none'; return; }

    bar.style.display = 'flex';
    bar.innerHTML = `
        <span class="ggg-font-tag-chip ${activeTagFilter === null ? 'active' : ''}" data-ftag="__all__">全部</span>
        ${allTags.map(t => `<span class="ggg-font-tag-chip ${activeTagFilter === t ? 'active' : ''}" data-ftag="${escapeAttr(t)}">${escapeHtml(t)}</span>`).join('')}
    `;

    bar.querySelectorAll('.ggg-font-tag-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const val = chip.dataset.ftag;
            activeTagFilter = val === '__all__' ? null : val;
            currentPage = 0;
            refreshTagBar();
            refreshFontList();
        });
    });
}

// ============================================================
// 字体列表（分组 + 分页）
// ============================================================

function getFilteredGroupedFonts() {
    let filtered = fontSettings.list.filter(f => {
        if (typeFilter !== 'all' && f.type !== typeFilter) return false;
        if (activeTagFilter !== null && !(f.tags || []).includes(activeTagFilter)) return false;
        return true;
    });

    // 已启用字体单独成组，置顶显示（实现：已选择的字体出现在第一页顶部）
    const enabledFonts  = filtered.filter(f => f.enabled);
    const disabledFonts = filtered.filter(f => !f.enabled);
    enabledFonts.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh'));

    const items = [];
    enabledFonts.forEach((font, idx) => {
        items.push({ font, groupTag: '__enabled__', isGroupFirst: idx === 0 });
    });

    // 未启用按 tag 分组
    const groups = {};
    disabledFonts.forEach(f => {
        const sortedTags = (f.tags || []).slice().sort((a, b) => a.localeCompare(b, 'zh'));
        const groupKey = sortedTags[0] || '';
        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(f);
    });
    Object.values(groups).forEach(g => g.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh')));
    const sortedKeys = Object.keys(groups).sort((a, b) => {
        if (a === '' && b !== '') return 1;
        if (b === '' && a !== '') return -1;
        return a.localeCompare(b, 'zh');
    });
    sortedKeys.forEach(key => {
        groups[key].forEach((font, idx) => {
            items.push({ font, groupTag: key, isGroupFirst: idx === 0 });
        });
    });

    return items;
}

function refreshFontList() {
    const area = document.getElementById('ggg-font-list-area');
    const pagEl = document.getElementById('ggg-font-pagination');
    if (!area) return;

    const items = getFilteredGroupedFonts();

    // 失效字体置顶（Phase 3）
    const invalids = items.filter(({ font }) => font._valid === false);
    const others   = items.filter(({ font }) => font._valid !== false);
    const sorted   = [...invalids, ...others];
    const total    = sorted.length;

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentPage >= totalPages) currentPage = totalPages - 1;

    const pageFonts = sorted.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

    if (total === 0) {
        area.innerHTML = '<div class="ggg-font-empty">还没有导入任何字体</div>';
        if (pagEl) pagEl.innerHTML = '';
        return;
    }

    let html = '';
    let lastGroup = Symbol(); // 确保第一个分组一定渲染标题
    pageFonts.forEach(({ font, groupTag }) => {
        if (groupTag !== lastGroup) {
            const groupLabel = groupTag === '__enabled__' ? '已启用' : (groupTag || '未分类');
            html += `<div class="ggg-font-group-title">${escapeHtml(groupLabel)}</div>`;
            lastGroup = groupTag;
        }
        html += buildFontItemHTML(font);
    });

    area.innerHTML = html;
    bindFontItemEvents(area);

    // 分页
    if (pagEl) {
        if (totalPages <= 1) { pagEl.innerHTML = ''; return; }
        let pHtml = '';
        if (currentPage > 0) pHtml += `<span class="ggg-font-page-btn" data-page="${currentPage - 1}">«</span>`;
        for (let i = 0; i < totalPages; i++) {
            pHtml += `<span class="ggg-font-page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i + 1}</span>`;
        }
        if (currentPage < totalPages - 1) pHtml += `<span class="ggg-font-page-btn" data-page="${currentPage + 1}">»</span>`;
        pagEl.innerHTML = pHtml;

        pagEl.querySelectorAll('.ggg-font-page-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                currentPage = parseInt(btn.dataset.page);
                refreshFontList();
            });
        });
    }
}

function buildFontItemHTML(font) {
    const ff = `'${font.fontFaceName || font.name}', sans-serif`;
    const displayName = font.zhName || font.name;
    const typeLabel = font.type === 'file' ? '本地' : '在线';
    const isExpanded = expandedFontId === font.id;
    const isSelected = selectedFontIds.has(font.id);
    const isInvalid  = font._valid === false;
    const isMissing  = font._missing;

    // 范围标签（最多显示 2 个）
    const allScopes = getAllScopes();
    const scopeLabels = (font.scopes || []).slice(0, 2).map(key => {
        const s = allScopes.find(x => x.key === key);
        return s ? `<span class="ggg-fitem-scope">${s.label}</span>` : '';
    }).join('');

    // 本地字体若无 blobUrl 且未标记为 _missing，说明可能未加载成功
    const isNotLoaded = font.type === 'file' && !blobUrls.has(font.id) && !isMissing;

    const invalidBadge  = isInvalid  ? `<span class="ggg-fitem-badge ggg-fitem-badge-invalid">已失效</span>` : '';
    const missingBadge  = isMissing  ? `<span class="ggg-fitem-badge ggg-fitem-badge-missing">文件丢失</span>` : '';
    const notLoadBadge  = isNotLoaded && !isInvalid ? `<span class="ggg-fitem-badge ggg-fitem-badge-notload" title="字体名称若以系统字体显示，说明该字体未加载。可能原因：页面未刷新、字体文件损坏、网络超时等">未加载</span>` : '';

    return `
    <div class="ggg-fitem ${isSelected ? 'selected' : ''} ${isInvalid ? 'invalid' : ''}" data-fid="${escapeAttr(font.id)}">
        <div class="ggg-fitem-main">
            ${editMode
                ? `<div class="ggg-fitem-checkbox ${isSelected ? 'checked' : ''}" data-fid="${escapeAttr(font.id)}">
                    <i class="ggg-fa fa-solid ${isSelected ? 'fa-square-check' : 'fa-square'}"></i>
                   </div>`
                : `<input type="checkbox" class="ggg-fitem-enable" data-fid="${escapeAttr(font.id)}" ${font.enabled ? 'checked' : ''} title="启用/禁用">`
            }
            <div class="ggg-fitem-info">
                <span class="ggg-fitem-name" style="font-family:${ff} !important;" title="${isNotLoaded ? '若字体名称以系统字体显示，说明该字体当前未加载。可能原因：页面刚打开、字体文件损坏等' : ''}">${escapeHtml(displayName)}</span>
                <span class="ggg-fitem-type">${typeLabel}</span>
                ${invalidBadge}${missingBadge}${notLoadBadge}
            </div>
            <div class="ggg-fitem-scopes">${scopeLabels}</div>
            <div class="ggg-fitem-actions">
                ${isInvalid ? `<span class="ggg-text-btn ggg-fitem-update-btn" data-fid="${escapeAttr(font.id)}" title="更新字体 URL"><i class="ggg-fa fa-solid fa-rotate"></i></span>` : ''}
                ${!editMode ? `<span class="ggg-text-btn ggg-fitem-expand-btn ${isExpanded ? 'open' : ''}" data-fid="${escapeAttr(font.id)}" title="设置">
                    <i class="ggg-fa fa-solid fa-chevron-${isExpanded ? 'up' : 'down'}"></i>
                </span>` : ''}
                ${!editMode ? `<span class="ggg-text-btn ggg-fitem-delete-btn" data-fid="${escapeAttr(font.id)}" title="删除">
                    <i class="ggg-fa fa-solid fa-trash"></i>
                </span>` : ''}
            </div>
        </div>
        ${isExpanded && !editMode ? buildFontSettingsHTML(font) : ''}
    </div>`;
}

function buildFontSettingsHTML(font) {
    const scopes   = font.scopes || [];
    const fontSize = font.fontSize || { value: '', unit: 'px' };
    const tags     = font.tags || [];
    const hasCustom = !!font.customSelector;

    const allScopes = getAllScopes();
    const scopeChips = allScopes.map(s =>
        `<span class="ggg-fscope-chip ${scopes.includes(s.key) ? 'active' : ''}" data-fid="${escapeAttr(font.id)}" data-scope="${s.key}">${s.label}</span>`
    ).join('');

    return `
    <div class="ggg-fitem-settings" data-fsettings="${escapeAttr(font.id)}">
        <div class="ggg-fsetting-row">
            <span class="ggg-fsetting-label">使用范围</span>
            <span class="ggg-text-btn ggg-fadvanced-toggle" data-fid="${escapeAttr(font.id)}">${hasCustom ? '◆ 高级' : '○ 高级'}</span>
        </div>
        <div class="ggg-fscope-grid">${scopeChips}</div>
        <input type="text" class="ggg-fcustom-selector" data-fid="${escapeAttr(font.id)}"
            placeholder="自定义 CSS 选择器，如: .my-class" value="${escapeAttr(font.customSelector || '')}"
            style="${hasCustom ? '' : 'display:none;'}">

        <div class="ggg-fsetting-row" style="margin-top:8px;">
            <span class="ggg-fsetting-label">字体大小</span>
            <input type="number" class="ggg-fsize-input" data-fid="${escapeAttr(font.id)}"
                value="${fontSize.value || ''}" placeholder="默认" min="1" max="300" step="1">
            <select class="ggg-fsize-unit" data-fid="${escapeAttr(font.id)}">
                <option value="px" ${(fontSize.unit||'px')==='px'?'selected':''}>px</option>
                <option value="em" ${fontSize.unit==='em'?'selected':''}>em</option>
            </select>
        </div>

        <div class="ggg-fsetting-row" style="margin-top:8px;">
            <span class="ggg-fsetting-label">标签</span>
            <div class="ggg-ftag-edit-row">
                ${tags.map(t => `<span class="ggg-ftag-chip">${escapeHtml(t)}<i class="ggg-fa fa-solid fa-xmark ggg-ftag-remove" data-fid="${escapeAttr(font.id)}" data-tag="${escapeAttr(t)}"></i></span>`).join('')}
                <input type="text" class="ggg-ftag-input" data-fid="${escapeAttr(font.id)}" placeholder="输入后按 Enter 添加">
            </div>
        </div>
    </div>`;
}

// ============================================================
// 全局选择器（高级）
// ============================================================

function renderGlobalSelectors() {
    const container = document.getElementById('ggg-font-global-selectors');
    if (!container) return;

    const selectors = fontSettings.globalSelectors || [];
    if (selectors.length === 0) {
        container.innerHTML = '<div style="font-size:0.78em;opacity:0.5;padding:4px 0;">（暂无）</div>';
        return;
    }

    container.innerHTML = selectors.map((s, i) => `
        <div class="ggg-gselector-row">
            <span class="ggg-gselector-name">${escapeHtml(s.name || '选择器 ' + (i+1))}</span>
            <code class="ggg-gselector-code">${escapeHtml(s.selector)}</code>
            <span class="ggg-text-btn ggg-gselector-delete" data-gsi="${i}" title="删除"><i class="ggg-fa fa-solid fa-xmark"></i></span>
        </div>
    `).join('');

    container.querySelectorAll('.ggg-gselector-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.gsi);
            fontSettings.globalSelectors.splice(idx, 1);
            saveAllSettings();
            injectFontStyles();
            renderGlobalSelectors();
            refreshFontList();
        });
    });
}

// ============================================================
// 事件绑定
// ============================================================

function bindFontPanelEvents() {
    // 总开关
    document.getElementById('ggg-font-master-toggle')?.addEventListener('change', e => {
        fontSettings.enabled = e.target.checked;
        const content = document.getElementById('ggg-font-content');
        if (content) content.style.display = fontSettings.enabled ? '' : 'none';
        saveAllSettings();
        injectFontStyles();
    });

    // 使用说明折叠（只绑定字体面板内的，避免与 initGuides 重复绑定）
    const fontPanelRoot = document.getElementById('ggg-panel-font') || document.getElementById('ggg-bpanel-font');
    if (fontPanelRoot) {
        fontPanelRoot.querySelectorAll('.ggg-guide-toggle').forEach(toggle => {
            toggle.addEventListener('click', () => {
                const key = toggle.dataset.guide;
                const content = fontPanelRoot.querySelector(`.ggg-guide-content[data-guide-content="${key}"]`);
                if (!content) return;
                toggle.classList.toggle('open');
                content.classList.toggle('open');
            });
        });
    }

    // 导入按钮（展开/收起导入弹出区）
    document.getElementById('ggg-font-btn-import')?.addEventListener('click', () => {
        const popup = document.getElementById('ggg-font-import-popup');
        if (popup) popup.style.display = popup.style.display === 'none' ? '' : 'none';
    });

    // 编辑模式
    document.getElementById('ggg-font-btn-edit')?.addEventListener('click', () => {
        editMode = !editMode;
        selectedFontIds.clear();
        expandedFontId = null;
        document.getElementById('ggg-font-btn-edit')?.classList.toggle('active', editMode);
        const bar = document.getElementById('ggg-font-edit-bar');
        if (bar) bar.style.display = editMode ? 'flex' : 'none';
        refreshFontList();
    });

    // 验证在线字体
    document.getElementById('ggg-font-btn-validate')?.addEventListener('click', () => validateAllOnlineFonts());

    // 导出档案
    document.getElementById('ggg-font-btn-export')?.addEventListener('click', () => exportFontsZip());

    // 导入档案（文件选择）
    document.getElementById('ggg-font-btn-import-archive')?.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip,.json';
        input.addEventListener('change', e => {
            const file = e.target.files?.[0];
            if (file) importFontArchive(file);
        });
        input.click();
    });

    // 编辑模式：全选
    document.getElementById('ggg-font-btn-select-all')?.addEventListener('click', () => {
        getFilteredGroupedFonts().forEach(({ font }) => selectedFontIds.add(font.id));
        updateEditCount();
        refreshFontList();
    });

    // 编辑模式：取消选择
    document.getElementById('ggg-font-btn-deselect')?.addEventListener('click', () => {
        selectedFontIds.clear();
        updateEditCount();
        refreshFontList();
    });

    // 编辑模式：批量添加标签
    document.getElementById('ggg-font-btn-batch-tag')?.addEventListener('click', () => {
        if (selectedFontIds.size === 0) { toastr.info('请先选择字体'); return; }
        showBatchFontTagPopup([...selectedFontIds]);
    });

    // 编辑模式：批量删除标签
    document.getElementById('ggg-font-btn-batch-del-tag')?.addEventListener('click', () => {
        if (selectedFontIds.size === 0) { toastr.info('请先选择字体'); return; }
        showBatchDeleteFontTagPopup([...selectedFontIds]);
    });

    // 孤立字体恢复按钮
    document.getElementById('ggg-font-btn-recover')?.addEventListener('click', () => recoverOrphanFonts());

    // 编辑模式：批量删除
    document.getElementById('ggg-font-btn-batch-delete')?.addEventListener('click', async () => {
        if (selectedFontIds.size === 0) { toastr.info('请先选择字体'); return; }
        const { callGenericPopup, POPUP_TYPE } = SillyTavern.getContext();
        const ok = await callGenericPopup(`确定删除选中的 ${selectedFontIds.size} 个字体吗？`, POPUP_TYPE.CONFIRM);
        if (!ok) return;
        const ids = [...selectedFontIds];
        for (const id of ids) await deleteFontById(id);
        selectedFontIds.clear();
        editMode = false;
        document.getElementById('ggg-font-btn-edit')?.classList.remove('active');
        const bar = document.getElementById('ggg-font-edit-bar');
        if (bar) bar.style.display = 'none';
        saveAllSettings();
        refreshFontPanel();
        injectFontStyles();
        toastr.success(`已删除 ${ids.length} 个字体`);
    });

    // 类型筛选 Chip
    document.querySelectorAll('.ggg-font-type-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            typeFilter = chip.dataset.ftype;
            currentPage = 0;
            document.querySelectorAll('.ggg-font-type-chip').forEach(c => c.classList.toggle('active', c.dataset.ftype === typeFilter));
            refreshFontList();
        });
    });

    // 导入面板 Tabs
    document.querySelectorAll('.ggg-font-itab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.ggg-font-itab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.ggg-font-ipanel').forEach(p => p.classList.remove('active'));
            document.querySelector(`.ggg-font-ipanel[data-ipanel="${tab.dataset.itab}"]`)?.classList.add('active');
        });
    });

    // 选择本地字体文件
    document.getElementById('ggg-font-btn-pick-file')?.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.addEventListener('change', async e => {
            const files = e.target.files;
            if (!files || !files.length) return;
            const popup = document.getElementById('ggg-font-import-popup');
            if (popup) popup.style.display = 'none';
            for (const file of files) {
                try { await handleFileImport(file); }
                catch (err) { console.error('[ggg] 字体导入失败:', err); toastr.error(`导入失败: ${file.name}`); }
            }
        });
        input.click();
    });

    // 导入在线字体
    document.getElementById('ggg-font-btn-import-online')?.addEventListener('click', async () => {
        const input = document.getElementById('ggg-font-url-input');
        const val = input?.value?.trim();
        if (!val) { toastr.info('请输入字体 URL'); return; }
        await importOnlineFont(val);
        if (input) input.value = '';
        const popup = document.getElementById('ggg-font-import-popup');
        if (popup) popup.style.display = 'none';
    });

    // 取消导入
    document.getElementById('ggg-font-btn-cancel-import')?.addEventListener('click', () => {
        const popup = document.getElementById('ggg-font-import-popup');
        if (popup) popup.style.display = 'none';
    });

    // URL 输入框：阻止事件冒泡防止快捷键冲突
    const urlInput = document.getElementById('ggg-font-url-input');
    if (urlInput) ['keydown','keyup','keypress','input'].forEach(e => urlInput.addEventListener(e, ev => ev.stopPropagation()));

    // 添加全局选择器
    document.getElementById('ggg-font-btn-add-selector')?.addEventListener('click', async () => {
        const { callGenericPopup, POPUP_TYPE } = SillyTavern.getContext();
        const html = `<div>
            <div style="font-size:0.85em;margin-bottom:8px;opacity:0.7;">为此选择器添加一个易记名称：</div>
            <input type="text" id="ggg-gs-name" class="text_pole" placeholder="名称（如：侧边栏）" style="margin-bottom:8px;">
            <input type="text" id="ggg-gs-sel" class="text_pole" placeholder="CSS 选择器（如：.sidebar, #menu）">
        </div>`;
        let capturedName = '';
        let capturedSel = '';
        setTimeout(() => {
            const nameEl = document.getElementById('ggg-gs-name');
            const selEl = document.getElementById('ggg-gs-sel');
            [nameEl, selEl].forEach(el => {
                if (el) ['keydown','keyup','keypress','input'].forEach(e => el.addEventListener(e, ev => ev.stopPropagation()));
            });
            if (nameEl) nameEl.addEventListener('input', () => { capturedName = nameEl.value; });
            if (selEl) selEl.addEventListener('input', () => { capturedSel = selEl.value; });
        }, 100);
        const ok = await callGenericPopup(html, POPUP_TYPE.CONFIRM, '', { okButton: '添加', cancelButton: '取消' });
        if (!ok) return;
        const name = (document.getElementById('ggg-gs-name')?.value ?? capturedName).trim();
        const sel  = (document.getElementById('ggg-gs-sel')?.value ?? capturedSel).trim();
        if (!sel) { toastr.warning('请输入 CSS 选择器'); return; }
        if (!fontSettings.globalSelectors) fontSettings.globalSelectors = [];
        fontSettings.globalSelectors.push({ name: name || sel, selector: sel });
        saveAllSettings();
        injectFontStyles();
        renderGlobalSelectors();
        refreshFontList();
    });
}

function bindFontItemEvents(area) {
    // 启用/禁用复选框
    area.querySelectorAll('.ggg-fitem-enable').forEach(cb => {
        cb.addEventListener('change', () => {
            const font = getFontById(cb.dataset.fid);
            if (font) { font.enabled = cb.checked; saveAllSettings(); injectFontStyles(); refreshActiveFonts(); }
        });
    });

    // 编辑模式：点击复选框切换选中
    area.querySelectorAll('.ggg-fitem-checkbox').forEach(box => {
        box.addEventListener('click', () => {
            const id = box.dataset.fid;
            if (selectedFontIds.has(id)) selectedFontIds.delete(id);
            else selectedFontIds.add(id);
            updateEditCount();
            refreshFontList();
        });
    });

    // 展开/折叠设置面板
    area.querySelectorAll('.ggg-fitem-expand-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.fid;
            expandedFontId = expandedFontId === id ? null : id;
            refreshFontList();
        });
    });

    // 删除（单个）
    area.querySelectorAll('.ggg-fitem-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.fid;
            const font = getFontById(id);
            const { callGenericPopup, POPUP_TYPE } = SillyTavern.getContext();
            const ok = await callGenericPopup(`确定删除字体 "${font?.zhName || font?.name}" 吗？`, POPUP_TYPE.CONFIRM);
            if (!ok) return;
            await deleteFontById(id);
            saveAllSettings();
            refreshFontPanel();
            injectFontStyles();
            toastr.success(`已删除字体: ${font?.zhName || font?.name}`);
        });
    });

    // 更新失效字体按钮
    area.querySelectorAll('.ggg-fitem-update-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const font = getFontById(btn.dataset.fid);
            if (font) showUpdateFontPopup(font);
        });
    });

    // 作用范围 Chip
    area.querySelectorAll('.ggg-fscope-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const font = getFontById(chip.dataset.fid);
            if (!font) return;
            if (!font.scopes) font.scopes = [];
            const pos = font.scopes.indexOf(chip.dataset.scope);
            if (pos >= 0) font.scopes.splice(pos, 1);
            else font.scopes.push(chip.dataset.scope);
            chip.classList.toggle('active');
            saveAllSettings();
            injectFontStyles();
        });
    });

    // 高级自定义选择器显示/隐藏
    area.querySelectorAll('.ggg-fadvanced-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = area.querySelector(`.ggg-fcustom-selector[data-fid="${btn.dataset.fid}"]`);
            if (input) {
                const visible = input.style.display !== 'none';
                input.style.display = visible ? 'none' : '';
                btn.textContent = visible ? '○ 高级' : '◆ 高级';
            }
        });
    });

    // 自定义选择器输入
    area.querySelectorAll('.ggg-fcustom-selector').forEach(input => {
        ['keydown','keyup','keypress','input'].forEach(e => input.addEventListener(e, ev => ev.stopPropagation()));
        input.addEventListener('change', () => {
            const font = getFontById(input.dataset.fid);
            if (font) { font.customSelector = input.value.trim(); saveAllSettings(); injectFontStyles(); }
        });
    });

    // 字体大小输入
    area.querySelectorAll('.ggg-fsize-input').forEach(input => {
        ['keydown','keyup','keypress','input'].forEach(e => input.addEventListener(e, ev => ev.stopPropagation()));
        input.addEventListener('change', () => {
            const font = getFontById(input.dataset.fid);
            if (!font) return;
            const val  = input.value.trim();
            const unit = area.querySelector(`.ggg-fsize-unit[data-fid="${input.dataset.fid}"]`)?.value || 'px';
            font.fontSize = val ? { value: parseFloat(val), unit } : null;
            saveAllSettings();
            injectFontStyles();
        });
    });

    // 字体大小单位
    area.querySelectorAll('.ggg-fsize-unit').forEach(sel => {
        sel.addEventListener('change', () => {
            const font = getFontById(sel.dataset.fid);
            if (!font) return;
            const input = area.querySelector(`.ggg-fsize-input[data-fid="${sel.dataset.fid}"]`);
            const val = input?.value?.trim();
            if (val && font.fontSize) { font.fontSize.unit = sel.value; saveAllSettings(); injectFontStyles(); }
        });
    });

    // 标签删除
    area.querySelectorAll('.ggg-ftag-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const font = getFontById(btn.dataset.fid);
            if (!font) return;
            font.tags = (font.tags || []).filter(t => t !== btn.dataset.tag);
            saveAllSettings();
            refreshFontList();
            refreshTagBar();
        });
    });

    // 标签输入（按 Enter 或逗号添加）
    area.querySelectorAll('.ggg-ftag-input').forEach(input => {
        ['keydown','keyup','keypress','input'].forEach(e => input.addEventListener(e, ev => ev.stopPropagation()));
        input.addEventListener('keydown', e => {
            if (e.key !== 'Enter' && e.key !== ',') return;
            e.preventDefault();
            const font = getFontById(input.dataset.fid);
            const val = input.value.trim().replace(/,$/, '');
            if (!val || !font) return;
            if (!font.tags) font.tags = [];
            if (!font.tags.includes(val)) {
                font.tags.push(val);
                saveAllSettings();
                refreshFontList();
                refreshTagBar();
            }
            input.value = '';
        });
    });
}

// ============================================================
// 批量标签弹窗（编辑模式）
// ============================================================

// ============================================================
// 批量删除标签弹窗（编辑模式）
// ============================================================

async function showBatchDeleteFontTagPopup(ids) {
    // 收集已选字体上所有存在的标签
    const tagSet = new Set();
    ids.forEach(id => {
        const font = getFontById(id);
        if (font) (font.tags || []).forEach(t => tagSet.add(t));
    });
    const allTags = [...tagSet].sort();
    if (allTags.length === 0) { toastr.info('已选字体没有任何标签'); return; }

    // 用变量追踪勾选状态
    const toDeleteSet = new Set();

    const html = `
        <div class="ggg-tag-popup">
            <div class="ggg-tag-popup-title">批量删除标签（${ids.length} 个字体）</div>
            <div style="font-size:0.82em;opacity:0.65;margin-bottom:8px;">勾选要从已选字体中删除的标签</div>
            <div class="ggg-tag-popup-section">
                <div class="ggg-tag-popup-tags" id="ggg-fbtag-del-existing">
                    ${allTags.map(t => `<label class="ggg-tag-popup-chip"><input type="checkbox" value="${escapeAttr(t)}"><span>${escapeHtml(t)}</span></label>`).join('')}
                </div>
            </div>
        </div>`;

    const { callGenericPopup, POPUP_TYPE } = SillyTavern.getContext();
    setTimeout(() => {
        document.querySelectorAll('#ggg-fbtag-del-existing input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => {
                if (cb.checked) toDeleteSet.add(cb.value);
                else toDeleteSet.delete(cb.value);
            });
        });
    }, 100);

    const result = await callGenericPopup(html, POPUP_TYPE.CONFIRM, '', {
        okButton: '删除标签', cancelButton: '取消', allowVerticalScrolling: true,
    });
    if (!result) return;
    if (toDeleteSet.size === 0) { toastr.info('没有选择标签'); return; }

    ids.forEach(id => {
        const font = getFontById(id);
        if (!font) return;
        font.tags = (font.tags || []).filter(t => !toDeleteSet.has(t));
    });

    saveAllSettings();
    refreshFontPanel();
    toastr.success(`已从 ${ids.length} 个字体删除 ${toDeleteSet.size} 个标签`);
}

async function showBatchFontTagPopup(ids) {
    const tagSet = new Set();
    fontSettings.list.forEach(f => (f.tags || []).forEach(t => tagSet.add(t)));
    const allTags = [...tagSet].sort();
    let newTags = [];
    // 用变量追踪勾选状态（弹窗关闭后 DOM 会被销毁）
    const checkedTags = new Set();

    const html = `
        <div class="ggg-tag-popup">
            <div class="ggg-tag-popup-title">批量管理标签（${ids.length} 个字体）</div>
            <div class="ggg-tag-popup-section">
                <div class="ggg-tag-popup-subtitle">选择要添加的标签</div>
                <div class="ggg-tag-popup-tags" id="ggg-fbtag-existing">
                    ${allTags.length > 0
                        ? allTags.map(t => `<label class="ggg-tag-popup-chip"><input type="checkbox" value="${escapeAttr(t)}"><span>${escapeHtml(t)}</span></label>`).join('')
                        : '<span style="opacity:0.5;font-size:0.85em;">暂无标签</span>'}
                </div>
            </div>
            <div class="ggg-tag-popup-section">
                <div class="ggg-tag-popup-subtitle">添加新标签</div>
                <div class="ggg-tag-popup-new-row">
                    <input type="text" id="ggg-fbtag-input" class="text_pole" placeholder="新标签名…">
                    <div id="ggg-fbtag-add-btn" class="menu_button menu_button_icon ggg-btn-small"><i class="ggg-fa fa-solid fa-plus"></i></div>
                </div>
                <div id="ggg-fbtag-list" class="ggg-tag-popup-current-tags" style="margin-top:6px;"></div>
            </div>
        </div>`;

    const { callGenericPopup, POPUP_TYPE } = SillyTavern.getContext();
    setTimeout(() => {
        const listEl   = document.getElementById('ggg-fbtag-list');
        const addBtn   = document.getElementById('ggg-fbtag-add-btn');
        const addInput = document.getElementById('ggg-fbtag-input');

        function renderNewTags() {
            if (!listEl) return;
            listEl.innerHTML = newTags.map(t =>
                `<span class="ggg-tag-current-chip">${escapeHtml(t)} <i class="ggg-fa fa-solid fa-xmark ggg-fbtag-rm" data-tag="${escapeAttr(t)}"></i></span>`
            ).join('');
            listEl.querySelectorAll('.ggg-fbtag-rm').forEach(rm => {
                rm.addEventListener('click', () => { newTags = newTags.filter(x => x !== rm.dataset.tag); renderNewTags(); });
            });
        }

        function addTag() {
            const val = addInput?.value?.trim();
            if (!val || newTags.includes(val)) return;
            newTags.push(val);
            renderNewTags();
            if (addInput) addInput.value = '';
        }

        // 追踪复选框状态（不依赖弹窗关闭后的 DOM 查询）
        document.querySelectorAll('#ggg-fbtag-existing input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => {
                if (cb.checked) checkedTags.add(cb.value);
                else checkedTags.delete(cb.value);
            });
        });

        addBtn?.addEventListener('click', addTag);
        addInput?.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
        ['keyup','keypress','input'].forEach(ev => addInput?.addEventListener(ev, e => e.stopPropagation()));
    }, 100);

    const result = await callGenericPopup(html, POPUP_TYPE.CONFIRM, '', {
        okButton: '添加', cancelButton: '取消', allowVerticalScrolling: true,
    });
    if (!result) return;

    // 使用提前追踪的 checkedTags，而非弹窗关闭后查询 DOM
    const toAdd = [...checkedTags, ...newTags];
    if (toAdd.length === 0) { toastr.info('没有选择标签'); return; }

    ids.forEach(id => {
        const font = getFontById(id);
        if (!font) return;
        if (!font.tags) font.tags = [];
        toAdd.forEach(t => { if (!font.tags.includes(t)) font.tags.push(t); });
    });

    saveAllSettings();
    refreshFontPanel();
    toastr.success(`已为 ${ids.length} 个字体添加标签`);
}

// ============================================================
// 辅助：删除字体（包含 IndexedDB + Blob URL 清理）
// ============================================================

async function deleteFontById(id) {
    const idx = fontSettings.list.findIndex(f => f.id === id);
    if (idx < 0) return;
    const font = fontSettings.list[idx];

    // 清理 IndexedDB（本地字体）
    if (font.type === 'file') {
        try { await deleteFontData(id); } catch (err) { console.warn('[ggg] IndexedDB 删除失败:', err); }
    }

    // 撤销 Blob URL + 从 document.fonts 移除
    revokeFont(id);

    // 从列表移除
    fontSettings.list.splice(idx, 1);

    // 清理状态
    if (expandedFontId === id) expandedFontId = null;
    selectedFontIds.delete(id);
}

// ============================================================
// 辅助工具
// ============================================================

function updateEditCount() {
    const el = document.getElementById('ggg-font-edit-count');
    if (el) el.textContent = `已选 ${selectedFontIds.size} 个`;
}

function getFontById(id) {
    return fontSettings.list.find(f => f.id === id) || null;
}

function getMimeType(format) {
    switch (format) {
        case 'woff2':    return 'font/woff2';
        case 'woff':     return 'font/woff';
        case 'opentype': return 'font/otf';
        default:         return 'font/truetype';
    }
}

// ============================================================
// 字体 name table 解析（OpenType/TrueType）
// platformID=3(Windows), nameID=1(fontFamily)/4(fullName)
// languageID=2052 → 简体中文, languageID=1033 → 英文
// ============================================================
function parseFontNameTable(buffer) {
    const result = { zhName: '', enName: '' };
    try {
        const view = new DataView(buffer);
        const numTables = view.getUint16(4);
        let nameTableOffset = 0;

        for (let i = 0; i < numTables; i++) {
            const off = 12 + i * 16;
            const tag = String.fromCharCode(view.getUint8(off), view.getUint8(off+1), view.getUint8(off+2), view.getUint8(off+3));
            if (tag === 'name') { nameTableOffset = view.getUint32(off + 8); break; }
        }
        if (!nameTableOffset) return result;

        const count = view.getUint16(nameTableOffset + 2);
        const stringOffset = view.getUint16(nameTableOffset + 4);
        const storageOffset = nameTableOffset + stringOffset;

        for (let i = 0; i < count; i++) {
            const rec = nameTableOffset + 6 + i * 12;
            const platformID = view.getUint16(rec);
            const languageID = view.getUint16(rec + 4);
            const nameID     = view.getUint16(rec + 6);
            const length     = view.getUint16(rec + 8);
            const strOff     = view.getUint16(rec + 10);

            if (platformID !== 3) continue;
            if (nameID !== 1 && nameID !== 4) continue;

            const strStart = storageOffset + strOff;
            if (strStart + length > buffer.byteLength) continue;

            let str = '';
            for (let j = 0; j < length; j += 2) str += String.fromCharCode(view.getUint16(strStart + j));

            if (languageID === 2052 && !result.zhName) result.zhName = str;
            else if (languageID === 1033 && !result.enName) result.enName = str;
        }
    } catch (e) {
        console.warn('[ggg] 字体名解析失败:', e);
    }
    return result;
}

function escapeHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#039;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
