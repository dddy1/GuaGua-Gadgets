/**
 * GuaGua 角色卡 / Persona "PP 资料" 折叠面板
 *
 * 模块负责四件事：
 *   1) 在酒馆 #description_textarea / #firstmessage_textarea / #alternate_greeting_X
 *      / #persona_description 下方注入折叠面板，编辑 PP 资料
 *   2) 角色 PP 资料数据存到 character.data.extensions.guagua_pp（随 v3 角色卡 PNG 导出）
 *   3) 用户 PP 资料与手机里 me 联通：persona 切换时 me 跟随，me 改动时 persona 资料同步
 *   4) 通过 setExtensionPrompt 把当前角色的 PP 资料注入提示词，让模型知道"你在 PP 上叫什么"
 *
 * v0.2.45：把 setInterval 周期扫描改为 MutationObserver + ST 事件，
 *          DevTools 长时间打开时不再因频繁 DOM 查询导致卡顿
 */

import { settings, saveAllSettings } from '../../index.js';
import { RELEASE_MODE } from '../phone/release-flag.js';

const PROMPT_KEY_CHARACTER = 'GUAGUA_PP_CHARACTER';
const PROMPT_KEY_PERSONA   = 'GUAGUA_PP_PERSONA';
const PROMPT_KEY_GREETING  = 'GUAGUA_PP_GREETING';

let _scanTimer = null;
let _lastChid = null;
let _lastPersonaAvatar = null;
let _initialized = false;
let _observerCleanups = [];

export function initCharacterCards() {
    if (RELEASE_MODE) {
        clearCharacterCardArtifacts();
        return;
    }
    if (typeof window !== 'undefined' && typeof window.__ggg_cc_cleanup === 'function') {
        try { window.__ggg_cc_cleanup(); } catch {}
    }
    if (_initialized) return;
    _initialized = true;
    window.__ggg_cc_cleanup = cleanupCharacterCards;
    injectCss();
    bootstrapObservers();
    scheduleScan();
    // 初始注入一次提示词
    setTimeout(() => syncPromptInjection(), 800);
}

function clearCharacterCardArtifacts() {
    cleanupCharacterCards();
    document.querySelectorAll('.ggg-cc-character-card, .ggg-cc-greeting-card, .ggg-cc-persona-card').forEach(el => el.remove());
    clearPromptInjection();
}

function clearPromptInjection() {
    const ctx = getCtx();
    if (!ctx || typeof ctx.setExtensionPrompt !== 'function') return;
    try { ctx.setExtensionPrompt(PROMPT_KEY_CHARACTER, '', 1, 4); } catch {}
    try { ctx.setExtensionPrompt(PROMPT_KEY_PERSONA, '', 1, 4); } catch {}
    try { ctx.setExtensionPrompt(PROMPT_KEY_GREETING, '', 1, 4); } catch {}
}

/* ============================================================
 * 节流扫描：MutationObserver + ST 事件
 * ============================================================ */
function bootstrapObservers() {
    // 监听 body 子树变化（角色编辑器/persona 面板按需渲染）
    const obs = new MutationObserver(() => scheduleScan());
    obs.observe(document.body, { childList: true, subtree: true });
    _observerCleanups.push(() => obs.disconnect());

    // 监听 ST 事件
    try {
        const ctx = getCtx();
        const es = ctx?.eventSource;
        const types = ctx?.event_types || {};
        if (es && typeof es.on === 'function') {
            ['CHARACTER_EDITED', 'CHARACTER_PAGE_LOADED', 'CHAT_CHANGED',
             'CHARACTER_FIRST_MESSAGE_SELECTED', 'SETTINGS_LOADED_AFTER',
             'GENERATION_AFTER_COMMANDS'].forEach(name => {
                const ev = types[name] || name.toLowerCase();
                const handler = () => { scheduleScan(); syncPromptInjection(); };
                try {
                    es.on(ev, handler);
                    if (typeof es.off === 'function') _observerCleanups.push(() => es.off(ev, handler));
                    else if (typeof es.removeListener === 'function') _observerCleanups.push(() => es.removeListener(ev, handler));
                } catch {}
            });
        }
        // persona 切换专门监听
        const personaEvents = ['settings_updated', 'persona_set', 'PERSONA_CHANGED'];
        personaEvents.forEach(ev => {
            const handler = () => { syncPersonaToMe(); scheduleScan(); };
            try {
                es?.on?.(ev, handler);
                if (typeof es?.off === 'function') _observerCleanups.push(() => es.off(ev, handler));
                else if (typeof es?.removeListener === 'function') _observerCleanups.push(() => es.removeListener(ev, handler));
            } catch {}
        });
    } catch (e) { /* 静默 */ }
}

function cleanupCharacterCards() {
    if (_scanTimer) {
        clearTimeout(_scanTimer);
        _scanTimer = null;
    }
    _observerCleanups.forEach(fn => { try { fn(); } catch {} });
    _observerCleanups = [];
    _initialized = false;
    if (typeof window !== 'undefined' && window.__ggg_cc_cleanup === cleanupCharacterCards) {
        window.__ggg_cc_cleanup = null;
    }
}

function scheduleScan() {
    if (_scanTimer) return;
    _scanTimer = setTimeout(() => {
        _scanTimer = null;
        try { scan(); } catch (e) { console.warn('[ggg-cc] scan err', e); }
    }, 180);
}

function scan() {
    const cur = getCurrentCharacter();
    const chid = cur ? String(cur.chid) : '__none__';
    const personaAvatar = getActivePersonaAvatar() || '__none__';

    // 角色切换：清掉旧的 + 同步 persona ↔ me
    if (chid !== _lastChid) {
        _lastChid = chid;
        document.querySelectorAll('.ggg-cc-character-card, .ggg-cc-greeting-card').forEach(el => {
            if (el.dataset.chid !== chid) el.remove();
        });
        syncPromptInjection();
    }
    if (personaAvatar !== _lastPersonaAvatar) {
        _lastPersonaAvatar = personaAvatar;
        document.querySelectorAll('.ggg-cc-persona-card').forEach(el => {
            if (el.dataset.avatar !== personaAvatar) el.remove();
        });
        syncPersonaToMe();
        syncPromptInjection();
    }

    injectCharacterCard(cur);
    injectGreetingCards(cur);
    injectPersonaCard(personaAvatar);

    // v0.2.52：每次扫描都把当前角色 + 活跃开场白同步到手机联系人
    if (cur) syncContactsFromGreetings(cur);
}

/* ============================================================
 * 通用工具
 * ============================================================ */
