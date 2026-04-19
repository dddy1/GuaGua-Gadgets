/**
 * 设置 App —— 手机内的"系统设置"
 * 分组：
 *   显示    —— 壁纸（精简，复杂选择移到图库）/ 主题
 *   入口    —— 入口形态 / 始终全屏
 *   PP API  —— url / key / model（默认空 = 使用酒馆当前 API；可"从酒馆同步"）
 *   PP 预设 —— 全局一个当前预设；预设由多个条目组成（角色信息 / 世界书 / 上下文 / 自定义提示词）
 *   关于
 *
 * 数据落点：
 *   壁纸 / 主题 / 入口 / 全屏 → settings.phone.*
 *   API     → settings.phone.api          { useStDefault, name, url, key, model }
 *   预设    → settings.phone.presets[]    + settings.phone.currentPresetId
 */
import { settings, saveAllSettings } from '../../../../index.js';
import { listStBackgrounds, getBgUrl, setBgUrl } from '../../core/background.js';
import { getTheme, setTheme } from '../../core/theme.js';

const uid = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ============ 默认预设（首次启动时注入） ============ */
const DEFAULT_PROMPT_HEADER = `你正在通过【PP】（一款类似 QQ 的即时通讯软件）和"{{user}}"聊天。
请保持你的角色性格与说话风格，但要符合即时通讯的特点：
- 回复短句化、口语化、可分多条发送（用换行分隔不同的消息气泡）
- 适度使用表情、颜文字
- 不要写小说式的旁白动作，除非用 (...) 或 *...* 包裹的少量动作描写
- 不要重复 user 的话，不要总结，不要复述
- 当用户问到与你设定无关的内容时，按你的人格自然回应`;

function makeDefaultPreset() {
    return {
        id: 'default',
        name: '默认预设',
        entries: [
            { id: uid(), type: 'custom',     enabled: true,  role: 'system', name: 'PP 聊天规则', content: DEFAULT_PROMPT_HEADER },
            { id: uid(), type: 'char-info',  enabled: true },
            { id: uid(), type: 'lorebook',   enabled: true,  source: 'char' },
            { id: uid(), type: 'st-context', enabled: false, count: 6 },
            { id: uid(), type: 'pp-context', enabled: true,  count: 30 },
        ],
    };
}

