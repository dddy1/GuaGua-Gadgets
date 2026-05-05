/**
 * 设置 App —— 手机内的"系统设置"
 * 分组：
 *   入口    —— 统一悬浮球说明 / 始终全屏
 *   PP API  —— url / key / model（默认空 = 使用酒馆当前 API；可"从酒馆同步"）
 *   PP 预设 —— 全局一个当前预设；预设由多个条目组成（角色信息 / 世界书 / 上下文 / 自定义提示词）
 *   关于
 *
 * 数据落点：
 *   全屏 → settings.phone.*
 *   API     → settings.phone.api          { useStDefault, name, url, key, model }
 *   预设    → settings.phone.presets[]    + settings.phone.currentPresetId
 */
import { settings, saveAllSettings } from '../../../../index.js';
import {
    ensurePhoneTimeSettings,
    savePhoneTimeSettings,
    scanCustomPhoneTimeFromLatest,
    setPhoneTimeMode,
} from '../../core/phone-time.js';

const uid = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ============ 默认预设（v0.2.53 起：4 条固定条目） ============
 * 4 条固定条目（fixed: true）：
 *   fixed-char-info  角色信息（角色 PP + 角色设定，统一一段，无 markdown 标题）
 *   fixed-user-info  用户信息（用户 PP + persona 描述，统一一段）
 *   fixed-meme-lib   表情包库（主面板/手机图库上传）
 *   fixed-char-meme  角色表情包（角色 PP 资料）
 *   fixed-user-meme  用户表情包（用户 PP 资料）
 *   fixed-history    历史（酒馆当前聊天历史；PP 消息会桥接成真实酒馆楼层）
 *   fixed-latest     最新用户回复（PP 绕过酒馆发送时拼入）
 *
 * 固定条目可拖拽排序，不可删除、不可禁用、不可编辑。
 * 用户可在它们之间插入自定义条目（custom / lorebook / lorebook-entry）。
 */
const FIXED_ENTRY_TYPES = [
    'fixed-char-info',
    'fixed-user-info',
    'fixed-meme-lib',
    'fixed-char-meme',
    'fixed-user-meme',
    'fixed-history',
    'fixed-latest',
];

// 旧版 fixed type → 全部废弃，用统一 4 条替代
const LEGACY_FIXED_TYPES = new Set([
    'fixed-char-pp', 'fixed-char-set', 'fixed-user-pp', 'fixed-user-set',
]);

let _uidCounter = 0;
const stableUid = () => 's' + Date.now().toString(36) + (_uidCounter++).toString(36) + Math.random().toString(36).slice(2, 5);

function makeFixedEntries() {
    return FIXED_ENTRY_TYPES.map(t => ({ id: stableUid(), type: t, enabled: true, fixed: true }));
}

function makeDefaultPreset() {
    return {
        id: 'default',
        name: '默认预设',
        entries: makeFixedEntries(),
    };
}

/* v0.2.53：迁移老预设
 *   - 删除老的非 fixed 条目（char-info / user-info / st-context / pp-context / "PP 聊天规则"）
 *   - 删除老版 6 条 fixed（fixed-char-pp / fixed-char-set / fixed-user-pp / fixed-user-set）
 *   - 缺失的 fixed-* 自动补齐
 */
function migratePresetV253(p) {
    if (!p || !Array.isArray(p.entries)) return;
    const dropTypes = new Set(['char-info', 'user-info', 'st-context', 'pp-context']);
    p.entries = p.entries.filter(e => {
        if (dropTypes.has(e.type)) return false;
        if (LEGACY_FIXED_TYPES.has(e.type)) return false;
        if (e.type === 'custom' && e.name === 'PP 聊天规则') return false;
        return true;
    });
    const have = new Set(p.entries.filter(e => e.fixed).map(e => e.type));
    FIXED_ENTRY_TYPES.forEach(t => {
        if (!have.has(t)) p.entries.push({ id: stableUid(), type: t, enabled: true, fixed: true });
    });
}

function ensurePresetSetup() {
    if (!settings.phone) settings.phone = {};
    if (!Array.isArray(settings.phone.presets) || settings.phone.presets.length === 0) {
        settings.phone.presets = [makeDefaultPreset()];
    } else {
        settings.phone.presets.forEach(migratePresetV253);
    }
    if (!settings.phone.currentPresetId) {
        settings.phone.currentPresetId = settings.phone.presets[0].id;
    }
    saveAllSettings();
}

function ensureApiSetup() {
    if (!settings.phone) settings.phone = {};
    if (!settings.phone.api) {
        settings.phone.api = { useStDefault: true, name: '', url: '', key: '', model: '' };
        saveAllSettings();
    }
}

/* 取酒馆当前 API：优先用酒馆全局变量 oai_settings / textgenerationwebui_settings 等，
 * 失败再退化到 DOM 读取。这才是各 API 字段都齐的可靠方式 */
function readStCurrentApi() {
    const w = window;
    // 关键修复：window.main_api 在新版酒馆里是 <select> DOM 元素而不是字符串！
    //   先判断类型：DOM 元素取 .value，字符串则直接用
    let mainRaw = w.main_api;
    if (mainRaw && typeof mainRaw === 'object' && 'value' in mainRaw) mainRaw = mainRaw.value;
    let main = String(mainRaw || document.querySelector('#main_api')?.value || '').trim();
    // SillyTavern.getContext().mainApi 兜底
    if (!main || main === '[object HTMLSelectElement]') {
        try {
            const ctx = w.SillyTavern?.getContext?.();
            if (ctx?.mainApi) main = String(ctx.mainApi).trim();
        } catch {}
    }
    let url = '', model = '', source = main || 'unknown';

    if (main === 'openai') {
        // SillyTavern.getContext().oai_settings 优先，因为新版可能没把 oai_settings 挂在 window
        let oai = w.oai_settings || {};
        try {
            const ctx2 = w.SillyTavern?.getContext?.();
            if (ctx2?.oai_settings && Object.keys(ctx2.oai_settings).length > 0) oai = ctx2.oai_settings;
        } catch {}
        const cc = (oai.chat_completion_source || document.querySelector('#chat_completion_source')?.value || 'openai').trim();
        source = `openai/${cc}`;
        // 各家 model 字段都叫 ${cc}_model
        const candidates = [`${cc}_model`, 'openai_model', 'claude_model', 'openrouter_model', 'custom_model'];
        for (const k of candidates) { if (!model && oai[k]) model = oai[k]; }
        // url
        if (cc === 'custom')         url = oai.custom_url || '';
        else if (cc === 'openrouter') url = oai.openrouter_url || '';
        else                          url = oai.reverse_proxy || oai.proxy_url || '';
        // custom 模式 DOM 兜底（不同酒馆版本 input id 不一样，多列几个）
        if (cc === 'custom' && !url) {
            const sel = [
                '#custom_api_url_text', // 新版酒馆实际 id（已确认）
                '#custom_api_url', '#custom_url', '#openai_custom_url',
                '#custom_endpoint', '#api_url_custom',
                'input[name="custom_url"]', 'input[name="api_url_custom"]',
                '#custom_api_url_input', '#custom_url_input',
            ];
            for (const s of sel) {
                const v = (document.querySelector(s)?.value || '').trim();
                if (v) { url = v; break; }
            }
        }
        // custom 模式 model DOM 兜底
        if (cc === 'custom' && !model) {
            const sel = ['#model_custom_select', '#custom_model_id', 'input[name="custom_model_id"]'];
            for (const s of sel) {
                const v = (document.querySelector(s)?.value || '').trim();
                if (v) { model = v; break; }
            }
        }
    } else if (main === 'textgenerationwebui') {
        const tg = w.textgenerationwebui_settings || {};
        const type = tg.type || '';
        source = type ? `textgen/${type}` : 'textgen';
        url = (tg.server_urls && tg.server_urls[type]) || tg.api_server || '';
        model = tg.model || '';
    } else if (main === 'kobold') {
        source = 'kobold';
        url = w.api_server || '';
        model = w.kai_settings?.model || '';
    } else if (main === 'novel') {
        source = 'novelai';
        model = w.nai_settings?.model_novel || '';
    } else if (main === 'koboldhorde') {
        source = 'koboldhorde';
        model = w.horde_settings?.model || '';
    }

    // DOM 兜底（万一全局变量名变了）
    if (!url) {
        const ids = ['#openai_reverse_proxy', '#custom_api_url', '#api_url_textgenerationwebui',
                     '#api_url_text', '#horde_api_url', '#api_url_novel'];
        for (const id of ids) {
            const v = (document.querySelector(id)?.value || '').trim();
            if (v) { url = v; break; }
        }
    }
    if (!model) {
        document.querySelectorAll('select[id^="model_"], #openrouter_model, #model_custom_select').forEach(s => {
            if (!model && s.offsetParent !== null && s.value) model = s.value;
        });
    }
    return { url, key: '', model, source: source || '酒馆' };
}