function getCtx() {
    try { return window.SillyTavern?.getContext?.(); } catch { return null; }
}
function getCurrentCharacter() {
    const ctx = getCtx();
    if (!ctx) return null;
    const chid = ctx.characterId;
    if (chid == null || chid === '') return null;
    const character = ctx.characters?.[chid];
    if (!character) return null;
    return { chid, character, ctx };
}
function readCharacterExt(character) {
    return character?.data?.extensions?.guagua_pp || {};
}
async function writeCharacterExt(chid, value) {
    const ctx = getCtx();
    if (!ctx) return;
    try {
        if (typeof ctx.writeExtensionField === 'function') {
            await ctx.writeExtensionField(chid, 'guagua_pp', value);
        } else {
            const ch = ctx.characters?.[chid];
            if (ch?.data) {
                if (!ch.data.extensions) ch.data.extensions = {};
                ch.data.extensions.guagua_pp = value;
            }
            ctx.saveSettingsDebounced?.();
        }
        // 写完触发提示词重注入
        syncPromptInjection();
    } catch (e) { console.warn('[ggg-cc] writeExt 失败', e); }
}
function debounce(fn, ms = 250) {
    let t = null;
    return (...args) => {
        if (t) clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}
function escapeAttr(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
}
function escapeHtml(value) {
    return escapeAttr(value);
}
function normalizeMemeTag(value, fallback = '') {
    return String(value || fallback || '').trim();
}
function memeTagsFromItem(item, fallback = '') {
    const tags = Array.isArray(item?.tags) ? item.tags : [];
    let tag = normalizeMemeTag(tags[0] || item?.tag || fallback);
    if (tag === '{{char}}' || tag === '{{user}}') tag = normalizeMemeTag(fallback);
    return tag ? [tag] : [];
}

function applyUnifiedMemeTag(items, tag) {
    const normalized = normalizeMemeTag(tag);
    (Array.isArray(items) ? items : []).forEach(item => {
        item.tags = normalized ? [normalized] : [];
    });
}

function stripRuntimeFields(value) {
    if (Array.isArray(value)) return value.map(stripRuntimeFields);
    if (!value || typeof value !== 'object') return value;
    const out = {};
    Object.entries(value).forEach(([k, v]) => {
        if (k.startsWith('__')) return;
        out[k] = stripRuntimeFields(v);
    });
    return out;
}

function notifyStickerLibraryChanged() {
    try { window.dispatchEvent(new CustomEvent('ggg:stickers-changed')); } catch {}
}
async function askPopupInput(title, defaultValue = '', placeholder = '') {
    const base = String(defaultValue || '').trim();
    try {
        const ctx = getCtx();
        if (ctx?.callGenericPopup && ctx?.POPUP_TYPE) {
            const id = `ggg-cc-input-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const html = `
                <div class="ggg-cc-popup">
                    <div class="ggg-cc-popup-title">${escapeHtml(title)}</div>
                    <input id="${id}" class="text_pole" value="${escapeAttr(base)}" placeholder="${escapeAttr(placeholder)}">
                </div>`;
            setTimeout(() => {
                const input = document.getElementById(id);
                input?.focus();
                input?.select();
                ['keydown','keyup','keypress','input'].forEach(ev => input?.addEventListener(ev, e => e.stopPropagation()));
            }, 80);
            const ok = await ctx.callGenericPopup(html, ctx.POPUP_TYPE.CONFIRM, '', { okButton: '确定', cancelButton: '取消' });
            if (!ok) return '';
            return String(document.getElementById(id)?.value || '').trim();
        }
    } catch {}
    return String(window.prompt(title, base) || '').trim();
}
async function uploadFileToBackgrounds(file, prefix = 'ggg_meme') {
    const filename = `${prefix}_${Date.now()}_${file.name}`;
    const formData = new FormData();
    formData.append('avatar', file, filename);
    const headers = {};
    const origH = getCtx()?.getRequestHeaders?.() || {};
    for (const [k, v] of Object.entries(origH)) {
        if (String(k).toLowerCase() !== 'content-type') headers[k] = v;
    }
    const resp = await fetch('/api/backgrounds/upload', { method: 'POST', headers, body: formData });
    if (!resp.ok) throw new Error(`上传失败: ${resp.status}`);
    return { filename, url: `/backgrounds/${filename}` };
}
function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
}
function readJsonFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            try { resolve(JSON.parse(String(reader.result || ''))); }
            catch (e) { reject(e); }
        };
        reader.onerror = reject;
        reader.readAsText(file);
    });
}
function normalizePersonaAvatarKey(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.endsWith('.png') ? raw : `${raw}.png`;
}
function personaKeyVariants(value) {
    const key = normalizePersonaAvatarKey(value);
    const raw = String(value || '').trim();
    const noExt = key.replace(/\.png$/i, '');
    return Array.from(new Set([key, raw, noExt].filter(Boolean)));
}
function readPersonaProfile(personas, avatar) {
    for (const key of personaKeyVariants(avatar)) {
        if (personas[key]) return { key, data: personas[key] };
    }
    const key = normalizePersonaAvatarKey(avatar) || avatar || '__none__';
    return { key, data: personas[key] || {} };
}
function bindDrawer(wrapper) {
    const toggle = wrapper.querySelector('.inline-drawer-toggle');
    const content = wrapper.querySelector('.inline-drawer-content');
    if (!toggle || !content) return;
    content.style.display = 'none';
    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = wrapper.classList.toggle('ggg-cc-open');
        content.style.display = open ? '' : 'none';
        const icon = wrapper.querySelector('.inline-drawer-icon');
        if (icon) icon.style.transform = open ? 'rotate(180deg)' : '';
    });
}
function bindNestedActionStops(wrapper) {
    wrapper.querySelectorAll('.ggg-cc-nested-card summary button, .ggg-cc-nested-card summary label').forEach(el => {
        el.addEventListener('click', e => e.stopPropagation());
    });
}
function personaAvatarUrl(avatar) {
    const raw = String(avatar || '').trim();
    if (!raw) return '';
    if (/^(data:|https?:|\/)/i.test(raw)) return raw;
    const cleaned = raw.replace(/^User Avatars[\\/]/i, '').replace(/^User%20Avatars[\\/]/i, '');
    const name = /\.[a-z0-9]+$/i.test(cleaned) ? cleaned : `${cleaned}.png`;
    return `User Avatars/${name}`;
}
function personaAvatarFallbacks(avatar) {
    const raw = String(avatar || '').trim();
    if (!raw || /^(data:|https?:)/i.test(raw)) return [];
    const cleaned = raw.replace(/^\/?User Avatars[\\/]/i, '').replace(/^\/?User%20Avatars[\\/]/i, '');
    const name = /\.[a-z0-9]+$/i.test(cleaned) ? cleaned : `${cleaned}.png`;
    return Array.from(new Set([
        `User Avatars/${name}`,
        `User%20Avatars/${encodeURIComponent(name)}`,
        `/User%20Avatars/${encodeURIComponent(name)}`,
    ]));
}
function personaAvatarImgHtml(avatar) {
    const first = personaAvatarUrl(avatar);
    if (!first) return `<i class="fa-solid fa-user"></i>`;
    const fallbacks = personaAvatarFallbacks(avatar).filter(url => url !== first);
    const onerror = fallbacks.length
        ? `const a=JSON.parse(this.dataset.fallbacks||'[]');const n=a.shift();this.dataset.fallbacks=JSON.stringify(a);if(n){this.src=n;}else{this.onerror=null;this.replaceWith(Object.assign(document.createElement('i'),{className:'fa-solid fa-user'}));}`
        : `this.replaceWith(Object.assign(document.createElement('i'),{className:'fa-solid fa-user'}));`;
    return `<img src="${escapeAttr(first)}" data-fallbacks="${escapeAttr(JSON.stringify(fallbacks))}" onerror="${escapeAttr(onerror)}" alt="">`;
}
function normalizeImageUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (/^(data:|https?:|\/)/i.test(raw)) return raw;
    return `/backgrounds/${encodeURIComponent(raw)}`;
}
function profileCoverStyle(url) {
    const src = normalizeImageUrl(url);
    return src ? ` style="background-image:url('${escapeAttr(src)}')"` : '';
}
function imageLibraryOptions(source = 'st-bg') {
    const out = [];
    if (source === 'st-bg') {
        document.querySelectorAll('#bg_menu_content .bg_example').forEach(el => {
            const name = el.getAttribute('bgfile') || '';
            const url = normalizeImageUrl(name);
            if (url) out.push({ url, name, group: '酒馆背景' });
        });
    }
    if (source === 'gallery') {
        (settings.gallery || []).forEach(img => {
            const url = normalizeImageUrl(img?.url || img?.dataUrl || '');
            if (url) out.push({ url, name: img?.name || img?.filename || '图库图片', group: '图库' });
        });
    }
    return out;
}
function openImagePicker(wrapper, { title = '选择图片', onPick } = {}) {
    let picker = wrapper.querySelector('[data-role="profile-image-picker"]');
    if (!picker) {
        picker = document.createElement('div');
        picker.className = 'ggg-cc-image-picker';
        picker.dataset.role = 'profile-image-picker';
        wrapper.appendChild(picker);
    }
    const close = () => {
        picker.hidden = true;
        picker.innerHTML = '';
    };
    let source = 'st-bg';
    const render = () => {
        const opts = imageLibraryOptions(source);
        picker.hidden = false;
        picker.innerHTML = `
            <div class="ggg-cc-image-picker-panel">
                <div class="ggg-cc-avatar-picker-head">
                    <b>${escapeHtml(title)}</b>
                    <button type="button" class="ggg-cc-plain-icon" data-act="close-profile-image-picker" title="关闭"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="ggg-cc-image-picker-tabs">
                    <button type="button" class="${source === 'st-bg' ? 'active' : ''}" data-image-source="st-bg">酒馆背景</button>
                    <button type="button" class="${source === 'gallery' ? 'active' : ''}" data-image-source="gallery">图库</button>
                </div>
                <div class="ggg-cc-avatar-grid">
                    <button type="button" class="ggg-cc-avatar-option ggg-cc-avatar-option-empty" data-image-url="" title="清除图片">
                        <i class="fa-solid fa-ban"></i>
                        <span>清除</span>
                    </button>
                    ${opts.length ? opts.map(o => `
                        <button type="button" class="ggg-cc-avatar-option" data-image-url="${escapeAttr(o.url)}" title="${escapeAttr(o.group)} · ${escapeAttr(o.name)}">
                            <img src="${escapeAttr(o.url)}" alt="${escapeAttr(o.name)}" loading="lazy" decoding="async">
                            <span>${escapeHtml(o.name)}</span>
                        </button>
                    `).join('') : `<div class="ggg-cc-tip">没有可选图片</div>`}
                </div>
            </div>`;
        picker.querySelectorAll('[data-act="close-profile-image-picker"]').forEach(el => el.addEventListener('click', close));
        picker.querySelectorAll('[data-image-source]').forEach(btn => {
            btn.addEventListener('click', () => {
                source = btn.dataset.imageSource || 'st-bg';
                render();
            });
        });
        picker.querySelectorAll('[data-image-url]').forEach(btn => {
            btn.addEventListener('click', () => {
                onPick?.(btn.dataset.imageUrl || '');
                close();
            });
        });
    };
    render();
}

/* ============================================================
 * 角色 PP 资料卡（#description_textarea 下方）
 * ============================================================ */
function injectCharacterCard(cur) {
    const desc = document.getElementById('description_textarea');
    if (!desc || !desc.parentNode) return;
    if (!cur) return;
    if (desc.parentNode.querySelector('.ggg-cc-character-card[data-chid="' + cur.chid + '"]')) return;
    const card = buildCharacterCard(cur);
    desc.insertAdjacentElement('afterend', card);
}

function buildCharacterCard({ chid, character }) {
    const data = { ...readCharacterExt(character) };
    if (typeof data.nickname !== 'string') data.nickname = '';
    if (typeof data.signature !== 'string') data.signature = '';
    if (typeof data.coverUrl !== 'string') data.coverUrl = '';
    if (typeof data.avatarUrl !== 'string') data.avatarUrl = '';
    if (typeof data.altEnabled !== 'boolean') data.altEnabled = false;
    if (typeof data.altNickname !== 'string') data.altNickname = '';
    if (typeof data.currency !== 'string') data.currency = '¥';
    if (typeof data.languages !== 'string') data.languages = '';
    if (typeof data.charMemesEnabled !== 'boolean') data.charMemesEnabled = false;
    if (typeof data.charMemesTag !== 'string') data.charMemesTag = '';
    if (!Array.isArray(data.charMemes)) data.charMemes = [];
    data.charMemes.forEach(m => { m.tags = memeTagsFromItem(m, character?.name || ''); });
    data.charMemesTag = normalizeMemeTag(data.charMemesTag || data.charMemes.find(m => (m.tags || [])[0])?.tags?.[0] || '');
    applyUnifiedMemeTag(data.charMemes, data.charMemesTag);

    const wrapper = document.createElement('div');
    wrapper.className = 'ggg-cc-character-card ggg-cc-card inline-drawer wide100p';
    wrapper.dataset.chid = String(chid);
    wrapper.innerHTML = `
        <div class="inline-drawer-toggle inline-drawer-header">
            <b><i class="fa-solid fa-id-card"></i> 呱呱手机 · 角色 PP 资料</b>
            <div class="fa-solid fa-circle-chevron-down inline-drawer-icon down"></div>
        </div>
        <div class="inline-drawer-content ggg-cc-body">
            <div class="ggg-cc-profile-shell">
                <div class="ggg-cc-profile-view" data-role="profile-view">
                    <div class="ggg-cc-profile-cover"${profileCoverStyle(data.coverUrl)}></div>
                    <div class="ggg-cc-profile-main">
                        <div class="ggg-cc-profile-avatar">
                            ${data.avatarUrl ? `<img src="${escapeAttr(data.avatarUrl)}" alt="">` : `<i class="fa-solid fa-user"></i>`}
                        </div>
                        <div class="ggg-cc-profile-copy">
                            <div class="ggg-cc-profile-name" data-role="profile-name">${escapeHtml(data.nickname || character?.name || '角色')}</div>
                            <div class="ggg-cc-profile-sub" data-role="profile-sig">${escapeHtml(data.signature || '还没有签名')}</div>
                            <div class="ggg-cc-profile-tags" data-role="profile-tags"></div>
                        </div>
                        <div class="ggg-cc-profile-menu">
                            <button type="button" class="ggg-cc-dot-btn" data-act="toggle-profile-menu" title="更多"><i class="fa-solid fa-ellipsis"></i></button>
                            <div class="ggg-cc-profile-menu-pop" data-role="profile-menu" hidden>
                                <button type="button" data-act="edit-profile"><i class="fa-solid fa-pen"></i> 编辑信息</button>
                                <button type="button" data-act="pick-profile-cover"><i class="fa-solid fa-images"></i> 选择背景图片</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="ggg-cc-profile-edit" data-role="profile-edit" hidden>
                    <label class="ggg-cc-row"><span class="ggg-cc-label">昵称</span>
                        <input type="text" class="text_pole" data-f="nickname" placeholder="不填则用角色名"></label>
                    <label class="ggg-cc-row"><span class="ggg-cc-label">签名</span>
                        <input type="text" class="text_pole" data-f="signature" placeholder="例：今天也是元气满满的一天"></label>
                    <label class="ggg-cc-row"><span class="ggg-cc-label">头像 URL</span>
                        <input type="text" class="text_pole" data-f="avatarUrl" placeholder="留空则用角色卡头像"></label>
                    <label class="ggg-cc-row ggg-cc-checkbox">
                        <input type="checkbox" data-f="altEnabled"><span>启用小号功能</span></label>
                    <label class="ggg-cc-row ggg-cc-altrow" style="display:none;">
                        <span class="ggg-cc-label">小号昵称</span>
                        <input type="text" class="text_pole" data-f="altNickname" placeholder="小号对外显示的名字"></label>
                    <label class="ggg-cc-row"><span class="ggg-cc-label">转账币种</span>
                        <select class="text_pole" data-f="currency">
                            <option value="¥">¥ 人民币</option>
                            <option value="$">$ 美元</option>
                            <option value="€">€ 欧元</option>
                            <option value="£">£ 英镑</option>
                            <option value="₽">₽ 卢布</option>
                            <option value="₩">₩ 韩元</option>
                            <option value="¥JP">¥ 日元</option>
                        </select></label>
                    <label class="ggg-cc-row"><span class="ggg-cc-label">常用语言</span>
                        <input type="text" class="text_pole" data-f="languages" placeholder="例：中文、English、日本語（用顿号或逗号分隔）"></label>
                    <div class="ggg-cc-row"><span></span><button type="button" class="ggg-cc-plain-icon" data-act="done-profile" title="完成"><i class="fa-solid fa-check"></i></button></div>
                </div>
            </div>
            <label class="ggg-cc-row ggg-cc-checkbox">
                <input type="checkbox" data-f="charMemesEnabled"><span>使用角色表情包</span></label>
            <details class="ggg-cc-nested-card ggg-cc-memes-block">
                <summary>
                    <span><i class="fa-solid fa-face-smile"></i> 角色表情包</span>
                    <span class="ggg-cc-actions">
                        <button type="button" class="menu_button ggg-cc-icon-btn" data-act="add-char-meme" title="添加表情包"><i class="fa-solid fa-plus"></i></button>
                        <button type="button" class="menu_button ggg-cc-icon-btn" data-act="toggle-char-meme-bulk" title="批量编辑"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button type="button" class="menu_button ggg-cc-icon-btn" data-act="export-char-meme" title="导出 URL 表情包"><i class="fa-solid fa-file-export"></i></button>
                        <label class="menu_button ggg-cc-icon-btn" title="导入 URL 表情包">
                            <i class="fa-solid fa-file-import"></i>
                            <input type="file" accept="application/json,.json" data-act="import-char-meme" style="display:none;">
                        </label>
                    </span>
                </summary>
                <div class="ggg-cc-nested-body">
                    <label class="ggg-cc-row">
                        <span class="ggg-cc-label">统一 tag</span>
                        <input type="text" class="text_pole" data-f="charMemesTag" placeholder="留空则归入 未分类">
                    </label>
                    <div class="ggg-cc-meme-list" data-role="char-meme-list"></div>
                </div>
            </details>
            <div class="ggg-cc-tip">数据会随角色卡 PNG 一起导出，并自动注入到提示词中</div>
        </div>
    `;
    wrapper.querySelectorAll('[data-f]').forEach(el => {
        const k = el.dataset.f;
        if (el.type === 'checkbox') el.checked = !!data[k];
        else el.value = data[k] ?? '';
    });
    wrapper.querySelector('.ggg-cc-altrow').style.display = data.altEnabled ? '' : 'none';
    const renderProfileView = () => {
        const name = wrapper.querySelector('[data-role="profile-name"]');
        const sig = wrapper.querySelector('[data-role="profile-sig"]');
        const tags = wrapper.querySelector('[data-role="profile-tags"]');
        const avatar = wrapper.querySelector('.ggg-cc-profile-avatar');
        const cover = wrapper.querySelector('.ggg-cc-profile-cover');
        if (name) name.textContent = data.nickname || character?.name || '角色';
        if (sig) sig.textContent = data.signature || '还没有签名';
        if (tags) tags.innerHTML = [
            data.currency ? `<span>${escapeHtml(data.currency)}</span>` : '',
            data.languages ? `<span>${escapeHtml(data.languages)}</span>` : '',
            data.altEnabled ? `<span>小号</span>` : '',
        ].filter(Boolean).join('');
        if (avatar) avatar.innerHTML = data.avatarUrl ? `<img src="${escapeAttr(data.avatarUrl)}" alt="">` : `<i class="fa-solid fa-user"></i>`;
        if (cover) cover.style.backgroundImage = data.coverUrl ? `url("${normalizeImageUrl(data.coverUrl).replace(/"/g, '\\"')}")` : '';
    };
    const setProfileEditing = (editing) => {
        const view = wrapper.querySelector('[data-role="profile-view"]');
        const edit = wrapper.querySelector('[data-role="profile-edit"]');
        if (view) view.hidden = !!editing;
        if (edit) edit.hidden = !editing;
        if (!editing) renderProfileView();
    };
    const closeProfileMenu = () => {
        const menu = wrapper.querySelector('[data-role="profile-menu"]');
        if (menu) menu.hidden = true;
    };
    wrapper.querySelector('[data-act="toggle-profile-menu"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = wrapper.querySelector('[data-role="profile-menu"]');
        if (menu) menu.hidden = !menu.hidden;
    });
    wrapper.querySelector('[data-act="edit-profile"]')?.addEventListener('click', () => {
        closeProfileMenu();
        setProfileEditing(true);
    });
    wrapper.querySelector('[data-act="pick-profile-cover"]')?.addEventListener('click', () => {
        closeProfileMenu();
        openImagePicker(wrapper, {
            title: '选择资料背景图片',
            onPick: (url) => {
                data.coverUrl = url;
                renderProfileView();
                save();
            },
        });
    });
    wrapper.querySelector('[data-act="done-profile"]')?.addEventListener('click', () => {
        setProfileEditing(false);
        save();
    });
    renderProfileView();

    const save = debounce(async () => {
        const fullExt = { ...readCharacterExt(getCtx()?.characters?.[chid]) };
        Object.assign(fullExt, stripRuntimeFields(data));
        await writeCharacterExt(chid, fullExt);
        notifyStickerLibraryChanged();
    });
    let charMemeBulkMode = false;
    let charMemeSelected = new Set();
    const renderCharMemes = () => {
        const list = wrapper.querySelector('[data-role="char-meme-list"]');
        if (!list) return;
        if (!data.charMemes.length) {
            charMemeSelected = new Set();
            list.innerHTML = `<div class="ggg-cc-tip">还没有角色表情包</div>`;
            return;
        }
        charMemeSelected = new Set([...charMemeSelected].filter(i => data.charMemes[i]));
        const bulkBar = charMemeBulkMode ? `
            <div class="ggg-cc-bulkbar">
                <button type="button" class="menu_button ggg-cc-icon-btn" data-act="select-all-char-meme" title="全选"><i class="fa-solid fa-check-double"></i></button>
                <button type="button" class="menu_button ggg-cc-icon-btn" data-act="clear-char-meme-selection" title="取消选择"><i class="fa-solid fa-xmark"></i></button>
                <button type="button" class="menu_button ggg-cc-icon-btn ggg-cc-danger-btn" data-act="delete-selected-char-meme" title="删除选中"><i class="fa-solid fa-trash"></i></button>
                <span>${charMemeSelected.size} 已选</span>
            </div>` : '';
        list.innerHTML = bulkBar + data.charMemes.map((m, i) => `
            <div class="ggg-cc-meme-row ${m.__editing ? 'is-editing' : ''}" data-index="${i}">
                ${m.__editing ? `
                    <div class="ggg-cc-row">
                        <span class="ggg-cc-label">名称</span>
                        <input type="text" class="text_pole" data-meme-f="name" value="${escapeAttr(m.name || '')}" placeholder="表情包名">
                    </div>
                    <div class="ggg-cc-row">
                        <span class="ggg-cc-label">URL</span>
                        <input type="text" class="text_pole" data-meme-f="url" value="${escapeAttr(m.url || '')}" placeholder="https://...">
                    </div>
                    <div class="ggg-cc-row">
                        <span></span>
                        <button type="button" class="menu_button ggg-cc-icon-btn" data-act="done-char-meme" title="完成"><i class="fa-solid fa-check"></i></button>
                    </div>
                ` : `
                    <div class="ggg-cc-meme-preview ${charMemeBulkMode ? 'is-bulk' : ''}" data-act="${charMemeBulkMode ? 'toggle-char-meme-select' : ''}">
                        ${charMemeBulkMode ? `<span class="ggg-cc-select-mark ${charMemeSelected.has(i) ? 'selected' : ''}"><i class="fa-solid fa-check"></i></span>` : ''}
                        ${m.url ? `<img src="${escapeAttr(m.url)}" alt="${escapeAttr(m.name || '表情包')}">` : `<div class="ggg-cc-meme-empty"><i class="fa-solid fa-image"></i></div>`}
                        <div class="ggg-cc-meme-name">${escapeHtml(m.name || '未命名')}</div>
                        ${charMemeBulkMode ? '' : `<button type="button" class="ggg-cc-dot-btn ggg-cc-meme-edit" data-act="edit-char-meme" title="编辑"><i class="fa-solid fa-ellipsis"></i></button>`}
                    </div>
                `}
            </div>
        `).join('');
        list.querySelectorAll('[data-meme-f]').forEach(el => {
            el.addEventListener('input', () => {
                const row = el.closest('.ggg-cc-meme-row');
                const item = data.charMemes[Number(row?.dataset.index)];
                if (!item) return;
                item[el.dataset.memeF] = el.value;
                item.tags = memeTagsFromItem({ tags: [data.charMemesTag] });
                save();
            });
        });
        list.querySelectorAll('[data-act="toggle-char-meme-select"]').forEach(el => {
            el.addEventListener('click', () => {
                const row = el.closest('.ggg-cc-meme-row');
                const index = Number(row?.dataset.index);
                if (charMemeSelected.has(index)) charMemeSelected.delete(index);
                else charMemeSelected.add(index);
                renderCharMemes();
            });
        });
        list.querySelector('[data-act="select-all-char-meme"]')?.addEventListener('click', () => {
            charMemeSelected = new Set(data.charMemes.map((_, i) => i));
            renderCharMemes();
        });
        list.querySelector('[data-act="clear-char-meme-selection"]')?.addEventListener('click', () => {
            charMemeSelected = new Set();
            renderCharMemes();
        });
        list.querySelector('[data-act="delete-selected-char-meme"]')?.addEventListener('click', () => {
            if (!charMemeSelected.size) return;
            if (!confirm(`确定删除选中的 ${charMemeSelected.size} 个角色表情包吗？`)) return;
            [...charMemeSelected].sort((a, b) => b - a).forEach(i => data.charMemes.splice(i, 1));
            charMemeSelected = new Set();
            renderCharMemes();
            save();
        });
        list.querySelectorAll('[data-act="remove-char-meme"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('.ggg-cc-meme-row');
                data.charMemes.splice(Number(row?.dataset.index), 1);
                renderCharMemes();
                save();
            });
        });
        list.querySelectorAll('[data-act="edit-char-meme"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('.ggg-cc-meme-row');
                const item = data.charMemes[Number(row?.dataset.index)];
                if (!item) return;
                item.__editing = true;
                renderCharMemes();
            });
        });
        list.querySelectorAll('[data-act="done-char-meme"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('.ggg-cc-meme-row');
                const item = data.charMemes[Number(row?.dataset.index)];
                if (!item) return;
                item.__editing = false;
                renderCharMemes();
                save();
            });
        });
    };
    wrapper.querySelector('[data-act="add-char-meme"]')?.addEventListener('click', () => {
        data.charMemes.unshift({ name: '', url: '', tags: memeTagsFromItem({ tags: [data.charMemesTag] }), __editing: true });
        renderCharMemes();
        save();
    });
    wrapper.querySelector('[data-act="toggle-char-meme-bulk"]')?.addEventListener('click', (e) => {
        charMemeBulkMode = !charMemeBulkMode;
        charMemeSelected = new Set();
        e.currentTarget?.classList.toggle('active', charMemeBulkMode);
        renderCharMemes();
    });
    wrapper.querySelector('[data-act="export-char-meme"]')?.addEventListener('click', () => {
        const urlOnly = data.charMemes
            .filter(m => /^https?:\/\//i.test(String(m.url || '')) || String(m.url || '').startsWith('/'))
            .map(m => ({ name: m.name || '', url: m.url || '', tags: memeTagsFromItem({ tags: [data.charMemesTag] }) }));
        downloadJson(`char-memes-${character?.name || 'character'}.json`, { version: 1, type: 'charMemes', memes: urlOnly });
    });
    wrapper.querySelector('[data-act="import-char-meme"]')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const obj = await readJsonFile(file);
            const imported = Array.isArray(obj?.memes) ? obj.memes : Array.isArray(obj) ? obj : [];
            imported.slice().reverse().forEach(m => {
                const name = String(m?.name || '').trim();
                const url = String(m?.url || '').trim();
                if (!name || !url || /^data:/i.test(url)) return;
                data.charMemes.unshift({ name, url, tags: memeTagsFromItem({ tags: [data.charMemesTag] }) });
            });
            renderCharMemes();
            save();
        } catch { alert('导入失败：JSON 格式不正确'); }
        e.target.value = '';
    });
    bindNestedActionStops(wrapper);
    renderCharMemes();
    wrapper.querySelectorAll('[data-f]').forEach(el => {
        const handler = () => {
            const k = el.dataset.f;
            if (el.type === 'checkbox') data[k] = el.checked;
            else data[k] = el.value;
            if (k === 'altEnabled') {
                wrapper.querySelector('.ggg-cc-altrow').style.display = el.checked ? '' : 'none';
            }
            if (k === 'charMemesTag') applyUnifiedMemeTag(data.charMemes, data.charMemesTag);
            save();
        };
        el.addEventListener('input', handler);
        el.addEventListener('change', handler);
    });
    bindDrawer(wrapper);
    return wrapper;
}

