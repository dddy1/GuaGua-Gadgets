/**
 * PP 回复解析器 —— v0.2.57-rc8
 *
 * 协议（终版 r3）：
 *   <PP><chat>
 *     <昵称>
 *       #N|时间|种类|内容
 *       sysN|时间|种类|内容
 *     </昵称>
 *   </chat></PP>
 *
 * 字段 1：#N 角色 / &N 用户（AI 写新回复时不应出现）/ sysN 系统；N 是全局序号
 * 字段 2：时间，AI 写字面 {{phone_time}}，由本解析器替换为真实 ISO
 * 字段 3：种类（中文）：消息/语音/图片/表情包/转账/位置/语音通话/视频通话/骰子/引用/撤回/表态/时间分隔
 *       收款/退回回执建议写成：#N|{{phone_time}}|收款|[目标序号] 或 #N|{{phone_time}}|退回|[目标序号]
 * 字段 4+：内容，按种类不同语义；引用用二级分隔 ||
 *
 * rc3：
 *  - 没找到 <PP> 时：把整段非空文本兜底当一条 #text 消息返回（避免 events:[] 静默丢回复）
 *  - 撤回：内容为 [被撤序号]，由调用方据此把目标消息 markRecalled，本身不进时间线
 */
import { getPhoneTimeISO } from './phone-time.js';

const NAME_TO_KIND = {
    '消息': 'text', '文本': 'text',
    '语音': 'voice',
    '图片': 'image',
    '表情包': 'sticker', '表情': 'sticker',
    '转账': 'transfer',
    '位置': 'location', '定位': 'location',
    '语音通话': 'audio_call',
    '视频通话': 'video_call',
    '骰子': 'dice',
    '引用': 'quote',
    '撤回': 'recall',
    '表态': 'reaction',
    '时间分隔': 'timemarker',
    '收款': 'text', '退回': 'text',
};

function parseConversationTag(tagName) {
    const eq = tagName.indexOf('=');
    if (eq >= 0) {
        return { scope: 'group', name: tagName.slice(0, eq).trim(), declaredCount: parseInt(tagName.slice(eq + 1)) || 0 };
    }
    return { scope: 'private', name: tagName.trim() };
}

function extractTranslate(text) {
    const m = String(text || '').match(/^([\s\S]*?)<tr>([\s\S]*?)<\/tr>([\s\S]*)$/);
    if (m) return { primary: (m[1] + m[3]).trim(), translate: m[2].trim() };
    return { primary: String(text || ''), translate: null };
}

function estimateVoiceDuration(text) {
    const n = String(text || '').length;
    return Math.max(1, Math.min(60, Math.ceil(n / 4)));
}

function parseTransferReceipt(kindRaw, contentRaw) {
    const action = kindRaw === '退回' ? 'return' : 'receive';
    const mm = String(contentRaw || '').match(/^\s*\[(\d+)\]\s*(.*)$/);
    const targetSeq = mm ? parseInt(mm[1]) || 0 : 0;
    const actor = (mm?.[2] || '')
        .replace(/已收款|已退回/g, '')
        .trim();
    return {
        text: `[${targetSeq}]${actor}${action === 'return' ? '已退回' : '已收款'}`,
        type: 'transfer-status',
        action,
        targetSeq,
        actor,
        amount: 0,
        currency: '¥',
    };
}