/* 估算 token：优先调酒馆原生 API；不可用时走粗略本地估算 */
function estimateTokens(text) {
    if (!text) return 0;
    const s = String(text);
    // 优先调酒馆全局 API（同步版本）
    try {
        const ctx = (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null;
        if (ctx && typeof ctx.getTokenCount === 'function') {
            const n = ctx.getTokenCount(s);
            if (typeof n === 'number' && n >= 0) return n;
        }
        if (typeof window.getTokenCount === 'function') {
            const n = window.getTokenCount(s);
            if (typeof n === 'number' && n >= 0) return n;
        }
    } catch (e) { /* fall through */ }
    // fallback：中文按 1.5、英文按 4
    let cn = 0, other = 0;
    for (const ch of s) {
        if (/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch)) cn++;
        else other++;
    }
    return Math.ceil(cn / 1.5 + other / 4);
}

/* 异步版本（酒馆有 getTokenCountAsync 时用更准的） */
async function estimateTokensAsync(text) {
    if (!text) return 0;
    const s = String(text);
    try {
        const ctx = (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null;
        if (ctx && typeof ctx.getTokenCountAsync === 'function') {
            const n = await ctx.getTokenCountAsync(s);
            if (typeof n === 'number' && n >= 0) return n;
        }
    } catch (e) { /* fall through */ }
    return estimateTokens(s);
}

/* 异步加载世界书条目：尝试 window.loadWorldInfo，失败 fallback 到 fetch /api/worldinfo/get */
async function loadLorebookEntries(name) {
    if (!name) return [];
    try {
        // 酒馆历史 expose 的全局函数
        if (typeof window.loadWorldInfo === 'function') {
            const data = await window.loadWorldInfo(name);
            const entries = data?.entries || {};
            return Object.values(entries);
        }
    } catch (e) { console.warn('[ggg] loadWorldInfo 失败：', e); }
    try {
        const ctx = window.SillyTavern?.getContext?.();
        const headers = ctx?.getRequestHeaders ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };
        const resp = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers,
            body: JSON.stringify({ name }),
        });
        if (!resp.ok) return [];
        const data = await resp.json();
        return Object.values(data?.entries || {});
    } catch (e) {
        console.warn('[ggg] /api/worldinfo/get 失败：', e);
        return [];
    }
}

/* 拉取酒馆当前选中 API 的模型下拉列表 —— 只取可见的 select */
function readStModelOptions() {
    const out = [];
    document.querySelectorAll('select[id^="model_"], #openrouter_model').forEach(sel => {
        if (sel.offsetParent === null) return;
        sel.querySelectorAll('option').forEach(opt => {
            const v = (opt.value || '').trim();
            if (v && !out.includes(v)) out.push(v);
        });
    });
    return out;
}

