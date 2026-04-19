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

export function createPPStore(Vue) {
    const { reactive, watch } = Vue;

    if (!settings.phone) settings.phone = {};
    if (!settings.phone.pp) {
        // 首次创建时优先读酒馆当前 persona 作为默认
        const persona = readStCurrentPersona();
        settings.phone.pp = {
            me: {
                nickname: persona?.name || 'User',
                signature: '这个人很懒，什么都没写',
                ppId: '10086',
                avatar: persona?.avatarUrl || '',
                // 标记是否还在跟随酒馆 persona（用户手动改过昵称/头像后置 false）
                fromStPersona: !!persona,
            },
            friends: [],   // [{ id, nickname, avatar, group, remark, ... }]
            groups: [],    // [{ id, name, members: [...] }]
            chats: [],     // [{ id, peerType:'friend'|'group', peerId, lastTs, unread, lastPreview }]
            // 钱包 / 会员 / 装扮
            wallet: { balance: 3.0, history: [] },
            vip: { tier: 'none', expireAt: 0 },
            decorations: { theme: 'default', bubble: 'default', font: 'default' },
            favorites: [], // 收藏
        };
        saveAllSettings();
    }

    // v0.2.17：每次创建 store 时如果 me 还在跟随酒馆 persona，先用同步 fallback 即时填一次
    //   下面再异步用 ST_API 覆盖（异步路径更准确，能拿到真正的 url 和昵称）
    if (settings.phone.pp.me?.fromStPersona) {
        const personaSync = readStCurrentPersona();
        if (personaSync) {
            settings.phone.pp.me.nickname = personaSync.name || settings.phone.pp.me.nickname;
            settings.phone.pp.me.avatar = personaSync.avatarUrl || settings.phone.pp.me.avatar;
        }
    }

    const state = reactive(settings.phone.pp);

    // v0.2.17：异步用 ST_API 再覆盖一次（reactive，所以会自动触发 UI 刷新）
    if (state.me?.fromStPersona) {
        readStCurrentPersonaAsync().then(p => {
            if (!p) return;
            if (p.name) state.me.nickname = p.name;
            if (p.avatarUrl) state.me.avatar = p.avatarUrl;
        });
    }

    // 自动持久化（深 watch；轻量）
    watch(() => state, () => {
        settings.phone.pp = JSON.parse(JSON.stringify(state));
        saveAllSettings();
    }, { deep: true });

    return {
        state,
        getMe: () => state.me,
        // v0.2.21：手动切换账号 —— 用指定 persona 覆盖 me，并真正切换酒馆 persona
        async switchAccount(persona) {
            if (!persona) return;
            state.me.nickname = persona.name || state.me.nickname;
            state.me.avatar = persona.url || state.me.avatar;
            state.me.fromStPersona = true;
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
}