function parseStickerPayload(contentRaw) {
    const raw = String(contentRaw || '').trim().replace(/^\[|\]$/g, '');
    let name = raw;
    let tag = '';
    const m = raw.match(/^(.+?)(?:,|#|@|\/)([^,#@/]+)$/);
    if (m) {
        name = m[1].trim();
        tag = m[2].trim();
    }
    return tag ? { name, tag } : { name };
}

function realizePhoneTime(macro) {
    if (!macro) return getPhoneTimeISO();
    if (/\{\{\s*phone_time\s*\}\}/i.test(macro)) return getPhoneTimeISO();
    const t = new Date(macro);
    if (!isNaN(t.getTime())) return t.toISOString();
    return getPhoneTimeISO();
}

function parseLine(line) {
    line = line.trim();
    if (!line) return null;

    const head = line.match(/^(sys|#|&)(\d+)\|(.+)$/);
    if (!head) return null;

    const prefix = head[1];
    const seq = parseInt(head[2]);
    const rest = head[3];
    const senderRole = prefix === '#' ? 'char' : prefix === '&' ? 'user' : 'sys';

    const parts = rest.split('|');
    const phoneTimeMacro = parts[0] || '{{phone_time}}';
    const kindRaw = (parts[1] || '').trim();
    const kind = NAME_TO_KIND[kindRaw] || 'text';
    const contentRaw = parts.slice(2).join('|');

    const event = {
        seq, senderRole, kind,
        phoneTimeMacro,
        phoneTime: realizePhoneTime(phoneTimeMacro),
        payload: {},
    };

    switch (kind) {
        case 'text': {
            if (kindRaw === '收款' || kindRaw === '退回') {
                event.payload = parseTransferReceipt(kindRaw, contentRaw);
                break;
            }
            const { primary, translate } = extractTranslate(contentRaw);
            event.payload = { text: primary, translate };
            break;
        }
        case 'voice': {
            const { primary, translate } = extractTranslate(contentRaw);
            event.payload = {
                transcript: primary, translate,
                duration: estimateVoiceDuration(primary),
            };
            break;
        }
        case 'image': {
            event.payload = { alt: contentRaw.trim() };
            break;
        }
        case 'sticker': {
            event.payload = parseStickerPayload(contentRaw);
            break;
        }
        case 'transfer': {
            const segs = contentRaw.split(',').map(s => s.trim());
            let amount = 0, note = '';
            const raw = contentRaw.trim();
            const amountMatch = raw.match(/-?\d+(?:\.\d+)?/);
            if (segs.length >= 2) {
                if (/^-?\d/.test(segs[0])) { amount = parseFloat(segs[0]) || 0; note = segs.slice(1).join(','); }
                else { note = segs[0]; amount = parseFloat(segs[1]) || 0; }
            } else {
                amount = parseFloat(segs[0]) || 0;
            }
            if ((!amount || Number.isNaN(amount)) && amountMatch) amount = parseFloat(amountMatch[0]) || 0;
            if (!note && amountMatch) note = raw.replace(amountMatch[0], '').replace(/[¥￥元,，:：]/g, '').trim();
            event.payload = { amount, note, currency: '¥', status: 'pending' }; // pending|received|returned
            break;
        }
        case 'location': {
            event.payload = { desc: contentRaw.trim() };
            break;
        }
        case 'audio_call':
        case 'video_call': {
            event.payload = { status: contentRaw.trim() || '已通话' };
            break;
        }
        case 'dice': {
            const n = parseInt(contentRaw.trim());
            event.payload = { point: (n >= 1 && n <= 6) ? n : (Math.floor(Math.random() * 6) + 1) };
            break;
        }
        case 'quote': {
            const mm = contentRaw.match(/^\s*\[(\d+)\](.*?)(?:\|\|([\s\S]*))?$/);
            if (mm) {
                const bodyRaw = (mm[3] || '').trim();
                const { primary: bodyText, translate: bodyTr } = extractTranslate(bodyRaw);
                event.payload = {
                    quoteSeq: parseInt(mm[1]) || 0,
                    quoteSummary: (mm[2] || '').trim(),
                    text: bodyText,
                    translate: bodyTr,
                };
            } else {
                const { primary, translate } = extractTranslate(contentRaw);
                event.payload = { text: primary, translate };
            }
            break;
        }
        case 'recall': {
            // 内容格式：[被撤序号]
            const mm = contentRaw.match(/^\s*\[(\d+)\]/);
            let jsonSeq = 0;
            if (!mm && /^\s*\{/.test(contentRaw)) {
                try { jsonSeq = parseInt(JSON.parse(contentRaw).targetSeq) || 0; } catch {}
            }
            event.payload = { targetSeq: mm ? parseInt(mm[1]) : jsonSeq };
            break;
        }
        case 'reaction': {
            const mm = contentRaw.match(/^\s*\[(\d+)\](.*)$/);
            event.payload = mm ? {
                targetSeq: parseInt(mm[1]) || 0,
                emoji: (mm[2] || '').trim(),
            } : { emoji: contentRaw.trim() };
            break;
        }
        case 'timemarker':
        default:
            event.payload = { raw: contentRaw };
    }

    return event;
}

/** 兜底：把整段 raw 当作单条文本气泡 */
function buildFallbackConversation(rawText) {
    const cleaned = rawText
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '')
        .trim();
    if (!cleaned) return null;
    return {
        scope: 'private',
        name: '__fallback__',
        events: [{
            seq: 0,
            senderRole: 'char',
            kind: 'text',
            phoneTime: getPhoneTimeISO(),
            payload: { text: cleaned, translate: null, fallback: true },
        }],
    };
}

export function parseAIReply(rawText) {
    const result = { conversations: [], moments: [], warnings: [], rawText };
    if (!rawText || typeof rawText !== 'string') {
        result.warnings.push('回复为空或非字符串');
        return result;
    }

    // rc6：先剥掉 <think>...</think>，避免思维链里的占位 <chat> 干扰
    const cleanText = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '')
                             .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');

    // <PP> 可选；只要找到 <chat> 就当作 PP 回复
    let ppBody;
    const ppMatch = cleanText.match(/<PP>([\s\S]*?)<\/PP>/);
    if (ppMatch) {
        ppBody = ppMatch[1];
    } else if (/<chat>/.test(cleanText)) {
        ppBody = cleanText;
        result.warnings.push('未找到 <PP> 包裹，但发现 <chat>，按裸 chat 解析');
    } else {
        result.warnings.push('未找到 <PP> 也未找到 <chat>，按纯文本兜底');
        const fb = buildFallbackConversation(cleanText || rawText);
        if (fb) result.conversations.push(fb);
        return result;
    }

    const chatMatch = ppBody.match(/<chat>([\s\S]*?)<\/chat>/);
    if (chatMatch) {
        const chatBody = chatMatch[1];
        // 用 u 标志支持中文/任意 Unicode 标签名
        const innerRe = /<([^\/<>\s\n][^<>\n]*?)>([\s\S]*?)<\/\1>/gu;
        let im;
        while ((im = innerRe.exec(chatBody)) !== null) {
            const meta = parseConversationTag(im[1]);
            const events = im[2].split(/\r?\n/)
                .map(parseLine)
                .filter(Boolean);
            if (meta.scope === 'group') {
                events.forEach(ev => { ev.senderName = meta.name; });
            }
            result.conversations.push({ ...meta, events });
        }
        if (result.conversations.length === 0) {
            // rc4：没有 <昵称> 包裹时，把 <chat> 里直接出现的行也尝试解析
            const looseEvents = chatBody.split(/\r?\n/).map(parseLine).filter(Boolean);
            if (looseEvents.length > 0) {
                result.conversations.push({ scope: 'private', name: '__loose__', events: looseEvents });
                result.warnings.push('<chat> 未包 <昵称>，已按裸行解析');
            } else if (chatBody.trim() === '...' || /^\s*\.{2,}\s*$/.test(chatBody)) {
                // rc6：AI 输出了 <chat>...</chat> 占位符，明确告警，不再生成无意义气泡
                result.warnings.push('AI 只输出了占位 <chat>...</chat>，无任何消息内容');
            } else {
                result.warnings.push('<chat> 内未发现任何 <昵称>...</昵称>，按纯文本兜底');
                const fb = buildFallbackConversation(ppBody);
                if (fb) result.conversations.push(fb);
            }
        }
    } else {
        result.warnings.push('未找到 <chat>...</chat>');
        const fb = buildFallbackConversation(ppBody);
        if (fb) result.conversations.push(fb);
    }

    const momentsMatch = ppBody.match(/<moments>([\s\S]*?)<\/moments>/);
    if (momentsMatch) result.moments.push({ raw: momentsMatch[1] });

    return result;
}

if (typeof window !== 'undefined') {
    window.__ggg_pp_parser = { parseAIReply };
}