/* 占位变量替换 */
function substVars(s) {
    if (!s) return '';
    const ctx = (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null;
    const userName = ctx?.name1 || '{{user}}';
    const charName = ctx?.name2 || '{{char}}';
    return String(s).replace(/\{\{user\}\}/gi, userName).replace(/\{\{char\}\}/gi, charName);
}

const DEFAULT_MEME_TAG = '未分类';

function normalizeTags(tags, forcedTag = '') {
    const out = Array.isArray(tags) ? tags.map(t => String(t || '').trim()).filter(Boolean) : [];
    if (forcedTag && !out.includes(forcedTag)) out.push(forcedTag);
    return out.length ? out : [DEFAULT_MEME_TAG];
}

function buildMemeLibraryText(title, tagName, items, forcedTag = '') {
    const list = (Array.isArray(items) ? items : [])
        .map(item => ({
            name: String(item?.name || '').trim(),
            tags: normalizeTags(item?.tags, forcedTag),
        }))
        .filter(item => item.name);
    if (!list.length) return '';
    const lines = list.map(item => {
        const tag = item.tags[0] ? `,${item.tags[0]}` : '';
        return `- ${item.name}${tag}`;
    });
    return `<${tagName}>\n${lines.join('\n')}\n</${tagName}>`;
}

/* 把预设按顺序展开成最终 messages 块（用于预览）
 * lorebookCache: { [name]: entries[] } 由调用方先 await 加载好 */
function buildPresetPreview(preset, lorebookCache = {}) {
    const blocks = [];
    if (!preset) return blocks;
    const ctx = (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null;
    const chId = ctx?.characterId;
    const ch = (ctx?.characters && chId != null) ? ctx.characters[chId] : null;

    // 取 PP 资料卡数据（v0.2.53 起的 6 条固定条目用）
    const ppMe = settings.phone?.pp?.me || {};
    const ppFriends = Array.isArray(settings.phone?.pp?.friends) ? settings.phone.pp.friends : [];
    const ppGroups  = Array.isArray(settings.phone?.pp?.groups)  ? settings.phone.pp.groups  : [];
    const charExt = (() => {
        try {
            const w = window;
            // v0.2.55 修：character-cards 实际写入 key 为 guagua_pp（v3 角色卡导出兼容）
            const ext = ch?.data?.extensions || ch?.extensions || {};
            const cur = ext.guagua_pp || ext.ggg_pp || ext.gggPP || {};
            return cur || {};
        } catch { return {}; }
    })();

    const buildContactsLines = () => {
        const lines = [];
        if (ppFriends.length) {
            lines.push(`好友（共 ${ppFriends.length}）：${ppFriends.slice(0, 50).map(f => {
                const tag = f.group === 'blocked_me' ? '[黑]' : f.group === 'blocked_by_me' ? '[反拉黑]' : '';
                return `${f.remark || f.nickname}${tag}`;
            }).join('、')}`);
        }
        if (ppGroups.length) {
            lines.push(`群聊（共 ${ppGroups.length}）：${ppGroups.slice(0, 30).map(g => `${g.name}(${g.memberCount || g.members?.length || 0}人)`).join('、')}`);
        }
        return lines;
    };

    for (const e of preset.entries) {
        if (!e.enabled) continue;

        // ===== v0.2.53 固定 4 条 =====
        if (e.type === 'fixed-char-info') {
            // 角色 PP 资料 + 角色卡设定，整段拼接（无 markdown 标题）
            const lines = [];
            const charName = charExt.nickname || ch?.name || '未设置';
            lines.push(`PP昵称：${charName}`);
            if (charExt.signature) lines.push(`个性签名：${charExt.signature}`);
            if (charExt.currency)  lines.push(`常用币种：${charExt.currency}`);
            if (charExt.languages) lines.push(`常用语言：${charExt.languages}`);
            const contacts = buildContactsLines();
            if (contacts.length) lines.push(...contacts);
            if (ch) {
                if (ch.description) lines.push('', ch.description);
                if (ch.personality) lines.push('', ch.personality);
                if (ch.scenario)    lines.push('', ch.scenario);
                if (ch.mes_example) lines.push('', ch.mes_example);
            }
            const headed = `[${charName}的PP账号资料]\n` + lines.join('\n');
            blocks.push({ type: 'fixed-char-info', role: e.role || 'system', name: '角色信息', content: substVars(headed) || '(空)' });
            continue;
        }
        if (e.type === 'fixed-user-info') {
            // 用户 PP 资料 + persona 描述，整段拼接
            const lines = [];
            // v0.2.56-rc6：酒馆助手 v2 真实路径是 ctx.powerUserSettings（不是 power_user）
            const pu = ctx?.powerUserSettings || ctx?.power_user || window.power_user || {};
            const userAvatar = pu.user_avatar || window.user_avatar || ctx?.user_avatar || ppMe.avatarKey || '';
            const personaName = pu.personas?.[userAvatar] || ctx?.name1 || ppMe.nickname || '{{user}}';
            const userName = ppMe.nickname || personaName;
            lines.push(`PP昵称：${userName}`);
            if (ppMe.signature) lines.push(`个性签名：${ppMe.signature}`);
            // 从 persona 资料卡读币种/语言
            try {
                const personas = settings.phone?.pp?.personas || {};
                const pdata = userAvatar ? (personas[userAvatar] || {}) : {};
                if (pdata.currency)  lines.push(`常用币种：${pdata.currency}`);
                if (pdata.languages) lines.push(`常用语言：${pdata.languages}`);
            } catch {}
            const contacts = buildContactsLines();
            if (contacts.length) lines.push(...contacts);
            // 关键修：persona_descriptions[avatarKey].description 才是真字段（不是 persona_description）
            let personaDesc = '';
            const pdMap = pu.persona_descriptions || {};
            const pdEntry = userAvatar ? pdMap[userAvatar] : null;
            if (pdEntry) {
                personaDesc = typeof pdEntry === 'string' ? pdEntry : String(pdEntry.description || '');
            }
            if (!personaDesc) personaDesc = String(pu.persona_description || '');
            personaDesc = personaDesc.trim();
            if (personaDesc) lines.push('', personaDesc);
            const headed = `[${userName}的PP账号资料]\n` + lines.join('\n');
            blocks.push({ type: 'fixed-user-info', role: e.role || 'system', name: '用户信息', content: substVars(headed) || '(空)' });
            continue;
        }
        if (e.type === 'fixed-meme-lib') {
            const content = buildMemeLibraryText('表情包库', 'meme', settings.memes || '');
            blocks.push({ type: 'fixed-meme-lib', role: e.role || 'system', name: '表情包库', content: content || '(空)' });
            continue;
        }
        if (e.type === 'fixed-char-meme') {
            const content = buildMemeLibraryText('角色表情包', 'char_meme', charExt.charMemes || []);
            blocks.push({ type: 'fixed-char-meme', role: e.role || 'system', name: '角色表情包', content: (charExt.charMemesEnabled ? content : '') || '(空)' });
            continue;
        }
        if (e.type === 'fixed-user-meme') {
            let pdata = {};
            try {
                const pu = ctx?.powerUserSettings || ctx?.power_user || window.power_user || {};
                const userAvatar = pu.user_avatar || window.user_avatar || ctx?.userAvatar || ctx?.user_avatar || ppMe.avatarKey || '';
                const personas = settings.phone?.pp?.personas || {};
                const key = userAvatar && !String(userAvatar).endsWith('.png') ? `${userAvatar}.png` : userAvatar;
                const noExt = String(key || '').replace(/\.png$/i, '');
                pdata = personas[key] || personas[userAvatar] || personas[noExt] || {};
            } catch {}
            const content = buildMemeLibraryText('用户表情包', 'user_meme', pdata.userMemes || []);
            blocks.push({ type: 'fixed-user-meme', role: e.role || 'system', name: '用户表情包', content: (pdata.userMemesEnabled ? content : '') || '(空)' });
            continue;
        }
        if (e.type === 'fixed-history') {
            blocks.push({
                type: 'fixed-history',
                role: e.role || 'system',
                name: '历史',
                content: '(发送时使用酒馆原生 chat_history)',
            });
            continue;
        }
        if (e.type === 'fixed-latest') {
            blocks.push({ type: 'fixed-latest', role: e.role || 'user', name: '最新用户回复', content: '(发送时由 PP 拼入用户本次回复)' });
            continue;
        }

        if (e.type === 'lorebook') {
            // 整本世界书：把 cache 里所有条目内容拼出来
            const lbName = (e.source === 'char')
                ? (getCharBoundLorebook() || '')
                : (e.lorebookName || '');
            const entries = lorebookCache[lbName] || [];
            if (!lbName) {
                blocks.push({ role: 'system', name: e.name || '世界书', content: '(未指定世界书)' });
            } else if (entries.length === 0) {
                blocks.push({ role: 'system', name: e.name || `世界书：${lbName}`,
                    content: `(世界书 "${lbName}" 暂未加载或为空，点"刷新"重试)` });
            } else {
                const text = entries.map(en => {
                    const keys = Array.isArray(en.key) ? en.key.join(', ') : (en.key || '');
                    const head = `【${en.comment || keys || 'entry'}】`;
                    return `${head}\n${en.content || ''}`;
                }).join('\n\n— — —\n\n');
                blocks.push({ role: 'system', name: e.name || `世界书：${lbName}`,
                    content: substVars(text) });
            }

        } else if (e.type === 'lorebook-entry') {
            // 单个世界书条目（来自"从世界书导入"）
            blocks.push({
                role: e.role || 'system',
                name: e.name || '世界书条目',
                content: substVars(e.content || ''),
            });

        } else if (e.type === 'custom') {
            blocks.push({
                type: 'custom',
                role: e.role || 'system',
                name: e.name || '自定义提示词',
                content: substVars(e.content || ''),
            });
        }
    }
    return blocks;
}

/* v0.2.57-rc8：模块顶层注册 sender 钩子，不再依赖 settings UI 实例化
 * 之前注册在 setup() 里 → 用户没打开设置页 → 钩子=undefined → sender 拿不到 blocks → 只发了"当前时间"那一行
 */
if (typeof window !== 'undefined') {
    window.__ggg_build_preset_blocks = (opts = {}) => {
        try {
            if (!settings.phone) settings.phone = {};
            if (!Array.isArray(settings.phone.presets) || settings.phone.presets.length === 0) {
                settings.phone.presets = [makeDefaultPreset()];
                settings.phone.currentPresetId = settings.phone.presets[0].id;
            }
            settings.phone.presets.forEach(migratePresetV253);
            if (!settings.phone.currentPresetId) settings.phone.currentPresetId = settings.phone.presets[0].id;
            const preset = settings.phone.presets.find(p => p.id === settings.phone.currentPresetId)
                        || settings.phone.presets[0];
            if (!preset) return [];
            return buildPresetPreview(preset, {})
                .filter(b => b && b.content && b.content !== '(空)');
        } catch (e) {
            console.warn('[ggg-settings] __ggg_build_preset_blocks 失败：', e);
            return [];
        }
    };
}

/* 预扫预设：找出所有需要加载的世界书名 */
function collectLorebookNames(preset) {
    const set = new Set();
    if (!preset) return [];
    for (const e of preset.entries) {
        if (e.type === 'lorebook' && e.enabled) {
            const name = (e.source === 'char') ? getCharBoundLorebook() : e.lorebookName;
            if (name) set.add(name);
        }
    }
    return Array.from(set);
}

/* 列出所有世界书（多来源） */
function listLorebooks() {
    const out = [];
    const push = (name) => {
        const t = String(name || '').trim();
        if (t && !out.find(x => x.name === t)) out.push({ value: t, name: t });
    };
    if (typeof window !== 'undefined' && Array.isArray(window.world_names)) {
        window.world_names.forEach(push);
    }
    document.querySelectorAll('#world_editor_select option, #world_info option').forEach(opt => {
        push(opt.textContent || opt.value);
    });
    // 顺带把当前角色卡绑定的世界书塞进列表（如果没在）
    const bound = getCharBoundLorebook();
    if (bound) push(bound);
    return out;
}

/* 取角色卡绑定的世界书名 */
function getCharBoundLorebook() {
    const ctx = (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null;
    if (!ctx) return '';
    const ch = ctx.characters?.[ctx.characterId];
    return ch?.data?.extensions?.world
        || ch?.character_book?.name
        || '';
}

export function createSettingsComponent(Vue) {
    const { ref, reactive, computed, onMounted } = Vue;

    return Vue.defineComponent({
        name: 'PhoneSettings',
        props: { onBack: { type: Function, required: true } },

        setup(props) {
            ensureApiSetup();
            ensurePresetSetup();

            const section = ref('entry');

            // -- 入口 --
            const alwaysFs = ref(!!settings.phone?.alwaysFullscreen);
            const setFs = (v) => {
                if (!settings.phone) settings.phone = {};
                settings.phone.alwaysFullscreen = !!v; alwaysFs.value = !!v;
                saveAllSettings();
            };

            // -- 时间 --
            const timeConf = reactive(ensurePhoneTimeSettings());
            const timeScanMsg = ref('');
            const setTimeMode = (mode) => {
                setPhoneTimeMode(mode);
                timeConf.mode = mode === 'custom' ? 'custom' : 'local';
                if (timeConf.mode === 'custom') scanTimeConf();
            };
            const saveTimeConf = () => {
                savePhoneTimeSettings({
                    mode: timeConf.mode,
                    pattern: timeConf.pattern,
                    dateGroup: timeConf.dateGroup,
                    timeGroup: timeConf.timeGroup,
                    weekGroup: timeConf.weekGroup,
                    weatherGroup: timeConf.weatherGroup,
                });
            };
            const scanTimeConf = () => {
                saveTimeConf();
                const hit = scanCustomPhoneTimeFromLatest({ force: true });
                timeScanMsg.value = hit
                    ? `已匹配第 ${hit.floor + 1} 楼：${new Date(hit.baseMs).toLocaleString()}`
                    : '未匹配到可解析时间';
            };

            // -- 思维链拦截 (rc6) --
            function ensureThinkGuard() {
                if (!settings.phone) settings.phone = {};
                if (!settings.phone.pp) settings.phone.pp = {};
                if (!settings.phone.pp.thinkGuard) {
                    settings.phone.pp.thinkGuard = {
                        enabled: true,
                        content: '<think>\n好，我已经把要回复的内容想清楚了。下面我直接按 PP 协议输出 <PP><chat><昵称>...</昵称></chat></PP>，不再写思考内容。\n</think>',
                    };
                }
                return settings.phone.pp.thinkGuard;
            }
            const thinkGuard = reactive(ensureThinkGuard());
            const setThinkGuardEnabled = (v) => { thinkGuard.enabled = !!v; saveAllSettings(); };
            const setThinkGuardContent = (v) => { thinkGuard.content = String(v ?? ''); saveAllSettings(); };
            const resetThinkGuard = () => {
                thinkGuard.content = '<think>\n好，我已经把要回复的内容想清楚了。下面我直接按 PP 协议输出 <PP><chat><昵称>...</昵称></chat></PP>，不再写思考内容。\n</think>';
                saveAllSettings();
            };


            // -- API --
            const api = reactive(settings.phone.api);
            const stApi = ref(readStCurrentApi());
            const stModelList = ref(readStModelOptions());
            const refreshStApi = () => {
                stApi.value = readStCurrentApi();
                stModelList.value = readStModelOptions();
            };
            const syncFromSt = () => {
                refreshStApi();
                if (!stApi.value.url && !stApi.value.model) {
                    console.warn('[ggg] 同步失败：酒馆 URL 和 Model 都为空，可能未配置或 main_api 异常');
                    if (typeof toastr !== 'undefined') toastr.warning('同步失败：未读取到酒馆 API 信息，请先在酒馆配置好 API 并选中模型');
                    return;
                }
                api.useStDefault = false;
                api.name = api.name || `${stApi.value.source} 同步`;
                api.url = stApi.value.url || api.url;
                api.model = stApi.value.model || api.model;
                if (typeof toastr !== 'undefined') toastr.success(`同步成功（来源：${stApi.value.source}）`);
                saveAllSettings();
            };
            const saveApi = () => saveAllSettings();

            // -- 预设 --
            const presets = reactive(settings.phone.presets);
            const currentPresetId = ref(settings.phone.currentPresetId);
            const currentPreset = computed(() =>
                presets.find(p => p.id === currentPresetId.value) || presets[0]
            );
            const setCurrentPreset = (id) => {
                currentPresetId.value = id;
                settings.phone.currentPresetId = id;
                saveAllSettings();
            };
            const newPreset = () => {
                const p = makeDefaultPreset();
                p.id = uid();
                p.name = '新预设';
                presets.push(p);
                setCurrentPreset(p.id);
            };
            const dupPreset = () => {
                const cur = currentPreset.value;
                if (!cur) return;
                const copy = JSON.parse(JSON.stringify(cur));
                copy.id = uid();
                copy.name = cur.name + ' 副本';
                copy.entries.forEach(e => e.id = uid());
                presets.push(copy);
                setCurrentPreset(copy.id);
            };
            const delPreset = () => {
                if (presets.length <= 1) return;
                const idx = presets.findIndex(p => p.id === currentPresetId.value);
                if (idx >= 0) presets.splice(idx, 1);
                setCurrentPreset(presets[0].id);
            };
            const renamePreset = (e) => {
                if (currentPreset.value) {
                    currentPreset.value.name = e.target.value;
                    saveAllSettings();
                }
            };

            // -- 预设 token 估算 --
            const lorebookCache = ref({});  // { name: entries[] }

            const buildCurrentPresetBlocks = async () => {
                lorebookList.value = listLorebooks();
                // 预加载所有需要的世界书
                const names = collectLorebookNames(currentPreset.value);
                const cache = { ...lorebookCache.value };
                await Promise.all(names.map(async (n) => {
                    if (!cache[n]) cache[n] = await loadLorebookEntries(n);
                }));
                lorebookCache.value = cache;
                return buildPresetPreview(currentPreset.value, cache);
            };
            const currentPresetTokens = ref(0);
            const recalcPresetTokens = async () => {
                const blocks = await buildCurrentPresetBlocks();
                // 优先用酒馆异步 token API（更准）
                let total = 0;
                for (const b of blocks) {
                    total += await estimateTokensAsync(b.content || '');
                }
                currentPresetTokens.value = total;
            };
            onMounted(() => { recalcPresetTokens(); });

            // v0.2.57：暴露给 PP sender 用的"取当前预设 blocks"钩子
            //   sender 在发送时会调用，拿到 [{role,name,content}] 数组拼成 injects
            if (typeof window !== 'undefined') {
                window.__ggg_build_preset_blocks = (opts = {}) => {
                    try {
                        const cur = currentPreset.value;
                        if (!cur) return [];
                        return buildPresetPreview(cur, lorebookCache.value || {})
                            .filter(b => b && b.content && b.content !== '(空)');
                    } catch (e) {
                        console.warn('[ggg-settings] __ggg_build_preset_blocks 失败：', e);
                        return [];
                    }
                };
            }

            // -- 预设条目 --
            const editingEntry = ref(null);
            const lorebookList = ref(listLorebooks());

            const ENTRY_LABELS = {
                // v0.2.53 固定 4 条（不可删/不可改/不可禁，可拖拽排序）
                'fixed-char-info': { name: '角色信息',     icon: 'fa-id-card',           hint: '角色的 PP 资料 + 角色卡设定，整段输出（无 markdown 标题）' },
                'fixed-user-info': { name: '用户信息',     icon: 'fa-user',              hint: '用户的 PP 资料 + persona 描述，整段输出' },
                'fixed-meme-lib':  { name: '表情包库',     icon: 'fa-face-smile',        hint: '主面板/手机图库上传的表情包，使用 <meme> 包裹' },
                'fixed-char-meme': { name: '角色表情包',   icon: 'fa-face-grin-stars',   hint: '角色 PP 资料里的表情包，使用 <char_meme> 包裹' },
                'fixed-user-meme': { name: '用户表情包',   icon: 'fa-face-laugh',        hint: '用户 PP 资料里的表情包，使用 <user_meme> 包裹' },
                'fixed-history':   { name: '历史',         icon: 'fa-clock-rotate-left', hint: '酒馆原生 chat_history；隐藏楼层、swipe、酒馆正则由酒馆处理' },
                'fixed-latest':    { name: '最新用户回复', icon: 'fa-paper-plane',       hint: 'PP 绕过酒馆发送时由 PP 拼入用户本次回复' },
                // 可加条目
                'lorebook':        { name: '世界书',       icon: 'fa-book',              hint: '注入整本世界书所有条目' },
                'lorebook-entry':  { name: '世界书条目',   icon: 'fa-bookmark',          hint: '从某世界书中导入的单条' },
                'custom':          { name: '自定义提示词', icon: 'fa-pen-to-square',     hint: '自由编写' },
            };
            const entryLabel = (e) => {
                const base = ENTRY_LABELS[e.type] || { name: e.type, icon: 'fa-question' };
                return { ...base, name: e.name || base.name };
            };
            const entryMeta = (e) => {
                if (e.type === 'lorebook') {
                    return e.source === 'char' ? '角色卡绑定' : `手动：${e.lorebookName || '未选'}`;
                }
                if (e.type === 'lorebook-entry') return `[${e.role || 'system'}] ${(e.content || '').slice(0, 40) || '空'}`;
                if (e.type === 'custom') return `[${e.role}] ${(e.content || '').slice(0, 40) || '空'}`;
                return ENTRY_LABELS[e.type]?.hint || '';
            };

            const toggleEntry = (e) => { if (e.fixed) return; e.enabled = !e.enabled; saveAllSettings(); };
            const moveEntry = (idx, dir) => {
                const arr = currentPreset.value.entries;
                const j = idx + dir;
                if (j < 0 || j >= arr.length) return;
                [arr[idx], arr[j]] = [arr[j], arr[idx]];
                saveAllSettings();
            };
            const delEntry = (idx) => {
                const e = currentPreset.value.entries[idx];
                if (e?.fixed) return; // 固定条目不可删
                currentPreset.value.entries.splice(idx, 1);
                saveAllSettings();
            };
            const editEntry = (e) => {
                if (e.fixed) return; // 固定条目不可编辑
                if (['custom','lorebook','lorebook-entry'].includes(e.type)) {
                    if (e.type === 'lorebook') lorebookList.value = listLorebooks();
                    editingEntry.value = JSON.parse(JSON.stringify(e));
                }
            };
            const saveEntryEdit = () => {
                if (!editingEntry.value) return;
                const arr = currentPreset.value.entries;
                const idx = arr.findIndex(x => x.id === editingEntry.value.id);
                if (idx >= 0) arr[idx] = editingEntry.value;
                editingEntry.value = null;
                saveAllSettings();
            };
            const addEntry = (type) => {
                if (type === 'lorebook-import')    { openImportLb(false); return; }
                if (type === 'lorebook-import-ch') { openImportLb(true);  return; }
                const arr = currentPreset.value.entries;
                let e = null;
                if (type === 'lorebook')   { lorebookList.value = listLorebooks(); e = { id: uid(), type, enabled: true, source: 'char', lorebookName: '' }; }
                if (type === 'custom')     e = { id: uid(), type, enabled: true, role: 'system', name: '新提示词', content: '' };
                if (e) {
                    arr.push(e);
                    if (type === 'custom' || type === 'lorebook') editEntry(e);
                    saveAllSettings();
                }
            };

            // -- 拖拽换位（条目列表） --
            const dragEntryIdx = ref(-1);
            const dragOverIdx = ref(-1);
            // v0.2.56-rc7：capture 阶段始终拦截，自己处理 dragover/drop 逻辑（避免酒馆 overlay）
            let __gggDragCaptureBound = false;
            const __gggDragCaptureHandler = (ev) => {
                const t = ev.target;
                const inList = t && t.closest && t.closest('.ggg-preset-entries-list');
                if (inList) {
                    const entryEl = t.closest('.ggg-preset-entry');
                    if (entryEl && entryEl.parentNode) {
                        const idx = Array.prototype.indexOf.call(entryEl.parentNode.children, entryEl);
                        if (ev.type === 'dragover' || ev.type === 'dragenter') {
                            ev.preventDefault();
                            if (dragEntryIdx.value >= 0 && dragOverIdx.value !== idx) dragOverIdx.value = idx;
                        } else if (ev.type === 'drop') {
                            ev.preventDefault();
                            const from = dragEntryIdx.value;
                            if (from >= 0 && from !== idx) {
                                const arr = currentPreset.value.entries;
                                const moved = arr.splice(from, 1)[0];
                                arr.splice(idx, 0, moved);
                                saveAllSettings();
                            }
                            dragEntryIdx.value = -1;
                            dragOverIdx.value = -1;
                            document.body.classList.remove('ggg-suppress-st-dragdrop');
                            __gggUnbindDragCapture();
                        }
                    }
                }
                // 无论是否自己区域，统一 stop，让酒馆 body 拖入监听完全收不到事件
                ev.stopImmediatePropagation();
            };
            const __gggBindDragCapture = () => {
                if (__gggDragCaptureBound) return;
                __gggDragCaptureBound = true;
                ['dragenter','dragover','dragleave','drop'].forEach(t => {
                    window.addEventListener(t, __gggDragCaptureHandler, true);
                });
            };
            const __gggUnbindDragCapture = () => {
                if (!__gggDragCaptureBound) return;
                __gggDragCaptureBound = false;
                ['dragenter','dragover','dragleave','drop'].forEach(t => {
                    window.removeEventListener(t, __gggDragCaptureHandler, true);
                });
            };
            const onEntryDragStart = (idx, ev) => {
                dragEntryIdx.value = idx;
                ev.stopPropagation();
                ev.dataTransfer.effectAllowed = 'move';
                try { ev.dataTransfer.setData('text/plain', String(idx)); } catch {}
                document.body.classList.add('ggg-suppress-st-dragdrop');
                __gggBindDragCapture();
            };
            const onEntryDragOver = (idx, ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (dragEntryIdx.value < 0) return;
                if (dragOverIdx.value !== idx) dragOverIdx.value = idx;
            };
            const onEntryDragLeave = (idx, ev) => {
                if (ev?.stopPropagation) ev.stopPropagation();
                if (dragOverIdx.value === idx) dragOverIdx.value = -1;
            };
            const onEntryDragEnd = (ev) => {
                if (ev?.stopPropagation) ev.stopPropagation();
                dragEntryIdx.value = -1;
                dragOverIdx.value = -1;
                document.body.classList.remove('ggg-suppress-st-dragdrop');
                __gggUnbindDragCapture();
            };
            const onEntryDrop = (idx, ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const from = dragEntryIdx.value;
                dragEntryIdx.value = -1;
                dragOverIdx.value = -1;
                document.body.classList.remove('ggg-suppress-st-dragdrop');
                __gggUnbindDragCapture();
                if (from < 0 || from === idx) return;
                const arr = currentPreset.value.entries;
                const moved = arr.splice(from, 1)[0];
                arr.splice(idx, 0, moved);
                saveAllSettings();
            };

            // -- 保存 / 另存为 / 导出 / 导入 --
            const saveCurrent = () => { saveAllSettings(); };
            const saveAsPreset = () => {
                const cur = currentPreset.value;
                if (!cur) return;
                const name = window.prompt('新预设名：', cur.name + ' 副本');
                if (!name) return;
                const copy = JSON.parse(JSON.stringify(cur));
                copy.id = uid();
                copy.name = name;
                copy.entries.forEach(en => en.id = uid());
                presets.push(copy);
                setCurrentPreset(copy.id);
            };
            const exportPreset = () => {
                const cur = currentPreset.value;
                if (!cur) return;
                const blob = new Blob([JSON.stringify(cur, null, 2)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `pp-preset-${cur.name || 'preset'}.json`;
                document.body.appendChild(a); a.click();
                setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
            };
            const importPresetFile = (ev) => {
                const file = ev.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                    try {
                        const obj = JSON.parse(reader.result);
                        if (!obj || !Array.isArray(obj.entries)) throw new Error('格式不对');
                        obj.id = uid();
                        obj.name = obj.name || '导入预设';
                        obj.entries.forEach(en => en.id = uid());
                        presets.push(obj);
                        setCurrentPreset(obj.id);
                        ev.target.value = '';
                    } catch (err) {
                        alert('导入失败：' + err.message);
                    }
                };
                reader.readAsText(file);
            };

            // -- 从世界书导入条目 --
            const importLbOpen = ref(false);
            const importLbName = ref('');
            const importLbEntries = ref([]);   // 加载到的条目列表
            const importLbLoading = ref(false);
            const importLbSelected = ref({});  // { uid: bool }
            const importLbUseChar = ref(false); // true = 当前角色卡绑定的世界书（不显示选择器）
            const openImportLb = (useChar) => {
                lorebookList.value = listLorebooks();
                importLbUseChar.value = !!useChar;
                importLbName.value = useChar ? (getCharBoundLorebook() || '') : '';
                importLbEntries.value = [];
                importLbSelected.value = {};
                importLbOpen.value = true;
                if (importLbName.value) loadImportLb();
            };
            const closeImportLb = () => { importLbOpen.value = false; };
            const loadImportLb = async () => {
                importLbLoading.value = true;
                try {
                    importLbEntries.value = await loadLorebookEntries(importLbName.value);
                } finally { importLbLoading.value = false; }
            };
            const importLbSelectAll = () => {
                const all = {};
                importLbEntries.value.forEach((en, i) => { all[en.uid ?? i] = true; });
                importLbSelected.value = all;
            };
            const importLbClear = () => { importLbSelected.value = {}; };
            // 模板内复选框切换（避免在模板里直接对 ref 赋值，否则会抛"Cannot set property"）
            const toggleImportLbItem = (key, checked) => {
                importLbSelected.value = { ...importLbSelected.value, [key]: !!checked };
            };
            const importLbSelectedCount = computed(() =>
                Object.values(importLbSelected.value).filter(Boolean).length
            );
            const confirmImportLb = () => {
                const arr = currentPreset.value.entries;
                importLbEntries.value.forEach((en, i) => {
                    const k = en.uid ?? i;
                    if (!importLbSelected.value[k]) return;
                    const keys = Array.isArray(en.key) ? en.key.join(', ') : (en.key || '');
                    arr.push({
                        id: uid(),
                        type: 'lorebook-entry',
                        enabled: true,
                        role: 'system',
                        name: en.comment || keys || `${importLbName.value}#${i+1}`,
                        content: en.content || '',
                    });
                });
                saveAllSettings();
                closeImportLb();
            };

            const sections = [
                { id: 'entry',   name: '入口',     icon: 'fa-mobile-screen',       color: '#06b6d4' },
                { id: 'time',    name: '时间',     icon: 'fa-clock',               color: '#14b8a6' },
                { id: 'api',     name: 'API',      icon: 'fa-plug',                color: '#10b981' },
                { id: 'preset',  name: '预设',     icon: 'fa-wand-magic-sparkles', color: '#f59e0b' },
                { id: 'diagnose',name: '诊断',     icon: 'fa-stethoscope',         color: '#ef4444' },
                { id: 'about',   name: '关于',     icon: 'fa-circle-info',         color: '#64748b' },
            ];
            // 注：'整本世界书' 现在直接打开"从世界书导入"对话框，把每条 entry 拆为 lorebook-entry
            const addMenuItems = [
                // v0.2.53：角色信息/用户信息/酒馆上下文/PP上下文 已并入 6 条固定条目，按钮移除
                { type: 'lorebook-import',    name: '世界书导入',   icon: 'fa-book' },
                { type: 'lorebook-import-ch', name: '角色书导入',   icon: 'fa-id-card-clip' },
                { type: 'custom',             name: '自定义提示',   icon: 'fa-pen-to-square' },
            ];

            return {
                section, sections,
                alwaysFs, setFs,
                timeConf, timeScanMsg, setTimeMode, saveTimeConf, scanTimeConf,
                thinkGuard, setThinkGuardEnabled, setThinkGuardContent, resetThinkGuard,
                api, stApi, stModelList, refreshStApi, syncFromSt, saveApi,
                presets, currentPresetId, currentPreset, setCurrentPreset, newPreset, dupPreset, delPreset, renamePreset,
                editingEntry, lorebookList, addMenuItems,
                entryLabel, entryMeta, toggleEntry, moveEntry, delEntry, editEntry, saveEntryEdit, addEntry,
                currentPresetTokens, recalcPresetTokens,
                dragEntryIdx, dragOverIdx, onEntryDragStart, onEntryDragOver, onEntryDragLeave, onEntryDragEnd, onEntryDrop,
                saveCurrent, saveAsPreset, exportPreset, importPresetFile,
                importLbOpen, importLbName, importLbEntries, importLbLoading, importLbSelected, importLbSelectedCount,
                importLbUseChar,
                openImportLb, closeImportLb, loadImportLb, importLbSelectAll, importLbClear, confirmImportLb, toggleImportLbItem,
                onBack: props.onBack,
            };
        },

        template: /* html */ `
            <div class="ggg-phone-app ggg-phone-settings">
                <div class="ggg-phone-app-topbar">
                    <button class="ggg-phone-iconbtn" @click="onBack" aria-label="返回">
                        <i class="ggg-fa fa-solid fa-chevron-left"></i>
                    </button>
                    <div class="ggg-phone-app-title">设置</div>
                    <div class="ggg-phone-iconbtn placeholder"></div>
                </div>

                <div class="ggg-set-body">
                    <div class="ggg-set-side">
                        <div
                            v-for="s in sections"
                            :key="s.id"
                            class="ggg-set-side-item"
                            :class="{ active: section === s.id }"
                            @click="section = s.id">
                            <span class="ico" :style="{ background: s.color }">
                                <i class="ggg-fa fa-solid" :class="s.icon"></i>
                            </span>
                            <span class="name">{{ s.name }}</span>
                        </div>
                    </div>

                    <div class="ggg-set-main">
                        <!-- 入口 -->
                        <div v-if="section === 'entry'" class="ggg-set-page">
                            <div class="ggg-set-h">入口形态</div>
                            <div class="ggg-set-card">
                                <div class="ggg-set-row meta">
                                    <span><i class="ggg-fa fa-solid fa-frog"></i> 手机入口已经并入统一悬浮球</span>
                                </div>
                                <div class="ggg-set-hint">主面板控制悬浮球总开关；勾选“启用手机模块”后，悬浮球面板才会出现“进入手机”。</div>
                            </div>

                            <div class="ggg-set-h">浏览器</div>
                            <div class="ggg-set-card">
                                <div class="ggg-set-row toggle">
                                    <div>
                                        <div class="lbl">始终全屏</div>
                                        <div class="hint">点入口时自动请求浏览器全屏，撑掉浏览器顶/底栏</div>
                                    </div>
                                    <label class="ggg-switch">
                                        <input type="checkbox" :checked="alwaysFs" @change="setFs($event.target.checked)" />
                                        <span></span>
                                    </label>
                                </div>
                            </div>
                        </div>

                        <!-- 时间 -->
                        <div v-if="section === 'time'" class="ggg-set-page">
                            <div class="ggg-set-h">时间来源</div>
                            <div class="ggg-set-card">
                                <div class="ggg-set-seg vertical">
                                    <button :class="{ on: timeConf.mode === 'local' }" @click="setTimeMode('local')">
                                        <i class="ggg-fa fa-solid fa-location-crosshairs"></i> 本地时间
                                    </button>
                                    <button :class="{ on: timeConf.mode === 'custom' }" @click="setTimeMode('custom')">
                                        <i class="ggg-fa fa-solid fa-clock-rotate-left"></i> 自定义时间
                                    </button>
                                </div>
                                <div class="ggg-set-hint">本地时间直接使用浏览器时间；自定义时间会在进入手机时扫描最新匹配楼层。</div>
                            </div>

                            <div class="ggg-set-h">自定义解析</div>
                            <div class="ggg-set-card">
                                <div class="ggg-set-field">
                                    <label>正则</label>
                                    <input v-model="timeConf.pattern" @blur="saveTimeConf" placeholder="/日期[:：]([0-9]{4}-[0-9]{1,2}-[0-9]{1,2}).*时间[:：]([0-9]{1,2}:[0-9]{2})/" />
                                </div>
                                <div class="ggg-set-row" style="align-items:stretch;gap:8px;">
                                    <div class="ggg-set-field" style="flex:1;">
                                        <label>日期占位符</label>
                                        <input v-model="timeConf.dateGroup" @blur="saveTimeConf" placeholder="1" />
                                    </div>
                                    <div class="ggg-set-field" style="flex:1;">
                                        <label>时间占位符</label>
                                        <input v-model="timeConf.timeGroup" @blur="saveTimeConf" placeholder="2" />
                                    </div>
                                </div>
                                <div class="ggg-set-row" style="align-items:stretch;gap:8px;">
                                    <div class="ggg-set-field" style="flex:1;">
                                        <label>星期占位符</label>
                                        <input v-model="timeConf.weekGroup" @blur="saveTimeConf" placeholder="可留空" />
                                    </div>
                                    <div class="ggg-set-field" style="flex:1;">
                                        <label>天气占位符</label>
                                        <input v-model="timeConf.weatherGroup" @blur="saveTimeConf" placeholder="可留空" />
                                    </div>
                                </div>
                                <div class="ggg-set-row" style="gap:8px;">
                                    <button class="ggg-set-btn primary" @click="scanTimeConf">
                                        <i class="ggg-fa fa-solid fa-magnifying-glass"></i> 测试扫描
                                    </button>
                                    <div class="val" style="flex:1;">{{ timeScanMsg }}</div>
                                </div>
                                <div class="ggg-set-hint">占位符可填捕获组序号或命名组名。日期支持 2026-04-26、2026年4月26日、4月26日；时间支持 13:45、下午3点20。</div>
                            </div>
                        </div>

                        <!-- API -->
                        <div v-if="section === 'api'" class="ggg-set-page">
                            <div class="ggg-set-h">聊天的 API</div>

                            <div class="ggg-set-card">
                                <div class="ggg-set-row toggle">
                                    <div>
                                        <div class="lbl">使用酒馆当前 API（推荐）</div>
                                        <div class="hint">PP 聊天直接走酒馆现有的 API/Key/Model 设置</div>
                                    </div>
                                    <label class="ggg-switch">
                                        <input type="checkbox" :checked="api.useStDefault" @change="api.useStDefault = $event.target.checked; saveApi()" />
                                        <span></span>
                                    </label>
                                </div>
                                <div class="ggg-set-row meta">
                                    <span><i class="ggg-fa fa-solid fa-info-circle"></i> 酒馆当前：{{ stApi.source }} · {{ stApi.model || '未选模型' }}</span>
                                </div>
                            </div>

                            <template v-if="!api.useStDefault">
                                <div class="ggg-set-h">自定义 API
                                    <button class="ggg-set-h-btn" @click="syncFromSt">
                                        <i class="ggg-fa fa-solid fa-rotate"></i> 从酒馆同步
                                    </button>
                                </div>
                                <div class="ggg-set-card">
                                    <div class="ggg-set-field">
                                        <label>名称</label>
                                        <input v-model="api.name" @blur="saveApi" placeholder="例如：OpenAI 中转" />
                                    </div>
                                    <div class="ggg-set-field">
                                        <label>URL</label>
                                        <input v-model="api.url" @blur="saveApi" :placeholder="stApi.url || 'https://api.openai.com/v1'" />
                                    </div>
                                    <div class="ggg-set-field">
                                        <label>API Key</label>
                                        <input v-model="api.key" @blur="saveApi" type="password" placeholder="sk-..." />
                                    </div>
                                    <div class="ggg-set-field">
                                        <label>Model（可下拉选酒馆已有模型）</label>
                                        <input v-model="api.model" @blur="saveApi" :placeholder="stApi.model || 'gpt-4o-mini'" list="ggg-st-models" />
                                        <datalist id="ggg-st-models">
                                            <option v-for="m in stModelList" :key="m" :value="m"></option>
                                        </datalist>
                                    </div>
                                    <div class="ggg-set-row">
                                        <button class="ggg-set-btn" @click="refreshStApi">
                                            <i class="ggg-fa fa-solid fa-arrows-rotate"></i> 刷新模型列表
                                        </button>
                                    </div>
                                </div>
                            </template>
                        </div>

                        <!-- 预设 -->
                        <div v-if="section === 'preset'" class="ggg-set-page">
                            <!-- 思维链拦截（rc6） -->
                            <div class="ggg-set-h">思维链拦截</div>
                            <div class="ggg-set-card">
                                <div class="ggg-set-row toggle">
                                    <div>
                                        <div class="lbl">启用</div>
                                        <div class="hint">在请求最末尾以 assistant 角色注入一段假装"已思考完"的回复，强制思考模型直接输出 PP 格式。</div>
                                    </div>
                                    <label class="ggg-switch">
                                        <input type="checkbox" :checked="thinkGuard.enabled !== false" @change="setThinkGuardEnabled($event.target.checked)" />
                                        <span></span>
                                    </label>
                                </div>
                                <div class="ggg-set-row" style="flex-direction:column;align-items:stretch;gap:6px;">
                                    <div class="lbl">注入内容（assistant 角色）</div>
                                    <textarea
                                        :value="thinkGuard.content"
                                        @input="setThinkGuardContent($event.target.value)"
                                        rows="4"
                                        style="width:100%;font-family:ui-monospace,monospace;font-size:12px;padding:8px;border-radius:6px;border:1px solid rgba(0,0,0,0.15);box-sizing:border-box;resize:vertical;"
                                        placeholder="<think>...</think>"></textarea>
                                </div>
                                <div class="ggg-set-row">
                                    <button class="ggg-set-btn" @click="resetThinkGuard">
                                        <i class="ggg-fa fa-solid fa-rotate-left"></i> 恢复默认
                                    </button>
                                </div>
                            </div>

                            <!-- ① 当前预设：选预设 + 操作按钮同一行 -->
                            <div class="ggg-set-h">当前预设</div>
                            <div class="ggg-set-card">
                                <div class="ggg-preset-current-row">
                                    <select :value="currentPresetId" @change="setCurrentPreset($event.target.value)" class="ggg-set-select">
                                        <option v-for="p in presets" :key="p.id" :value="p.id">{{ p.name }}</option>
                                    </select>
                                    <button class="ggg-set-btn primary" @click="saveCurrent" title="保存"><i class="ggg-fa fa-solid fa-floppy-disk"></i></button>
                                    <button class="ggg-set-btn" @click="saveAsPreset" title="另存为"><i class="ggg-fa fa-solid fa-clone"></i></button>
                                    <button class="ggg-set-btn" @click="exportPreset" title="导出"><i class="ggg-fa fa-solid fa-download"></i></button>
                                    <label class="ggg-set-btn" style="cursor:pointer;" title="导入">
                                        <i class="ggg-fa fa-solid fa-upload"></i>
                                        <input type="file" accept="application/json,.json" style="display:none;" @change="importPresetFile" />
                                    </label>
                                    <button class="ggg-set-btn" @click="newPreset" title="新建"><i class="ggg-fa fa-solid fa-plus"></i></button>
                                    <button class="ggg-set-btn danger" @click="delPreset" v-if="presets.length > 1" title="删除"><i class="ggg-fa fa-solid fa-trash"></i></button>
                                </div>
                            </div>

                            <!-- ③ 总 token + 刷新 -->
                            <div class="ggg-set-card">
                                <div class="ggg-set-row" style="justify-content:space-between;align-items:center;">
                                    <div style="font-size:12px;color:var(--ggg-text-dim);">
                                        预设总 token（估算）：
                                        <strong style="color:var(--ggg-text);font-size:14px;">{{ currentPresetTokens }}</strong>
                                    </div>
                                    <div style="display:flex;gap:6px;">
                                        <button class="ggg-set-btn" @click="recalcPresetTokens"><i class="ggg-fa fa-solid fa-arrows-rotate"></i> 刷新</button>
                                    </div>
                                </div>
                            </div>

                            <!-- ④ 增加条目 / 从世界书导入 / 从角色世界书导入 -->
                            <div class="ggg-set-h">条目</div>
                            <div class="ggg-set-card" v-if="!editingEntry">
                                <div class="ggg-preset-add-menu">
                                    <button v-for="m in addMenuItems" :key="m.type" @click="addEntry(m.type)">
                                        <i class="ggg-fa fa-solid" :class="m.icon"></i>
                                        <span>{{ m.name }}</span>
                                    </button>
                                </div>
                            </div>

                            <!-- ⑤ 条目列表（可拖拽排序） -->
                            <div v-if="currentPreset && !editingEntry" class="ggg-preset-entries-list">
                                <div
                                    v-for="(e, idx) in currentPreset.entries"
                                    :key="e.id"
                                    class="ggg-preset-entry"
                                    :class="{ disabled: !e.enabled, dragging: dragEntryIdx === idx, 'drag-over': dragOverIdx === idx, fixed: e.fixed }"
                                    draggable="true"
                                    @dragstart="onEntryDragStart(idx, $event)"
                                    @dragover="onEntryDragOver(idx, $event)"
                                    @dragleave="onEntryDragLeave(idx)"
                                    @dragend="onEntryDragEnd"
                                    @drop="onEntryDrop(idx, $event)">
                                    <div class="e-handle" title="拖拽排序"><i class="ggg-fa fa-solid fa-grip-vertical"></i></div>
                                    <div class="e-body">
                                        <div class="e-name">
                                            <i class="ggg-fa fa-solid" :class="entryLabel(e).icon" style="margin-right:6px;color:var(--ggg-accent);"></i>
                                            {{ entryLabel(e).name }}
                                            <span v-if="e.fixed" class="ggg-preset-entry-tag" title="固定条目，不可删/不可改">必需</span>
                                        </div>
                                        <div class="e-meta">{{ entryMeta(e) }}</div>
                                    </div>
                                    <div class="e-actions">
                                        <button class="ggg-set-iconbtn" v-if="!e.fixed" @click="toggleEntry(e)" :title="e.enabled ? '禁用' : '启用'">
                                            <i class="ggg-fa fa-solid" :class="e.enabled ? 'fa-eye' : 'fa-eye-slash'"></i>
                                        </button>
                                        <button class="ggg-set-iconbtn" v-if="!e.fixed && (e.type === 'custom' || e.type === 'lorebook' || e.type === 'lorebook-entry')" @click="editEntry(e)">
                                            <i class="ggg-fa fa-solid fa-pen"></i>
                                        </button>
                                        <button class="ggg-set-iconbtn danger" v-if="!e.fixed" @click="delEntry(idx)" title="删除">
                                            <i class="ggg-fa fa-solid fa-trash"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <!-- 条目编辑 -->
                            <div v-if="editingEntry" class="ggg-set-card">
                                <div class="ggg-set-h" style="padding:0;">编辑条目（{{ entryLabel(editingEntry).name }}）</div>

                                <template v-if="editingEntry.type === 'custom'">
                                    <div class="ggg-set-field">
                                        <label>名称</label>
                                        <input v-model="editingEntry.name" placeholder="便于识别" />
                                    </div>
                                    <div class="ggg-set-field">
                                        <label>角色</label>
                                        <select v-model="editingEntry.role" class="ggg-set-select">
                                            <option value="system">system</option>
                                            <option value="user">user</option>
                                            <option value="assistant">assistant</option>
                                        </select>
                                    </div>
                                    <div class="ggg-set-field">
                                        <label v-pre>内容（支持 {{user}} {{char}} 占位）</label>
                                        <textarea v-model="editingEntry.content" rows="8"></textarea>
                                    </div>
                                </template>

                                <template v-if="editingEntry.type === 'lorebook'">
                                    <div class="ggg-set-field">
                                        <label>来源</label>
                                        <div class="ggg-set-seg">
                                            <button :class="{ on: editingEntry.source === 'char' }" @click="editingEntry.source = 'char'">角色卡绑定</button>
                                            <button :class="{ on: editingEntry.source === 'manual' }" @click="editingEntry.source = 'manual'">手动选</button>
                                        </div>
                                    </div>
                                    <div class="ggg-set-field" v-if="editingEntry.source === 'manual'">
                                        <label>世界书</label>
                                        <select v-model="editingEntry.lorebookName" class="ggg-set-select">
                                            <option value="">未选</option>
                                            <option v-for="lb in lorebookList" :key="lb.value" :value="lb.name">{{ lb.name }}</option>
                                        </select>
                                    </div>
                                </template>

                                <template v-if="editingEntry.type === 'lorebook-entry'">
                                    <div class="ggg-set-field">
                                        <label>名称</label>
                                        <input v-model="editingEntry.name" placeholder="自由命名" />
                                    </div>
                                    <div class="ggg-set-field">
                                        <label>角色（位置）</label>
                                        <select v-model="editingEntry.role" class="ggg-set-select">
                                            <option value="system">system</option>
                                            <option value="user">user</option>
                                            <option value="assistant">assistant</option>
                                        </select>
                                    </div>
                                    <div class="ggg-set-field">
                                        <label>内容</label>
                                        <textarea v-model="editingEntry.content" rows="8"></textarea>
                                    </div>
                                </template>

                                <div class="ggg-set-row" style="gap:8px;">
                                    <button class="ggg-set-btn primary" @click="saveEntryEdit">保存</button>
                                    <button class="ggg-set-btn" @click="editingEntry = null">取消</button>
                                </div>
                            </div>
                        </div>

                        <div v-if="section === 'diagnose'" class="ggg-set-page">
                        </div>

                        <div v-if="section === 'about'" class="ggg-set-page">
                            <div class="ggg-set-h">关于</div>
                            <div class="ggg-set-card">
                                <div class="ggg-set-row"><div class="lbl">名称</div><div class="val">呱呱小工具 · 手机</div></div>
                                <div class="ggg-set-row"><div class="lbl">版本</div><div class="val">v0.2.57-rc8</div></div>
                                <div class="ggg-set-row"><div class="lbl">GitHub</div><div class="val">dddy1/1</div></div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 从世界书导入条目 对话框 -->
                <div v-if="importLbOpen" class="ggg-set-modal" @click.self="closeImportLb">
                    <div class="ggg-set-modal-panel">
                        <div class="ggg-set-modal-head">
                            <div style="min-width:0;">
                                <div class="title">从世界书导入条目</div>
                                <div class="sub">勾选要导入的条目，每条变成一个独立的提示词条目（可自由命名/位置）</div>
                            </div>
                            <button class="ggg-set-iconbtn" @click="closeImportLb">
                                <i class="ggg-fa fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div class="ggg-set-modal-body">
                            <div class="ggg-set-card">
                                <!-- 角色书导入：锁定为角色卡绑定的世界书，只展示名字 -->
                                <div class="ggg-set-field" v-if="importLbUseChar">
                                    <label>角色卡绑定的世界书</label>
                                    <div style="padding:8px 10px;background:var(--ggg-card-hover);border-radius:6px;">
                                        <i class="ggg-fa fa-solid fa-id-card-clip" style="margin-right:6px;color:var(--ggg-accent);"></i>
                                        <strong>{{ importLbName || '（当前角色卡未绑定世界书）' }}</strong>
                                    </div>
                                </div>
                                <!-- 普通世界书导入：从所有世界书中选择 -->
                                <div class="ggg-set-field" v-else>
                                    <label>世界书</label>
                                    <select v-model="importLbName" @change="loadImportLb" class="ggg-set-select">
                                        <option value="">— 选择世界书 —</option>
                                        <option v-for="lb in lorebookList" :key="lb.value" :value="lb.name">{{ lb.name }}</option>
                                    </select>
                                </div>
                                <div class="ggg-set-row" style="gap:6px;">
                                    <button class="ggg-set-btn" @click="loadImportLb"><i class="ggg-fa fa-solid fa-arrows-rotate"></i> 重新加载</button>
                                    <button class="ggg-set-btn" @click="importLbSelectAll"><i class="ggg-fa fa-solid fa-check-double"></i> 全选</button>
                                    <button class="ggg-set-btn" @click="importLbClear"><i class="ggg-fa fa-solid fa-eraser"></i> 清空</button>
                                </div>
                                <div v-if="importLbLoading" style="padding:20px;text-align:center;opacity:.6;">加载中…</div>
                                <div v-else-if="importLbEntries.length === 0" style="padding:20px;text-align:center;opacity:.6;">
                                    {{ importLbName ? '该世界书暂无条目，或加载失败' : '请先选择一本世界书' }}
                                </div>
                                <div v-else style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">
                                    <label v-for="(en, i) in importLbEntries" :key="en.uid ?? i"
                                        class="ggg-preset-entry"
                                        style="cursor:pointer;align-items:flex-start;">
                                        <input type="checkbox" style="margin-top:6px;margin-right:8px;"
                                            :checked="!!importLbSelected[en.uid != null ? en.uid : i]"
                                            @change="toggleImportLbItem(en.uid != null ? en.uid : i, $event.target.checked)" />
                                        <div class="e-body" style="min-width:0;">
                                            <div class="e-name">{{ en.comment || (Array.isArray(en.key) ? en.key.join(', ') : en.key) || ('entry #' + (i+1)) }}</div>
                                            <div class="e-meta" style="white-space:normal;">{{ (en.content || '').slice(0, 100) }}{{ (en.content || '').length > 100 ? '…' : '' }}</div>
                                        </div>
                                    </label>
                                </div>
                                <div class="ggg-set-row" style="gap:8px;margin-top:10px;">
                                    <button class="ggg-set-btn primary" @click="confirmImportLb"
                                        :disabled="importLbSelectedCount === 0">
                                        <i class="ggg-fa fa-solid fa-check"></i>
                                        导入选中 ({{ importLbSelectedCount }})
                                    </button>
                                    <button class="ggg-set-btn" @click="closeImportLb">取消</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `,
    });
}
