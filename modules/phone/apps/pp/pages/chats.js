/**
 * PP - Chats 页 ：会话列表 —— v0.2.57
 *   - 数据源：friends + groups（统一 contacts），从 messages 实时算 lastPreview / lastTs
 *   - 点击 → 进入聊天详情页（onOpenChat(contact, scope)）
 */
import { listMessages } from '../messages.js';
import { formatRelativeTime } from '../../../core/pp-sender.js';

function previewOfMsg(m) {
    if (!m) return '';
    if (m.recalled) return '[已撤回]';
    switch (m.kind) {
        case 'text':      return m.payload?.text || '';
        case 'image':     return '[图片]';
        case 'voice':     return '[语音]';
        case 'sticker':   return '[表情]';
        case 'transfer':  return `[转账 ${m.payload?.currency || '¥'}${m.payload?.amount || 0}]`;
        case 'redpacket': return '[红包]';
        case 'location':  return '[位置]';
        default:          return `[${m.kind}]`;
    }
}
function uniqueById(list) {
    const seen = new Set();
    const out = [];
    for (const item of list || []) {
        const id = item?.fromCharacter ? `char:${item.fromCharacter}` : (item?.id || item?.nickname || item?.name);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(item);
    }
    return out;
}

export function createPPChatsPage(Vue) {
    return Vue.defineComponent({
        name: 'PPChats',
        props: {
            friends:    { type: Array, required: true },
            groups:     { type: Array, required: true },
            onOpenChat: { type: Function, required: true },
            tick:       { type: Number, default: 0 },
        },
        setup(props) {
            const { computed } = Vue;

            const items = computed(() => {
                props.tick; // 依赖
                const out = [];
                for (const f of uniqueById(props.friends)) {
                    const msgs = listMessages({ scope: 'private', contactId: f.id });
                    const last = msgs.length ? msgs.reduce((a, b) => a.createdAt > b.createdAt ? a : b) : null;
                    out.push({
                        scope: 'private',
                        contact: f,
                        displayName: f.remark || f.nickname || '未知',
                        avatar: f.avatar || '',
                        lastPreview: previewOfMsg(last),
                        lastTs: last?.createdAt || 0,
                        lastPhoneTime: last?.phoneTime || '',
                        unread: 0,
                    });
                }
                for (const g of uniqueById(props.groups)) {
                    const msgs = listMessages({ scope: 'group', groupId: g.id });
                    const last = msgs.length ? msgs.reduce((a, b) => a.createdAt > b.createdAt ? a : b) : null;
                    out.push({
                        scope: 'group',
                        contact: g,
                        displayName: g.name || '群聊',
                        avatar: g.avatar || '',
                        lastPreview: previewOfMsg(last),
                        lastTs: last?.createdAt || 0,
                        lastPhoneTime: last?.phoneTime || '',
                        unread: 0,
                        isGroup: true,
                    });
                }
                // 按最近时间倒序，没消息的排最后保留原顺序
                out.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
                return out;
            });

            const fmtTs = (iso) => iso ? formatRelativeTime(iso) : '';

            return { items, fmtTs };
        },
        template: /* html */ `
            <div class="ggg-pp-page ggg-pp-chats">
                <div class="ggg-pp-searchbar">
                    <i class="ggg-fa fa-solid fa-magnifying-glass"></i>
                    <input type="text" placeholder="搜索 / 备忘录（输入手机 tag）" />
                </div>

                <div v-if="items.length === 0" class="ggg-pp-empty">
                    <i class="ggg-fa fa-solid fa-comment-slash"></i>
                    <div>还没有聊天会话</div>
                    <div class="hint">在「联系人」里添加好友，开始聊天吧</div>
                </div>

                <div v-else class="ggg-pp-chat-list">
                    <div
                        v-for="it in items"
                        :key="it.scope + ':' + it.contact.id"
                        class="ggg-pp-chat-item"
                        @click="onOpenChat(it.contact, it.scope)">
                        <div class="avatar">
                            <img v-if="it.avatar" :src="it.avatar" alt="" />
                            <i v-else class="ggg-fa fa-solid" :class="it.isGroup ? 'fa-users' : 'fa-user'"></i>
                        </div>
                        <div class="meta">
                            <div class="line1">
                                <span class="name">{{ it.displayName }}</span>
                                <span class="time">{{ fmtTs(it.lastPhoneTime) }}</span>
                            </div>
                            <div class="line2">
                                <span class="preview">{{ it.lastPreview || '...' }}</span>
                                <span v-if="it.unread > 0" class="badge">{{ it.unread }}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `,
    });
}
