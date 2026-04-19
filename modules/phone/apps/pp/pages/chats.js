/**
 * PP - Chats 页 ：会话列表（占位）
 */
export function createPPChatsPage(Vue) {
    return Vue.defineComponent({
        name: 'PPChats',
        props: {
            chats: { type: Array, required: true },
            onOpenChat: { type: Function, required: true },
        },
        template: /* html */ `
            <div class="ggg-pp-page ggg-pp-chats">
                <!-- 备忘录 / 搜索框（功能：手机 tag 输入 → 写入提示词，Phase 2 后续实现） -->
                <div class="ggg-pp-searchbar">
                    <i class="ggg-fa fa-solid fa-magnifying-glass"></i>
                    <input type="text" placeholder="搜索 / 备忘录（输入手机 tag）" />
                </div>

                <div v-if="chats.length === 0" class="ggg-pp-empty">
                    <i class="ggg-fa fa-solid fa-comment-slash"></i>
                    <div>还没有聊天会话</div>
                    <div class="hint">在「联系人」里添加好友，开始聊天吧</div>
                </div>

                <div v-else class="ggg-pp-chat-list">
                    <div
                        v-for="c in chats"
                        :key="c.id"
                        class="ggg-pp-chat-item"
                        @click="onOpenChat(c.id)">
                        <div class="avatar"><i class="ggg-fa fa-solid fa-user"></i></div>
                        <div class="meta">
                            <div class="line1">
                                <span class="name">{{ c.name || c.peerId }}</span>
                                <span class="time">{{ c.lastTs ? new Date(c.lastTs).toLocaleTimeString().slice(0,5) : '' }}</span>
                            </div>
                            <div class="line2">
                                <span class="preview">{{ c.lastPreview || '...' }}</span>
                                <span v-if="c.unread > 0" class="badge">{{ c.unread }}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `,
    });
}
