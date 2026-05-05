/**
 * PP 最新回复预览监听
 * 监听酒馆最新楼层 .last_mes：当原始消息含 <PP><chat><昵称>...</昵称></chat></PP>
 * 且该楼层进入视口时，在手机入口旁弹出 3 秒预览。
 */
import { parseAIReply } from './pp-parser.js';
import { appendMessage } from '../apps/pp/messages.js';

const PREVIEW_ID = 'ggg-phone-pp-preview-card';
const META_KEY = 'gggPPNotifier';

let _mounted = false;
let _observer = null;
let _intersection = null;
let _scrollTimer = null;
let _hideTimer = null;
let _lastCandidate = null;
let _onOpenPPChat = null;

function getCtx() {
    try { return (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null; } catch { return null; }
}

function hashText(text) {
    const s = String(text || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return (h >>> 0).toString(36);
}

function stripTags(text) {
    return String(text || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function previewOfEvent(ev) {
    const p = ev?.payload || {};
    switch (ev?.kind) {
        case 'text': return p.text || '';
        case 'voice': return p.transcript ? `[语音] ${p.transcript}` : '[语音]';
        case 'image': return p.alt ? `[图片] ${p.alt}` : '[图片]';
        case 'sticker': return p.name ? `[表情] ${p.name}` : '[表情]';
        case 'transfer': return `[转账 ${p.currency || '¥'}${p.amount || 0}]`;
        case 'location': return p.desc ? `[位置] ${p.desc}` : '[位置]';
        case 'audio_call': return '[语音通话]';
        case 'video_call': return '[视频通话]';
        case 'dice': return `[骰子] ${p.point || ''}`.trim();
        case 'quote': return p.text || p.quoteSummary || '[引用]';
        case 'recall': return '[撤回了一条消息]';
        case 'reaction': return p.emoji ? `[表态] ${p.emoji}` : '[表态]';
        default: return ev?.kind ? `[${ev.kind}]` : '';
    }
}

function contactIdForName(name) {
    return `pp_auto_${hashText(String(name || 'PP').trim())}`;
}

function ensureContact(name) {
    const nickname = String(name || '').trim();
    if (!nickname || nickname === '__fallback__' || nickname === '__loose__') return null;

    const ctx = getCtx();
    if (ctx) {
        if (!ctx.chatMetadata) ctx.chatMetadata = {};
        if (!ctx.chatMetadata.gggPPContacts) ctx.chatMetadata.gggPPContacts = {};
        const contacts = ctx.chatMetadata.gggPPContacts;
        if (!Array.isArray(contacts.friends)) contacts.friends = [];
        const id = contactIdForName(nickname);
        let contact = contacts.friends.find(f => f?.id === id || f?.nickname === nickname || f?.remark === nickname);
        if (!contact) {
            contact = {
                id,
                nickname,
                avatar: '',
                signature: '',
                group: 'friend',
                source: 'last-mes-pp',
            };
            contacts.friends.push(contact);
        }
        try {
            const save = ctx.saveMetadata || window.saveMetadata;
            if (typeof save === 'function') Promise.resolve(save.call(ctx)).catch(() => {});
        } catch {}
        window.__ggg_phone_pp_store?.addOrUpdateFriend?.(contact);
        window.__ggg_phone_pp_store?.refreshContacts?.();
        return contact;
    }

    return { id: contactIdForName(nickname), nickname, avatar: '', source: 'last-mes-pp' };
}

function getRawLatestMessage(lastEl) {
    const ctx = getCtx();
    const mesId = Number(lastEl?.getAttribute?.('mesid'));
    if (Array.isArray(ctx?.chat) && Number.isInteger(mesId) && ctx.chat[mesId]) {
        const item = ctx.chat[mesId];
        if (item?.is_user || item?.extra?.guagua_pp_bridge) return '';
        return String(item.mes || item.message || '');
    }
    if (Array.isArray(ctx?.chat) && ctx.chat.length) {
        const item = ctx.chat[ctx.chat.length - 1];
        if (item?.is_user || item?.extra?.guagua_pp_bridge) return '';
        return String(item.mes || item.message || '');
    }
    return String(lastEl?.textContent || '');
}

function buildCandidate(lastEl) {
    if (!lastEl) return null;
    const raw = getRawLatestMessage(lastEl);
    if (!/<PP>[\s\S]*?<chat>[\s\S]*?<\/chat>[\s\S]*?<\/PP>/i.test(raw)) return null;

    const parsed = parseAIReply(raw);
    const conv = parsed.conversations.find(c => c?.name && c.events?.length) || null;
    if (!conv) return null;
    const event = conv.events.find(ev => ev.senderRole !== 'user' && ev.kind !== 'timemarker') || conv.events[0];
    const contact = ensureContact(conv.name);
    if (!contact) return null;

    const hash = hashText(raw);
    return {
        hash,
        raw,
        parsed,
        floor: Number(lastEl.getAttribute?.('mesid')),
        contact,
        scope: 'private',
        contactId: contact.id,
        nickname: contact.remark || contact.nickname || conv.name,
        preview: previewOfEvent(event) || stripTags(raw).slice(0, 80) || '收到一条 PP 消息',
        el: lastEl,
    };
}

async function persistCandidate(candidate) {
    const ctx = getCtx();
    if (!ctx) return;
    if (!ctx.chatMetadata) ctx.chatMetadata = {};
    const meta = ctx.chatMetadata[META_KEY] || (ctx.chatMetadata[META_KEY] = {});
    if (meta.processedHash === candidate.hash) return;

    // 重新解析一次，让 {{phone_time}} 落在真正弹出预览的时刻，而不是首次扫描到 DOM 的时刻。
    const parsedAtPopup = parseAIReply(candidate.raw || '');
    candidate.parsed = parsedAtPopup;

    for (const conv of parsedAtPopup.conversations) {
        const name = String(conv.name || '').trim();
        if (!name || name !== candidate.nickname && name !== candidate.contact.nickname) continue;
        for (const ev of conv.events || []) {
            if (ev.senderRole === 'user' || ev.kind === 'timemarker') continue;
            const saved = await appendMessage({
                scope: 'private',
                contactId: candidate.contactId,
                senderId: candidate.contactId,
                senderRole: ev.senderRole === 'sys' ? 'sys' : 'char',
                senderName: candidate.nickname,
                peerName: candidate.nickname,
                kind: ev.kind,
                payload: ev.payload || {},
                phoneTime: ev.phoneTime,
                seq: typeof ev.seq === 'number' && ev.seq > 0 ? ev.seq : undefined,
                anchorPos: 'after',
                translate: ev.payload?.translate || null,
                deferBridge: true,
            });
            if (saved?.id) meta.lastSavedMsgId = saved.id;
        }
    }

    meta.processedHash = candidate.hash;
    meta.processedAt = Date.now();
    try {
        const save = ctx.saveMetadata || window.saveMetadata;
        if (typeof save === 'function') await save.call(ctx);
    } catch {}
}

function isInViewport(el) {
    if (!el?.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    return r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
}

function entryRect() {
        const entry = document.getElementById('ggg-floating-ball');
    return entry?.getBoundingClientRect?.() || null;
}

function positionCard(card) {
    const r = entryRect();
    const vw = window.innerWidth || 360;
    const vh = window.innerHeight || 640;
    const w = card.offsetWidth || 236;
    const h = card.offsetHeight || 76;
    let left = vw - w - 14;
    let top = vh - h - 86;
    if (r) {
        const preferLeft = r.left + r.width / 2 < vw / 2;
        left = preferLeft ? r.right + 10 : r.left - w - 10;
        if (left < 10 || left + w > vw - 10) left = Math.max(10, Math.min(vw - w - 10, r.left));
        top = Math.max(10, Math.min(vh - h - 10, r.top + r.height / 2 - h / 2));
    }
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
}

function hidePreview() {
    if (_hideTimer) clearTimeout(_hideTimer);
    _hideTimer = null;
    document.getElementById(PREVIEW_ID)?.remove();
}

async function showPreview(candidate) {
    await persistCandidate(candidate);
    hidePreview();

    const card = document.createElement('button');
    card.id = PREVIEW_ID;
    card.className = 'ggg-phone-pp-preview-card';
    card.type = 'button';
    card.innerHTML = `
        <div class="ppv-icon"><i class="ggg-fa fa-solid fa-comment-dots"></i></div>
        <div class="ppv-main">
            <div class="ppv-head">
                <span class="ppv-badge">PP</span>
                <span class="ppv-title">${escapeHtml(candidate.nickname)}</span>
            </div>
            <div class="ppv-text">${escapeHtml(candidate.preview)}</div>
        </div>
    `;
    card.addEventListener('click', () => {
        hidePreview();
        _onOpenPPChat?.({
            scope: candidate.scope,
            contactId: candidate.contactId,
            nickname: candidate.nickname,
            contact: candidate.contact,
        });
    });
    document.body.appendChild(card);
    positionCard(card);
    requestAnimationFrame(() => card.classList.add('show'));
    _hideTimer = setTimeout(hidePreview, 5000);
}

function escapeHtml(text) {
    return String(text || '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
}

function maybeShow(candidate) {
    if (!candidate || !candidate.el) return;
    const ctx = getCtx();
    const processed = ctx?.chatMetadata?.[META_KEY]?.lastPreviewHash;
    if (processed === candidate.hash) return;
    if (!isInViewport(candidate.el)) return;
    if (!ctx.chatMetadata) ctx.chatMetadata = {};
    if (!ctx.chatMetadata[META_KEY]) ctx.chatMetadata[META_KEY] = {};
    ctx.chatMetadata[META_KEY].lastPreviewHash = candidate.hash;
    showPreview(candidate).catch(e => console.warn('[ggg-phone] PP 预览显示失败', e));
}

function observeCandidate(candidate) {
    if (_intersection) {
        _intersection.disconnect();
        _intersection = null;
    }
    if (!candidate?.el) return;
    _lastCandidate = candidate;
    if ('IntersectionObserver' in window) {
        _intersection = new IntersectionObserver(entries => {
            if (entries.some(e => e.isIntersecting)) maybeShow(candidate);
        }, { threshold: 0.08 });
        _intersection.observe(candidate.el);
    }
    maybeShow(candidate);
}

function scanLatest() {
    if (!_mounted) return;
    const lastEl = document.querySelector('#chat > .mes.last_mes, .mes.last_mes, .last_mes');
    const candidate = buildCandidate(lastEl);
    if (!candidate) return;
    if (_lastCandidate?.hash === candidate.hash) {
        maybeShow(_lastCandidate);
        return;
    }
    observeCandidate(candidate);
}

function scheduleScan() {
    if (_scrollTimer) clearTimeout(_scrollTimer);
    _scrollTimer = setTimeout(scanLatest, 120);
}

export function mountPPPreviewNotifier({ onOpenPPChat } = {}) {
    _onOpenPPChat = onOpenPPChat || null;
    if (_mounted) {
        scheduleScan();
        return;
    }
    _mounted = true;
    _observer = new MutationObserver(scheduleScan);
    _observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class'],
    });
    window.addEventListener('scroll', scheduleScan, true);
    window.addEventListener('resize', scheduleScan);
    scheduleScan();
}

export function unmountPPPreviewNotifier() {
    _mounted = false;
    _onOpenPPChat = null;
    if (_observer) _observer.disconnect();
    if (_intersection) _intersection.disconnect();
    if (_scrollTimer) clearTimeout(_scrollTimer);
    hidePreview();
    _observer = null;
    _intersection = null;
    _scrollTimer = null;
    _lastCandidate = null;
    window.removeEventListener('scroll', scheduleScan, true);
    window.removeEventListener('resize', scheduleScan);
}
