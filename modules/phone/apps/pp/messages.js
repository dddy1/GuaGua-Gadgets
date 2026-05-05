/**
 * PP 消息存储 —— v0.2.57-rc2
 *
 * Msg 结构（rc2）：
 *   {
 *     id, scope:'private'|'group', contactId, groupId,
 *     seq:        number,           // ★ 全聊天全局递增序号（同一会话内）
 *     senderId, senderRole:'user'|'char'|'sys',
 *     senderName: string,
 *     kind: 'text'|'voice'|'image'|'sticker'|'transfer'|'location'
 *          |'audio_call'|'video_call'|'dice'|'quote'
 *          |'recall'|'reaction'|'timemarker'|'system',
 *     payload: any,                 // 按 kind 不同
 *     phoneTime: ISO string,        // 真实时间（用于渲染相对时间）
 *     createdAt: number,
 *     anchorFloor, anchorPos,
 *     translate: string|null,
 *     recalled: boolean,
 *     pending: boolean,             // ★ rc2：用户已敲回车但还没点"发送"
 *     reactions: [{emoji, actor, ts}],  // ★ rc2：表态聚合
 *   }
 */

import { getPhoneNow, getPhoneTimeISO } from '../../core/phone-time.js';

const STORE_KEY = 'gggPP';
const STORE_VERSION = 1;
const BRIDGE_EXTRA_KEY = 'guagua_pp_bridge';

