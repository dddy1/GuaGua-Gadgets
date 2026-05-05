/**
 * PP 私聊/群聊对话页 —— v0.2.57-rc8
 *
 * rc5 改动：
 *  - 左划面板（点头像）：我的资料编辑（昵称/签名/余额/在线/自动翻译）
 *  - 三点菜单 → 好友设置抽屉：备注 + 聊天背景（可改）+ 拉黑/删除占位
 *  - 长按 popmenu：用 _justOpenedAt 时间戳防 stream click 立即关
 *  - 撤回仅对 pending（未发送）的用户消息生效；点击实际删除该消息
 *  - 翻译消息去掉视觉聚焦边框/底色
 *  - 图片气泡：仅描述卡片有遮罩，图标只在遮罩里，文字居中，过多内容滚动
 *  - 多选模式：长按出现"多选" → 进入多选 → 底部工具栏（删除 / 收藏 / 取消）
 *  - 收藏：messages 上加 favorite=true（持久化）
 */
import {
    listMessages, recallMessage, addReaction, findBySeq,
    appendMessage, patchMessage, deleteMessage,
} from '../messages.js';
import {
    stagePPMessage, flushPPConversation, formatRelativeTime,
    previewPPPrompt, replacePPReplyFromSnapshot, refreshPPReplyFromSnapshot,
} from '../../../core/pp-sender.js';
import { findStickerByName, listStickers } from '../../../core/sticker-library.js';
import { listStBackgrounds } from '../../../core/background.js';
import { persistCurrentMeProfile } from '../store.js';
import { applyPPAppearanceStyles } from '../components.js';
import { readLocalContactExt, writeLocalContactExt } from '../local-prefs.js';
import { settings, saveAllSettings } from '../../../../../index.js';

const FIVE_MIN = 5 * 60 * 1000;
const COMMON_REACT_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉'];
const REVEAL_MS_PER_CHAR = 35;
const REVEAL_MIN_DELAY = 250;
const REVEAL_MAX_DELAY = 2500;

const ONLINE_OPTIONS = [
    { v: 'online',    l: '在线', color: '#22c55e' },
    { v: 'busy',      l: '忙碌', color: '#f59e0b' },
    { v: 'invisible', l: '隐身', color: '#9ca3af' },
    { v: 'offline',   l: '离线', color: '#9ca3af' },
];
function onlineLabel(v) {
    if (v === 'invisible') return '离线';
    return (ONLINE_OPTIONS.find(o => o.v === v)?.l) || '离线';
}
function onlineColor(v) {
    if (v === 'invisible') return '#9ca3af';
    return (ONLINE_OPTIONS.find(o => o.v === v)?.color) || '#9ca3af';
}

function getCtx() {
    try { return (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null; } catch { return null; }
}
function ensureMe() {
    if (!settings.phone) settings.phone = {};
    if (!settings.phone.pp) settings.phone.pp = {};
    if (!settings.phone.pp.me) settings.phone.pp.me = { nickname: '', signature: '', online: 'online' };
    delete settings.phone.pp.me.balance;
    if (!settings.phone.pp.me.online) settings.phone.pp.me.online = 'online';
    return settings.phone.pp.me;
}
function getUserName() { return ensureMe().nickname || getCtx()?.name1 || '我'; }
function normalizeWalletBalance(value, fallback = 3.0) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : fallback;
}

function contactExtKey(scope, contact) {
    const id = String(contact?.id || '').trim();
    return id ? `${scope || 'private'}:${id}` : '';
}
function ensureContactExtStore() {
    if (!settings.phone) settings.phone = {};
    if (!settings.phone.pp) settings.phone.pp = {};
    if (!settings.phone.pp.contactExtByKey || typeof settings.phone.pp.contactExtByKey !== 'object') {
        settings.phone.pp.contactExtByKey = {};
    }
    const liveState = (typeof window !== 'undefined') ? window.__ggg_phone_pp_store?.state : null;
    if (liveState && (!liveState.contactExtByKey || typeof liveState.contactExtByKey !== 'object')) {
        liveState.contactExtByKey = settings.phone.pp.contactExtByKey;
    }
    return settings.phone.pp.contactExtByKey;
}
function readContactExt(contact, scope = 'private') {
    const key = contactExtKey(scope, contact);
    const saved = key ? (readLocalContactExt(key) || ensureContactExtStore()[key] || {}) : {};
    const hasSaved = (prop) => Object.prototype.hasOwnProperty.call(saved, prop);
    return {
        online: hasSaved('online') ? saved.online : (contact?.online || 'online'),
        signature: hasSaved('signature') ? saved.signature : (contact?.signature || ''),
        bgUrl: hasSaved('bgUrl') ? saved.bgUrl : (contact?.bgUrl || ''),
        remark: hasSaved('remark') ? saved.remark : (contact?.remark || ''),
    };
}
function saveContactExt(contact, scope, patch) {
    const key = contactExtKey(scope, contact);
    if (!key) return;
    const next = {
        ...(readLocalContactExt(key) || {}),
        ...patch,
    };
    writeLocalContactExt(key, next);
    const liveState = (typeof window !== 'undefined') ? window.__ggg_phone_pp_store?.state : null;
    if (liveState) {
        if (!liveState.contactExtByKey || typeof liveState.contactExtByKey !== 'object') liveState.contactExtByKey = {};
        liveState.contactExtByKey[key] = next;
    }
}