/* ============================================================
 * 开场白好友关系卡 + "导入到手机联系人" 按钮
 * ============================================================ */
const FRIENDSHIP_OPTIONS = [
    { v: 'friend',        l: '好友' },
    { v: 'nonfriend',     l: '非好友' },
    { v: 'blocked_me',    l: '被{{user}}拉黑' },
    { v: 'blocked_by_me', l: '已拉黑{{user}}' },
];

function injectGreetingCards(cur) {
    if (!cur) return;
    const targets = [];
    const fm = document.getElementById('firstmessage_textarea');
    if (fm) targets.push({ el: fm, key: 'first' });
    document.querySelectorAll('textarea[id^="alternate_greeting_"]').forEach(el => {
        const m = el.id.match(/^alternate_greeting_(\d+)$/);
        if (m) targets.push({ el, key: m[1] });
    });
    targets.forEach(({ el, key }) => {
        const parent = el.parentNode;
        if (!parent) return;
        if (parent.querySelector(`.ggg-cc-greeting-card[data-key="${key}"][data-chid="${cur.chid}"]`)) return;
        const card = buildGreetingCard(cur, key);
        el.insertAdjacentElement('afterend', card);
    });
}

function buildGreetingCard({ chid, character }, key) {
    const ext = readCharacterExt(character);
    const data = { ...((ext.greetings || {})[key] || {}) };
    if (typeof data.friendship !== 'string') data.friendship = 'nonfriend';
    if (typeof data.friendshipNote !== 'string') data.friendshipNote = '';
    if (typeof data.applyAsContact !== 'boolean') data.applyAsContact = false;

    const wrapper = document.createElement('div');
    wrapper.className = 'ggg-cc-greeting-card ggg-cc-card inline-drawer wide100p';
    wrapper.dataset.chid = String(chid);
    wrapper.dataset.key = key;
    const title = key === 'first' ? '初始开场白' : `备用开场白 #${Number(key) + 1}`;
    wrapper.innerHTML = `
        <div class="inline-drawer-toggle inline-drawer-header">
            <b><i class="fa-solid fa-user-group"></i> 呱呱手机 · ${title} · 好友关系</b>
            <div class="fa-solid fa-circle-chevron-down inline-drawer-icon down"></div>
        </div>
        <div class="inline-drawer-content ggg-cc-body">
            <label class="ggg-cc-row"><span class="ggg-cc-label">关系</span>
                <select class="text_pole" data-f="friendship">
                    ${FRIENDSHIP_OPTIONS.map(o => `<option value="${o.v}">${o.l}</option>`).join('')}
                </select></label>
            <label class="ggg-cc-row"><span class="ggg-cc-label">备注</span>
                <input type="text" class="text_pole" data-f="friendshipNote" placeholder="例：青梅竹马，从小一起长大"></label>
            <label class="ggg-cc-row ggg-cc-checkbox">
                <input type="checkbox" data-f="applyAsContact">
                <span>启用此开场白时，自动加入手机好友列表</span></label>
        </div>
    `;
    wrapper.querySelectorAll('[data-f]').forEach(el => {
        if (el.type === 'checkbox') el.checked = !!data[el.dataset.f];
        else el.value = data[el.dataset.f] ?? '';
    });

    const save = debounce(async () => {
        const cur = getCurrentCharacter();
        if (!cur) return;
        const fullExt = { ...readCharacterExt(cur.character) };
        const grs = { ...(fullExt.greetings || {}) };
        grs[key] = { ...data };
        fullExt.greetings = grs;
        await writeCharacterExt(cur.chid, fullExt);
        syncContactsFromGreetings(cur);
    });
    wrapper.querySelectorAll('[data-f]').forEach(el => {
        const handler = () => {
            if (el.type === 'checkbox') data[el.dataset.f] = el.checked;
            else data[el.dataset.f] = el.value;
            save();
        };
        el.addEventListener('input', handler);
        el.addEventListener('change', handler);
    });
    bindDrawer(wrapper);
    return wrapper;
}