function ensurePresetSetup() {
    if (!settings.phone) settings.phone = {};
    if (!Array.isArray(settings.phone.presets) || settings.phone.presets.length === 0) {
        settings.phone.presets = [makeDefaultPreset()];
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

/* v0.2.19：拼装"用户信息"块 —— 用于 user-info 预设条目
 *   兼容 ctx.power_user / window.power_user 两种来源；
 *   名字会清理掉时间戳数字前缀；
 *   如果 PP 昵称（settings.phone.pp.me.nickname）和酒馆 persona name 不同，
 *   末尾追加一行 `PP昵称=xxx`
 */
function _gggCleanPersonaName(s) {
    if (!s) return s;
    return String(s).replace(/^\d{6,}[\s_\-.]*/, '').trim() || s;
}
function buildUserInfoText() {
    const ctx = (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null;
    // v0.2.20：新版 ST 是 powerUserSettings，旧版才是 power_user
    const power = ctx?.powerUserSettings || ctx?.power_user || window.power_user || null;
    const avatarKey = (() => {
        const k = ctx?.userAvatar || window.user_avatar || '';
        if (!k) return '';
        return k.endsWith('.png') ? k : `${k}.png`;
    })();
    const rawName = power?.personas?.[avatarKey] || ctx?.name1 || window.name1 || '';
    const personaName = _gggCleanPersonaName(rawName);
    const personaDesc = power?.persona_descriptions?.[avatarKey]?.description
        || power?.persona_description // 部分老版本字段名不同
        || '';
    const ppNick = settings.phone?.pp?.me?.nickname || '';

    const parts = [];
    if (personaName) parts.push(`# 用户：${personaName}`);
    if (personaDesc) parts.push(`## 描述\n${personaDesc}`);
    // 用户在 PP 里改过昵称（与酒馆 persona name 不同）→ 末尾追加
    if (ppNick && personaName && ppNick !== personaName) {
        parts.push(`\nPP昵称=${ppNick}`);
    }
    if (parts.length === 0) return '(未发现当前酒馆 persona)';
    return parts.join('\n\n');
}

/* 占位变量替换 */
function substVars(s) {
    if (!s) return '';
    const ctx = (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null;
    const userName = ctx?.name1 || '{{user}}';
    const charName = ctx?.name2 || '{{char}}';
    return String(s).replace(/\{\{user\}\}/gi, userName).replace(/\{\{char\}\}/gi, charName);
}

/* 把预设按顺序展开成最终 messages 块（用于预览）
 * lorebookCache: { [name]: entries[] } 由调用方先 await 加载好 */
function buildPresetPreview(preset, lorebookCache = {}) {
    const blocks = [];
    if (!preset) return blocks;
    const ctx = (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null;
    const chId = ctx?.characterId;
    const ch = (ctx?.characters && chId != null) ? ctx.characters[chId] : null;

    for (const e of preset.entries) {
        if (!e.enabled) continue;

        if (e.type === 'user-info') {
            blocks.push({
                role: e.role || 'system',
                name: e.name || '用户信息',
                content: substVars(buildUserInfoText()),
            });

        } else if (e.type === 'char-info') {
            if (ch) {
                const parts = [];
                if (ch.name)        parts.push(`# ${ch.name}`);
                if (ch.description) parts.push(`## 描述\n${ch.description}`);
                if (ch.personality) parts.push(`## 性格\n${ch.personality}`);
                if (ch.scenario)    parts.push(`## 场景\n${ch.scenario}`);
                if (ch.mes_example) parts.push(`## 对话示例\n${ch.mes_example}`);
                blocks.push({ role: 'system', name: e.name || `角色信息：${ch.name || ''}`,
                    content: substVars(parts.join('\n\n')) || '(角色卡无内容)' });
            } else {
                blocks.push({ role: 'system', name: e.name || '角色信息', content: '(当前未选角色卡)' });
            }

        } else if (e.type === 'lorebook') {
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

        } else if (e.type === 'st-context') {
            const chat = ctx?.chat || [];
            const n = Number(e.count) || 0;
            const recent = n > 0 ? chat.slice(-n) : chat.slice();   // 0 = 全部
            if (recent.length === 0) {
                blocks.push({ role: 'system', name: e.name || `酒馆上下文（${n === 0 ? '全部' : '最近 '+n+' 条'}）`, content: '(暂无消息)' });
            } else {
                const text = recent.map(m => {
                    const role = m.is_user ? 'user' : 'assistant';
                    return `[${role}] ${m.name || ''}：\n${substVars(m.mes || '')}`;
                }).join('\n\n— — —\n\n');
                blocks.push({
                    role: 'system',
                    name: e.name || `酒馆上下文（${n === 0 ? '全部' : '最近 '+recent.length+' 条'}）`,
                    content: text,
                });
            }

        } else if (e.type === 'pp-context') {
            const n = Number(e.count) || 0;
            blocks.push({ role: 'system', name: e.name || 'PP 上下文',
                content: `(发送时注入 PP 当前会话${n === 0 ? '全部' : '最近 '+n+' 条'}；Phase 3 接入聊天后生效)` });

        } else if (e.type === 'custom') {
            blocks.push({
                role: e.role || 'system',
                name: e.name || '自定义提示词',
                content: substVars(e.content || ''),
            });
        }
    }
    return blocks;
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

            const section = ref('display');
            // -- 显示 --
            const currentBg = ref(getBgUrl());
            const theme = ref(getTheme());
            const setT = (v) => { setTheme(v); theme.value = v; };
            const clearBg = () => { setBgUrl(''); currentBg.value = ''; };

            // -- 入口 --
            const entryMode = ref(settings.phone?.entryMode || 'island');
            const setEntry = (v) => {
                if (!settings.phone) settings.phone = {};
                settings.phone.entryMode = v; entryMode.value = v;
                saveAllSettings();
                window.dispatchEvent(new CustomEvent('ggg-phone-entry-change', { detail: { mode: v } }));
            };
            const alwaysFs = ref(!!settings.phone?.alwaysFullscreen);
            const setFs = (v) => {
                if (!settings.phone) settings.phone = {};
                settings.phone.alwaysFullscreen = !!v; alwaysFs.value = !!v;
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

            // -- 预设预览 + token 估算 --
            const previewOpen = ref(false);
            const previewBlocks = ref([]);
            const lorebookCache = ref({});  // { name: entries[] }

            const refreshPreview = async () => {
                lorebookList.value = listLorebooks();
                // 预加载所有需要的世界书
                const names = collectLorebookNames(currentPreset.value);
                const cache = { ...lorebookCache.value };
                await Promise.all(names.map(async (n) => {
                    if (!cache[n]) cache[n] = await loadLorebookEntries(n);
                }));
                lorebookCache.value = cache;
                previewBlocks.value = buildPresetPreview(currentPreset.value, cache);
            };
            const openPreview = async () => { await refreshPreview(); previewOpen.value = true; };
            const closePreview = () => { previewOpen.value = false; };
            const totalChars = computed(() =>
                previewBlocks.value.reduce((n, b) => n + (b.content || '').length, 0)
            );
            const totalTokens = computed(() =>
                previewBlocks.value.reduce((n, b) => n + estimateTokens(b.content), 0)
            );
            // 预设级别 token 估算（不打开预览也能算）—— 统计当前 preset 各 entry 的静态内容
            const currentPresetTokens = ref(0);
            const recalcPresetTokens = async () => {
                await refreshPreview();
                // 优先用酒馆异步 token API（更准）
                let total = 0;
                for (const b of previewBlocks.value) {
                    total += await estimateTokensAsync(b.content || '');
                }
                currentPresetTokens.value = total;
            };
            onMounted(() => { recalcPresetTokens(); });

            // -- 预设条目 --
            const editingEntry = ref(null);
            const lorebookList = ref(listLorebooks());

            const ENTRY_LABELS = {
                'char-info':      { name: '角色信息',     icon: 'fa-id-card',           hint: '自动注入当前角色卡的描述 / 性格 / 场景' },
                'user-info':      { name: '用户信息',     icon: 'fa-user',              hint: '注入当前酒馆账号 persona 的名字/描述；若 PP 改过昵称会追加 PP昵称=xxx' },
                'lorebook':       { name: '世界书',       icon: 'fa-book',              hint: '注入整本世界书所有条目' },
                'lorebook-entry': { name: '世界书条目',   icon: 'fa-bookmark',          hint: '从某世界书中导入的单条' },
                'st-context':     { name: '酒馆上下文',   icon: 'fa-clock-rotate-left', hint: '注入酒馆主聊天的最近 N 条（0=全部）' },
                'pp-context':     { name: 'PP 上下文',    icon: 'fa-comments',          hint: '注入 PP 当前会话的最近 N 条（0=全部）' },
                'custom':         { name: '自定义提示词', icon: 'fa-pen-to-square',     hint: '自由编写' },
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
                if (e.type === 'st-context' || e.type === 'pp-context') {
                    const n = Number(e.count) || 0;
                    return n === 0 ? '全部历史' : `最近 ${n} 条`;
                }
                if (e.type === 'custom') return `[${e.role}] ${(e.content || '').slice(0, 40) || '空'}`;
                return ENTRY_LABELS[e.type]?.hint || '';
            };

            const toggleEntry = (e) => { e.enabled = !e.enabled; saveAllSettings(); };
            const moveEntry = (idx, dir) => {
                const arr = currentPreset.value.entries;
                const j = idx + dir;
                if (j < 0 || j >= arr.length) return;
                [arr[idx], arr[j]] = [arr[j], arr[idx]];
                saveAllSettings();
            };
            const delEntry = (idx) => { currentPreset.value.entries.splice(idx, 1); saveAllSettings(); };
            const editEntry = (e) => {
                if (['custom','lorebook','st-context','pp-context','lorebook-entry'].includes(e.type)) {
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
                // 新：导入按钮直接打开"从世界书导入"对话框，把每条 entry 拆成 lorebook-entry
                if (type === 'lorebook-import')    { openImportLb(false); return; }
                if (type === 'lorebook-import-ch') { openImportLb(true);  return; }
                const arr = currentPreset.value.entries;
                let e = null;
                if (type === 'char-info')  e = { id: uid(), type, enabled: true };
                if (type === 'user-info')  e = { id: uid(), type, enabled: true };
                if (type === 'lorebook')   { lorebookList.value = listLorebooks(); e = { id: uid(), type, enabled: true, source: 'char', lorebookName: '' }; }
                if (type === 'st-context') e = { id: uid(), type, enabled: true, count: 6 };
                if (type === 'pp-context') e = { id: uid(), type, enabled: true, count: 30 };
                if (type === 'custom')     e = { id: uid(), type, enabled: true, role: 'system', name: '新提示词', content: '' };
                if (e) {
                    arr.push(e);
                    if (type === 'custom' || type === 'lorebook') editEntry(e);
                    saveAllSettings();
                }
            };

            // -- 拖拽换位（条目列表） --
            const dragEntryIdx = ref(-1);
            const onEntryDragStart = (idx, ev) => {
                dragEntryIdx.value = idx;
                ev.dataTransfer.effectAllowed = 'move';
                try { ev.dataTransfer.setData('text/plain', String(idx)); } catch {}
            };
            const onEntryDragOver = (ev) => { ev.preventDefault(); };
            const onEntryDrop = (idx, ev) => {
                ev.preventDefault();
                const from = dragEntryIdx.value;
                if (from < 0 || from === idx) return;
                const arr = currentPreset.value.entries;
                const moved = arr.splice(from, 1)[0];
                arr.splice(idx, 0, moved);
                dragEntryIdx.value = -1;
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
                { id: 'display', name: '显示',     icon: 'fa-palette',             color: '#a855f7' },
                { id: 'entry',   name: '入口',     icon: 'fa-mobile-screen',       color: '#06b6d4' },
                { id: 'api',     name: 'PP API',   icon: 'fa-plug',                color: '#10b981' },
                { id: 'preset',  name: 'PP 预设',  icon: 'fa-wand-magic-sparkles', color: '#f59e0b' },
                { id: 'about',   name: '关于',     icon: 'fa-circle-info',         color: '#64748b' },
            ];
            // 注：'st-context' / 'pp-context' 默认常驻条目列表，不在此处提供添加
            //     '整本世界书' 现在直接打开"从世界书导入"对话框，把每条 entry 拆为 lorebook-entry
            const addMenuItems = [
                { type: 'char-info',          name: '角色信息',     icon: 'fa-id-card' },
                { type: 'user-info',          name: '用户信息',     icon: 'fa-user' },
                { type: 'lorebook-import',    name: '世界书导入',   icon: 'fa-book' },
                { type: 'lorebook-import-ch', name: '角色书导入',   icon: 'fa-id-card-clip' },
                { type: 'custom',             name: '自定义提示',   icon: 'fa-pen-to-square' },
            ];

            return {
                section, sections,
                currentBg, clearBg, theme, setT,
                entryMode, setEntry, alwaysFs, setFs,
                api, stApi, stModelList, refreshStApi, syncFromSt, saveApi,
                presets, currentPresetId, currentPreset, setCurrentPreset, newPreset, dupPreset, delPreset, renamePreset,
                editingEntry, lorebookList, addMenuItems,
                entryLabel, entryMeta, toggleEntry, moveEntry, delEntry, editEntry, saveEntryEdit, addEntry,
                previewOpen, previewBlocks, totalChars, totalTokens, openPreview, closePreview, refreshPreview,
                currentPresetTokens, recalcPresetTokens,
                dragEntryIdx, onEntryDragStart, onEntryDragOver, onEntryDrop,
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
                        <!-- 显示 -->
                        <div v-if="section === 'display'" class="ggg-set-page">
                            <div class="ggg-set-h">壁纸</div>
                            <div class="ggg-set-card">
                                <div class="ggg-set-row">
                                    <div class="lbl">当前壁纸</div>
                                    <div class="val">{{ currentBg ? '已自定义' : '默认（酒馆首张）' }}</div>
                                </div>
                                <div v-if="currentBg" class="ggg-set-wp-preview" :style="{ backgroundImage: 'url(' + currentBg + ')' }"></div>
                                <div class="ggg-set-hint">
                                    在【图库】中点图即可设为壁纸；支持 tag / 横竖筛选。
                                </div>
                                <div class="ggg-set-row" v-if="currentBg">
                                    <button class="ggg-set-btn" @click="clearBg">
                                        <i class="ggg-fa fa-solid fa-eraser"></i> 还原默认
                                    </button>
                                </div>
                            </div>

                            <div class="ggg-set-h">主题</div>
                            <div class="ggg-set-card">
                                <div class="ggg-set-seg">
                                    <button :class="{ on: theme === 'dark' }" @click="setT('dark')">
                                        <i class="ggg-fa fa-solid fa-moon"></i> 深色
                                    </button>
                                    <button :class="{ on: theme === 'light' }" @click="setT('light')">
                                        <i class="ggg-fa fa-solid fa-sun"></i> 浅色
                                    </button>
                                </div>
                            </div>

                        </div>

                        <!-- 入口 -->
                        <div v-if="section === 'entry'" class="ggg-set-page">
                            <div class="ggg-set-h">入口形态</div>
                            <div class="ggg-set-card">
                                <div class="ggg-set-seg vertical">
                                    <button :class="{ on: entryMode === 'island' }" @click="setEntry('island')">
                                        <i class="ggg-fa fa-solid fa-circle-dot"></i> 灵动岛（顶部胶囊）
                                    </button>
                                    <button :class="{ on: entryMode === 'pc-floater' }" @click="setEntry('pc-floater')">
                                        <i class="ggg-fa fa-solid fa-window-restore"></i> PC 悬浮窗
                                    </button>
                                    <button :class="{ on: entryMode === 'mobile-ball' }" @click="setEntry('mobile-ball')">
                                        <i class="ggg-fa fa-solid fa-circle"></i> 移动悬浮球
                                    </button>
                                </div>
                                <div class="ggg-set-hint">单击切换酒馆顶栏，双击进/退手机</div>
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

                        <!-- API -->
                        <div v-if="section === 'api'" class="ggg-set-page">
                            <div class="ggg-set-h">PP 聊天的 API</div>

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

                            <!-- ③ 总 token + 预览 + 刷新 -->
                            <div class="ggg-set-card">
                                <div class="ggg-set-row" style="justify-content:space-between;align-items:center;">
                                    <div style="font-size:12px;color:var(--ggg-text-dim);">
                                        预设总 token（估算）：
                                        <strong style="color:var(--ggg-text);font-size:14px;">{{ currentPresetTokens }}</strong>
                                    </div>
                                    <div style="display:flex;gap:6px;">
                                        <button class="ggg-set-btn primary" @click="openPreview"><i class="ggg-fa fa-solid fa-eye"></i> 预览</button>
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
                            <div v-if="currentPreset && !editingEntry">
                                <div
                                    v-for="(e, idx) in currentPreset.entries"
                                    :key="e.id"
                                    class="ggg-preset-entry"
                                    :class="{ disabled: !e.enabled, dragging: dragEntryIdx === idx }"
                                    draggable="true"
                                    @dragstart="onEntryDragStart(idx, $event)"
                                    @dragover="onEntryDragOver"
                                    @drop="onEntryDrop(idx, $event)">
                                    <div class="e-handle" title="拖拽排序"><i class="ggg-fa fa-solid fa-grip-vertical"></i></div>
                                    <div class="e-body">
                                        <div class="e-name">
                                            <i class="ggg-fa fa-solid" :class="entryLabel(e).icon" style="margin-right:6px;color:var(--ggg-accent);"></i>
                                            {{ entryLabel(e).name }}
                                        </div>
                                        <div class="e-meta">{{ entryMeta(e) }}</div>
                                    </div>
                                    <div class="e-actions">
                                        <button class="ggg-set-iconbtn" @click="toggleEntry(e)" :title="e.enabled ? '禁用' : '启用'">
                                            <i class="ggg-fa fa-solid" :class="e.enabled ? 'fa-eye' : 'fa-eye-slash'"></i>
                                        </button>
                                        <button class="ggg-set-iconbtn" @click="editEntry(e)" v-if="e.type !== 'char-info' &amp;&amp; e.type !== 'user-info'">
                                            <i class="ggg-fa fa-solid fa-pen"></i>
                                        </button>
                                        <button class="ggg-set-iconbtn danger" @click="delEntry(idx)"
                                            v-if="e.type !== 'st-context' && e.type !== 'pp-context'"
                                            title="删除"><i class="ggg-fa fa-solid fa-trash"></i></button>
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

                                <template v-if="editingEntry.type === 'st-context' || editingEntry.type === 'pp-context'">
                                    <div class="ggg-set-field">
                                        <label>名称（可选）</label>
                                        <input v-model="editingEntry.name" placeholder="便于识别" />
                                    </div>
                                    <div class="ggg-set-field">
                                        <label>注入最近 N 条消息（0 = 全部历史）</label>
                                        <input type="number" min="0" step="1" v-model.number="editingEntry.count" />
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

                        <!-- 关于 -->
                        <div v-if="section === 'about'" class="ggg-set-page">
                            <div class="ggg-set-h">关于</div>
                            <div class="ggg-set-card">
                                <div class="ggg-set-row"><div class="lbl">名称</div><div class="val">呱呱小工具 · 手机</div></div>
                                <div class="ggg-set-row"><div class="lbl">版本</div><div class="val">v0.2.0 (Phase 2+)</div></div>
                                <div class="ggg-set-row"><div class="lbl">GitHub</div><div class="val">dddy1/1</div></div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 预设预览覆盖层（盖整个 settings App） -->
                <div v-if="previewOpen" class="ggg-preset-preview" @click.self="closePreview">
                    <div class="ggg-preset-preview-panel">
                        <div class="ggg-preset-preview-head">
                            <div style="min-width:0;">
                                <div class="title">提示词预览</div>
                                <div class="sub">
                                    {{ currentPreset?.name }} · {{ previewBlocks.length }} 块 · {{ totalChars }} 字 · 约 {{ totalTokens }} token
                                </div>
                            </div>
                            <button class="ggg-set-iconbtn" @click="closePreview">
                                <i class="ggg-fa fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div class="ggg-preset-preview-body">
                            <div v-if="previewBlocks.length === 0" class="ggg-set-empty">
                                当前预设没有启用任何条目
                            </div>
                            <div
                                v-for="(b, i) in previewBlocks"
                                :key="i"
                                class="ggg-preset-preview-block"
                                :class="'role-' + b.role">
                                <div class="head">
                                    <span class="role">{{ b.role }}</span>
                                    <span class="name">{{ b.name }}</span>
                                    <span class="len">{{ (b.content || '').length }} 字 / ~{{ (function(c){let cn=0,o=0;for(const ch of String(c||'')){if(/[\u4e00-\u9fa5]/.test(ch))cn++;else o++;}return Math.ceil(cn/1.5+o/4);})(b.content) }} tk</span>
                                </div>
                                <pre class="body">{{ b.content }}</pre>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 从世界书导入条目 对话框 -->
                <div v-if="importLbOpen" class="ggg-preset-preview" @click.self="closeImportLb">
                    <div class="ggg-preset-preview-panel">
                        <div class="ggg-preset-preview-head">
                            <div style="min-width:0;">
                                <div class="title">从世界书导入条目</div>
                                <div class="sub">勾选要导入的条目，每条变成一个独立的提示词条目（可自由命名/位置）</div>
                            </div>
                            <button class="ggg-set-iconbtn" @click="closeImportLb">
                                <i class="ggg-fa fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div class="ggg-preset-preview-body">
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