function getCtx() {
    try { return (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null; } catch { return null; }
}

function getMeta() {
    const ctx = getCtx();
    if (!ctx) return null;
    if (!ctx.chatMetadata) ctx.chatMetadata = {};
    if (!ctx.chatMetadata[STORE_KEY] || ctx.chatMetadata[STORE_KEY].version !== STORE_VERSION) {
        ctx.chatMetadata[STORE_KEY] = { version: STORE_VERSION, messages: [] };
    }
    if (!Array.isArray(ctx.chatMetadata[STORE_KEY].messages)) {
        ctx.chatMetadata[STORE_KEY].messages = [];
    }
    return ctx.chatMetadata[STORE_KEY];
}

function isBridgeMessage(m) {
    return !!m?.extra?.[BRIDGE_EXTRA_KEY];
}

function getLastNonBridgeFloor(ctx = getCtx()) {
    const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
    for (let i = chat.length - 1; i >= 0; i--) {
        if (!isBridgeMessage(chat[i])) return i;
    }
    return chat.length > 0 ? 0 : -1;
}

async function persist() {
    const ctx = getCtx();
    if (!ctx) return;
    try {
        if (typeof ctx.saveMetadata === 'function') await ctx.saveMetadata();
        else if (typeof window.saveMetadata === 'function') await window.saveMetadata();
        else if (typeof window.saveChatConditional === 'function') await window.saveChatConditional();
    } catch (e) {
        console.warn('[ggg pp messages] persist failed', e);
    }
}

const uid = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const KIND_TO_NAME = {
    text: '消息', voice: '语音', image: '图片', sticker: '表情包',
    transfer: '转账', location: '位置',
    audio_call: '语音通话', video_call: '视频通话',
    dice: '骰子', quote: '引用', recall: '撤回', reaction: '表态',
    timemarker: '时间分隔', system: '系统',
};

function fmtBridgeTime(iso, now = getPhoneNow()) {
    const d = new Date(iso || Date.now());
    if (isNaN(d.getTime())) return '';
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const diffMs = now.getTime() - d.getTime();
    if (diffMs >= 0 && diffMs < 60_000) return '刚刚';
    if (diffMs >= 0 && diffMs <= 180_000) return `${Math.max(1, Math.floor(diffMs / 60_000))}分钟前`;

    const startNow = new Date(now); startNow.setHours(0, 0, 0, 0);
    const startThat = new Date(d); startThat.setHours(0, 0, 0, 0);
    const diffDays = Math.round((startNow.getTime() - startThat.getTime()) / 86400000);
    if (diffDays === 0) return hhmm;
    if (diffDays === 1) return `昨天 ${hhmm}`;
    if (diffDays === 2) return `前天 ${hhmm}`;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day} ${hhmm}`;
}

function bridgePayloadText(m) {
    const p = m?.payload || {};
    if (m?.kind === 'text' && p.type === 'recall-status') return `[${p.targetSeq || 0}]`;
    if (m?.kind === 'text' && p.type === 'transfer-status') return `[${p.targetSeq || 0}]`;
    switch (m?.kind) {
        case 'text':       return p.text || '';
        case 'voice':      return p.transcript || '';
        case 'image':      return p.alt || '';
        case 'sticker':    return p.tag ? `${p.name || ''},${p.tag}` : (p.name || '');
        case 'transfer':   return `${p.amount || 0},${p.note || ''},${p.status || ''}`;
        case 'location':   return p.desc || '';
        case 'audio_call':
        case 'video_call': return p.status || '';
        case 'dice':       return String(p.point || 1);
        case 'quote':      return `[${p.quoteSeq || 0}]${p.quoteSummary || ''}||${p.text || ''}`;
        case 'recall':     return `[${p.targetSeq || 0}]`;
        case 'reaction':   return `[${p.targetSeq || 0}]${p.emoji || ''}`;
        default:           return JSON.stringify(p);
    }
}

function bridgePrefix(m) {
    const p = m?.payload || {};
    if (m?.kind === 'text' && (p.type === 'recall-status' || p.type === 'transfer-status')) return '&';
    return m.senderRole === 'user' ? '&' : m.senderRole === 'sys' ? 'sys' : '#';
}

function bridgeKindName(m) {
    const p = m?.payload || {};
    if (m?.kind === 'text' && p.type === 'recall-status') return '撤回';
    if (m?.kind === 'text' && p.type === 'transfer-status') {
        return p.action === 'return' ? '退回' : '收款';
    }
    return KIND_TO_NAME[m.kind] || m.kind || '消息';
}

function convKey(m) {
    return `${m.scope || 'private'}:${m.scope === 'group' ? (m.groupId || '') : (m.contactId || '')}`;
}

function convName(m) {
    return String(m.peerName || m.senderName || m.contactName || m.groupName || m.contactId || m.groupId || 'PP').trim() || 'PP';
}

function safeTagName(name) {
    return String(name || 'PP').replace(/[<>\r\n/]/g, '').trim() || 'PP';
}

function msgToProtocolLine(m, now) {
    const prefix = bridgePrefix(m);
    const seq = Number(m.seq) || 0;
    const kindName = bridgeKindName(m);
    const content = String(bridgePayloadText(m) || '').replace(/\r?\n/g, ' ').trim();
    return `${prefix}${seq}|${fmtBridgeTime(m.phoneTime, now)}|${kindName}|${content}`;
}

function buildBridgeTextForMessages(messages) {
    const groups = new Map();
    const now = getPhoneNow();
    for (const m of messages) {
        if (!m || m.pending || m.recalled || m.deleted) continue;
        const key = convKey(m);
        if (!groups.has(key)) groups.set(key, { name: convName(m), lines: [] });
        groups.get(key).lines.push(msgToProtocolLine(m, now));
    }
    const blocks = [];
    for (const group of groups.values()) {
        const name = safeTagName(group.name);
        blocks.push(`<${name}>`);
        blocks.push(...group.lines);
        blocks.push(`</${name}>`);
    }
    const pp = `<PP>\n<chat>\n${blocks.join('\n')}\n</chat>\n</PP>`;
    return pp;
}

function wrapBridgeDetails(text, anchorFloor) {
    return text;
}

function findBridgeIndexByAnchor(ctx, anchorFloor) {
    if (!ctx || !Array.isArray(ctx.chat)) return -1;
    return ctx.chat.findIndex(x => x?.extra?.[BRIDGE_EXTRA_KEY]?.anchorFloor === anchorFloor);
}

function findInsertBeforeIndex(ctx, anchorFloor) {
    const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
    for (let i = anchorFloor + 1; i < chat.length; i++) {
        if (!isBridgeMessage(chat[i])) return i;
    }
    return 'end';
}

function shiftAnchorsFrom(insertIndex, delta, exceptAnchor) {
    if (!Number.isInteger(insertIndex) || delta === 0) return;
    const meta = getMeta();
    if (meta) {
        for (const m of meta.messages) {
            if (m.anchorFloor === exceptAnchor) continue;
            if (Number.isInteger(m.anchorFloor) && m.anchorFloor >= insertIndex) {
                m.anchorFloor += delta;
            }
        }
    }
    const ctx = getCtx();
    if (Array.isArray(ctx?.chat)) {
        for (const cm of ctx.chat) {
            const bridge = cm?.extra?.[BRIDGE_EXTRA_KEY];
            if (bridge && bridge.anchorFloor !== exceptAnchor && Number.isInteger(bridge.anchorFloor) && bridge.anchorFloor >= insertIndex) {
                bridge.anchorFloor += delta;
            }
        }
    }
}

async function saveBridgeChat(ctx) {
    try {
        if (ctx && typeof ctx.saveChat === 'function') await ctx.saveChat();
        else if (typeof window !== 'undefined' && typeof window.saveChatConditional === 'function') await window.saveChatConditional();
    } catch (e) {
        console.warn('[ggg pp bridge] save chat failed', e);
    }
}

function makeExcludeSet(excludeIds) {
    return new Set(Array.isArray(excludeIds) ? excludeIds.filter(Boolean) : []);
}

function messagesForAnchor(anchorFloor, excludeIds = []) {
    const meta = getMeta();
    const excluded = makeExcludeSet(excludeIds);
    if (!meta) return [];
    return meta.messages
        .filter(m => !m.pending && !excluded.has(m.id) && Number(m.anchorFloor) === Number(anchorFloor))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || (a.seq || 0) - (b.seq || 0));
}

function bridgeMetaForAnchor(anchorFloor, messages) {
    const conversations = [];
    const seen = new Set();
    for (const m of messages) {
        const key = convKey(m);
        if (seen.has(key)) continue;
        seen.add(key);
        conversations.push({
            key,
            scope: m.scope || 'private',
            contactId: m.contactId || '',
            groupId: m.groupId || '',
            name: convName(m),
        });
    }
    return {
        anchorFloor,
        conversations,
        messageIds: messages.map(m => m.id).filter(Boolean),
    };
}

async function syncBridgeForAnchor(anchorFloor, { excludeIds = [] } = {}) {
    const ctx = getCtx();
    if (!ctx || !Array.isArray(ctx.chat) || !Number.isInteger(Number(anchorFloor)) || Number(anchorFloor) < 0) return false;

    const messages = messagesForAnchor(Number(anchorFloor), excludeIds);
    const visibleMessages = messages.filter(m => !m.recalled && !m.deleted);
    const text = wrapBridgeDetails(buildBridgeTextForMessages(visibleMessages), Number(anchorFloor));
    const hidden = visibleMessages.length === 0 && makeExcludeSet(excludeIds).size === 0;
    const extra = {
        [BRIDGE_EXTRA_KEY]: bridgeMetaForAnchor(Number(anchorFloor), visibleMessages),
    };

    const idx = findBridgeIndexByAnchor(ctx, Number(anchorFloor));
    if (idx >= 0) {
        const target = ctx.chat[idx];
        target.mes = text;
        target.is_user = false;
        target.is_system = hidden;
        target.extra = { ...(target.extra || {}), ...extra };
        await saveBridgeChat(ctx);
        return true;
    }

    if (hidden) return false;

    const entry = {
        name: 'phone',
        ch_name: 'phone',
        is_user: false,
        is_system: false,
        mes: text,
        send_date: typeof ctx.humanizedDateTime === 'function' ? ctx.humanizedDateTime() : getPhoneTimeISO(),
        extra,
    };

    try {
        const create = (typeof window !== 'undefined' && window.createChatMessages)
            || (typeof createChatMessages === 'function' ? createChatMessages : null);
        if (typeof create === 'function') {
            const insertBefore = findInsertBeforeIndex(ctx, Number(anchorFloor));
            await create([{
                role: 'assistant',
                name: 'phone',
                ch_name: 'phone',
                is_hidden: false,
                message: text,
                extra,
            }], { insert_before: insertBefore, refresh: 'none' });
            if (Number.isInteger(insertBefore)) shiftAnchorsFrom(insertBefore, 1, Number(anchorFloor));
            const createdIdx = findBridgeIndexByAnchor(ctx, Number(anchorFloor));
            if (createdIdx >= 0 && ctx.chat[createdIdx]) {
                ctx.chat[createdIdx].mes = text;
                ctx.chat[createdIdx].name = 'phone';
                ctx.chat[createdIdx].ch_name = 'phone';
                ctx.chat[createdIdx].is_user = false;
                ctx.chat[createdIdx].is_system = false;
                ctx.chat[createdIdx].extra = { ...(ctx.chat[createdIdx].extra || {}), ...extra };
                await saveBridgeChat(ctx);
            }
            return true;
        }
    } catch (e) {
        console.warn('[ggg pp bridge] createChatMessages failed, fallback to ctx.chat', e);
    }

    ctx.chat.push(entry);
    await saveBridgeChat(ctx);
    return true;
}

async function hideBridgeForMessage(m) {
    if (!m) return false;
    return syncBridgeForAnchor(Number(m.anchorFloor));
}

function matchConv(m, scope, contactId, groupId) {
    if (scope && m.scope !== scope) return false;
    if (scope === 'private' && contactId && m.contactId !== contactId) return false;
    if (scope === 'group'   && groupId   && m.groupId   !== groupId) return false;
    return true;
}

export function listMessages({ scope, contactId, groupId } = {}) {
    const meta = getMeta();
    if (!meta) return [];
    return meta.messages.filter(m => matchConv(m, scope, contactId, groupId));
}

export function getNextSeq({ scope, contactId, groupId } = {}) {
    const list = listMessages({ scope, contactId, groupId });
    let max = 0;
    for (const m of list) {
        if (typeof m.seq === 'number' && m.seq > max) max = m.seq;
    }
    return max + 1;
}

export function getMaxSeq(args) {
    return Math.max(0, getNextSeq(args) - 1);
}

export async function appendMessage(msg) {
    const meta = getMeta();
    if (!meta) return null;
    const ctx = getCtx();
    const anchorFloor = getLastNonBridgeFloor(ctx);
    const baseScope = msg?.scope || 'private';
    const { deferBridge = false, ...cleanMsg } = msg || {};
    const full = {
        id: uid(),
        scope: baseScope,
        contactId: '',
        groupId: '',
        senderId: '__user__',
        senderRole: 'user',
        senderName: '',
        kind: 'text',
        payload: {},
        phoneTime: getPhoneTimeISO(),
        createdAt: Date.now(),
        anchorFloor: anchorFloor >= 0 ? anchorFloor : 0,
        anchorPos: 'after',
        translate: null,
        recalled: false,
        pending: false,
        reactions: [],
        ...cleanMsg,
    };
    if (typeof full.seq !== 'number') {
        full.seq = getNextSeq({ scope: full.scope, contactId: full.contactId, groupId: full.groupId });
    }
    meta.messages.push(full);
    if (!deferBridge && !full.pending) await syncBridgeForAnchor(Number(full.anchorFloor));
    await persist();
    return full;
}

export async function recallMessage(id) {
    const meta = getMeta();
    if (!meta) return false;
    const m = meta.messages.find(x => x.id === id);
    if (!m) return false;
    m.recalled = true;
    await syncBridgeForAnchor(Number(m.anchorFloor));
    await persist();
    return true;
}

export async function deleteMessage(id) {
    const meta = getMeta();
    if (!meta) return false;
    const idx = meta.messages.findIndex(x => x.id === id);
    if (idx < 0) return false;
    const anchorFloor = Number(meta.messages[idx].anchorFloor);
    await hideBridgeForMessage(meta.messages[idx]);
    meta.messages.splice(idx, 1);
    await syncBridgeForAnchor(anchorFloor);
    await persist();
    return true;
}

/** rc2：清掉指定会话下所有 pending 标记（发送成功后调） */
export async function clearPending({ scope, contactId, groupId } = {}) {
    const meta = getMeta();
    if (!meta) return;
    let dirty = false;
    const changed = [];
    for (const m of meta.messages) {
        if (m.pending && matchConv(m, scope, contactId, groupId)) {
            m.pending = false;
            dirty = true;
            changed.push(m);
        }
    }
    const anchors = Array.from(new Set(changed.map(m => Number(m.anchorFloor)).filter(n => Number.isInteger(n)))).sort((a, b) => b - a);
    for (const anchor of anchors) {
        await syncBridgeForAnchor(anchor);
    }
    if (dirty) await persist();
}

export function listPending({ scope, contactId, groupId } = {}) {
    return listMessages({ scope, contactId, groupId }).filter(m => m.pending);
}

/** rc2：给指定 seq 的消息加表态 */
export async function addReaction({ scope, contactId, groupId, targetSeq, emoji, actor }) {
    const meta = getMeta();
    if (!meta) return false;
    const m = meta.messages.find(x =>
        matchConv(x, scope, contactId, groupId) && x.seq === targetSeq
    );
    if (!m) return false;
    if (!Array.isArray(m.reactions)) m.reactions = [];
    m.reactions.push({ emoji, actor: actor || '', ts: Date.now() });
    await syncBridgeForAnchor(Number(m.anchorFloor));
    await persist();
    return true;
}

/** rc2：根据 seq 找消息（用于引用预览） */
export function findBySeq({ scope, contactId, groupId, seq }) {
    return listMessages({ scope, contactId, groupId }).find(m => m.seq === seq) || null;
}

/** rc3：按 seq 标记撤回 */
export async function markRecalledBySeq({ scope, contactId, groupId, seq }) {
    const m = findBySeq({ scope, contactId, groupId, seq });
    if (!m) return false;
    m.recalled = true;
    await syncBridgeForAnchor(Number(m.anchorFloor));
    await persist();
    return true;
}

/** rc3：更新指定消息的 payload（如转账状态） */
export async function patchMessage(id, patch) {
    const meta = getMeta();
    if (!meta) return false;
    const m = meta.messages.find(x => x.id === id);
    if (!m) return false;
    Object.assign(m, patch);
    if (patch.payload) m.payload = { ...m.payload, ...patch.payload };
    await syncBridgeForAnchor(Number(m.anchorFloor));
    await persist();
    return true;
}

export async function syncBridgedMessages({ scope, contactId, groupId, excludeIds = [] } = {}) {
    const anchors = Array.from(new Set(listMessages({ scope, contactId, groupId })
        .filter(m => !m.pending)
        .map(m => Number(m.anchorFloor))
        .filter(n => Number.isInteger(n) && n >= 0)))
        .sort((a, b) => b - a);
    let dirty = false;
    for (const anchor of anchors) {
        dirty = (await syncBridgeForAnchor(anchor, { excludeIds })) || dirty;
    }
    if (dirty) await persist();
}

/* 暴露到 window */
if (typeof window !== 'undefined') {
    window.__ggg_phone_pp_messages = {
        listMessages, appendMessage, recallMessage, deleteMessage,
        getNextSeq, getMaxSeq, clearPending, listPending, addReaction, findBySeq,
        markRecalledBySeq, patchMessage, syncBridgedMessages,
    };
}