/* v0.2.58：扫描当前角色 + 活跃开场白 → 写到当前聊天元数据
 *   规则：
 *     - friend       → 加入好友列表（group=friend）
 *     - blocked_me   → 加入黑名单（group=blocked_me；表示用户拉黑了对方）
 *     - blocked_by_me→ 加入"对方拉黑你"列表（group=blocked_by_me；用户尝试加好友会失败）
 *     - nonfriend    → 不加入（若已存在则移除）
 *   联系人不再写入 settings.phone.pp.friends，避免跨聊天/跨角色污染。
 */
async function syncContactsFromGreetings(cur) {
    if (!cur) return;
    const ctx = getCtx();
    const ext = readCharacterExt(cur.character);
    const grs = ext.greetings || {};
    if (!settings.phone) settings.phone = {};
    if (!settings.phone.pp) settings.phone.pp = {};
    settings.phone.pp.friends = [];

    const charName = cur.character?.name || cur.character?.data?.name || '角色';
    const baseId = `char_${cur.chid}`;
    const friends = [];
    const upsert = (friend) => {
        const idx = friends.findIndex(f => f.id === friend.id);
        if (idx >= 0) friends[idx] = { ...friends[idx], ...friend };
        else friends.push(friend);
    };

    // 1. 当前活跃 greeting：按关系写入当前聊天联系人
    const activeKey = detectActiveGreetingKey(cur, ctx);
    const active = grs[activeKey];
    const activeId = `${baseId}_active`;
    if (active && active.friendship && active.friendship !== 'nonfriend') {
        upsert({
            id: activeId,
            nickname: ext.nickname || charName,
            avatar: ext.avatarUrl || '',
            signature: ext.signature || '',
            group: active.friendship,
            remark: active.friendshipNote || '',
            fromCharacter: cur.chid,
            greetingKey: activeKey,
            auto: true,
        });
    }

    // 2. 兼容旧路径：勾选 applyAsContact 的 greeting 也写入当前聊天
    Object.entries(grs).forEach(([key, g]) => {
        if (!g?.applyAsContact) return;
        if (String(key) === String(activeKey)) return;
        if ((g.friendship || 'friend') === 'nonfriend') return;
        upsert({
            id: `${baseId}_g${key}`,
            nickname: ext.nickname || charName,
            avatar: ext.avatarUrl || '',
            signature: ext.signature || '',
            group: g.friendship || 'friend',
            remark: g.friendshipNote || '',
            fromCharacter: cur.chid,
            greetingKey: key,
        });
    });

    if (ctx) {
        if (!ctx.chatMetadata) ctx.chatMetadata = {};
        ctx.chatMetadata.gggPPContacts = {
            version: 1,
            friends,
            source: 'character-greeting',
            updatedAt: Date.now(),
        };
        try {
            if (typeof ctx.saveMetadata === 'function') await ctx.saveMetadata();
            else if (typeof window.saveMetadata === 'function') await window.saveMetadata();
            else if (typeof window.saveChatConditional === 'function') await window.saveChatConditional();
        } catch (e) {
            console.warn('[ggg-cc] 保存 PP 聊天联系人失败：', e);
        }
    }
    try { window.__ggg_phone_pp_store?.setChatContacts?.(friends); } catch {}
    saveAllSettings();
}

