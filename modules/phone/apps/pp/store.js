/**
 * PP（捏他 QQ）数据 store —— 极简版
 * 数据持久化到 settings.phone.pp（友列表、群列表、聊天会话索引等）
 * 真正的聊天消息绑到酒馆 chat[i].extra.guagua_pp（Phase 3 实现）
 *
 * 当前只暴露 reactive 容器与 getters/setters 占位，让骨架可以渲染
 */
import { settings, saveAllSettings } from '../../../../index.js';

/* ============================================================
 * v0.2.17 修订：用 st-api-wrapper 的 window.ST_API.avatar 取头像与 persona
 *   旧实现依赖 window.power_user.personas，新版 ST 已不再把它暴露到 window，
 *   导致列表始终为空、头像/昵称回落到默认 'User'。
 *
 * 优先级：window.ST_API.avatar.* （异步，Lianues/st-api-wrapper 扩展）
 *         其次 fallback 到 power_user / user_avatar 同步读
 * ============================================================ */

/** 把 'foo' / 'foo.png' 都规范成带 .png 的文件名 */
function ensurePng(name) {
    if (!name) return '';
    return name.endsWith('.png') ? name : `${name}.png`;
}

/**
 * v0.2.19：清掉 persona 显示名前的一大串数字时间戳前缀
 *   SillyTavern 上传 user avatar 时常自动 rename 成 `1769250972654-Alice.png`，
 *   power_user.personas 里也会跟着存这个带前缀的名字 → UI 上看起来很丑。
 *   规则：去掉开头连续 ≥ 6 位数字 +（可选）分隔符 [- _ . 空格]。
 */
function cleanPersonaName(s) {
    if (!s) return s;
    return String(s).replace(/^\d{6,}[\s_\-.]*/, '').trim() || s;
}

/**
 * v0.2.19：统一拿"酒馆 power_user"对象 —— 兼容两种来源
 *   1. SillyTavern.getContext().power_user —— 主线 ST 都暴露在 ctx 上
 *   2. window.power_user —— 部分老版本 / 助手扩展会暴露到 window
 */
