function getCtx() {
    try { return (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null; } catch { return null; }
}

const DEFAULT_MEME_TAG = '未分类';

function normalizeTags(tags) {
    const out = Array.isArray(tags)
        ? tags.map(t => String(t || '').trim()).filter(Boolean)
        : [];
    return out.length ? out : [DEFAULT_MEME_TAG];
}

function normalizeSticker(item, source = 'global', forcedTag = '') {
    const name = String(item?.name || '').trim();
    const url = String(item?.url || item?.dataUrl || '').trim();
    if (!name || !url) return null;
    const tags = normalizeTags(item.tags);
    for (let i = 0; i < tags.length; i++) {
        if ((tags[i] === '{{char}}' || tags[i] === '{{user}}') && forcedTag) tags[i] = forcedTag;
    }
    return {
        ...item,
        name,
        url,
        tags,
        source,
        key: `${source}:${name}:${tags.join(',')}:${url}`,
    };
}

function getSettings() {
    try {
        return (typeof window !== 'undefined')
            ? (window.__ggg_settings || getCtx()?.extensionSettings?.ggg || null)
            : null;
    } catch { return null; }
}

function getCurrentCharacterExt() {
    try {
        const ctx = getCtx();
        const chid = ctx?.characterId;
        const ch = (ctx?.characters && chid != null) ? ctx.characters[chid] : null;
        const ext = ch?.data?.extensions || ch?.extensions || {};
        return ext.guagua_pp || ext.ggg_pp || ext.gggPP || {};
    } catch { return {}; }
}

function getCurrentCharacterName() {
    try {
        const ctx = getCtx();
        const chid = ctx?.characterId;
        const ch = (ctx?.characters && chid != null) ? ctx.characters[chid] : null;
        return ch?.name || ch?.data?.name || ctx?.name2 || '';
    } catch { return ''; }
}

function getCurrentUserName() {
    try {
        const ctx = getCtx();
        return ctx?.name1 || window.name1 || '';
    } catch { return ''; }
}

function getCurrentPersonaData(settings) {
    try {
        const ctx = getCtx();
        const pu = ctx?.powerUserSettings || ctx?.power_user || window.power_user || {};
        const personas = settings?.phone?.pp?.personas || {};
        const candidates = [
            ctx?.userAvatar,
            ctx?.user_avatar,
            pu.user_avatar,
            window.user_avatar,
            settings?.phone?.pp?.me?.avatarKey,
        ].map(v => String(v || '').trim()).filter(Boolean);
        const keys = new Set();
        candidates.forEach(raw => {
            keys.add(raw);
            keys.add(raw.endsWith('.png') ? raw : `${raw}.png`);
            keys.add(raw.replace(/\.png$/i, ''));
        });
        for (const key of keys) {
            if (personas[key]) return personas[key];
        }
        const enabled = Object.values(personas).find(p => p?.userMemesEnabled && Array.isArray(p.userMemes) && p.userMemes.length);
        return enabled || {};
    } catch { return {}; }
}

export function listStickers({ includeChar = true, includeUser = true } = {}) {
    const settings = getSettings();
    const out = [];
    (settings?.memes || []).forEach(item => {
        const s = normalizeSticker(item, 'global');
        if (s) out.push(s);
    });

    if (includeChar) {
        const ext = getCurrentCharacterExt();
        if (ext?.charMemesEnabled) {
            (ext.charMemes || []).forEach(item => {
                const s = normalizeSticker(item, 'char', getCurrentCharacterName());
                if (s) out.push(s);
            });
        }
    }

    if (includeUser) {
        const pdata = getCurrentPersonaData(settings);
        if (pdata?.userMemesEnabled) {
            (pdata.userMemes || []).forEach(item => {
                const s = normalizeSticker(item, 'user', getCurrentUserName());
                if (s) out.push(s);
            });
        }
    }

    return out;
}

export function findStickerByName(name, { tag = '', source = '', url = '' } = {}) {
    const all = listStickers();
    const target = String(name || '').trim();
    const tagName = String(tag || '').trim();
    const src = String(source || '').trim();
    const u = String(url || '').trim();
    if (u) {
        const byUrl = all.find(s => s.name === target && s.url === u);
        if (byUrl) return byUrl;
    }
    if (tagName) {
        const byTag = all.find(s => s.name === target && (s.tags || []).includes(tagName) && (!src || s.source === src));
        if (byTag) return byTag;
    }
    if (src) {
        const bySource = all.find(s => s.name === target && s.source === src);
        if (bySource) return bySource;
    }
    return all.find(s => s.name === target) || null;
}

if (typeof window !== 'undefined') {
    window.__ggg_pp_sticker_lib = { listStickers, findStickerByName };
}