/* ============================================================
 * Persona 用户 PP 资料卡 + me 双向同步
 * ============================================================ */
function getActivePersonaAvatar() {
    const ctx = getCtx();
    return ctx?.userAvatar || ctx?.user_avatar || window.user_avatar || '';
}
function ensurePersonaStore() {
    if (!settings.phone) settings.phone = {};
    if (!settings.phone.pp) settings.phone.pp = {};
    if (!settings.phone.pp.personas) settings.phone.pp.personas = {};
    return settings.phone.pp.personas;
}

function injectPersonaCard(personaAvatar) {
    const desc = document.getElementById('persona_description');
    if (!desc || !desc.parentNode) return;
    if (desc.parentNode.querySelector(`.ggg-cc-persona-card[data-avatar="${personaAvatar}"]`)) return;
    desc.parentNode.classList.add('ggg-cc-persona-host');
    const card = buildPersonaCard(personaAvatar);
    desc.insertAdjacentElement('afterend', card);
}

function buildPersonaCard(avatar) {
    const personas = ensurePersonaStore();
    const profile = readPersonaProfile(personas, avatar);
    const data = { ...(profile.data || {}) };
    if (typeof data.nickname !== 'string') data.nickname = '';
    if (typeof data.signature !== 'string') data.signature = '';
    if (typeof data.coverUrl !== 'string') data.coverUrl = '';
    if (typeof data.currency !== 'string') data.currency = '¥';
    if (typeof data.languages !== 'string') data.languages = '';
    if (typeof data.userMemesEnabled !== 'boolean') data.userMemesEnabled = false;
    if (typeof data.userMemesTag !== 'string') data.userMemesTag = '';
    if (!Array.isArray(data.userMemes)) data.userMemes = [];
    data.userMemes.forEach(m => { m.tags = memeTagsFromItem(m, getCtx()?.name1 || window.name1 || ''); });
    data.userMemesTag = normalizeMemeTag(data.userMemesTag || data.userMemes.find(m => (m.tags || [])[0])?.tags?.[0] || '');
    applyUnifiedMemeTag(data.userMemes, data.userMemesTag);
    if (!Array.isArray(data.friends)) {
        data.friends = String(data.friendsText || '')
            .split(/\r?\n/)
            .map(s => s.trim())
            .filter(Boolean)
            .map(line => {
                const parts = line.split('|').map(s => s.trim());
                return { nickname: parts[0] || '', avatar: parts[1] || '', remark: parts[2] || '' };
            });
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'ggg-cc-persona-card ggg-cc-card inline-drawer wide100p';
    wrapper.dataset.avatar = avatar || '__none__';
    wrapper.innerHTML = `
        <div class="inline-drawer-toggle inline-drawer-header">
            <b><i class="fa-solid fa-user-tag"></i> 呱呱手机 · 用户 PP 资料</b>
            <div class="fa-solid fa-circle-chevron-down inline-drawer-icon down"></div>
        </div>
        <div class="inline-drawer-content ggg-cc-body">
            <div class="ggg-cc-profile-shell">
                <div class="ggg-cc-profile-view" data-role="profile-view">
                    <div class="ggg-cc-profile-cover"${profileCoverStyle(data.coverUrl)}></div>
                    <div class="ggg-cc-profile-main">
                        <div class="ggg-cc-profile-avatar">
                            ${personaAvatarImgHtml(avatar)}
                        </div>
                        <div class="ggg-cc-profile-copy">
                            <div class="ggg-cc-profile-name" data-role="profile-name">${escapeHtml(data.nickname || getCtx()?.name1 || window.name1 || '用户')}</div>
                            <div class="ggg-cc-profile-sub" data-role="profile-sig">${escapeHtml(data.signature || '还没有签名')}</div>
                            <div class="ggg-cc-profile-tags" data-role="profile-tags"></div>
                        </div>
                        <div class="ggg-cc-profile-menu">
                            <button type="button" class="ggg-cc-dot-btn" data-act="toggle-profile-menu" title="更多"><i class="fa-solid fa-ellipsis"></i></button>
                            <div class="ggg-cc-profile-menu-pop" data-role="profile-menu" hidden>
                                <button type="button" data-act="edit-profile"><i class="fa-solid fa-pen"></i> 编辑信息</button>
                                <button type="button" data-act="pick-profile-cover"><i class="fa-solid fa-images"></i> 选择背景图片</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="ggg-cc-profile-edit" data-role="profile-edit" hidden>
                    <label class="ggg-cc-row"><span class="ggg-cc-label">昵称</span>
                        <input type="text" class="text_pole" data-f="nickname" placeholder="不填则用 persona 名字"></label>
                    <label class="ggg-cc-row"><span class="ggg-cc-label">签名</span>
                        <input type="text" class="text_pole" data-f="signature" placeholder="例：在线等回复"></label>
                    <label class="ggg-cc-row"><span class="ggg-cc-label">转账币种</span>
                        <select class="text_pole" data-f="currency">
                            <option value="¥">¥ 人民币</option>
                            <option value="$">$ 美元</option>
                            <option value="€">€ 欧元</option>
                            <option value="£">£ 英镑</option>
                            <option value="₽">₽ 卢布</option>
                            <option value="₩">₩ 韩元</option>
                            <option value="¥JP">¥ 日元</option>
                        </select></label>
                    <label class="ggg-cc-row"><span class="ggg-cc-label">常用语言</span>
                        <input type="text" class="text_pole" data-f="languages" placeholder="例：中文、English、日本語（用顿号或逗号分隔）"></label>
                    <div class="ggg-cc-row"><span></span><button type="button" class="ggg-cc-plain-icon" data-act="done-profile" title="完成"><i class="fa-solid fa-check"></i></button></div>
                </div>
            </div>
            <label class="ggg-cc-row ggg-cc-checkbox">
                <input type="checkbox" data-f="userMemesEnabled"><span>注入并显示用户表情包</span></label>
            <details class="ggg-cc-nested-card ggg-cc-memes-block">
                <summary>
                    <span><i class="fa-solid fa-face-smile"></i> 用户表情包</span>
                    <span class="ggg-cc-actions">
                        <button type="button" class="menu_button ggg-cc-icon-btn" data-act="add-user-meme" title="添加 URL 表情包"><i class="fa-solid fa-plus"></i></button>
                        <button type="button" class="menu_button ggg-cc-icon-btn" data-act="toggle-user-meme-bulk" title="批量编辑"><i class="fa-solid fa-pen-to-square"></i></button>
                        <label class="menu_button ggg-cc-icon-btn" title="本地上传">
                            <i class="fa-solid fa-upload"></i>
                            <input type="file" accept="image/*" data-act="upload-user-meme" style="display:none;">
                        </label>
                        <button type="button" class="menu_button ggg-cc-icon-btn" data-act="export-user-meme" title="导出 URL 表情包"><i class="fa-solid fa-file-export"></i></button>
                        <label class="menu_button ggg-cc-icon-btn" title="导入 URL 表情包">
                            <i class="fa-solid fa-file-import"></i>
                            <input type="file" accept="application/json,.json" data-act="import-user-meme" style="display:none;">
                        </label>
                    </span>
                </summary>
                <div class="ggg-cc-nested-body">
                    <label class="ggg-cc-row">
                        <span class="ggg-cc-label">统一 tag</span>
                        <input type="text" class="text_pole" data-f="userMemesTag" placeholder="留空则归入 未分类">
                    </label>
                    <div class="ggg-cc-meme-list" data-role="user-meme-list"></div>
                </div>
            </details>
            <div class="ggg-cc-friends-block">
                <details class="ggg-cc-nested-card ggg-cc-friends-drawer" open>
                    <summary>
                        <span><i class="fa-solid fa-user-group"></i> PP好友</span>
                        <span class="ggg-cc-actions">
                            <button type="button" class="menu_button ggg-cc-icon-btn" data-act="add-friend" title="添加好友"><i class="fa-solid fa-user-plus"></i></button>
                        </span>
                    </summary>
                    <div class="ggg-cc-nested-body">
                        <div class="ggg-cc-friend-list" data-role="friend-list"></div>
                    </div>
                </details>
            </div>
            <div class="ggg-cc-avatar-picker" data-role="friend-avatar-picker" hidden></div>
            <div class="ggg-cc-tip">和手机里的"我"完全联通：persona 切换 → 手机账号自动换，反之亦然</div>
        </div>
    `;
    wrapper.querySelectorAll('[data-f]').forEach(el => {
        if (el.closest('.ggg-cc-friend-row')) return;
        if (el.type === 'checkbox') el.checked = !!data[el.dataset.f];
        else el.value = data[el.dataset.f] ?? '';
    });
    const renderProfileView = () => {
        const name = wrapper.querySelector('[data-role="profile-name"]');
        const sig = wrapper.querySelector('[data-role="profile-sig"]');
        const tags = wrapper.querySelector('[data-role="profile-tags"]');
        const cover = wrapper.querySelector('.ggg-cc-profile-cover');
        if (name) name.textContent = data.nickname || getCtx()?.name1 || window.name1 || '用户';
        if (sig) sig.textContent = data.signature || '还没有签名';
        if (tags) tags.innerHTML = [
            data.currency ? `<span>${escapeHtml(data.currency)}</span>` : '',
            data.languages ? `<span>${escapeHtml(data.languages)}</span>` : '',
            data.userMemesEnabled ? `<span>表情包</span>` : '',
        ].filter(Boolean).join('');
        if (cover) cover.style.backgroundImage = data.coverUrl ? `url("${normalizeImageUrl(data.coverUrl).replace(/"/g, '\\"')}")` : '';
    };
    const setProfileEditing = (editing) => {
        const view = wrapper.querySelector('[data-role="profile-view"]');
        const edit = wrapper.querySelector('[data-role="profile-edit"]');
        if (view) view.hidden = !!editing;
        if (edit) edit.hidden = !editing;
        if (!editing) renderProfileView();
    };
    const closeProfileMenu = () => {
        const menu = wrapper.querySelector('[data-role="profile-menu"]');
        if (menu) menu.hidden = true;
    };
    wrapper.querySelector('[data-act="toggle-profile-menu"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = wrapper.querySelector('[data-role="profile-menu"]');
        if (menu) menu.hidden = !menu.hidden;
    });
    wrapper.querySelector('[data-act="edit-profile"]')?.addEventListener('click', () => {
        closeProfileMenu();
        setProfileEditing(true);
    });
    wrapper.querySelector('[data-act="pick-profile-cover"]')?.addEventListener('click', () => {
        closeProfileMenu();
        openImagePicker(wrapper, {
            title: '选择资料背景图片',
            onPick: (url) => {
                data.coverUrl = url;
                renderProfileView();
                save();
            },
        });
    });
    wrapper.querySelector('[data-act="done-profile"]')?.addEventListener('click', () => {
        setProfileEditing(false);
        save();
    });
    renderProfileView();

    const save = debounce(() => {
        delete data.friendsText;
        personas[profile.key] = stripRuntimeFields(data);
        if (profile.key !== avatar && personas[avatar]) delete personas[avatar];
        // v0.2.47：写完资料卡后让 store（如果手机已开）重新基于 ST persona+PP 数据重算 me
        try { window.__ggg_phone_pp_store?.rebuildMe?.(); } catch {}
        try { window.__ggg_phone_pp_store?.refreshContacts?.(); } catch {}
        // 同步到 settings.phone.pp.me（保证手机未开时下次打开也对）
        syncPersonaToMe();
        saveAllSettings();
        syncPromptInjection();
        notifyStickerLibraryChanged();
    });
    let userMemeBulkMode = false;
    let userMemeSelected = new Set();
    const renderUserMemes = () => {
        const list = wrapper.querySelector('[data-role="user-meme-list"]');
        if (!list) return;
        if (!data.userMemes.length) {
            userMemeSelected = new Set();
            list.innerHTML = `<div class="ggg-cc-tip">还没有用户表情包</div>`;
            return;
        }
        userMemeSelected = new Set([...userMemeSelected].filter(i => data.userMemes[i]));
        const bulkBar = userMemeBulkMode ? `
            <div class="ggg-cc-bulkbar">
                <button type="button" class="menu_button ggg-cc-icon-btn" data-act="select-all-user-meme" title="全选"><i class="fa-solid fa-check-double"></i></button>
                <button type="button" class="menu_button ggg-cc-icon-btn" data-act="clear-user-meme-selection" title="取消选择"><i class="fa-solid fa-xmark"></i></button>
                <button type="button" class="menu_button ggg-cc-icon-btn ggg-cc-danger-btn" data-act="delete-selected-user-meme" title="删除选中"><i class="fa-solid fa-trash"></i></button>
                <span>${userMemeSelected.size} 已选</span>
            </div>` : '';
        list.innerHTML = bulkBar + data.userMemes.map((m, i) => `
            <div class="ggg-cc-meme-row ${m.__editing ? 'is-editing' : ''}" data-index="${i}">
                ${m.__editing ? `
                    <div class="ggg-cc-row">
                        <span class="ggg-cc-label">名称</span>
                        <input type="text" class="text_pole" data-user-meme-f="name" value="${escapeAttr(m.name || '')}" placeholder="表情包名">
                    </div>
                    <div class="ggg-cc-row">
                        <span class="ggg-cc-label">URL</span>
                        <input type="text" class="text_pole" data-user-meme-f="url" value="${escapeAttr(m.url || '')}" placeholder="https://...">
                    </div>
                    <div class="ggg-cc-row">
                        <span></span>
                        <button type="button" class="menu_button ggg-cc-icon-btn" data-act="done-user-meme" title="完成"><i class="fa-solid fa-check"></i></button>
                    </div>
                ` : `
                    <div class="ggg-cc-meme-preview ${userMemeBulkMode ? 'is-bulk' : ''}" data-act="${userMemeBulkMode ? 'toggle-user-meme-select' : ''}">
                        ${userMemeBulkMode ? `<span class="ggg-cc-select-mark ${userMemeSelected.has(i) ? 'selected' : ''}"><i class="fa-solid fa-check"></i></span>` : ''}
                        ${m.url ? `<img src="${escapeAttr(m.url)}" alt="${escapeAttr(m.name || '表情包')}">` : `<div class="ggg-cc-meme-empty"><i class="fa-solid fa-image"></i></div>`}
                        <div class="ggg-cc-meme-name">${escapeHtml(m.name || '未命名')}</div>
                        ${userMemeBulkMode ? '' : `<button type="button" class="ggg-cc-dot-btn ggg-cc-meme-edit" data-act="edit-user-meme" title="编辑"><i class="fa-solid fa-ellipsis"></i></button>`}
                    </div>
                `}
            </div>
        `).join('');
        list.querySelectorAll('[data-user-meme-f]').forEach(el => {
            el.addEventListener('input', () => {
                const row = el.closest('.ggg-cc-meme-row');
                const item = data.userMemes[Number(row?.dataset.index)];
                if (!item) return;
                item[el.dataset.userMemeF] = el.value;
                item.tags = memeTagsFromItem({ tags: [data.userMemesTag] });
                save();
            });
        });
        list.querySelectorAll('[data-act="toggle-user-meme-select"]').forEach(el => {
            el.addEventListener('click', () => {
                const row = el.closest('.ggg-cc-meme-row');
                const index = Number(row?.dataset.index);
                if (userMemeSelected.has(index)) userMemeSelected.delete(index);
                else userMemeSelected.add(index);
                renderUserMemes();
            });
        });
        list.querySelector('[data-act="select-all-user-meme"]')?.addEventListener('click', () => {
            userMemeSelected = new Set(data.userMemes.map((_, i) => i));
            renderUserMemes();
        });
        list.querySelector('[data-act="clear-user-meme-selection"]')?.addEventListener('click', () => {
            userMemeSelected = new Set();
            renderUserMemes();
        });
        list.querySelector('[data-act="delete-selected-user-meme"]')?.addEventListener('click', () => {
            if (!userMemeSelected.size) return;
            if (!confirm(`确定删除选中的 ${userMemeSelected.size} 个用户表情包吗？`)) return;
            [...userMemeSelected].sort((a, b) => b - a).forEach(i => data.userMemes.splice(i, 1));
            userMemeSelected = new Set();
            renderUserMemes();
            save();
        });
        list.querySelectorAll('[data-act="remove-user-meme"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('.ggg-cc-meme-row');
                data.userMemes.splice(Number(row?.dataset.index), 1);
                renderUserMemes();
                save();
            });
        });
        list.querySelectorAll('[data-act="edit-user-meme"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('.ggg-cc-meme-row');
                const item = data.userMemes[Number(row?.dataset.index)];
                if (!item) return;
                item.__editing = true;
                renderUserMemes();
            });
        });
        list.querySelectorAll('[data-act="done-user-meme"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('.ggg-cc-meme-row');
                const item = data.userMemes[Number(row?.dataset.index)];
                if (!item) return;
                item.__editing = false;
                renderUserMemes();
                save();
            });
        });
    };
    wrapper.querySelector('[data-act="add-user-meme"]')?.addEventListener('click', () => {
        data.userMemes.unshift({ name: '', url: '', tags: memeTagsFromItem({ tags: [data.userMemesTag] }), __editing: true });
        renderUserMemes();
        save();
    });
    wrapper.querySelector('[data-act="toggle-user-meme-bulk"]')?.addEventListener('click', (e) => {
        userMemeBulkMode = !userMemeBulkMode;
        userMemeSelected = new Set();
        e.currentTarget?.classList.toggle('active', userMemeBulkMode);
        renderUserMemes();
    });
    wrapper.querySelector('[data-act="upload-user-meme"]')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const name = await askPopupInput('表情包名', file.name.replace(/\.[^.]+$/, ''), '写入 PP 表情包消息时使用的名字');
            if (!name) return;
            const uploaded = await uploadFileToBackgrounds(file, 'ggg_meme');
            data.userMemes.unshift({
                name: String(name).trim(),
                url: uploaded.url,
                filename: uploaded.filename,
                timestamp: Date.now(),
                tags: memeTagsFromItem({ tags: [data.userMemesTag] }),
            });
            renderUserMemes();
            save();
        } catch (err) {
            console.warn('[ggg-cc] 用户表情包上传失败:', err);
            try { toastr?.error?.('上传失败'); } catch {}
        } finally {
            e.target.value = '';
        }
    });
    wrapper.querySelector('[data-act="export-user-meme"]')?.addEventListener('click', () => {
        const urlOnly = data.userMemes
            .filter(m => (/^https?:\/\//i.test(String(m.url || '')) || String(m.url || '').startsWith('/')) && !/^data:/i.test(String(m.url || '')))
            .map(m => ({ name: m.name || '', url: m.url || '', tags: memeTagsFromItem({ tags: [data.userMemesTag] }) }));
        downloadJson(`user-memes-${getCtx()?.name1 || window.name1 || 'user'}.json`, { version: 1, type: 'userMemes', memes: urlOnly });
    });
    wrapper.querySelector('[data-act="import-user-meme"]')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const obj = await readJsonFile(file);
            const imported = Array.isArray(obj?.memes) ? obj.memes : Array.isArray(obj) ? obj : [];
            imported.slice().reverse().forEach(m => {
                const name = String(m?.name || '').trim();
                const url = String(m?.url || '').trim();
                if (!name || !url || /^data:/i.test(url)) return;
                data.userMemes.unshift({ name, url, tags: memeTagsFromItem({ tags: [data.userMemesTag] }) });
            });
            renderUserMemes();
            save();
        } catch { alert('导入失败：JSON 格式不正确'); }
        e.target.value = '';
    });
    bindNestedActionStops(wrapper);
    renderUserMemes();
    const avatarOptions = () => (settings.avatars || [])
        .map(img => ({ url: img.url || img.dataUrl || '', name: img.name || img.filename || '头像' }))
        .filter(img => img.url);
    const closeFriendAvatarPicker = () => {
        const picker = wrapper.querySelector('[data-role="friend-avatar-picker"]');
        if (!picker) return;
        picker.hidden = true;
        picker.innerHTML = '';
    };
    const openFriendAvatarPicker = (index) => {
        const picker = wrapper.querySelector('[data-role="friend-avatar-picker"]');
        if (!picker) return;
        const opts = avatarOptions();
        picker.hidden = false;
        picker.innerHTML = `
            <div class="ggg-cc-avatar-picker-backdrop" data-act="close-avatar-picker"></div>
            <div class="ggg-cc-avatar-picker-panel">
                <div class="ggg-cc-avatar-picker-head">
                    <b>选择好友头像</b>
                    <button type="button" class="menu_button ggg-cc-icon-btn" data-act="close-avatar-picker" title="关闭"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="ggg-cc-avatar-grid">
                    ${opts.length ? opts.map(o => `
                        <button type="button" class="ggg-cc-avatar-option" data-avatar-url="${escapeAttr(o.url)}" title="${escapeAttr(o.name)}">
                            <img src="${escapeAttr(o.url)}" alt="${escapeAttr(o.name)}">
                            <span>${escapeHtml(o.name)}</span>
                        </button>
                    `).join('') : `<div class="ggg-cc-tip">头像库为空，请先在图库里上传头像</div>`}
                </div>
            </div>`;
        picker.querySelectorAll('[data-act="close-avatar-picker"]').forEach(el => {
            el.addEventListener('click', closeFriendAvatarPicker);
        });
        picker.querySelectorAll('[data-avatar-url]').forEach(btn => {
            btn.addEventListener('click', () => {
                const item = data.friends[index];
                if (!item) return;
                item.avatar = btn.dataset.avatarUrl || '';
                closeFriendAvatarPicker();
                renderFriends();
                save();
            });
        });
    };
    const renderFriends = () => {
        const list = wrapper.querySelector('[data-role="friend-list"]');
        if (!list) return;
        if (!data.friends.length) {
            list.innerHTML = `<div class="ggg-cc-tip">还没有填写 PP 好友</div>`;
            return;
        }
        list.innerHTML = data.friends.map((f, i) => `
            <details class="ggg-cc-nested-card ggg-cc-friend-row" data-index="${i}">
                <summary>
                    <span class="ggg-cc-friend-summary-main">
                        <span class="ggg-cc-friend-avatar">${f.avatar ? `<img src="${escapeAttr(f.avatar)}" alt="">` : `<i class="fa-solid fa-user"></i>`}</span>
                        <span class="ggg-cc-friend-name">${escapeHtml(f.nickname || '未命名好友')}</span>
                    </span>
                    <button type="button" class="menu_button ggg-cc-icon-btn" data-act="remove-friend" title="删除好友"><i class="fa-solid fa-trash"></i></button>
                </summary>
                <div class="ggg-cc-nested-body">
                    <div class="ggg-cc-row">
                        <span class="ggg-cc-label">昵称</span>
                        <input type="text" class="text_pole" data-friend-f="nickname" value="${escapeAttr(f.nickname)}" placeholder="好友昵称">
                    </div>
                    <div class="ggg-cc-row">
                        <span class="ggg-cc-label">头像</span>
                        <button type="button" class="menu_button" data-act="pick-friend-avatar"><i class="fa-solid fa-images"></i> 选择头像</button>
                    </div>
                    <div class="ggg-cc-row">
                        <span class="ggg-cc-label">头像URL</span>
                        <input type="text" class="text_pole" data-friend-f="avatar" value="${escapeAttr(f.avatar)}" placeholder="可留空">
                    </div>
                    <div class="ggg-cc-row">
                        <span class="ggg-cc-label">备注</span>
                        <input type="text" class="text_pole" data-friend-f="remark" value="${escapeAttr(f.remark)}" placeholder="可留空">
                    </div>
                </div>
            </details>
        `).join('');
        list.querySelectorAll('[data-friend-f]').forEach(el => {
            el.addEventListener('input', () => {
                const row = el.closest('.ggg-cc-friend-row');
                const item = data.friends[Number(row?.dataset.index)];
                if (!item) return;
                const field = el.dataset.friendF;
                item[field] = el.value;
                save();
            });
            el.addEventListener('change', () => el.dispatchEvent(new Event('input')));
        });
        list.querySelectorAll('[data-act="remove-friend"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('.ggg-cc-friend-row');
                data.friends.splice(Number(row?.dataset.index), 1);
                renderFriends();
                save();
            });
        });
        list.querySelectorAll('[data-act="pick-friend-avatar"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('.ggg-cc-friend-row');
                openFriendAvatarPicker(Number(row?.dataset.index));
            });
        });
        bindNestedActionStops(list);
    };
    wrapper.querySelector('[data-act="add-friend"]')?.addEventListener('click', () => {
        data.friends.push({ id: `pf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`, nickname: '', avatar: '', remark: '' });
        renderFriends();
        save();
    });
    renderFriends();
    wrapper.querySelectorAll('[data-f]').forEach(el => {
        el.addEventListener('input', () => {
            const k = el.dataset.f;
            if (el.type === 'checkbox') data[k] = el.checked;
            else data[k] = el.value;
            if (k === 'userMemesTag') applyUnifiedMemeTag(data.userMemes, data.userMemesTag);
            save();
        });
    });
    bindDrawer(wrapper);
    return wrapper;
}