export function createPPChatDetailPage(Vue) {
    const { ref, computed, nextTick, onMounted, onUnmounted, watch } = Vue;

    return Vue.defineComponent({
        name: 'PPChatDetail',
        props: {
            scope:    { type: String, default: 'private' },
            contact:  { type: Object, required: true },
            me:       { type: Object, required: true },
            onBack:   { type: Function, required: true },
        },
        setup(props) {
            const backendToken = `pp-chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const pendingTimers = new Set();
            let disposed = false;
            const later = (fn, ms) => {
                const id = setTimeout(() => {
                    pendingTimers.delete(id);
                    if (!disposed) fn();
                }, ms);
                pendingTimers.add(id);
                return id;
            };
            const clearLater = (id) => {
                if (!id) return;
                clearTimeout(id);
                pendingTimers.delete(id);
            };
            const inputText = ref('');
            const sending   = ref(false);
            const devSnap   = ref(null);
            const richBarOpen = ref(false);   // 富功能栏：输入框聚焦后展开
            const callModal   = ref(false);   // 通话"开发中"提示

            // 抽屉状态
            const meDrawerOpen = ref(false);     // 左划：我的资料
            const friendDrawerOpen = ref(false); // 三点：好友设置
            const autoTranslate = ref(false);
            const expandedTr = ref({});
            const tickRef = ref(0);

            const quoteDraft = ref(null);
            const longPressOn = ref(null);
            const longPressOpenedAt = ref(0);
            const reactPickerFor = ref(null);
            const reactCustomInput = ref('');
            const unmaskedImg = ref({});
            const voiceOpenId = ref({});
            const stickerPanelOpen = ref(false);
            const stickerTag = ref('');
            const voiceMode = ref(false);
            const taRef = ref(null);
            const richForm = ref(null);
            const balance = ref((settings.phone?.pp?.wallet?.balance) ?? 3);
            const transferModal = ref(null);
            const revealedIds = ref(new Set());

            // 撤回动画/查看集合
            const recallAnimIds = ref(new Set());   // 撤回后短暂显示原消息（动画中）
            const recallRevealIds = ref(new Set()); // 用户点击"查看"后展开的已撤回消息

            // 多选
            const selectMode = ref(false);
            const selected = ref(new Set());

            // 副标题
            const subtitleIdx = ref(0);
            const isTyping = ref(false);

            const stickerList = computed(() => {
                tickRef.value;
                return listStickers();
            });
            const stickerTags = computed(() => {
                const set = new Set();
                stickerList.value.forEach(s => (s.tags || []).forEach(t => set.add(t)));
                return ['', ...Array.from(set).sort()];
            });
            const filteredStickers = computed(() => {
                if (!stickerTag.value) return stickerList.value;
                return stickerList.value.filter(s => (s.tags || []).includes(stickerTag.value));
            });
            const userName = computed(() => getUserName());

            const idKey = computed(() => props.scope === 'group' ? 'groupId' : 'contactId');
            const convFilter = computed(() => {
                const f = { scope: props.scope };
                f[idKey.value] = props.contact?.id || '';
                return f;
            });

            const contactExt = computed(() => readContactExt(props.contact, props.scope));
            const displayName = computed(() => contactExt.value.remark || props.contact?.nickname || props.contact?.name || '未知');

            const items = computed(() => {
                tickRef.value;
                // 已撤回消息保留在列表中，由模板决定如何渲染
                const msgs = listMessages(convFilter.value).slice()
                    .sort((a, b) => (a.seq || 0) - (b.seq || 0) || a.createdAt - b.createdAt);
                const out = [];
                let lastTs = 0;
                for (const m of msgs) {
                    if (lastTs && (m.createdAt - lastTs) >= FIVE_MIN) {
                        out.push({ __sysTime: true, phoneTime: m.phoneTime, key: 'st-' + m.id });
                    }
                    out.push(m);
                    lastTs = m.createdAt;
                }
                return out;
            });

            const isVisible = (m) => {
                if (m.__sysTime) return true;
                if (m.senderRole === 'user' || m.senderRole === 'sys') return true;
                if (!m._needReveal) return true;
                return revealedIds.value.has(m.id);
            };

            const subtitleTimer = setInterval(() => {
                subtitleIdx.value = (subtitleIdx.value + 1) % 2;
            }, 4000);

            const subtitleText = computed(() => {
                if (isTyping.value) return '正在输入中';
                if (subtitleIdx.value === 0) return onlineLabel(contactExt.value.online);
                return contactExt.value.signature || '（暂无个性签名）';
            });
            const subtitleIsStatus = computed(() => subtitleIdx.value === 0);

            // 滚动
            const scrollEl = ref(null);
            const scrollToBottom = () => {
                nextTick(() => { const el = scrollEl.value; if (el) el.scrollTop = el.scrollHeight; });
            };
            function registerBackend() {
                if (typeof window === 'undefined') return;
                window.__ggg_pp_backend = {
                    token: backendToken,
                    isActive: true,
                    getSnapshot: () => devSnap.value || window.__ggg_pp_last_send || null,
                    previewPrompt: async () => {
                        const snap = await previewPPPrompt({
                            ...convFilter.value,
                            contactName: props.contact.nickname || props.contact.name,
                        });
                        devSnap.value = {
                            ...(devSnap.value || window.__ggg_pp_last_send || {}),
                            sentMessages: snap.sentMessages,
                            sentMessagesForDisplay: snap.sentMessagesForDisplay,
                            request: snap.request,
                            promptOnly: true,
                            promptPreviewLoaded: true,
                            ts: snap.ts,
                        };
                        return devSnap.value;
                    },
                    copySnapshot: async () => {
                        const snap = devSnap.value || window.__ggg_pp_last_send;
                        if (!snap) return false;
                        const txt = JSON.stringify({
                            sentMessages: snap.sentMessages,
                            sentMessagesForDisplay: snap.sentMessagesForDisplay,
                            rawResponse: snap.rawResponse,
                            parsed: snap.parsed,
                            error: snap.error,
                        }, null, 2);
                        try { await navigator.clipboard.writeText(txt); return true; } catch { return false; }
                    },
                    applyRawResponse: async (raw, versionId = '') => {
                        const snap = devSnap.value || window.__ggg_pp_last_send;
                        if (!snap) throw new Error('尚未发送过消息');
                        sending.value = true;
                        isTyping.value = true;
                        try {
                            const next = await replacePPReplyFromSnapshot(snap, raw, versionId);
                            devSnap.value = next;
                            tickRef.value++;
                            scrollToBottom();
                            return next;
                        } finally {
                            sending.value = false;
                            isTyping.value = false;
                        }
                    },
                    refreshAIReply: async () => {
                        const snap = devSnap.value || window.__ggg_pp_last_send;
                        if (!snap) throw new Error('尚未发送过消息');
                        sending.value = true;
                        isTyping.value = true;
                        try {
                            const next = await refreshPPReplyFromSnapshot(snap);
                            devSnap.value = next;
                            tickRef.value++;
                            scrollToBottom();
                            return next;
                        } finally {
                            sending.value = false;
                            isTyping.value = false;
                        }
                    },
                };
            }

            const onStickerLibraryChanged = () => {
                tickRef.value++;
                if (stickerTag.value && !stickerTags.value.includes(stickerTag.value)) stickerTag.value = '';
            };

            onMounted(() => {
                applyPPAppearanceStyles();
                scrollToBottom();
                autoGrowTextarea();
                registerBackend();
                window.addEventListener('ggg:stickers-changed', onStickerLibraryChanged);
            });
            let lastLen = 0;
            watch(items, (v) => {
                if (v.length > lastLen) scrollToBottom();
                lastLen = v.length;
            });

            const tickTimer = setInterval(() => {
                tickRef.value++;
                balance.value = ensureWallet().balance;
            }, 30000);
            onUnmounted(() => {
                disposed = true;
                clearInterval(tickTimer);
                clearInterval(subtitleTimer);
                cancelPress();
                pendingTimers.forEach(id => clearTimeout(id));
                pendingTimers.clear();
                window.removeEventListener('ggg:stickers-changed', onStickerLibraryChanged);
                if (typeof window !== 'undefined' && window.__ggg_pp_backend?.token === backendToken) {
                    window.__ggg_pp_backend = null;
                }
                devSnap.value = null;
            });

            const fmtTime = (iso) => formatRelativeTime(iso);
            const fmtTimeMarker = (iso) => formatRelativeTime(iso);

            function autoGrowTextarea() {
                nextTick(() => {
                    const el = taRef.value;
                    if (!el) return;
                    el.style.height = 'auto';
                    const lineH = parseFloat(getComputedStyle(el).lineHeight) || 20;
                    const maxH = lineH * 5 + 14;
                    el.style.height = Math.min(el.scrollHeight, maxH) + 'px';
                });
            }
            watch(inputText, autoGrowTextarea);

            async function stageWithQuote(kind, payload) {
                if (quoteDraft.value && kind === 'text') {
                    await stagePPMessage({
                        ...convFilter.value,
                        contactName: displayName.value,
                        kind: 'quote',
                        payload: {
                            quoteSeq: quoteDraft.value.seq,
                            quoteSummary: quoteDraft.value.summary,
                            text: payload.text,
                        },
                    });
                    quoteDraft.value = null;
                } else {
                    await stagePPMessage({ ...convFilter.value, contactName: displayName.value, kind, payload });
                }
                tickRef.value++;
            }

            async function onEnterStage() {
                const text = inputText.value.trim();
                if (!text) return;
                inputText.value = '';
                if (voiceMode.value) {
                    const dur = Math.max(1, Math.ceil(text.length / 4));
                    await stageWithQuote('voice', { transcript: text, duration: dur });
                } else {
                    await stageWithQuote('text', { text });
                }
                autoGrowTextarea();
            }

            async function onShipToAI() {
                if (sending.value) return;
                if (inputText.value.trim()) await onEnterStage();
                sending.value = true;
                isTyping.value = true;
                try {
                    const snap = await flushPPConversation({
                        ...convFilter.value,
                        contactName: props.contact.nickname || props.contact.name,
                    });
                    devSnap.value = snap;
                    if (snap.error) {
                        notifyST('发送失败：\n' + snap.error, 'error');
                    } else if (snap.savedMsgIds && snap.savedMsgIds.length > 0) {
                        scheduleStaggeredReveal(snap.savedMsgIds);
                    } else if (snap.parsed?.warnings?.length) {
                        notifyST('AI 回复未按 PP 格式或为空：\n' + snap.parsed.warnings.join('\n') + '\n\n点右上 ⋮ → 抽屉看原始', 'warning');
                    }
                    tickRef.value++;
                } finally {
                    sending.value = false;
                    isTyping.value = false;
                }
            }

            function scheduleStaggeredReveal(ids) {
                isTyping.value = true;
                for (const id of ids) {
                    const m = listMessages(convFilter.value).find(x => x.id === id);
                    if (m) m._needReveal = true;
                }
                tickRef.value++;
                let cumulative = 0;
                ids.forEach((id, i) => {
                    const m = listMessages(convFilter.value).find(x => x.id === id);
                    if (!m) return;
                    const text = m.payload?.text || m.payload?.transcript || m.payload?.alt || '';
                    const delay = Math.max(REVEAL_MIN_DELAY, Math.min(REVEAL_MAX_DELAY, text.length * REVEAL_MS_PER_CHAR));
                    cumulative += delay;
                    later(() => {
                        revealedIds.value = new Set([...revealedIds.value, id]);
                        if (m) m._needReveal = false;
                        tickRef.value++;
                        if (i === ids.length - 1) isTyping.value = false;
                    }, cumulative);
                });
            }

            const onInputKey = (e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEnterStage(); }
            };

            function notifyST(message, type = 'info') {
                const text = String(message || '');
                if (typeof toastr !== 'undefined' && toastr?.[type]) {
                    toastr[type](text);
                    return;
                }
                console[type === 'error' ? 'error' : 'log']('[ggg-phone]', text);
            }

            async function confirmST(message) {
                try {
                    const ctx = (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null;
                    if (ctx?.callGenericPopup && ctx?.POPUP_TYPE) {
                        return !!(await ctx.callGenericPopup(String(message || ''), ctx.POPUP_TYPE.CONFIRM));
                    }
                } catch {}
                return window.confirm(String(message || ''));
            }

            function onIconClick(kind) {
                if (kind === 'sticker') { stickerPanelOpen.value = !stickerPanelOpen.value; return; }
                if (kind === 'dice') { rollDice(); return; }
                if (kind === 'audio_call' || kind === 'video_call') {
                    callModal.value = true;
                    return;
                }
                if (kind === 'image')    richForm.value = { kind: 'image', alt: '' };
                else if (kind === 'transfer') richForm.value = { kind: 'transfer', amount: 0, note: '' };
            }

            async function rollDice() {
                const point = Math.floor(Math.random() * 6) + 1;
                await stageWithQuote('dice', { point });
                stickerPanelOpen.value = false;
            }
            async function pickSticker(s) {
                await stageWithQuote('sticker', {
                    name: s.name,
                    tag: stickerTag.value || (s.tags || [])[0] || '',
                    source: s.source || '',
                    url: s.url || '',
                });
                stickerPanelOpen.value = false;
            }

            async function submitRichForm() {
                const f = richForm.value;
                if (!f) return;
                if (f.kind === 'image') {
                    if (!f.alt.trim()) { richForm.value = null; return; }
                    await stageWithQuote('image', { alt: f.alt.trim() });
                } else if (f.kind === 'transfer') {
                    const amt = parseFloat(f.amount) || 0;
                    if (amt <= 0) { richForm.value = null; return; }
                    const wallet = ensureWallet();
                    if (wallet.balance < amt) {
                        notifyST('钱包余额不足', 'warning');
                        return;
                    }
                    mutateWallet(-amt, {
                        type: 'out', amount: amt,
                        to: props.contact?.nickname || props.contact?.name || '对方',
                        note: f.note.trim() || '转账',
                    });
                    await stageWithQuote('transfer', {
                        amount: amt, note: f.note.trim(), currency: '¥', status: 'pending',
                    });
                }
                richForm.value = null;
            }

            // 长按 ===
            let pressTimer = null;
            function onPressStart(m) {
                if (m.__sysTime) return;
                if (selectMode.value) return;
                cancelPress();
                pressTimer = later(() => {
                    pressTimer = null;
                    longPressOn.value = m.id;
                    longPressOpenedAt.value = Date.now();
                }, 500);
            }
            function cancelPress() { if (pressTimer) { clearLater(pressTimer); pressTimer = null; } }
            function closeLongPress() { longPressOn.value = null; reactPickerFor.value = null; }

            function onStreamClick() {
                // popmenu 打开后 350ms 内的 stream click 不关闭（避免长按抬手立即关）
                if (longPressOn.value && Date.now() - longPressOpenedAt.value < 350) return;
                closeLongPress();
                stickerPanelOpen.value = false;
                transferModal.value = null;
                richBarOpen.value = false;
            }

            function findStickerImage(payload) {
                if (typeof payload === 'string') return findStickerByName(payload);
                return findStickerByName(payload?.name, {
                    tag: payload?.tag || '',
                    source: payload?.source || '',
                    url: payload?.url || '',
                });
            }

            function actionQuote(m) { quoteDraft.value = { seq: m.seq, summary: makeSummary(m) }; closeLongPress(); }

            // 撤回：对任意消息生效，先动画显示再隐藏，生成可展开的系统消息
            async function actionRecall(m) {
                const label = m.senderRole === 'user'
                    ? (getUserName() || '你')
                    : (m.senderName || displayName.value || '对方');
                if (!(await confirmST(`撤回"${label}"的这条消息？`))) return;
                closeLongPress();
                await recallMessage(m.id);
                // 加入动画集合，短暂展示后淡出
                recallAnimIds.value = new Set([...recallAnimIds.value, m.id]);
                tickRef.value++;
                // 追加"撤回了一条消息"系统行，附带可展开的 recalledMsgId
                await appendMessage({
                    ...convFilter.value,
                    senderRole: 'sys', senderId: '__sys__',
                    peerName: displayName.value,
                    kind: 'text',
                    payload: {
                        text: `${label}撤回了第 ${m.seq || '?'} 条消息`,
                        type: 'recall-status',
                        targetSeq: m.seq || 0,
                        recalledMsgId: m.id,
                    },
                    pending: true,
                });
                tickRef.value++;
                // 2s 后从动画集合中移除（消息淡出后消失）
                later(() => {
                    const next = new Set(recallAnimIds.value);
                    next.delete(m.id);
                    recallAnimIds.value = next;
                    tickRef.value++;
                }, 2000);
            }

            // 切换已撤回消息的展开/收起
            function toggleRecallReveal(msgId) {
                const next = new Set(recallRevealIds.value);
                if (next.has(msgId)) next.delete(msgId); else next.add(msgId);
                recallRevealIds.value = next;
                tickRef.value++;
            }
            // 判断一条已撤回的消息当前是否"可见"（动画中或用户主动展开）
            const isRecalledVisible = (m) =>
                m.recalled && (recallAnimIds.value.has(m.id) || recallRevealIds.value.has(m.id));
            function actionReact(m) { reactPickerFor.value = m.id; reactCustomInput.value = ''; longPressOn.value = null; }
            async function pickReactEmoji(m, emoji) {
                if (!emoji) return;
                await addReaction({ ...convFilter.value, targetSeq: m.seq, emoji, actor: userName.value });
                await appendMessage({
                    ...convFilter.value,
                    senderRole: 'user', senderId: '__user__',
                    peerName: displayName.value,
                    kind: 'reaction',
                    payload: { targetSeq: m.seq, emoji },
                    pending: true,
                });
                reactPickerFor.value = null;
                tickRef.value++;
            }

            function actionEnterMultiSelect(m) {
                selectMode.value = true;
                selected.value = new Set([m.id]);
                closeLongPress();
            }
            function toggleSelected(m) {
                if (!selectMode.value) return;
                if (m.__sysTime) return;
                const next = new Set(selected.value);
                if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                selected.value = next;
            }
            function exitMultiSelect() { selectMode.value = false; selected.value = new Set(); }
            async function bulkDelete() {
                if (selected.value.size === 0) return;
                if (!(await confirmST(`确定删除选中的 ${selected.value.size} 条消息？此操作仅删除本地记录。`))) return;
                for (const id of Array.from(selected.value)) await deleteMessage(id);
                exitMultiSelect();
                tickRef.value++;
            }
            async function bulkFavorite() {
                if (selected.value.size === 0) return;
                for (const id of Array.from(selected.value)) {
                    await patchMessage(id, { favorite: true });
                }
                notifyST(`已收藏 ${selected.value.size} 条消息（可在数据中以 favorite=true 检索）`, 'success');
                exitMultiSelect();
                tickRef.value++;
            }

            function makeSummary(m, max = 30) {
                const p = m.payload || {};
                let s = '';
                switch (m.kind) {
                    case 'text': s = p.text || ''; break;
                    case 'voice': s = '[语音]' + (p.transcript || ''); break;
                    case 'image': s = '[图片]' + (p.alt || ''); break;
                    case 'sticker': s = '[表情]' + (p.name || ''); break;
                    case 'transfer': s = `[转账]¥${p.amount || 0}`; break;
                    case 'dice': s = `[骰子]${p.point || 1}`; break;
                    case 'quote': s = p.text || ''; break;
                    default: s = `[${m.kind}]`;
                }
                return s.slice(0, max);
            }

            function reactionGroups(m) {
                if (!Array.isArray(m.reactions) || m.reactions.length === 0) return [];
                const map = new Map();
                for (const r of m.reactions) {
                    const k = r.emoji;
                    if (!map.has(k)) map.set(k, { emoji: k, count: 0, actors: [] });
                    const g = map.get(k);
                    g.count++; if (r.actor) g.actors.push(r.actor);
                }
                return Array.from(map.values());
            }
            function reactionPreview(m) {
                const target = findBySeq({ ...convFilter.value, seq: m.payload?.targetSeq });
                const actor = m.senderRole === 'user' ? (userName.value || '你') : (m.senderName || '某人');
                const summary = target ? makeSummary(target, 5) : `#${m.payload?.targetSeq || '?'}`;
                return `${actor} 对 [${summary}] 表示 ${m.payload?.emoji || ''}`;
            }

            function canActOnTransfer(m) {
                return m.senderRole === 'char' && m.payload?.status === 'pending';
            }
            function isTransferSys(m) {
                const text = m?.payload?.text || '';
                return m?.kind === 'text'
                    && (m.payload?.type === 'transfer-status'
                        || /^(收款|退回)\|\[\d+\]/.test(text)
                        || (m?.senderRole === 'sys' && /^\[\d+\].*(已收款|已退回)/.test(text)));
            }
            function transferSysInfo(m) {
                if (m?.payload?.type === 'transfer-status') {
                    return {
                        action: m.payload.action || 'receive',
                        seq: m.payload.targetSeq || '',
                        actor: m.payload.actor || '',
                        amount: Number(m.payload.amount) || 0,
                        currency: m.payload.currency || '¥',
                    };
                }
                const text = m?.payload?.text || '';
                const mt = text.match(/^(收款|退回)\|\[(\d+)\](.*)$/);
                const simple = text.match(/^\[(\d+)\](.*?)(已收款|已退回).*$/);
                if (simple) {
                    return {
                        action: simple[3] === '已退回' ? 'return' : 'receive',
                        seq: simple[1] || '',
                        actor: (simple[2] || '').trim(),
                        amount: 0,
                        currency: '¥',
                    };
                }
                return {
                    action: mt?.[1] === '退回' ? 'return' : 'receive',
                    seq: mt?.[2] || '',
                    actor: (mt?.[3] || '').replace(/已收款|已退回/g, '').trim(),
                    amount: 0,
                    currency: '¥',
                };
            }
            function ensureWallet() {
                if (!settings.phone) settings.phone = {};
                if (!settings.phone.pp) settings.phone.pp = {};
                if (!settings.phone.pp.wallet) settings.phone.pp.wallet = { balance: 3.0, history: [] };
                settings.phone.pp.wallet.balance = normalizeWalletBalance(settings.phone.pp.wallet.balance);
                if (!Array.isArray(settings.phone.pp.wallet.history)) settings.phone.pp.wallet.history = [];
                return settings.phone.pp.wallet;
            }
            function mutateWallet(delta, entry = {}) {
                const ppStore = (typeof window !== 'undefined') ? window.__ggg_phone_pp_store : null;
                const wallet = ppStore?.state?.wallet || ensureWallet();
                if (ppStore?.state && !ppStore.state.wallet) ppStore.state.wallet = wallet;
                wallet.balance = normalizeWalletBalance(wallet.balance);
                if (!Array.isArray(wallet.history)) wallet.history = [];
                wallet.balance = Math.round((Number(wallet.balance || 0) + Number(delta || 0)) * 100) / 100;
                wallet.history.push({ ts: Date.now(), ...entry });
                balance.value = wallet.balance;
                saveAllSettings();
                return wallet;
            }
            async function transferAction(m, action) {
                const seq = m.seq;
                const payload = { ...(m.payload || {}) };
                const amt = Number(payload.amount) || 0;
                const currency = payload.currency || '¥';
                const note = payload.note || '转账';
                const actor = userName.value || '你';
                if (action === 'receive') {
                    await patchMessage(m.id, { payload: { ...payload, amount: amt, currency, note, status: 'received' } });
                    // rc7：必须经由 PP store 的 reactive state 修改，profile 才会实时刷新
                    mutateWallet(amt, {
                        type: 'in', amount: amt,
                        from: props.contact?.nickname || props.contact?.name || '对方',
                        note,
                    });
                    await appendMessage({
                        ...convFilter.value,
                        senderRole: 'sys', senderId: '__sys__',
                        peerName: displayName.value,
                        kind: 'text',
                        payload: { text: `${actor}已收款`, type: 'transfer-status', action: 'receive', targetSeq: seq, amount: amt, currency, actor },
                        pending: true,
                    });
                } else if (action === 'return') {
                    await patchMessage(m.id, { payload: { ...payload, amount: amt, currency, note, status: 'returned' } });
                    await appendMessage({
                        ...convFilter.value,
                        senderRole: 'sys', senderId: '__sys__',
                        peerName: displayName.value,
                        kind: 'text',
                        payload: { text: `${actor}已退回`, type: 'transfer-status', action: 'return', targetSeq: seq, amount: amt, currency, actor },
                        pending: true,
                    });
                }
                transferModal.value = null;
                tickRef.value++;
            }

            function toggleImgMask(m) {
                unmaskedImg.value = { ...unmaskedImg.value, [m.id]: !unmaskedImg.value[m.id] };
            }
            function toggleVoice(m) {
                voiceOpenId.value = { ...voiceOpenId.value, [m.id]: !voiceOpenId.value[m.id] };
            }

            const onBubbleClick = (m) => {
                if (selectMode.value) { toggleSelected(m); return; }
                if (m.payload?.translate) {
                    expandedTr.value = { ...expandedTr.value, [m.id]: !expandedTr.value[m.id] };
                }
            };
            const isTrExpanded = (m) => {
                if (!m.payload?.translate) return false;
                if (autoTranslate.value) return !expandedTr.value[m.id];
                return !!expandedTr.value[m.id];
            };

            function jumpToSeq(seq) {
                const el = document.querySelector(`[data-msg-seq="${seq}"]`);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.add('ggg-pp-cd-hl');
                    later(() => el.classList.remove('ggg-pp-cd-hl'), 1200);
                }
            }

            // 我的资料编辑（左划面板）
            const meDraft = ref({ nickname: '', signature: '', online: 'online' });
            function openMeDrawer() {
                const me = ensureMe();
                meDraft.value = {
                    nickname: me.nickname || '',
                    signature: me.signature || '',
                    online: me.online || 'online',
                };
                meDrawerOpen.value = true;
            }
            function saveMeDraft() {
                const me = ensureMe();
                me.nickname = meDraft.value.nickname.trim();
                me.signature = meDraft.value.signature.trim();
                me.online = meDraft.value.online;
                persistCurrentMeProfile(me);
                balance.value = ensureWallet().balance;
                meDrawerOpen.value = false;
            }

            // 好友设置（三点菜单）
            const remarkDraft = ref('');
            const editingRemark = ref(false);
            function openFriendDrawer() {
                try { document.activeElement?.blur?.(); } catch {}
                richBarOpen.value = false;
                stickerPanelOpen.value = false;
                friendDrawerOpen.value = true;
            }
            function startEditRemark() { remarkDraft.value = displayName.value; editingRemark.value = true; }
            function saveRemark() {
                const remark = remarkDraft.value.trim();
                if (props.contact) props.contact.remark = remark;
                saveContactExt(props.contact, props.scope, { remark });
                editingRemark.value = false;
            }
            // rc6：壁纸只能从【酒馆背景】或【图库】选
            const bgPickerOpen = ref(false);
            const bgPickerTab  = ref('st'); // 'st' | 'gallery'
            const stBgsList    = computed(() => {
                bgPickerOpen.value;
                try { return listStBackgrounds() || []; } catch { return []; }
            });
            const galleryBgs   = computed(() => {
                bgPickerOpen.value;
                return (settings.gallery || []).map(it => ({
                    name: it.name || it.id || '',
                    url:  it.url  || it.dataUrl || '',
                })).filter(x => x.url);
            });
            function openBgPicker() { bgPickerOpen.value = true; bgPickerTab.value = 'st'; }
            function pickChatBg(url) {
                const bgUrl = url || '';
                if (props.contact) props.contact.bgUrl = bgUrl;
                saveContactExt(props.contact, props.scope, { bgUrl });
                bgPickerOpen.value = false;
                tickRef.value++;
            }
            function clearChatBg() {
                if (props.contact) props.contact.bgUrl = '';
                saveContactExt(props.contact, props.scope, { bgUrl: '' });
                tickRef.value++;
            }

            const chatBgStyle = computed(() => {
                const u = contactExt.value.bgUrl;
                return u ? {
                    backgroundImage: `url(${u})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                } : {};
            });

            return {
                inputText, sending, devSnap, autoTranslate,
                richBarOpen, callModal,
                items, displayName, scrollEl, taRef,
                fmtTime, fmtTimeMarker,
                quoteDraft, clearQuote: () => quoteDraft.value = null,
                longPressOn, reactPickerFor, reactCustomInput, richForm,
                stickerPanelOpen, stickerList, stickerTags, stickerTag, filteredStickers, voiceMode,
                COMMON_REACT_EMOJIS, ONLINE_OPTIONS,
                balance, userName, contactExt, chatBgStyle,
                transferModal, canActOnTransfer, transferAction,
                isTransferSys, transferSysInfo,
                recallAnimIds, recallRevealIds, toggleRecallReveal, isRecalledVisible,
                meDrawerOpen, friendDrawerOpen, openMeDrawer, openFriendDrawer,
                meDraft, saveMeDraft, onlineLabel, onlineColor,
                editingRemark, remarkDraft, startEditRemark, saveRemark,
                openBgPicker, pickChatBg, clearChatBg,
                bgPickerOpen, bgPickerTab, stBgsList, galleryBgs,
                subtitleText, subtitleIsStatus, isTyping,
                selectMode, selected, exitMultiSelect, bulkDelete, bulkFavorite, toggleSelected,
                onEnterStage, onShipToAI, onInputKey,
                onIconClick, rollDice, pickSticker, submitRichForm,
                onPressStart, cancelPress, closeLongPress, onStreamClick,
                actionQuote, actionRecall, actionReact, pickReactEmoji,
                actionEnterMultiSelect,
                onBubbleClick, isTrExpanded, isVisible,
                reactionGroups, reactionPreview, jumpToSeq,
                toggleImgMask, toggleVoice,
                isImgUnmasked: (m) => !!unmaskedImg.value[m.id],
                isVoiceOpen: (m) => !!voiceOpenId.value[m.id],
                isSelected: (m) => selected.value.has(m.id),
                findStickerImage,
                toggleVoiceMode: () => { voiceMode.value = !voiceMode.value; },
            };
        },
        template: /* html */ `
            <div class="ggg-pp-chat-detail" @click="onStreamClick" :style="chatBgStyle">
                <!-- 顶栏 -->
                <div class="ggg-pp-cd-topbar v2">
                    <button class="ggg-pp-iconbtn" @click="onBack" aria-label="返回">
                        <i class="ggg-fa fa-solid fa-chevron-left"></i>
                    </button>
                    <div class="cd-center">
                        <div class="name">{{ displayName }}</div>
                        <div class="subtitle">
                            <transition name="cd-sub" mode="out-in">
                                <span class="sub-line" :key="subtitleText" :class="{typing: isTyping}">
                                    <i v-if="!isTyping && subtitleIsStatus" class="ggg-fa fa-solid fa-circle dot"
                                       :style="{fontSize:'7px', marginRight:'4px'}"></i>
                                    <span class="txt">{{ subtitleText }}</span>
                                    <span v-if="isTyping" class="typing-dots"><i></i><i></i><i></i></span>
                                </span>
                            </transition>
                        </div>
                    </div>
                    <div class="cd-right">
                        <button class="ggg-pp-iconbtn" @click="openFriendDrawer" title="好友设置">
                            <i class="ggg-fa fa-solid fa-ellipsis-vertical"></i>
                        </button>
                    </div>
                </div>

                <!-- 多选工具栏 -->
                <div v-if="selectMode" class="ggg-pp-cd-multibar">
                    <span>已选 {{ selected.size }}</span>
                    <div class="ggg-pp-cd-multibar-actions">
                        <button @click="bulkFavorite" :disabled="selected.size===0"><i class="ggg-fa fa-solid fa-star"></i>收藏</button>
                        <button class="danger" @click="bulkDelete" :disabled="selected.size===0"><i class="ggg-fa fa-solid fa-trash"></i>删除</button>
                        <button @click="exitMultiSelect"><i class="ggg-fa fa-solid fa-xmark"></i>取消</button>
                    </div>
                </div>

                <!-- 消息流 -->
                <div class="ggg-pp-cd-stream" ref="scrollEl" @click="onStreamClick">
                    <template v-for="m in items" :key="m.__sysTime ? m.key : m.id">
                        <div v-if="m.__sysTime" class="ggg-pp-cd-time-sep">{{ fmtTimeMarker(m.phoneTime) }}</div>

                        <div v-else-if="m.kind === 'reaction'"
                             class="ggg-pp-cd-sys-line ggg-pp-cd-sys-react"
                             :class="{ selected: isSelected(m), 'multi-mode': selectMode }"
                             @click.stop="selectMode ? toggleSelected(m) : jumpToSeq(m.payload?.targetSeq)">
                            <i v-if="selectMode" class="ggg-fa fa-solid sys-multi-check"
                               :class="isSelected(m) ? 'fa-circle-check' : 'fa-circle'"></i>
                            {{ reactionPreview(m) }}
                        </div>

                        <div v-else-if="isTransferSys(m)"
                             class="ggg-pp-cd-sys-line transfer-sys"
                             :class="['transfer-' + transferSysInfo(m).action, { selected: isSelected(m), 'multi-mode': selectMode }]"
                             @click.stop="selectMode ? toggleSelected(m) : null">
                            <i v-if="selectMode" class="ggg-fa fa-solid sys-multi-check"
                               :class="isSelected(m) ? 'fa-circle-check' : 'fa-circle'"></i>
                            <i class="ggg-fa fa-solid" :class="transferSysInfo(m).action === 'receive' ? 'fa-circle-check' : 'fa-rotate-left'"></i>
                            <span>{{ transferSysInfo(m).actor || '对方' }}</span>
                            <b>{{ transferSysInfo(m).action === 'receive' ? '已收款' : '已退回' }}</b>
                            <em v-if="transferSysInfo(m).amount">{{ transferSysInfo(m).currency }}{{ transferSysInfo(m).amount }}</em>
                        </div>

                        <!-- 系统消息：撤回行可点击展开/收起原消息；普通系统行直接显示 -->
                        <div v-else-if="m.senderRole === 'sys' && m.kind === 'text'"
                             class="ggg-pp-cd-sys-line"
                             :class="{ 'recall-sys': m.payload?.recalledMsgId, selected: isSelected(m), 'multi-mode': selectMode }"
                             @click.stop="selectMode ? toggleSelected(m) : (m.payload?.recalledMsgId ? toggleRecallReveal(m.payload.recalledMsgId) : null)">
                            <i v-if="selectMode" class="ggg-fa fa-solid sys-multi-check"
                               :class="isSelected(m) ? 'fa-circle-check' : 'fa-circle'"></i>
                            {{ m.payload?.text }}
                            <span v-if="m.payload?.recalledMsgId" class="recall-peek">
                                {{ recallRevealIds.has(m.payload.recalledMsgId) ? '[收起]' : '[查看]' }}
                            </span>
                        </div>

                        <!-- 已撤回但不可见：直接跳过渲染 -->
                        <template v-else-if="m.recalled && !isRecalledVisible(m)"></template>

                        <div v-else-if="isVisible(m)" class="ggg-pp-cd-row"
                             :class="{ mine: m.senderRole === 'user', pending: m.pending, selected: isSelected(m), 'multi-mode': selectMode, 'recalled-anim': m.recalled && recallAnimIds.has(m.id), 'recalled-reveal': m.recalled && recallRevealIds.has(m.id) }"
                             :data-msg-seq="m.seq"
                             @click.stop="selectMode ? toggleSelected(m) : null">
                            <div v-if="selectMode" class="multi-check">
                                <i class="ggg-fa fa-solid" :class="isSelected(m) ? 'fa-circle-check' : 'fa-circle'"></i>
                            </div>
                            <div class="avatar">
                                <img v-if="(m.senderRole === 'user' ? me.avatar : contact.avatar)"
                                     :src="m.senderRole === 'user' ? me.avatar : contact.avatar" alt="" />
                                <i v-else class="ggg-fa fa-solid fa-user"></i>
                            </div>
                            <div class="bubble-wrap">
                                <div class="bubble-and-actions"
                                     @mousedown="onPressStart(m)" @mouseup="cancelPress" @mouseleave="cancelPress"
                                     @touchstart="onPressStart(m)" @touchend="cancelPress" @touchcancel="cancelPress">

                                    <div v-if="m.kind === 'text'" class="ggg-pp-cd-bubble"
                                         :class="{ fallback: m.payload?.fallback, fav: m.favorite }"
                                         @click.stop="onBubbleClick(m)">
                                        <div>{{ m.payload?.text }}</div>
                                        <div v-if="isTrExpanded(m)" class="tr-line">{{ m.payload?.translate }}</div>
                                        <span v-if="m.favorite" class="fav-mark"><i class="ggg-fa fa-solid fa-star"></i></span>
                                    </div>

                                    <div v-else-if="m.kind === 'quote'" class="ggg-pp-cd-bubble bubble-quote"
                                         @click.stop="onBubbleClick(m)">
                                        <div class="quote-strip" @click.stop="jumpToSeq(m.payload?.quoteSeq)">
                                            <i class="ggg-fa fa-solid fa-quote-left"></i>
                                            <span>{{ m.payload?.quoteSummary || '原消息' }}</span>
                                        </div>
                                        <div class="quote-body">{{ m.payload?.text }}</div>
                                        <div v-if="isTrExpanded(m)" class="tr-line">{{ m.payload?.translate }}</div>
                                    </div>

                                    <div v-else-if="m.kind === 'image'" class="ggg-pp-cd-bubble bubble-image-v2"
                                         @click.stop="toggleImgMask(m)">
                                        <div class="img-card" :class="{masked: !isImgUnmasked(m)}">
                                            <div class="img-alt-text">{{ m.payload?.alt || '图片' }}</div>
                                            <div class="img-mask-overlay" v-if="!isImgUnmasked(m)">
                                                <i class="ggg-fa fa-solid fa-eye-slash"></i>
                                            </div>
                                        </div>
                                    </div>

                                    <div v-else-if="m.kind === 'voice'" class="bubble-voice-wrap">
                                        <div class="voice-bubble-line">
                                            <div class="ggg-pp-cd-bubble bubble-voice" @click.stop="toggleVoice(m)">
                                                <i class="ggg-fa fa-solid fa-microphone"></i>
                                                <div class="wave"><span></span><span></span><span></span><span></span><span></span></div>
                                                <span class="dur">{{ m.payload?.duration || 1 }}″</span>
                                            </div>
                                            <div v-if="m.pending && m.senderRole === 'user'" class="ggg-pp-cd-pending-spin voice-spin"></div>
                                        </div>
                                        <div class="voice-trans-slide" :class="{open: isVoiceOpen(m)}">
                                            <div class="voice-trans-inner" @click.stop="onBubbleClick(m)">
                                                <div>{{ m.payload?.transcript || '(无转写)' }}</div>
                                                <div v-if="isTrExpanded(m)" class="tr-line">{{ m.payload?.translate }}</div>
                                            </div>
                                        </div>
                                    </div>

                                    <div v-else-if="m.kind === 'sticker'" class="ggg-pp-cd-bubble bubble-sticker">
                                        <template v-if="findStickerImage(m.payload)">
                                            <img class="ggg-pp-sticker-img" :src="findStickerImage(m.payload).url" :alt="m.payload?.name" loading="lazy" />
                                        </template>
                                        <template v-else>
                                            <i class="ggg-fa fa-solid fa-face-smile"></i> {{ m.payload?.name }}
                                        </template>
                                    </div>

                                    <!-- 转账卡片：点击弹出 transferModal 全屏 modal，移除了气泡内的内联菜单 -->
                                    <div v-else-if="m.kind === 'transfer'" class="ggg-pp-cd-card-transfer"
                                         :class="{actionable: canActOnTransfer(m), ['s-' + (m.payload?.status||'pending')]: true}"
                                         @click.stop="canActOnTransfer(m) ? (transferModal = { msg: m }) : null">
                                        <i class="ggg-fa fa-solid fa-coins icon-coin"></i>
                                        <div class="amt">{{ m.payload?.currency || '¥' }}{{ m.payload?.amount || 0 }}</div>
                                        <div class="note">{{ m.payload?.note || '转账' }}</div>
                                        <div class="t-status" v-if="m.payload?.status === 'received'">已收款</div>
                                        <div class="t-status" v-else-if="m.payload?.status === 'returned'">已退回</div>
                                        <div class="t-status" v-else-if="m.senderRole==='char'">点击操作</div>
                                    </div>

                                    <div v-else-if="m.kind === 'location'" class="ggg-pp-cd-card-location">
                                        <i class="ggg-fa fa-solid fa-location-dot"></i>
                                        {{ m.payload?.desc || '位置' }}
                                    </div>

                                    <div v-else-if="m.kind === 'audio_call' || m.kind === 'video_call'"
                                         class="ggg-pp-cd-bubble bubble-call">
                                        <i class="ggg-fa fa-solid"
                                           :class="m.kind === 'video_call' ? 'fa-video' : 'fa-phone'"></i>
                                        <span>{{ m.kind === 'video_call' ? '视频通话' : '语音通话' }}</span>
                                    </div>

                                    <!-- 骰子：粗线条单面骰子，消息内播放投掷动画 -->
                                    <div v-else-if="m.kind === 'dice'" class="ggg-pp-cd-bubble bubble-dice" @click.stop>
                                        <div class="ggg-dice-scene">
                                            <div class="ggg-dice ggg-dice-anim" :class="'ggg-dice-stop-' + (m.payload?.point || 1)" :key="m.id + '-' + (m.payload?.point || 1) + '-' + (m.phoneTime || '')">
                                                <div class="ggg-dice-face ggg-dice-f1"><span class="d c"></span></div>
                                                <div class="ggg-dice-face ggg-dice-f2"><span class="d tr"></span><span class="d bl"></span></div>
                                                <div class="ggg-dice-face ggg-dice-f3"><span class="d tr"></span><span class="d c"></span><span class="d bl"></span></div>
                                                <div class="ggg-dice-face ggg-dice-f4"><span class="d tl"></span><span class="d tr"></span><span class="d bl"></span><span class="d br"></span></div>
                                                <div class="ggg-dice-face ggg-dice-f5"><span class="d tl"></span><span class="d tr"></span><span class="d c"></span><span class="d bl"></span><span class="d br"></span></div>
                                                <div class="ggg-dice-face ggg-dice-f6"><span class="d tl"></span><span class="d tr"></span><span class="d ml"></span><span class="d mr"></span><span class="d bl"></span><span class="d br"></span></div>
                                            </div>
                                        </div>
                                    </div>

                                    <div v-else class="ggg-pp-cd-bubble">
                                        [{{ m.kind }}] {{ JSON.stringify(m.payload) }}
                                    </div>

                                    <!-- 长按弹出菜单：仅自己的消息可撤回 -->
                                    <div v-if="longPressOn === m.id" class="ggg-pp-cd-popmenu" @click.stop>
                                        <button @click="actionQuote(m)"><i class="ggg-fa fa-solid fa-quote-left"></i>引用</button>
                                        <button @click="actionReact(m)"><i class="ggg-fa fa-solid fa-face-smile"></i>表态</button>
                                        <button @click="actionEnterMultiSelect(m)"><i class="ggg-fa fa-solid fa-list-check"></i>多选</button>
                                        <button v-if="m.senderRole === 'user'" @click="actionRecall(m)"><i class="ggg-fa fa-solid fa-rotate-left"></i>撤回</button>
                                    </div>

                                    <div v-if="reactPickerFor === m.id" class="ggg-pp-cd-emojipick" @click.stop>
                                        <div class="row">
                                            <button v-for="e in COMMON_REACT_EMOJIS" :key="e" @click="pickReactEmoji(m, e)">{{ e }}</button>
                                        </div>
                                        <div class="row">
                                            <input v-model="reactCustomInput" placeholder="自定义 emoji 或文字" />
                                            <button class="ok" @click="pickReactEmoji(m, reactCustomInput)">OK</button>
                                            <button class="cancel" @click="reactPickerFor = null">×</button>
                                        </div>
                                    </div>
                                </div>

                                <div v-if="reactionGroups(m).length" class="ggg-pp-cd-react-chips">
                                    <span v-for="g in reactionGroups(m)" :key="g.emoji" class="chip"
                                          :title="g.actors.join(', ')">
                                        {{ g.emoji }} <b>{{ g.count }}</b>
                                    </span>
                                </div>

                                <div class="ts">{{ fmtTime(m.phoneTime) }}</div>
                            </div>
                            <!-- pending 转圈：仅用户自己的消息显示，位于 bubble-wrap 之后（row-reverse 时视觉上在气泡左侧） -->
                            <div v-if="m.pending && m.senderRole === 'user' && m.kind !== 'voice'" class="ggg-pp-cd-pending-spin"></div>
                        </div>
                    </template>
                </div>

                <div v-if="quoteDraft" class="ggg-pp-cd-quote-preview">
                    <i class="ggg-fa fa-solid fa-quote-left"></i>
                    <span class="qp-text">引用 #{{ quoteDraft.seq }}：{{ quoteDraft.summary }}</span>
                    <button @click="clearQuote"><i class="ggg-fa fa-solid fa-xmark"></i></button>
                </div>

                <div class="ggg-pp-cd-input-wrap" @click.stop>
                    <div class="ggg-pp-cd-icon-row" :class="{open: richBarOpen}" @mousedown.prevent>
                        <button @click="onIconClick('image')" title="图片"><i class="ggg-fa fa-solid fa-image"></i></button>
                        <button @click="onIconClick('transfer')" title="转账"><i class="ggg-fa fa-solid fa-coins"></i></button>
                        <button @click.stop="onIconClick('sticker')" :class="{active:stickerPanelOpen}" title="表情包/骰子"><i class="ggg-fa fa-solid fa-face-smile"></i></button>
                        <button @click="onIconClick('audio_call')" title="语音通话"><i class="ggg-fa fa-solid fa-phone"></i></button>
                        <button @click="onIconClick('video_call')" title="视频通话"><i class="ggg-fa fa-solid fa-video"></i></button>
                    </div>
                    <div class="ggg-pp-cd-input">
                        <button class="ggg-pp-cd-voice-toggle" :class="{active:voiceMode}"
                                @click="toggleVoiceMode" :title="voiceMode?'切回普通输入':'切到语音输入'">
                            <i class="ggg-fa fa-solid" :class="voiceMode?'fa-keyboard':'fa-microphone'"></i>
                        </button>
                        <textarea v-model="inputText" @keydown="onInputKey" ref="taRef" rows="1"
                                  :placeholder="voiceMode ? '输入语音' : '输入文字'"
                                  @focus="richBarOpen = true"
                                  @blur="richBarOpen = false"></textarea>
                        <button class="ggg-pp-cd-send" :disabled="sending" @click="onShipToAI" title="发送">
                            <i v-if="sending" class="ggg-fa fa-solid fa-spinner fa-spin"></i>
                            <i v-else class="ggg-fa fa-solid fa-paper-plane"></i>
                        </button>
                    </div>
                    <div class="ggg-pp-cd-sticker-panel" v-if="stickerPanelOpen" @click.stop>
                        <div class="sp-grid">
                            <button v-if="!stickerTag" class="sp-item dice" @click="rollDice" title="骰子">
                                <div class="sp-dice-mini ggg-dice ggg-dice-stop-5" aria-hidden="true">
                                    <div class="ggg-dice-face ggg-dice-f5"><span class="d tl"></span><span class="d tr"></span><span class="d c"></span><span class="d bl"></span><span class="d br"></span></div>
                                </div>
                                <div class="lbl">骰子</div>
                            </button>
                            <button v-for="s in filteredStickers" :key="s.source + ':' + s.name + ':' + s.url" class="sp-item meme" @click="pickSticker(s)" :title="s.name">
                                <img :src="s.url" :alt="s.name" loading="lazy" />
                                <div class="lbl">{{ s.name }}</div>
                            </button>
                        </div>
                        <div class="sp-tabs">
                            <button v-for="t in stickerTags" :key="t || '__all__'" :class="{active: stickerTag === t}" @click="stickerTag = t">
                                {{ t || '全部' }}
                            </button>
                        </div>
                    </div>
                </div>

                <!-- 通话：开发中提示 -->
                <div v-if="callModal" class="ggg-pp-cd-call-modal" @click.self="callModal = false">
                    <div class="callm-panel">
                        <div class="callm-icon"><i class="ggg-fa fa-solid fa-code"></i></div>
                        <div class="callm-title">功能开发中</div>
                        <div class="callm-desc">语音/视频通话功能尚在开发中，敬请期待 ☎️</div>
                        <button class="callm-ok" @click="callModal = false">好的</button>
                    </div>
                </div>

                <!-- 转账操作 Modal -->
                <div v-if="transferModal" class="ggg-pp-cd-transfer-modal" @click.self="transferModal = null">
                    <div class="tm-panel">
                        <div class="tm-head">
                            <div class="tm-amount-wrap">
                                <div class="tm-currency">{{ transferModal.msg.payload?.currency || '¥' }}</div>
                                <div class="tm-amount">{{ transferModal.msg.payload?.amount || 0 }}</div>
                            </div>
                            <button class="tm-close" @click="transferModal = null">
                                <i class="ggg-fa fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div class="tm-note">{{ transferModal.msg.payload?.note || '无备注' }}</div>
                        <div class="tm-actions">
                            <button class="tm-btn receive" @click="transferAction(transferModal.msg, 'receive')">
                                <i class="ggg-fa fa-solid fa-check"></i> 收款
                            </button>
                            <button class="tm-btn return" @click="transferAction(transferModal.msg, 'return')">
                                <i class="ggg-fa fa-solid fa-rotate-left"></i> 退回
                            </button>
                        </div>
                    </div>
                </div>

                <!-- 富类型小弹 -->
                <div v-if="richForm" class="ggg-pp-cd-richform" @click.self="richForm = null">
                    <div class="rf-panel">
                        <div class="rf-head">
                            {{ richForm.kind === 'image' ? '添加图片' : '转账' }}
                            <button @click="richForm = null"><i class="ggg-fa fa-solid fa-xmark"></i></button>
                        </div>
                        <div class="rf-body">
                            <template v-if="richForm.kind === 'image'">
                                <label>图片描述</label>
                                <input v-model="richForm.alt" placeholder="例：阳台上的猫" />
                            </template>
                            <template v-else>
                                <label>金额</label>
                                <input v-model.number="richForm.amount" type="number" min="0.01" step="0.01" />
                                <label>备注</label>
                                <input v-model="richForm.note" placeholder="例：奶茶钱" />
                            </template>
                        </div>
                        <div class="rf-foot">
                            <button @click="richForm = null">取消</button>
                            <button class="primary" @click="submitRichForm">入待发</button>
                        </div>
                    </div>
                </div>

                <!-- 我的资料抽屉（左侧滑入，半幅） -->
                <transition name="cd-medrawer">
                    <div v-if="meDrawerOpen" class="ggg-pp-cd-medrawer" @click.self="meDrawerOpen = false">
                        <div class="me-panel">
                            <div class="me-head">
                                <span>我的资料</span>
                                <button @click="meDrawerOpen = false"><i class="ggg-fa fa-solid fa-xmark"></i></button>
                            </div>
                            <div class="me-body">
                                <div class="me-avatar-wrap">
                                    <div class="me-avatar">
                                        <img v-if="me.avatar" :src="me.avatar" alt="" />
                                        <i v-else class="ggg-fa fa-solid fa-user"></i>
                                    </div>
                                </div>
                                <label>昵称</label>
                                <input v-model="meDraft.nickname" placeholder="你的 PP 昵称" />
                                <label>个性签名</label>
                                <input v-model="meDraft.signature" placeholder="一句话介绍你自己" />
                                <label>在线状态</label>
                                <select v-model="meDraft.online">
                                    <option v-for="o in ONLINE_OPTIONS" :key="o.v" :value="o.v">{{ o.l }}</option>
                                </select>
                                <div class="me-row">
                                    <label class="cd-switch-row">
                                        <span>对方消息自动翻译</span>
                                        <span class="cd-switch">
                                            <input type="checkbox" v-model="autoTranslate" />
                                            <span></span>
                                        </span>
                                    </label>
                                </div>
                                <button class="me-action" disabled title="占位"><i class="ggg-fa fa-solid fa-right-left"></i> 切换账号（占位）</button>
                            </div>
                            <div class="me-foot">
                                <button @click="meDrawerOpen = false">取消</button>
                                <button class="primary" @click="saveMeDraft">保存</button>
                            </div>
                        </div>
                    </div>
                </transition>

                <!-- 好友设置抽屉（右滑入，全宽） -->
                <transition name="cd-drawer">
                    <div v-if="friendDrawerOpen" class="ggg-pp-cd-drawer" @click.self="friendDrawerOpen = false">
                        <div class="cd-drawer-panel">
                            <div class="cd-drawer-head">
                                <button @click="friendDrawerOpen = false"><i class="ggg-fa fa-solid fa-chevron-left"></i></button>
                                <span>好友设置</span>
                                <span></span>
                            </div>
                            <div class="cd-drawer-body">
                                <div class="cd-section">
                                    <div class="cd-sec-title">备注与背景</div>
                                    <div class="cd-row">
                                        <div class="lbl">备注</div>
                                        <div class="val" v-if="!editingRemark">
                                            <span style="margin-right:8px;">{{ displayName }}</span>
                                            <button class="cd-mini-btn" @click="startEditRemark"><i class="ggg-fa fa-solid fa-pen"></i></button>
                                        </div>
                                        <div class="val" v-else>
                                            <input v-model="remarkDraft" style="width:120px;" />
                                            <button class="cd-mini-btn primary" @click="saveRemark">存</button>
                                        </div>
                                    </div>
                                    <div class="cd-row">
                                        <div class="lbl">聊天背景</div>
                                        <div class="val">
                                            <button class="cd-mini-btn" @click="openBgPicker">
                                                <i class="ggg-fa fa-solid fa-image"></i> 选图
                                            </button>
                                            <button class="cd-mini-btn" @click="clearChatBg" v-if="contactExt.bgUrl">清除</button>
                                        </div>
                                    </div>
                                    <div v-if="contactExt.bgUrl" class="cd-row">
                                        <div class="lbl">预览</div>
                                        <div class="val">
                                            <div class="bg-preview" :style="{backgroundImage:'url(' + contactExt.bgUrl + ')'}"></div>
                                        </div>
                                    </div>
                                </div>
                                <div class="cd-section">
                                    <div class="cd-sec-title">关系管理</div>
                                    <div class="cd-row danger">
                                        <div class="lbl">拉黑好友</div>
                                        <div class="val"><button class="cd-mini-btn danger" disabled title="占位"><i class="ggg-fa fa-solid fa-ban"></i></button></div>
                                    </div>
                                    <div class="cd-row danger">
                                        <div class="lbl">删除好友</div>
                                        <div class="val"><button class="cd-mini-btn danger" disabled title="占位"><i class="ggg-fa fa-solid fa-user-xmark"></i></button></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </transition>

                <!-- 聊天背景选择器 -->
                <div v-if="bgPickerOpen" class="ggg-pp-cd-bgpicker" @click.self="bgPickerOpen = false">
                    <div class="bgp-panel">
                        <div class="bgp-head">
                            <button class="bgp-tab" :class="{active: bgPickerTab==='st'}" @click="bgPickerTab='st'">酒馆背景</button>
                            <button class="bgp-tab" :class="{active: bgPickerTab==='gallery'}" @click="bgPickerTab='gallery'">图库</button>
                            <button class="bgp-x" @click="bgPickerOpen=false"><i class="ggg-fa fa-solid fa-xmark"></i></button>
                        </div>
                        <div class="bgp-body">
                            <template v-if="bgPickerTab==='st'">
                                <div v-if="stBgsList.length===0" class="bgp-empty">未发现酒馆背景</div>
                                <div v-else class="bgp-grid">
                                    <div v-for="b in stBgsList" :key="b.url" class="bgp-cell"
                                         :class="{cur: contactExt.bgUrl===b.url}"
                                         @click="pickChatBg(b.url)" :title="b.name">
                                        <img :src="b.url" loading="lazy" />
                                        <div class="bgp-name">{{ b.name }}</div>
                                    </div>
                                </div>
                            </template>
                            <template v-else>
                                <div v-if="galleryBgs.length===0" class="bgp-empty">
                                    呱呱图库为空。请先在酒馆扩展菜单 → 呱呱小工具 → 图库 上传图片。
                                </div>
                                <div v-else class="bgp-grid">
                                    <div v-for="b in galleryBgs" :key="b.url" class="bgp-cell"
                                         :class="{cur: contactExt.bgUrl===b.url}"
                                         @click="pickChatBg(b.url)" :title="b.name">
                                        <img :src="b.url" loading="lazy" />
                                        <div class="bgp-name">{{ b.name }}</div>
                                    </div>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>

            </div>
        `,
    });
}
