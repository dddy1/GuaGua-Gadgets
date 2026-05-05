/**
 * PP 发送器 —— v0.2.57-rc8
 *
 * 大改：
 *  - 用 TavernHelper.generateRaw + ordered_prompts，完全自己控制最终 messages 数组
 *  - 自己控制固定提示词，同时在预设的"历史"位置交给酒馆原生 chat_history
 *  - injects 一条都不发，避免 role 被酒馆改写
 *  - 每个预设条目按 entry.role 真生效；entries 顺序就是发送顺序
 *  - rawPrompt 诊断字段直接存 messages JSON，所见即所发
 *  - recall 解析后真正把目标 message markRecalled
 *  - 空回复返回明确报错
 */
import {
    appendMessage, listMessages, clearPending, addReaction,
    getMaxSeq, markRecalledBySeq, findBySeq, deleteMessage,
    syncBridgedMessages,
} from '../apps/pp/messages.js';
import { parseAIReply } from './pp-parser.js';
import { settings } from '../../../index.js';
import { getPhoneNow, getPhoneTimeISO } from './phone-time.js';

function getCtx() {
    try { return (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null; } catch { return null; }
}

function getTH() {
    return (typeof window !== 'undefined' && window.TavernHelper) ? window.TavernHelper : null;
}
function getGenerateRaw() {
    const th = getTH();
    if (th && typeof th.generateRaw === 'function') return th.generateRaw.bind(th);
    return null;
}
function getGenerateLegacy() {
    const th = getTH();
    if (th && typeof th.generate === 'function') return th.generate.bind(th);
    return null;
}

async function generateRawWithPrompts(ordered_prompts) {
    const generateRaw = getGenerateRaw();
    if (!generateRaw) {
        return {
            rawResponse: '',
            error: '未检测到 TavernHelper.generateRaw（请确认安装了酒馆助手 v2 / JS-Slash-Runner ≥ 3.x）。',
        };
    }
    try {
        let rawResponse = await generateRaw({
            user_input: '',
            ordered_prompts,
            should_silence: true,
            max_chat_history: 'all',
            overrides: {
                world_info_before: '',
                world_info_after: '',
                persona_description: '',
                char_description: '',
                char_personality: '',
                scenario: '',
                dialogue_examples: '',
            },
        });
        if (typeof rawResponse !== 'string') {
            rawResponse = String(rawResponse?.content ?? rawResponse ?? '');
        }
        if (!rawResponse.trim()) {
            return {
                rawResponse,
                error: '回复为空。可能原因：API 限流 / 内容审核拦截 / 模型未返回 / 配置错误。请打开浏览器控制台或酒馆日志查看详细错误。',
            };
        }
        return { rawResponse, error: null };
    } catch (e) {
        return { rawResponse: '', error: '生成失败：' + String(e?.message || e) };
    }
}

async function applyRawResponseToConversation(rawResponse, request = {}) {
    const {
        scope = 'private', contactId = '', groupId = '',
        contactName = '', forceCurrentConversation = false,
    } = request || {};

    const parsed = parseAIReply(rawResponse || '');
    const savedMsgIds = [];

    for (const conv of parsed.conversations) {
        const cn = String(conv.name || '').trim();
        const expected = String(contactName || '').trim();
        const matchedThisConv =
            forceCurrentConversation
            || parsed.conversations.length === 1
            || cn === '__fallback__'
            || cn === '__loose__'
            || (scope === 'private' && (cn === expected || parsed.conversations.length === 1))
            || (scope === 'group' && cn === expected)
            || (scope === 'group' && parsed.conversations.length === 1);

        if (!matchedThisConv) continue;

        for (const ev of conv.events) {
            if (ev.kind === 'timemarker') continue;
            if (ev.senderRole === 'user') continue;

            if (ev.kind === 'recall') {
                const targetSeq = Number(ev.payload?.targetSeq) || 0;
                if (targetSeq > 0) await markRecalledBySeq({ scope, contactId, groupId, seq: targetSeq });
                const recallerName = ev.senderName || contactName || '对方';
                const recalledMsg = targetSeq > 0 ? findBySeq({ scope, contactId, groupId, seq: targetSeq }) : null;
                const saved = await appendMessage({
                    scope, contactId, groupId,
                    senderRole: 'sys', senderId: '__sys__',
                    peerName: contactName,
                    kind: 'text',
                    payload: {
                        text: `${recallerName}撤回了一条消息`,
                        recalledMsgId: recalledMsg?.id || '',
                    },
                    phoneTime: getPhoneTimeISO(),
                    anchorPos: 'after',
                    deferBridge: true,
                });
                if (saved?.id) savedMsgIds.push(saved.id);
                continue;
            }

            if (ev.kind === 'reaction' && ev.payload?.targetSeq) {
                await addReaction({
                    scope, contactId, groupId,
                    targetSeq: ev.payload.targetSeq,
                    emoji: ev.payload.emoji,
                    actor: ev.senderName || contactName || '',
                });
            }

            const saved = await appendMessage({
                scope, contactId, groupId,
                senderId: ev.senderRole === 'sys' ? '__sys__' : (contactId || groupId),
                senderRole: ev.senderRole,
                senderName: ev.senderName || (scope === 'private' ? contactName : ''),
                peerName: contactName,
                kind: ev.kind,
                payload: ev.payload || {},
                phoneTime: ev.phoneTime || getPhoneTimeISO(),
                seq: typeof ev.seq === 'number' && ev.seq > 0 ? ev.seq : undefined,
                anchorPos: 'after',
                translate: ev.payload?.translate || null,
                deferBridge: true,
            });
            if (saved?.id) savedMsgIds.push(saved.id);
        }
    }

    return { parsed, savedMsgIds };
}

const WD = ['周日','周一','周二','周三','周四','周五','周六'];
function fmtAnchor(d) {
    const Y = d.getFullYear(), M = String(d.getMonth()+1).padStart(2,'0'), D = String(d.getDate()).padStart(2,'0');
    const h = String(d.getHours()).padStart(2,'0'), m = String(d.getMinutes()).padStart(2,'0');
    return `${Y}-${M}-${D}（${WD[d.getDay()]}）${h}:${m}`;
}

export function formatRelativeTime(iso, now = getPhoneNow()) {
    if (!iso) return '';
    const t = new Date(iso);
    if (isNaN(t.getTime())) return '';
    const HHMM = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
    const diffMs = now.getTime() - t.getTime();
    if (diffMs >= 0 && diffMs < 60_000) return '刚刚';
    if (diffMs >= 0 && diffMs <= 180_000) return `${Math.max(1, Math.floor(diffMs / 60_000))}分钟前`;
    const sameDay = t.toDateString() === now.toDateString();
    if (sameDay) return HHMM;
    const oneDay = 86400000;
    const startToday = new Date(now); startToday.setHours(0,0,0,0);
    const startThat  = new Date(t);   startThat.setHours(0,0,0,0);
    const diffDays = Math.round((startToday.getTime() - startThat.getTime()) / oneDay);
    if (diffDays === 1) return `昨天 ${HHMM}`;
    if (diffDays === 2) return `前天 ${HHMM}`;
    const Y = t.getFullYear(), M = String(t.getMonth()+1).padStart(2,'0'), D = String(t.getDate()).padStart(2,'0');
    return `${Y}-${M}-${D} ${HHMM}`;
}

const KIND_TO_NAME = {
    text: '消息', voice: '语音', image: '图片', sticker: '表情包',
    transfer: '转账', location: '位置',
    audio_call: '语音通话', video_call: '视频通话',
    dice: '骰子', quote: '引用', recall: '撤回', reaction: '表态',
    timemarker: '时间分隔', system: '系统',
};

function buildContentForPrompt(m) {
    const p = m.payload || {};
    if (m.kind === 'text' && p.type === 'recall-status') return `[${p.targetSeq || 0}]`;
    if (m.kind === 'text' && p.type === 'transfer-status') return `[${p.targetSeq || 0}]`;
    switch (m.kind) {
        case 'text':       return p.text || '';
        case 'voice':      return p.transcript || '';
        case 'image':      return p.alt || '';
        case 'sticker':    return p.tag ? `${p.name || ''},${p.tag}` : (p.name || '');
        case 'transfer':   return `${p.amount || 0},${p.note || ''}`;
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

function promptPrefix(m) {
    const p = m.payload || {};
    if (m.kind === 'text' && (p.type === 'recall-status' || p.type === 'transfer-status')) return '&';
    return m.senderRole === 'user' ? '&' : m.senderRole === 'sys' ? 'sys' : '#';
}

function promptKindName(m) {
    const p = m.payload || {};
    if (m.kind === 'text' && p.type === 'recall-status') return '撤回';
    if (m.kind === 'text' && p.type === 'transfer-status') {
        return p.action === 'return' ? '退回' : '收款';
    }
    return KIND_TO_NAME[m.kind] || m.kind;
}

function _msgToLine(m, phoneNow) {
    const prefix = promptPrefix(m);
    const t = formatRelativeTime(m.phoneTime, new Date(phoneNow));
    const kindName = promptKindName(m);
    const content = buildContentForPrompt(m);
    return `${prefix}${m.seq}|${t}|${kindName}|${content}`;
}

function readMessageText(m) {
    return String(m?.message ?? m?.mes ?? '').trim();
}

function readTavernHistoryForDisplay(ctx) {
    let messages = [];
    try {
        const getter = (typeof window !== 'undefined' && window.getChatMessages)
            || (typeof getChatMessages === 'function' ? getChatMessages : null);
        const lastGetter = (typeof window !== 'undefined' && window.getLastMessageId)
            || (typeof getLastMessageId === 'function' ? getLastMessageId : null);
        const lastId = typeof lastGetter === 'function'
            ? Number(lastGetter())
            : (Array.isArray(ctx?.chat) ? ctx.chat.length - 1 : -1);
        if (typeof getter === 'function' && lastId >= 0) {
            messages = getter(`0-${lastId}`, { role: 'all', hide_state: 'unhidden', include_swipes: false }) || [];
        }
    } catch (e) {
        console.warn('[ggg-sender] 展示用 chat_history 读取失败，使用 ctx.chat 兜底', e);
    }
    if (!messages.length && Array.isArray(ctx?.chat)) {
        messages = ctx.chat
            .map((m, index) => ({
                message_id: index,
                role: m.is_user ? 'user' : 'assistant',
                message: m.mes,
                is_hidden: !!m.is_system,
            }))
            .filter(m => !m.is_hidden);
    }
    return messages
        .map(m => ({ role: m.role || (m.is_user ? 'user' : 'assistant'), content: readMessageText(m) }))
        .filter(m => m.content);
}

function buildDisplayPrompts(ordered_prompts) {
    const ctx = getCtx();
    const history = readTavernHistoryForDisplay(ctx);
    const display = [];
    for (const p of ordered_prompts || []) {
        if (p === 'chat_history') {
            if (history.length) display.push(...history.map(m => ({ ...m, source: 'chat_history' })));
            else display.push({ role: 'system', source: 'chat_history', content: '(暂无酒馆历史)' });
            continue;
        }
        display.push(p);
    }
    return display;
}

function versionNumber(version, fallback) {
    const fromNumber = Number(version?.number);
    if (Number.isFinite(fromNumber) && fromNumber > 0) return fromNumber;
    const fromId = String(version?.id || '').match(/^v(\d+)$/);
    if (fromId) return Number(fromId[1]);
    const fromLabel = String(version?.label || '').match(/(\d+)/);
    if (fromLabel) return Number(fromLabel[1]);
    return fallback;
}

function normalizeReplyVersions(versions) {
    return (Array.isArray(versions) ? versions : []).map((version, index) => {
        const number = versionNumber(version, index + 1);
        return {
            ...version,
            id: String(version?.id || `v${number}`),
            number,
            label: `版本 ${number}`,
        };
    }).sort((a, b) => a.number - b.number);
}

function makeReplyVersion(number, data = {}) {
    return {
        id: `v${number}`,
        number,
        label: `版本 ${number}`,
        rawResponse: data.rawResponse || '',
        parsed: data.parsed || null,
        savedMsgIds: Array.isArray(data.savedMsgIds) ? data.savedMsgIds.slice() : [],
        ts: data.ts || Date.now(),
    };
}

function ensureReplyVersions(snapshot) {
    const snap = snapshot || {};
    const versions = normalizeReplyVersions(snap.replyVersions);
    if (versions.length) return versions;
    if (snap.rawResponse || snap.parsed) {
        return [makeReplyVersion(1, snap)];
    }
    return [];
}

function nextReplyVersionNumber(versions) {
    return versions.reduce((max, version) => Math.max(max, Number(version.number) || 0), 0) + 1;
}

function activeReplyVersionId(snapshot, versions) {
    const activeId = snapshot?.activeVersionId;
    if (activeId && versions.some(v => v.id === activeId)) return activeId;
    return versions[versions.length - 1]?.id || '';
}

/** 仅未发送的待发用户消息（rc4 新增）—— 拼到 <user_input> 块内 */
function buildPendingUserLines({ scope, contactId, groupId }) {
    const phoneNow = getPhoneNow();
    const list = listMessages({ scope, contactId, groupId })
        .filter(m => {
            if (!m.pending || m.deleted) return false;
            if (m.senderRole === 'user') return !m.recalled;
            return m.senderRole === 'sys';
        })
        .sort((a, b) => (a.seq || 0) - (b.seq || 0));
    return list.map(m => _msgToLine(m, phoneNow));
}

function buildOrderedPromptsForConversation(opts) {
    const {
        scope = 'private', contactId = '', groupId = '',
        contactName = '',
    } = opts || {};

    const phoneNow = getPhoneNow();
    const pendingLines = buildPendingUserLines({ scope, contactId, groupId });
    const maxSeq = getMaxSeq({ scope, contactId, groupId });
    const blocks = getOrderedBlocks();

    const ordered_prompts = [];

    for (const b of blocks) {
        if (!b) continue;
        const role = b.role || 'system';

        if (b.type === 'fixed-history' || b.name === '历史') {
            ordered_prompts.push('chat_history');
            continue;
        }

        if (b.type === 'fixed-latest' || b.name === '最新用户回复') {
            continue;
        }

        if (b.content && b.content !== '(空)') {
            ordered_prompts.push({ role, content: b.content });
        }
    }

    const openIdx = ordered_prompts.findIndex(p => p && typeof p.content === 'string' && p.content.trim() === '<user_input>');
    const closeIdx = ordered_prompts.findIndex(p => p && typeof p.content === 'string' && p.content.trim() === '</user_input>');
    const userInputBody = pendingLines.length > 0
        ? pendingLines.join('\n')
        : '(本轮用户没有新输入，请按当前时间自然延续话题)';
    if (openIdx >= 0 && closeIdx > openIdx) {
        ordered_prompts.splice(openIdx + 1, 0, { role: 'system', content: userInputBody });
    } else {
        ordered_prompts.push({ role: 'system', content: '<user_input>\n' + userInputBody + '\n</user_input>' });
    }

    const tailParts = [];
    tailParts.push(`[当前时间] ${fmtAnchor(phoneNow)}`);
    tailParts.push(`下一条消息序号请从 ${maxSeq + 1} 开始递增。`);
    if (pendingLines.length > 0) {
        tailParts.push(`本轮用户新输入共 ${pendingLines.length} 条，已列在 <user_input> 中，请按要求回复。`);
    }
    ordered_prompts.push({
        role: 'user',
        content: tailParts.join('\n'),
    });

    try {
        const tg = (typeof window !== 'undefined' && (settings?.phone?.pp?.thinkGuard)) || null;
        if (tg && tg.enabled !== false) {
            const content = (tg.content && String(tg.content).trim()) || '<think>\n好，我已经把要回复的内容想清楚了。下面我直接按 PP 协议输出 <PP><chat><昵称>...</昵称></chat></PP>，不再写思考内容。\n</think>';
            ordered_prompts.push({ role: 'assistant', content });
        }
    } catch (e) {}

    return {
        ordered_prompts,
        pendingLines,
        maxSeq,
        phoneNow,
    };
}

/** 取设置里钩子返回的"按顺序、带 type/role/content"的预设条目列表 */
function getOrderedBlocks() {
    try {
        if (typeof window !== 'undefined' && typeof window.__ggg_build_preset_blocks === 'function') {
            return window.__ggg_build_preset_blocks() || [];
        }
    } catch (e) {
        console.warn('[ggg-sender] 取预设失败', e);
    }
    return [];
}

/** 用户阶段输入：立即落库，pending=true */
export async function stagePPMessage(opts) {
    const { scope = 'private', contactId = '', groupId = '', contactName = '', kind = 'text', payload = {} } = opts || {};
    return await appendMessage({
        scope, contactId, groupId,
        senderId: '__user__', senderRole: 'user',
        peerName: contactName,
        kind, payload,
        phoneTime: getPhoneTimeISO(),
        anchorPos: 'after',
        pending: true,
    });
}

/**
 * 主入口：把会话历史 + 预设条目按顺序拼成 ordered_prompts，
 * 用 generateRaw 发出去，解析回复，落 AI 消息
 */
export async function flushPPConversation(opts) {
    const {
        scope = 'private', contactId = '', groupId = '',
        contactName = '',
    } = opts || {};

    await syncBridgedMessages();
    const ctx = getCtx();
    const chatLen = Array.isArray(ctx?.chat) ? ctx.chat.length : 0;
    const { ordered_prompts, pendingLines } = buildOrderedPromptsForConversation({ scope, contactId, groupId, contactName });

    const { rawResponse, error } = await generateRawWithPrompts(ordered_prompts);
    const applied = await applyRawResponseToConversation(rawResponse || '', {
        scope, contactId, groupId, contactName, chatLen,
    });
    const parsed = applied.parsed;
    const savedMsgIds = applied.savedMsgIds;
    const replyVersions = rawResponse || parsed
        ? [makeReplyVersion(1, { rawResponse, parsed, savedMsgIds })]
        : [];

    // 清 pending（成功才清）
    if (!error && savedMsgIds.length > 0) {
        await clearPending({ scope, contactId, groupId });
        await syncBridgedMessages();
    }

    // 诊断快照：直接存"实际发送的 messages JSON"
    const snapshot = {
        sentMessages: ordered_prompts,
        sentMessagesForDisplay: null,
        rawResponse,
        parsed,
        savedMsgIds,
        error,
        request: { scope, contactId, groupId, contactName, chatLen },
        replyVersions,
        activeVersionId: replyVersions[0]?.id || '',
        promptPreviewLoaded: false,
        ts: Date.now(),
    };
    if (typeof window !== 'undefined') window.__ggg_pp_last_send = snapshot;
    return snapshot;
}

export async function sendPP(opts) {
    const { userKind, userPayload, ...rest } = opts || {};
    if (userKind) await stagePPMessage({ ...rest, kind: userKind, payload: userPayload });
    return await flushPPConversation(rest);
}

export async function previewPPPrompt(opts) {
    const {
        scope = 'private', contactId = '', groupId = '',
        contactName = '',
    } = opts || {};
    const ctx = getCtx();
    const chatLen = Array.isArray(ctx?.chat) ? ctx.chat.length : 0;
    await syncBridgedMessages();
    const { ordered_prompts } = buildOrderedPromptsForConversation({ scope, contactId, groupId, contactName });
    const snapshot = {
        sentMessages: ordered_prompts,
        sentMessagesForDisplay: buildDisplayPrompts(ordered_prompts),
        rawResponse: '',
        parsed: null,
        savedMsgIds: [],
        error: null,
        request: { scope, contactId, groupId, contactName, chatLen },
        promptOnly: true,
        ts: Date.now(),
    };
    if (typeof window !== 'undefined') window.__ggg_pp_last_prompt_preview = snapshot;
    return snapshot;
}

export async function replacePPReplyFromSnapshot(snapshot, rawResponse, versionId = '') {
    const snap = snapshot || {};
    if (Array.isArray(snap.savedMsgIds)) {
        for (const id of snap.savedMsgIds) {
            try { await deleteMessage(id); } catch (e) {}
        }
    }
    const request = snap.request || {};
    const applied = await applyRawResponseToConversation(rawResponse || '', { ...request, forceCurrentConversation: true });
    const versions = ensureReplyVersions(snap);
    const targetId = versionId || snap.activeVersionId || activeReplyVersionId(snap, versions) || 'v1';
    let targetFound = false;
    const nextVersions = versions.map(version => {
        if (version.id !== targetId) return version;
        targetFound = true;
        return {
            ...version,
            rawResponse: rawResponse || '',
            parsed: applied.parsed,
            savedMsgIds: applied.savedMsgIds,
            ts: Date.now(),
        };
    });
    if (!targetFound) {
        const number = nextReplyVersionNumber(nextVersions);
        nextVersions.push(makeReplyVersion(number, {
            rawResponse,
            parsed: applied.parsed,
            savedMsgIds: applied.savedMsgIds,
        }));
    }
    const normalizedVersions = normalizeReplyVersions(nextVersions);
    const activeVersionId = targetFound ? targetId : normalizedVersions[normalizedVersions.length - 1]?.id || '';
    const next = {
        ...snap,
        replyVersions: normalizedVersions,
        activeVersionId,
        rawResponse: rawResponse || '',
        parsed: applied.parsed,
        savedMsgIds: applied.savedMsgIds,
        error: null,
        edited: true,
        ts: Date.now(),
    };
    if (typeof window !== 'undefined') window.__ggg_pp_last_send = next;
    return next;
}

export async function refreshPPReplyFromSnapshot(snapshot) {
    const snap = snapshot || {};
    const sentMessages = Array.isArray(snap.sentMessages) ? snap.sentMessages : [];
    if (!sentMessages.length) {
        return { ...snap, error: '没有可复用的实际发送 messages。请先发送一次 PP 消息。' };
    }
    const currentReplyIds = Array.isArray(snap.savedMsgIds) ? snap.savedMsgIds.filter(Boolean) : [];
    let generated;
    try {
        if (currentReplyIds.length) await syncBridgedMessages({ excludeIds: currentReplyIds });
        generated = await generateRawWithPrompts(sentMessages);
    } finally {
        if (currentReplyIds.length) await syncBridgedMessages();
    }
    const { rawResponse, error } = generated;
    if (error) {
        const failed = { ...snap, rawResponse, error, refreshed: true, ts: Date.now() };
        if (typeof window !== 'undefined') window.__ggg_pp_last_send = failed;
        return failed;
    }
    const parsed = parseAIReply(rawResponse || '');
    const versions = ensureReplyVersions(snap);
    const version = makeReplyVersion(nextReplyVersionNumber(versions), {
        rawResponse,
        parsed,
        savedMsgIds: [],
    });
    versions.push(version);
    const next = {
        ...snap,
        rawResponse,
        parsed,
        replyVersions: normalizeReplyVersions(versions),
        activeVersionId: version.id,
        error,
        refreshed: true,
        ts: Date.now(),
    };
    if (typeof window !== 'undefined') window.__ggg_pp_last_send = next;
    return next;
}

if (typeof window !== 'undefined') {
    window.__ggg_pp_sender = {
        sendPP, stagePPMessage, flushPPConversation, formatRelativeTime, previewPPPrompt,
        replacePPReplyFromSnapshot, refreshPPReplyFromSnapshot,
    };
}