/* v0.2.47：persona 切换时把"PP 资料 + ST persona 名字头像"重算到手机 me
 *   1. 写到 settings.phone.pp.me（持久化，手机下次打开生效）
 *   2. 调 window.__ggg_phone_pp_store.rebuildMe()（手机已开时实时换头像/昵称）
 */
function syncPersonaToMe() {
    try {
        const avatar = getActivePersonaAvatar();
        const personas = ensurePersonaStore();
        const ppData = readPersonaProfile(personas, avatar).data || {};

        // 同步读 ST persona name/url（fallback；store.js 异步路径会进一步校准）
        const ctx = getCtx();
        const power = ctx?.powerUserSettings || ctx?.power_user || window.power_user;
        const stName = power?.personas?.[avatar] || ctx?.name1 || window.name1 || '';

        if (!settings.phone) settings.phone = {};
        if (!settings.phone.pp) settings.phone.pp = {};
        if (!settings.phone.pp.me) settings.phone.pp.me = {};
        const me = settings.phone.pp.me;
        me.nickname = ppData.nickname || stName || me.nickname || 'User';
        if (ppData.avatarUrl) me.avatar = ppData.avatarUrl;
        me.signature = ppData.signature || me.signature || '这个人很懒，什么都没写';
        delete me.ppId;
        me.avatarKey = avatar;
        saveAllSettings();

        // 让正在打开的手机实时更新
        try { window.__ggg_phone_pp_store?.rebuildMe?.(); } catch {}
    } catch {}
}