function getStPowerUser() {
    const ctx = (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null;
    // 新版 ST：getContext() 暴露的是 powerUserSettings；老版可能挂 window.power_user
    return ctx?.powerUserSettings || ctx?.power_user || window.power_user || null;
}

/**
 * v0.2.20：ST 自带的占位头像（如 user-default.png）应该过滤掉，
 * 用户的"切换账号"列表只想看真实创建过的 persona。
 */
function isPlaceholderAvatar(avatarKey) {
    if (!avatarKey) return true;
    const k = String(avatarKey).toLowerCase();
    return k === 'user-default.png' || k === 'user-default' || k === 'default-user.png';
}
function getStCurrentAvatarKey() {
    const ctx = (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null;
    return ensurePng(ctx?.userAvatar || window.user_avatar || '');
}
function getStCurrentName() {
    const ctx = (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null;
    return ctx?.name1 || window.name1 || '';
}

/** 同步 fallback：从 ctx.power_user / window.power_user / user_avatar / name1 读 */
function readPersonaFallbackSync() {
    try {
        const power = getStPowerUser();
        const avatarKey = getStCurrentAvatarKey();
        const rawName = power?.personas?.[avatarKey] || getStCurrentName() || '';
        if (!rawName && !avatarKey) return null;
        return {
            name: cleanPersonaName(rawName || avatarKey.replace(/\.png$/, '')) || 'User',
            avatarUrl: avatarKey ? `User Avatars/${avatarKey}` : '',
            avatarKey,
        };
    } catch (e) { return null; }
}

/** 同步快速读（公开 API，不阻塞 Vue 渲染） */
export function readStCurrentPersona() {
    return readPersonaFallbackSync();
}

/**
 * 异步主路径：用 ST_API.avatar.get 拿当前用户头像
 * 返回 { name, avatarUrl, avatarKey } 或 null
 */
export async function readStCurrentPersonaAsync() {
    try {
        const api = window.ST_API?.avatar;
        if (!api?.get) return readPersonaFallbackSync();
        const a = await api.get({ type: 'user' });
        if (!a) return readPersonaFallbackSync();
        const avatarKey = ensurePng(a.name);
        const power = getStPowerUser();
        const displayName = power?.personas?.[avatarKey]
            || getStCurrentName()
            || a.name;
        return {
            name: cleanPersonaName(displayName || a.name),
            avatarUrl: a.url || (avatarKey ? `User Avatars/${avatarKey}` : ''),
            avatarKey,
        };
    } catch (e) {
        console.warn('[ggg-phone] readStCurrentPersonaAsync 失败：', e);
        return readPersonaFallbackSync();
    }
}

/** 同步 fallback：列所有 persona —— 兼容 ctx.power_user 和 window.power_user */
function readAllPersonasFallbackSync() {
    try {
        const power = getStPowerUser();
        const personas = power?.personas || {};
        const currentAvatar = getStCurrentAvatarKey();
        return Object.entries(personas)
            .filter(([avatar]) => !isPlaceholderAvatar(avatar))
            .map(([avatar, name]) => ({
                avatar,
                name: cleanPersonaName(String(name || avatar.replace(/\.png$/, ''))),
                url: `User Avatars/${avatar}`,
                isCurrent: avatar === currentAvatar,
            }));
    } catch (e) { return []; }
}

/** 同步快速读（保留旧 API 兼容） */
export function readStAllPersonas() {
    return readAllPersonasFallbackSync();
}

/**
 * 异步主路径：用 ST_API.avatar.list 列出所有用户头像
 * 返回 Array<{ avatar, name, url, isCurrent }>
 */
export async function readStAllPersonasAsync() {
    try {
        const api = window.ST_API?.avatar;
        if (!api?.list) return readAllPersonasFallbackSync();
        const r = await api.list({ type: 'user' });
        const users = r?.users || [];
        if (users.length === 0) return readAllPersonasFallbackSync();
        const power = getStPowerUser();
        return users
            .filter(u => !isPlaceholderAvatar(u.name) && !isPlaceholderAvatar(ensurePng(u.name)))
            .map(u => {
                const avatarKey = ensurePng(u.name);
                const displayName = power?.personas?.[avatarKey] || u.name;
                return {
                    avatar: avatarKey,
                    name: cleanPersonaName(String(displayName || avatarKey.replace(/\.png$/, ''))),
                    url: u.url || `User Avatars/${avatarKey}`,
                    isCurrent: !!u.isCurrent,
                };
            });
    } catch (e) {
        console.warn('[ggg-phone] readStAllPersonasAsync 失败：', e);
        return readAllPersonasFallbackSync();
    }
}

/**
 * v0.2.47：把"基于 ST 当前 persona + personas[avatar] PP 资料"重建 me 的逻辑抽出来
 *   每次 createPPStore 都跑、外部 PERSONA_CHANGED 事件也跑（通过全局 hook）
 *   规则：PP 资料卡里的 nickname/signature/avatarUrl 优先；其次 ST persona 显示名/头像
 */
function getCtx() {
    try { return (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null; } catch { return null; }
}

function personaKeyVariants(avatarKey) {
    const key = ensurePng(avatarKey || getStCurrentAvatarKey() || '');
    const raw = String(avatarKey || getStCurrentAvatarKey() || '');
    const noExt = key.replace(/\.png$/i, '');
    return Array.from(new Set([key, raw, noExt].filter(Boolean)));
}

function readPersonaData(state, avatarKey) {
    const personas = state.personas || {};
    for (const key of personaKeyVariants(avatarKey)) {
        if (personas[key]) return personas[key];
    }
    if (personas.__none__) return personas.__none__;
    return {};
}

function currentPersonaStoreKey(me = {}) {
    const key = ensurePng(me.avatarKey || getStCurrentAvatarKey() || '');
    return key || '__none__';
}

export function persistCurrentMeProfile(me = {}) {
    if (!settings.phone) settings.phone = {};
    if (!settings.phone.pp) settings.phone.pp = {};
    if (!settings.phone.pp.me) settings.phone.pp.me = {};
    if (!settings.phone.pp.personas) settings.phone.pp.personas = {};

    const key = currentPersonaStoreKey(me);
    const profile = {
        ...(settings.phone.pp.personas[key] || {}),
        nickname: String(me.nickname || '').trim(),
        signature: String(me.signature || '').trim(),
        avatarUrl: me.avatar || '',
    };
    const nextMe = { ...me, avatarKey: key === '__none__' ? '' : key };

    const liveState = (typeof window !== 'undefined' && window.__ggg_phone_pp_store?.state) || null;
    if (liveState) {
        if (!liveState.personas) liveState.personas = {};
        if (!liveState.me) liveState.me = {};
        liveState.personas[key] = { ...(liveState.personas[key] || {}), ...profile };
        Object.assign(liveState.me, nextMe);
    }

    settings.phone.pp.personas[key] = {
        ...(settings.phone.pp.personas[key] || {}),
        ...(liveState?.personas?.[key] || profile),
    };
    settings.phone.pp.me = {
        ...settings.phone.pp.me,
        ...(liveState?.me || nextMe),
    };
    saveAllSettings();
}

function normalizeWallet(wallet) {
    const target = wallet || { balance: 3.0, history: [] };
    const n = Number(target.balance);
    target.balance = Number.isFinite(n) ? Math.round(n * 100) / 100 : 3.0;
    if (!Array.isArray(target.history)) target.history = [];
    return target;
}

function createDefaultPPState() {
    return {
        me: {},
        friends: [],
        groups: [],
        chats: [],
        personas: {},
        wallet: { balance: 3.0, history: [] },
        vip: { tier: 'none', expireAt: 0 },
        decorations: { theme: 'default', bubble: 'default', font: 'default' },
        favorites: [],
        appearanceByPersona: {},
        contactExtByKey: {},
    };
}

function ensurePPStateShape(pp) {
    const defaults = createDefaultPPState();
    const target = (pp && typeof pp === 'object') ? pp : {};

    if (!target.me || typeof target.me !== 'object') target.me = { ...defaults.me };
    if (!target.personas || typeof target.personas !== 'object') target.personas = { ...defaults.personas };
    if (!target.vip || typeof target.vip !== 'object') target.vip = { ...defaults.vip };
    if (!target.decorations || typeof target.decorations !== 'object') target.decorations = { ...defaults.decorations };
    if (!target.appearanceByPersona || typeof target.appearanceByPersona !== 'object') target.appearanceByPersona = { ...defaults.appearanceByPersona };
    if (!target.contactExtByKey || typeof target.contactExtByKey !== 'object') target.contactExtByKey = { ...defaults.contactExtByKey };

    if (!Array.isArray(target.friends)) target.friends = [];
    if (!Array.isArray(target.groups)) target.groups = [];
    if (!Array.isArray(target.chats)) target.chats = [];
    if (!Array.isArray(target.favorites)) target.favorites = [];

    target.wallet = normalizeWallet(target.wallet || defaults.wallet);
    target.vip.tier = target.vip.tier || defaults.vip.tier;
    target.vip.expireAt = Number(target.vip.expireAt) || 0;
    target.decorations = { ...defaults.decorations, ...target.decorations };

    return target;
}

function readChatContacts() {
    const ctx = getCtx();
    const friends = ctx?.chatMetadata?.gggPPContacts?.friends;
    return Array.isArray(friends) ? friends.map(f => ({ ...f })) : [];
}

function readPersonaFriends(ppData, avatarKey) {
    if (Array.isArray(ppData?.friends)) {
        return ppData.friends
            .filter(f => f && String(f.nickname || '').trim())
            .map((f, index) => ({
                id: f.id || `persona_${avatarKey || 'current'}_${index}_${String(f.nickname || '').trim()}`,
                nickname: String(f.nickname || '').trim(),
                avatar: f.avatar || f.avatarUrl || '',
                signature: f.signature || '',
                group: 'friend',
                remark: f.remark || '',
                fromPersona: avatarKey || '',
                source: 'persona-profile',
            }));
    }
    return String(ppData?.friendsText || '')
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean)
        .map((line, index) => {
            const parts = line.split('|').map(s => s.trim());
            const nickname = parts[0] || `好友 ${index + 1}`;
            return {
                id: `persona_${avatarKey || 'current'}_${index}_${nickname}`,
                nickname,
                avatar: parts[1] || '',
                group: 'friend',
                remark: parts[2] || '',
                fromPersona: avatarKey || '',
                source: 'persona-profile',
            };
        });
}

function readPersonaProfileFriends(state) {
    const avatarKey = state?.me?.avatarKey || readStCurrentPersona()?.avatarKey || '';
    const ppData = readPersonaData(state, avatarKey);
    return readPersonaFriends(ppData, avatarKey);
}

function mergeFriends(...lists) {
    const map = new Map();
    for (const list of lists) {
        for (const f of (Array.isArray(list) ? list : [])) {
            if (!f || !f.id) continue;
            const key = f.fromCharacter ? `char:${f.fromCharacter}` : (f.id || f.nickname || f.name);
            map.set(key, { ...(map.get(key) || {}), ...f });
        }
    }
    return Array.from(map.values());
}

function rebuildContacts(state, chatContacts = readChatContacts()) {
    state.friends = mergeFriends(readPersonaProfileFriends(state), chatContacts);
}

function rebuildMeFromCurrentPersona(state) {
    const persona = readStCurrentPersona();
    const avatarKey = persona?.avatarKey || '';
    const personas = (state.personas = state.personas || {});
    const ppData = readPersonaData(state, avatarKey);

    const me = state.me || {};
    // v0.2.52：账号切换时（avatarKey 变了）不再回退到旧 me 的字段，
    //          否则切到新 persona 时还会显示老账号的昵称/头像
    const switching = !!me.avatarKey && me.avatarKey !== avatarKey;
    if (!switching) {
        const profileKey = currentPersonaStoreKey({ avatarKey });
        const data = personas[profileKey] || ppData || {};
        if (!data.nickname && me.nickname && me.nickname !== persona?.name) data.nickname = me.nickname;
        if (!data.signature && me.signature) data.signature = me.signature;
        if (!data.avatarUrl && me.avatar && me.avatar !== persona?.avatarUrl) data.avatarUrl = me.avatar;
        if (Object.keys(data).length) personas[profileKey] = data;
    }
    me.nickname = ppData.nickname || persona?.name || (switching ? 'User' : (me.nickname || 'User'));
    me.avatar   = ppData.avatarUrl || (switching ? (persona?.avatarUrl || '') : (me.avatar || persona?.avatarUrl || ''));
    me.signature = ppData.signature || (switching ? '这个人很懒，什么都没写' : (me.signature || '这个人很懒，什么都没写'));
    delete me.ppId;
    me.avatarKey = avatarKey;
    state.me = me;
}

export function createPPStore(Vue) {
    const { reactive, watch } = Vue;

    if (!settings.phone) settings.phone = {};
    settings.phone.pp = ensurePPStateShape(settings.phone.pp);
    if (settings.phone.pp.me) delete settings.phone.pp.me.balance;
    // v0.2.47：每次都重建 me（保证酒馆切 persona 后打开手机就是新账号）
    rebuildMeFromCurrentPersona(settings.phone.pp);
    settings.phone.pp.friends = [];
    saveAllSettings();

    const state = reactive(settings.phone.pp);
    rebuildContacts(state);

    // 异步用 ST_API 再校准头像 url（reactive，会触发 UI 刷新）
    readStCurrentPersonaAsync().then(p => {
        if (!p) return;
        const ppData = readPersonaData(state, p.avatarKey);
        if (!ppData.nickname && p.name) state.me.nickname = p.name;
        if (!ppData.avatarUrl && !state.me.avatar && p.avatarUrl) state.me.avatar = p.avatarUrl;
    });

    // 自动持久化（深 watch；轻量）
    watch(() => state, () => {
        const next = JSON.parse(JSON.stringify(state));
        // 好友列表按当前聊天文件和当前 persona 资料实时生成，不写回全局设置。
        next.friends = [];
        settings.phone.pp = next;
        saveAllSettings();
    }, { deep: true });

    // v0.2.47：暴露全局 hook，让 character-cards / 外部能在手机已开时直接更新 store
    const api = {
        state,
        getMe: () => state.me,
        rebuildMe() {
            rebuildMeFromCurrentPersona(state);
            rebuildContacts(state);
        },
        refreshContacts() {
            rebuildContacts(state);
        },
        setChatContacts(list) {
            rebuildContacts(state, Array.isArray(list) ? list : []);
        },
        addOrUpdateFriend(f) {
            if (!f || !f.id) return;
            const i = state.friends.findIndex(x => x.id === f.id);
            if (i >= 0) state.friends[i] = { ...state.friends[i], ...f };
            else state.friends.push(f);
        },
        // v0.2.21：手动切换账号 —— 用指定 persona 覆盖 me，并真正切换酒馆 persona
        async switchAccount(persona) {
            if (!persona) return;
            state.me.nickname = persona.name || state.me.nickname;
            state.me.avatar = persona.url || state.me.avatar;
            saveAllSettings();
            // 通过 SillyTavern 的 /persona-set 斜杠命令真正切换酒馆 persona，
            // 这会触发 PERSONA_CHANGED 事件 + 更新 user_avatar / name1 / power_user，
            // 之后 settings 预设里的"用户信息"才能拿到新值。
            try {
                const ctx = (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null;
                const exec = ctx?.executeSlashCommandsWithOptions
                    || ctx?.SlashCommandParser?.executeCommand
                    || (typeof window !== 'undefined' ? window.executeSlashCommandsWithOptions : null);
                // /persona-set 接受 avatar 文件名（最稳）或 persona 显示名
                const target = persona.avatar || persona.name;
                if (exec && target) {
                    // 用 mode=lookup 强制按已存在的 persona 查找，避免被当成临时名
                    await exec.call(ctx, `/persona-set mode=lookup ${target}`);
                }
            } catch (e) {
                console.warn('[ggg-phone] switchAccount via /persona-set 失败：', e);
            }
        },
        addFriend(f) { state.friends.push(f); },
        removeFriend(id) { state.friends = state.friends.filter(x => x.id !== id); },
    };

    // 暴露给外部模块（character-cards 等）
    window.__ggg_phone_pp_store = api;
    return api;
}
