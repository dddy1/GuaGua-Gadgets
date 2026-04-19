/**
 * PP（捏他 QQ）App 主入口
 * 内部三大页签：Chats / Contacts / Discover
 * 顶栏头像 → 打开左滑资料面板
 */
import { createPPStore } from './store.js';
import {
    createPPTopbarComponent,
    createPPBottombarComponent,
    createPPProfilePanelComponent,
} from './components.js';
import { createPPChatsPage } from './pages/chats.js';
import { createPPContactsPage } from './pages/contacts.js';
import { createPPDiscoverPage } from './pages/discover.js';

export function createPPComponent(Vue) {
    const { ref, computed } = Vue;

    const Topbar = createPPTopbarComponent(Vue);
    const Bottombar = createPPBottombarComponent(Vue);
    const ProfilePanel = createPPProfilePanelComponent(Vue);
    const Chats = createPPChatsPage(Vue);
    const Contacts = createPPContactsPage(Vue);
    const Discover = createPPDiscoverPage(Vue);

    return Vue.defineComponent({
        name: 'PPApp',
        components: { Topbar, Bottombar, ProfilePanel, Chats, Contacts, Discover },
        props: {
            onBack: { type: Function, required: true },
        },
        setup(props) {
            const ppStore = createPPStore(Vue);
            const tab = ref('chats');
            const profileOpen = ref(false);

            const titleMap = { chats: '消息', contacts: '联系人', discover: '动态' };
            const title = computed(() => titleMap[tab.value] || 'PP');

            const unreadChats = computed(() =>
                ppStore.state.chats.reduce((n, c) => n + (c.unread || 0), 0)
            );

            const onOpenChat = (id) => {
                console.log('[ggg-phone] 打开聊天：', id); // Phase 3
            };

            return {
                me: ppStore.state.me,
                wallet: ppStore.state.wallet,
                vip: ppStore.state.vip,
                friends: ppStore.state.friends,
                groups: ppStore.state.groups,
                chats: ppStore.state.chats,
                tab, title, profileOpen, unreadChats,
                onTabChange: (t) => tab.value = t,
                onAvatarTap: () => profileOpen.value = true,
                onPanelClose: () => profileOpen.value = false,
                onPlusTap: () => console.log('[ggg-phone] PP +：Phase 4 添加好友'),
                onSearchTap: () => console.log('[ggg-phone] PP 搜索：Phase 3 实装'),
                onOpenChat,
                onBack: props.onBack,
                // v0.2.17：切换账号
                onSwitchAccount: (persona) => ppStore.switchAccount(persona),
            };
        },
        template: /* html */ `
            <div class="ggg-pp-app">
                <topbar
                    :title="title"
                    :avatar="me.avatar"
                    :on-avatar-tap="onAvatarTap"
                    :on-plus-tap="onPlusTap"
                    :on-search-tap="onSearchTap" />

                <div class="ggg-pp-body">
                    <chats v-if="tab === 'chats'" :chats="chats" :on-open-chat="onOpenChat" />
                    <contacts v-else-if="tab === 'contacts'" :friends="friends" :groups="groups" />
                    <discover v-else-if="tab === 'discover'" />
                </div>

                <bottombar
                    :current="tab"
                    :unread-chats="unreadChats"
                    :on-tab-change="onTabChange" />

                <profile-panel
                    :open="profileOpen"
                    :me="me"
                    :wallet="wallet"
                    :vip="vip"
                    :on-close="onPanelClose"
                    :on-switch-account="onSwitchAccount" />
            </div>
        `,
    });
}