/* ============================================================
 * 提示词注入：让模型知道当前 PP 资料
 * ============================================================ */
function syncPromptInjection() {
    if (RELEASE_MODE) {
        clearPromptInjection();
        return;
    }
    const ctx = getCtx();
    if (!ctx || typeof ctx.setExtensionPrompt !== 'function') return;

    // 1. 当前角色资料
    const cur = getCurrentCharacter();
    if (cur) {
        const ext = readCharacterExt(cur.character);
        const charName = cur.character?.name || cur.character?.data?.name || '角色';
        const lines = [`[${charName}的PP账号资料]`];
        if (ext.nickname)   lines.push(`昵称：${ext.nickname}`);
        if (ext.signature)  lines.push(`个性签名：${ext.signature}`);
        if (ext.altEnabled && ext.altNickname) lines.push(`小号：${ext.altNickname}（启用中）`);
        const charText = lines.length > 1 ? lines.join('\n') : '';
        try { ctx.setExtensionPrompt(PROMPT_KEY_CHARACTER, charText, 1, 4, false, 0); } catch {}

        // 2. 当前对话对应的开场白好友关系
        const greetingKey = detectActiveGreetingKey(cur, ctx);
        const g = (ext.greetings || {})[greetingKey];
        if (g && g.friendship) {
            const label = (FRIENDSHIP_OPTIONS.find(o => o.v === g.friendship) || {}).l || g.friendship;
            const note = g.friendshipNote ? `（${g.friendshipNote}）` : '';
            const greetingText = `[${charName}与用户的PP关系] ${label}${note}`;
            try { ctx.setExtensionPrompt(PROMPT_KEY_GREETING, greetingText, 1, 4, false, 0); } catch {}
        } else {
            try { ctx.setExtensionPrompt(PROMPT_KEY_GREETING, '', 1, 4); } catch {}
        }
    } else {
        try { ctx.setExtensionPrompt(PROMPT_KEY_CHARACTER, '', 1, 4); } catch {}
        try { ctx.setExtensionPrompt(PROMPT_KEY_GREETING, '', 1, 4); } catch {}
    }

    // 3. 当前 persona 的 PP 资料
    const avatar = getActivePersonaAvatar();
    const personas = ensurePersonaStore();
    const me = personas[avatar];
    if (me && (me.nickname || me.signature)) {
        const lines = ['[用户的PP账号资料]'];
        if (me.nickname)  lines.push(`昵称：${me.nickname}`);
        if (me.signature) lines.push(`个性签名：${me.signature}`);
        try { ctx.setExtensionPrompt(PROMPT_KEY_PERSONA, lines.join('\n'), 1, 4, false, 0); } catch {}
    } else {
        try { ctx.setExtensionPrompt(PROMPT_KEY_PERSONA, '', 1, 4); } catch {}
    }
}

/* 简陋的"当前用了哪条开场白"探测：看 chat[0] 的内容是否匹配 first/alternate */
function detectActiveGreetingKey(cur, ctx) {
    try {
        const chat = ctx?.chat;
        if (!Array.isArray(chat) || chat.length === 0) return 'first';
        const opener = chat[0];
        if (!opener || opener.is_user) return 'first';
        const text = String(opener.mes || '').slice(0, 200);
        const ch = cur.character?.data || cur.character;
        const first = String(ch?.first_mes || ch?.firstmessage || '').slice(0, 200);
        if (first && text === first) return 'first';
        const alts = ch?.alternate_greetings || [];
        for (let i = 0; i < alts.length; i++) {
            if (String(alts[i] || '').slice(0, 200) === text) return String(i);
        }
    } catch {}
    return 'first';
}

/* ============================================================
 * CSS
 * ============================================================ */
