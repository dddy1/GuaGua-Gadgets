/**
 * PP（捏他 QQ）App 主入口 —— v0.2.57
 *   currentView: 'list'（chats/contacts/discover 三 tab）| 'chat-detail'（私聊或群聊详情）
 */
import { createPPStore } from './store.js';
import {
    createPPTopbarComponent,
    createPPBottombarComponent,
    createPPProfilePanelComponent,
    applyPPAppearanceStyles,
} from './components.js';
import { createPPChatsPage }     from './pages/chats.js';
import { createPPContactsPage }  from './pages/contacts.js';
import { createPPDiscoverPage }  from './pages/discover.js';
import { createPPChatDetailPage } from './pages/chat-detail.js';
import { createPPAppearancePage } from './pages/appearance.js';
import { createPPProfileActionPage } from './pages/profile-action.js';

export function createPPComponent(Vue) {
    const { ref, computed, onMounted, onUnmounted } = Vue;

    const Topbar       = createPPTopbarComponent(Vue);
    const Bottombar    = createPPBottombarComponent(Vue);
    const ProfilePanel = createPPProfilePanelComponent(Vue);
    const Chats        = createPPChatsPage(Vue);
    const Contacts     = createPPContactsPage(Vue);
    const Discover     = createPPDiscoverPage(Vue);
    const ChatDetail   = createPPChatDetailPage(Vue);
    const Appearance   = createPPAppearancePage(Vue);
    const ProfileAction = createPPProfileActionPage(Vue);

    return Vue.defineComponent({
        name: 'PPApp',
        components: { Topbar, Bottombar, ProfilePanel, Chats, Contacts, Discover, ChatDetail, Appearance, ProfileAction },
        props: {
            onBack: { type: Function, required: true },
            ppOpenRequest: { type: Object, default: null },
        },
        setup(props) {
            const ppStore = createPPStore(Vue);
            const tab = ref('chats');
            const profileOpen = ref(false);

            // v0.2.57：详情视图
            const currentView = ref('list');     // 'list' | 'profile' | 'chat-detail' | 'appearance' | 'profile-action'
            const detailContact = ref(null);     // 当前打开的好友/群对象
            const detailScope = ref('private');  // 'private' | 'group'
            const profilePage = ref('');
            const tickRef = ref(0);              // 让 chats 列表强制刷新

            const titleMap = { chats: '消息', contacts: '联系人', discover: '动态' };
            const title = computed(() => titleMap[tab.value] || 'PP');

            const unreadChats = computed(() => {
                const chats = Array.isArray(ppStore.state.chats) ? ppStore.state.chats : [];
                return chats.reduce((n, c) => n + (c.unread || 0), 0);
            });

            const onOpenChat = (contact, scope = 'private') => {
                if (!contact) return;
                detailContact.value = contact;
                detailScope.value = scope;
                currentView.value = 'chat-detail';
            };
            const openRequestedChat = (request) => {
                if (!request) return;
                const reqContact = request.contact || {};
                const targetId = request.contactId || reqContact.id || '';
                const targetName = request.nickname || reqContact.nickname || reqContact.name || '';
                let contact = ppStore.state.friends.find(f =>
                    (targetId && f.id === targetId)
                    || (targetName && (f.nickname === targetName || f.remark === targetName || f.name === targetName))
                );
                if (!contact && targetName) {
                    contact = {
                        id: targetId || `pp_auto_${Date.now()}`,
                        nickname: targetName,
                        avatar: reqContact.avatar || '',
                        signature: reqContact.signature || '',
                        group: 'friend',
                        source: reqContact.source || 'last-mes-pp',
                    };
                    ppStore.addOrUpdateFriend(contact);
                }
                if (contact) {
                    tab.value = 'chats';
                    profileOpen.value = false;
                    onOpenChat(contact, request.scope || 'private');
                }
            };

            const onLeaveDetail = () => {
                currentView.value = 'list';
                tickRef.value++; // 触发 chats 列表刷新最近消息
            };
            const onReturnProfile = () => {
                profileOpen.value = true;
                currentView.value = 'profile';
                profilePage.value = '';
            };
            const onOpenAppearance = () => {
                profileOpen.value = false;
                currentView.value = 'appearance';
            };
            const onOpenProfilePage = (page) => {
                profileOpen.value = false;
                profilePage.value = page;
                currentView.value = 'profile-action';
            };
            const localBack = () => {
                if (currentView.value === 'chat-detail') {
                    onLeaveDetail();
                    return;
                }
                if (currentView.value === 'profile') {
                    currentView.value = 'list';
                    profileOpen.value = false;
                    return;
                }
                if (currentView.value === 'appearance') {
                    onReturnProfile();
                    return;
                }
                if (currentView.value === 'profile-action') {
                    onReturnProfile();
                    return;
                }
                if (profileOpen.value) {
                    profileOpen.value = false;
                    return;
                }
                props.onBack?.();
            };

            onMounted(() => {
                applyPPAppearanceStyles();
                window.gggPhoneAppBack = localBack;
                openRequestedChat(props.ppOpenRequest);
            });
            Vue.watch(() => props.ppOpenRequest, (request) => {
                openRequestedChat(request);
            }, { deep: true });
            onUnmounted(() => {
                if (window.gggPhoneAppBack === localBack) window.gggPhoneAppBack = null;
            });

            return {
                me: ppStore.state.me,
                wallet: ppStore.state.wallet,
                vip: ppStore.state.vip,
                friends: ppStore.state.friends,
                groups: ppStore.state.groups,
                tab, title, profileOpen, unreadChats,
                currentView, detailContact, detailScope, tickRef, profilePage,
                onTabChange: (t) => tab.value = t,
                onAvatarTap: () => { profileOpen.value = true; currentView.value = 'profile'; },
                onPanelClose: () => profileOpen.value = false,
                onPlusTap: () => console.log('[ggg-phone] PP +：Phase 4 添加好友'),
                onSearchTap: () => console.log('[ggg-phone] PP 搜索：Phase 3 实装'),
                onOpenChat, onLeaveDetail, onOpenAppearance, onOpenProfilePage, onReturnProfile,
                onBack: localBack,
                onSwitchAccount: (persona) => ppStore.switchAccount(persona),
            };
        },
        template: /* html */ `
            <div class="ggg-pp-app">
                <!-- 列表视图 -->
                <template v-if="currentView === 'list'">
                    <topbar
                        :title="title"
                        :avatar="me.avatar"
                        :on-avatar-tap="onAvatarTap"
                        :on-plus-tap="onPlusTap"
                        :on-search-tap="onSearchTap" />

                    <div class="ggg-pp-body">
                        <chats v-if="tab === 'chats'" :friends="friends" :groups="groups" :on-open-chat="onOpenChat" :tick="tickRef" />
                        <contacts v-else-if="tab === 'contacts'" :friends="friends" :groups="groups" :on-open-chat="onOpenChat" />
                        <discover v-else-if="tab === 'discover'" />
                    </div>

                    <bottombar
                        :current="tab"
                        :unread-chats="unreadChats"
                        :on-tab-change="onTabChange" />

                </template>

                <profile-panel
                    v-else-if="currentView === 'profile'"
                    :open="profileOpen"
                    :me="me"
                    :wallet="wallet"
                    :vip="vip"
                    :on-close="onBack"
                    :on-open-appearance="onOpenAppearance"
                    :on-open-profile-page="onOpenProfilePage"
                    :on-switch-account="onSwitchAccount" />

                <!-- 聊天详情视图 -->
                <chat-detail
                    v-else-if="currentView === 'chat-detail' && detailContact"
                    :scope="detailScope"
                    :contact="detailContact"
                    :me="me"
                    :on-back="onLeaveDetail" />

                <appearance
                    v-else-if="currentView === 'appearance'"
                    :wallet="wallet"
                    :vip="vip"
                    :on-back="onReturnProfile" />

                <profile-action
                    v-else-if="currentView === 'profile-action'"
                    :page="profilePage"
                    :me="me"
                    :wallet="wallet"
                    :vip="vip"
                    :on-back="onReturnProfile"
                    :on-switch-account="onSwitchAccount" />
            </div>
        `,
    });
}