const STYLE = `
.ggg-cc-card {
    position: relative;
    margin: 8px 0;
    padding: 0;
    border: none;
    background: transparent;
}
.ggg-cc-persona-host {
    flex-wrap: wrap !important;
}
.ggg-cc-persona-card {
    display: block !important;
    flex: 0 0 100% !important;
    width: 100% !important;
    min-width: 100% !important;
    max-width: 100% !important;
    box-sizing: border-box !important;
    clear: both !important;
}
.ggg-cc-card .inline-drawer-toggle {
    cursor: pointer;
    padding: 6px 4px;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: space-between;
    user-select: none;
    opacity: .85;
}
.ggg-cc-card .inline-drawer-toggle:hover { opacity: 1; }
.ggg-cc-card .inline-drawer-icon { transition: transform .15s ease; }
.ggg-cc-card .inline-drawer-content {
    padding: 10px 12px 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.ggg-cc-row { display: flex; align-items: center; gap: 8px; }
.ggg-cc-row .ggg-cc-label { width: 78px; flex-shrink: 0; opacity: .85; font-size: 13px; }
.ggg-cc-row input.text_pole, .ggg-cc-row select.text_pole { flex: 1; min-width: 0; }
.ggg-cc-row.ggg-cc-checkbox { gap: 6px; cursor: pointer; }
.ggg-cc-row.ggg-cc-checkbox input { margin: 0; }
.ggg-cc-tip { font-size: 11px; opacity: .55; padding: 2px 0 0; }
.ggg-cc-memes-block,
.ggg-cc-friends-block { display: flex; flex-direction: column; gap: 6px; }
.ggg-cc-nested-card {
    border: 1px solid rgba(127,127,127,.22);
    border-radius: 8px;
    padding: 0;
}
.ggg-cc-nested-card > summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    cursor: pointer;
    user-select: none;
}
.ggg-cc-nested-card > summary::-webkit-details-marker { display: none; }
.ggg-cc-nested-body {
    border-top: 1px solid rgba(127,127,127,.16);
    padding: 8px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.ggg-cc-actions {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
}
.ggg-cc-icon-btn {
    min-width: 28px !important;
    width: 28px;
    height: 28px;
    padding: 0 !important;
    display: inline-flex !important;
    align-items: center;
    justify-content: center;
}
.ggg-cc-plain-icon,
.ggg-cc-dot-btn {
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 50%;
    background: rgba(255,255,255,.72);
    color: inherit;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
}
.theme-dark .ggg-cc-plain-icon,
.theme-dark .ggg-cc-dot-btn { background: rgba(0,0,0,.32); }
.ggg-cc-plain-icon:hover,
.ggg-cc-dot-btn:hover { background: rgba(127,127,127,.22); }
.ggg-cc-profile-menu {
    position: absolute;
    right: 8px;
    top: 8px;
    z-index: 2;
}
.ggg-cc-profile-menu-pop {
    position: absolute;
    right: 0;
    top: 34px;
    min-width: 148px;
    padding: 5px;
    border: 1px solid rgba(127,127,127,.24);
    border-radius: 8px;
    background: var(--SmartThemeBlurTintColor, var(--SmartThemeBodyColor, #fff));
    color: var(--SmartThemeEmColor, inherit);
    box-shadow: 0 8px 24px rgba(0,0,0,.18);
}
.ggg-cc-profile-menu-pop[hidden] { display: none !important; }
.ggg-cc-profile-menu-pop button {
    width: 100%;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    padding: 7px 8px;
    display: flex;
    align-items: center;
    gap: 7px;
    cursor: pointer;
    text-align: left;
}
.ggg-cc-profile-menu-pop button:hover { background: rgba(127,127,127,.14); }
.ggg-cc-profile-shell {
    position: relative;
    border: 1px solid rgba(127,127,127,.18);
    border-radius: 8px;
    overflow: visible;
    background: rgba(255,255,255,.55);
}
.theme-dark .ggg-cc-profile-shell { background: rgba(255,255,255,.06); }
.ggg-cc-profile-view[hidden],
.ggg-cc-profile-edit[hidden] { display: none !important; }
.ggg-cc-profile-cover {
    height: 58px;
    background: linear-gradient(135deg, #f8fafc 0%, #fbcfe8 45%, #bfdbfe 100%);
    background-size: cover;
    background-position: center;
}
.theme-dark .ggg-cc-profile-cover {
    background: linear-gradient(135deg, rgba(251,207,232,.32), rgba(191,219,254,.22));
}
.ggg-cc-profile-main {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    padding: 0 10px 12px;
    margin-top: -24px;
}
.ggg-cc-profile-avatar {
    width: 54px;
    height: 54px;
    border-radius: 50%;
    border: 3px solid rgba(255,255,255,.9);
    background: rgba(127,127,127,.16);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
}
.ggg-cc-profile-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.ggg-cc-profile-copy {
    min-width: 0;
    flex: 1;
    padding-bottom: 2px;
}
.ggg-cc-profile-name {
    font-size: 17px;
    font-weight: 700;
    line-height: 1.2;
}
.ggg-cc-profile-sub {
    margin-top: 3px;
    font-size: 12px;
    opacity: .68;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ggg-cc-profile-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 7px;
}
.ggg-cc-profile-tags span {
    border: 1px solid rgba(127,127,127,.18);
    border-radius: 999px;
    padding: 2px 7px;
    font-size: 11px;
    background: rgba(255,255,255,.46);
}
.theme-dark .ggg-cc-profile-tags span { background: rgba(255,255,255,.06); }
.ggg-cc-profile-edit {
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.ggg-cc-meme-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
    gap: 8px;
}
.ggg-cc-bulkbar {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px;
    border: 1px solid rgba(127,127,127,.18);
    border-radius: 8px;
    background: rgba(127,127,127,.08);
}
.ggg-cc-bulkbar span {
    margin-left: auto;
    font-size: 12px;
    opacity: .7;
}
.ggg-cc-danger-btn { color: #ef4444 !important; }
.ggg-cc-meme-row {
    padding: 8px;
    border: 1px solid rgba(127,127,127,.22);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.ggg-cc-meme-row.is-editing {
    grid-column: 1 / -1;
}
.ggg-cc-meme-preview {
    position: relative;
    min-height: 120px;
    overflow: hidden;
    border-radius: 8px;
    background: rgba(127,127,127,.1);
}
.ggg-cc-meme-preview.is-bulk { cursor: pointer; }
.ggg-cc-select-mark {
    position: absolute;
    left: 6px;
    top: 6px;
    z-index: 1;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid rgba(255,255,255,.9);
    background: rgba(0,0,0,.35);
    color: transparent;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
}
.ggg-cc-select-mark.selected {
    background: #22c55e;
    color: #fff;
}
.ggg-cc-meme-preview img,
.ggg-cc-meme-empty {
    width: 100%;
    height: 124px;
    object-fit: contain;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    opacity: .8;
}
.ggg-cc-meme-name {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 6px 36px 6px 8px;
    color: #fff;
    background: linear-gradient(to top, rgba(0,0,0,.68), rgba(0,0,0,0));
    font-size: 13px;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ggg-cc-meme-edit {
    position: absolute;
    left: 6px;
    bottom: 5px;
    width: 28px;
    height: 28px;
}
.ggg-cc-friend-list { display: flex; flex-direction: column; gap: 8px; }
.ggg-cc-friend-row > summary {
    min-height: 44px;
}
.ggg-cc-friend-summary-main {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;
}
.ggg-cc-friend-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(127,127,127,.16);
    flex: 0 0 auto;
}
.ggg-cc-friend-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.ggg-cc-friend-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ggg-cc-avatar-picker[hidden] { display: none; }
.ggg-cc-image-picker[hidden] { display: none; }
.ggg-cc-image-picker {
    position: absolute;
    left: 8px;
    right: 8px;
    top: 42px;
    z-index: 20;
}
.ggg-cc-image-picker-panel {
    max-height: min(430px, 68vh);
    overflow: hidden;
    border: 1px solid rgba(127,127,127,.25);
    border-radius: 8px;
    background: var(--SmartThemeBlurTintColor, var(--SmartThemeBodyColor, #222));
    color: var(--SmartThemeEmColor, inherit);
    box-shadow: 0 12px 32px rgba(0,0,0,.28);
    display: flex;
    flex-direction: column;
}
.ggg-cc-image-picker-tabs {
    display: flex;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid rgba(127,127,127,.16);
}
.ggg-cc-image-picker-tabs button {
    border: 1px solid rgba(127,127,127,.2);
    border-radius: 999px;
    background: rgba(127,127,127,.08);
    color: inherit;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 12px;
}
.ggg-cc-image-picker-tabs button.active {
    background: var(--SmartThemeQuoteColor, rgba(127,127,127,.24));
}
.ggg-cc-avatar-picker {
    position: fixed;
    inset: 0;
    z-index: 10060;
}
.ggg-cc-avatar-picker-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,.45);
}
.ggg-cc-avatar-picker-panel {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(640px, calc(100vw - 28px));
    max-height: min(76vh, 620px);
    overflow: hidden;
    border: 1px solid rgba(127,127,127,.25);
    border-radius: 8px;
    background: var(--SmartThemeBlurTintColor, var(--SmartThemeBodyColor, #222));
    color: var(--SmartThemeEmColor, inherit);
    box-shadow: 0 12px 36px rgba(0,0,0,.35);
    display: flex;
    flex-direction: column;
}
.ggg-cc-avatar-picker-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(127,127,127,.18);
}
.ggg-cc-avatar-grid {
    padding: 12px;
    overflow: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
    gap: 10px;
}
.ggg-cc-avatar-option {
    border: 1px solid rgba(127,127,127,.24);
    border-radius: 8px;
    background: rgba(127,127,127,.08);
    color: inherit;
    padding: 6px;
    cursor: pointer;
    min-width: 0;
}
.ggg-cc-avatar-option:hover { background: rgba(127,127,127,.16); }
.ggg-cc-avatar-option img {
    width: 100%;
    aspect-ratio: 1 / 1;
    object-fit: cover;
    border-radius: 6px;
    display: block;
}
.ggg-cc-avatar-option span {
    display: block;
    margin-top: 4px;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ggg-cc-popup {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: min(360px, 80vw);
}
.ggg-cc-popup-title {
    font-weight: 700;
}
`;
let _styleInjected = false;
function injectCss() {
    if (_styleInjected) return;
    const s = document.createElement('style');
    s.id = 'ggg-cc-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
    _styleInjected = true;
}
