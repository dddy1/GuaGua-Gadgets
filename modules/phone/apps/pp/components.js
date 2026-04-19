/**
 * PP 复用组件三件套（合并到一个文件，避免太散）
 *   - createPPTopbarComponent      顶栏（左头像 / 中标题 / 右搜索+加号）
 *   - createPPBottombarComponent   底部 Tab 栏（含未读角标）
 *   - createPPProfilePanelComponent 左滑资料面板（含主题切换）
 */
import { getTheme, setTheme } from '../../core/theme.js';

/* ==================== 顶栏 ==================== */
export function createPPTopbarComponent(Vue) {
    return Vue.defineComponent({
        name: 'PPTopbar',
        props: {
            title: { type: String, default: 'PP' },
            avatar: { type: String, default: '' },
            onAvatarTap: { type: Function, required: true },
            onPlusTap: { type: Function, default: () => {} },
            onSearchTap: { type: Function, default: () => {} },
        },
        template: /* html */ `
            <div class="ggg-pp-topbar">
                <div class="ggg-pp-topbar-avatar" @click="onAvatarTap">
                    <img v-if="avatar" :src="avatar" alt="" />
                    <i v-else class="ggg-fa fa-solid fa-user"></i>
                </div>
                <div class="ggg-pp-topbar-title">{{ title }}</div>
                <div class="ggg-pp-topbar-actions">
                    <button class="ggg-pp-iconbtn" @click="onSearchTap" aria-label="搜索">
                        <i class="ggg-fa fa-solid fa-magnifying-glass"></i>
                    </button>
                    <button class="ggg-pp-iconbtn" @click="onPlusTap" aria-label="添加">
                        <i class="ggg-fa fa-solid fa-plus"></i>
                    </button>
                </div>
            </div>
        `,
    });
}

/* ==================== 底栏 ==================== */
export function createPPBottombarComponent(Vue) {
    return Vue.defineComponent({
        name: 'PPBottombar',
        props: {
            current: { type: String, required: true },
            unreadChats: { type: Number, default: 0 },
            onTabChange: { type: Function, required: true },
        },
        setup() {
            const tabs = [
                { id: 'chats',    name: '消息',   icon: 'fa-comment-dots' },
                { id: 'contacts', name: '联系人', icon: 'fa-address-book' },
                { id: 'discover', name: '动态',   icon: 'fa-compass' },
            ];
            return { tabs };
        },
        template: /* html */ `
            <div class="ggg-pp-bottombar">
                <div
                    v-for="t in tabs"
                    :key="t.id"
                    class="ggg-pp-bottom-tab"
                    :class="{ active: current === t.id }"
                    @click="onTabChange(t.id)">
                    <div class="ggg-pp-bottom-icon">
                        <i class="ggg-fa fa-solid" :class="t.icon"></i>
                        <span v-if="t.id === 'chats' && unreadChats > 0" class="ggg-pp-bottom-badge">{{ unreadChats }}</span>
                    </div>
                    <div class="ggg-pp-bottom-name">{{ t.name }}</div>
                </div>
            </div>
        `,
    });
}

/* ==================== 左滑面板 ==================== */
import { settings as gggSettings, saveAllSettings as gggSaveAll } from '../../../../index.js';
import { readStAllPersonas, readStAllPersonasAsync } from './store.js';

export function createPPProfilePanelComponent(Vue) {
    const { ref, computed } = Vue;
    return Vue.defineComponent({
        name: 'PPProfilePanel',
        props: {
            open: { type: Boolean, default: false },
            me: { type: Object, required: true },
            wallet: { type: Object, required: true },
            vip: { type: Object, required: true },
            onClose: { type: Function, required: true },
            // v0.2.17：切换账号回调（来自 store.switchAccount）
            onSwitchAccount: { type: Function, default: () => {} },
        },
        setup(props) {
            const items = [
                { id: 'switch-account', name: '切换账号', icon: 'fa-user-group', color: '#ec4899' },
                { id: 'wallet',   name: '钱包',   icon: 'fa-wallet',  color: '#f59e0b' },
                { id: 'vip',      name: '会员',   icon: 'fa-crown',   color: '#eab308' },
                { id: 'deco',     name: '装扮',   icon: 'fa-palette', color: '#a855f7' },
                { id: 'fav',      name: '收藏',   icon: 'fa-star',    color: '#06b6d4' },
                { id: 'dev',      name: '开发者', icon: 'fa-code',    color: '#10b981' },
                { id: 'settings', name: '设置',   icon: 'fa-gear',    color: '#64748b' },
            ];
            // v0.2.17：账号切换 picker
            const accountPickerOpen = ref(false);
            const personas = ref([]);
            const personasLoading = ref(false);
            const refreshPersonas = async () => {
                // 先用同步 fallback 立刻填一次（无需等待）
                personas.value = readStAllPersonas();
                personasLoading.value = true;
                try {
                    const list = await readStAllPersonasAsync();
                    if (list && list.length) personas.value = list;
                } finally {
                    personasLoading.value = false;
                }
            };
            const onItem = (id) => {
                if (id === 'switch-account') {
                    accountPickerOpen.value = true;
                    refreshPersonas();
                    return;
                }
                console.log('[ggg-phone] PP 面板项点击：', id);
            };
            const closeAccountPicker = () => { accountPickerOpen.value = false; };
            const pickPersona = (p) => {
                props.onSwitchAccount?.(p);
                closeAccountPicker();
            };

            const theme = ref(getTheme());
            const toggleTheme = () => {
                const next = theme.value === 'dark' ? 'light' : 'dark';
                setTheme(next);
                theme.value = next;
            };

            // ===== inline 编辑 =====
            const editing = ref(''); // 'nick' | 'sig' | 'id' | ''
            const startEdit = (k) => { editing.value = k; };
            const saveField = (k, val) => {
                if (k === 'nick') props.me.nickname  = String(val || '').slice(0, 30);
                if (k === 'sig')  props.me.signature = String(val || '').slice(0, 100);
                if (k === 'id')   props.me.ppId      = String(val || '').slice(0, 20);
                gggSaveAll();
                editing.value = '';
            };

            // ===== 头像选择器 =====
            const pickerOpen = ref(false);
            const pickerTab = ref('upload'); // upload | gallery
            // 头像库（gggSettings.avatars），不是普通图库
            const galleryImgs = computed(() => {
                const list = gggSettings.avatars || [];
                return list.map(it => ({
                    url: it.url || it.dataUrl || '',
                    name: it.name || '',
                })).filter(it => it.url);
            });
            const openPicker = () => { pickerOpen.value = true; pickerTab.value = 'upload'; };
            const closePicker = () => { pickerOpen.value = false; };
            const setAvatar = (url) => {
                props.me.avatar = url;
                gggSaveAll();
                closePicker();
            };
            const onUpload = (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => setAvatar(reader.result);
                reader.readAsDataURL(file);
            };

            return {
                items, onItem, theme, toggleTheme,
                editing, startEdit, saveField,
                pickerOpen, pickerTab, galleryImgs, openPicker, closePicker, setAvatar, onUpload,
                // v0.2.17：账号切换
                accountPickerOpen, personas, personasLoading, closeAccountPicker, pickPersona,
            };
        },
        template: /* html */ `
            <div v-if="open" class="ggg-pp-profile-mask" @click="onClose"></div>
            <div class="ggg-pp-profile-panel" :class="{ open }">
                <div class="ggg-pp-profile-head">
                    <div class="ggg-pp-profile-avatar" @click="openPicker" title="点击更换头像">
                        <img v-if="me.avatar" :src="me.avatar" alt="avatar" />
                        <i v-else class="ggg-fa fa-solid fa-user"></i>
                    </div>
                    <div class="ggg-pp-profile-meta">
                        <!-- 昵称 -->
                        <div class="ggg-pp-profile-nick">
                            <input v-if="editing === 'nick'" class="ggg-pp-edit-inline" autofocus
                                :value="me.nickname"
                                @blur="saveField('nick', $event.target.value)"
                                @keyup.enter="saveField('nick', $event.target.value)" />
                            <span v-else @click="startEdit('nick')" style="cursor:text;">{{ me.nickname }}</span>
                        </div>
                        <!-- 签名 -->
                        <div class="ggg-pp-profile-sig">
                            <input v-if="editing === 'sig'" class="ggg-pp-edit-inline" autofocus
                                :value="me.signature"
                                @blur="saveField('sig', $event.target.value)"
                                @keyup.enter="saveField('sig', $event.target.value)" />
                            <span v-else @click="startEdit('sig')" style="cursor:text;">{{ me.signature || '点击编辑签名' }}</span>
                        </div>
                        <!-- PP 号 -->
                        <div class="ggg-pp-profile-id">
                            PP:
                            <input v-if="editing === 'id'" class="ggg-pp-edit-inline" autofocus
                                style="width:auto;display:inline-block;"
                                :value="me.ppId"
                                @blur="saveField('id', $event.target.value)"
                                @keyup.enter="saveField('id', $event.target.value)" />
                            <span v-else @click="startEdit('id')" style="cursor:text;">{{ me.ppId }}</span>
                        </div>
                    </div>
                    <!-- 主题按钮已移到面板左下角 footer -->
                </div>

                <!-- 头像选择器 -->
                <div v-if="pickerOpen" class="ggg-pp-avatar-picker" @click.self="closePicker">
                    <div class="ggg-pp-avatar-picker-panel">
                        <div class="ggg-pp-avatar-picker-head">
                            <div style="font-weight:600;">更换头像</div>
                            <button class="ggg-set-iconbtn" @click="closePicker">
                                <i class="ggg-fa fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div class="ggg-pp-avatar-picker-tabs">
                            <div :class="{ active: pickerTab === 'upload' }" @click="pickerTab = 'upload'">本地上传</div>
                            <div :class="{ active: pickerTab === 'gallery' }" @click="pickerTab = 'gallery'">头像库</div>
                        </div>
                        <div class="ggg-pp-avatar-picker-body">
                            <template v-if="pickerTab === 'upload'">
                                <label class="ggg-pp-avatar-picker-upload">
                                    <i class="ggg-fa fa-solid fa-cloud-arrow-up" style="font-size:24px;"></i>
                                    <div style="margin-top:6px;">点击选择本地图片</div>
                                    <input type="file" accept="image/*" @change="onUpload" style="display:none;" />
                                </label>
                                <div v-if="me.avatar" style="text-align:center;">
                                    <button class="ggg-set-btn" @click="setAvatar('')">
                                        <i class="ggg-fa fa-solid fa-trash"></i> 清除当前头像
                                    </button>
                                </div>
                            </template>
                            <template v-else>
                                <div v-if="galleryImgs.length === 0" style="text-align:center;color:var(--ggg-text-dim);padding:20px;font-size:12px;">
                                    呱呱头像库为空。请先在酒馆扩展菜单 → 呱呱小工具 → 图库 → 头像库 上传图片。
                                </div>
                                <div v-else class="ggg-pp-avatar-picker-grid">
                                    <div v-for="img in galleryImgs" :key="img.url" @click="setAvatar(img.url)" :title="img.name">
                                        <img :src="img.url" :alt="img.name" loading="lazy" />
                                    </div>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>

                <div class="ggg-pp-profile-stats">
                    <div class="stat">
                        <div class="num">¥{{ wallet.balance.toFixed(2) }}</div>
                        <div class="lbl">钱包</div>
                    </div>
                    <div class="stat">
                        <div class="num">{{ vip.tier === 'none' ? '—' : vip.tier.toUpperCase() }}</div>
                        <div class="lbl">会员</div>
                    </div>
                </div>

                <div class="ggg-pp-profile-list">
                    <div
                        v-for="it in items.filter(x => x.id !== 'settings')"
                        :key="it.id"
                        class="ggg-pp-profile-item"
                        @click="onItem(it.id)">
                        <span class="ico" :style="{ color: it.color }">
                            <i class="ggg-fa fa-solid" :class="it.icon"></i>
                        </span>
                        <span class="name">{{ it.name }}</span>
                        <i class="ggg-fa fa-solid fa-chevron-right arrow"></i>
                    </div>
                </div>

                <!-- v0.2.17：账号切换 picker -->
                <div v-if="accountPickerOpen" class="ggg-pp-avatar-picker" @click.self="closeAccountPicker">
                    <div class="ggg-pp-avatar-picker-panel">
                        <div class="ggg-pp-avatar-picker-head">
                            <div style="font-weight:600;">切换账号（酒馆 Persona）</div>
                            <button class="ggg-set-iconbtn" @click="closeAccountPicker">
                                <i class="ggg-fa fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div class="ggg-pp-avatar-picker-body">
                            <div v-if="personasLoading && personas.length === 0" style="text-align:center;color:var(--ggg-text-dim);padding:20px;font-size:12px;">
                                正在读取酒馆账号…
                            </div>
                            <div v-else-if="personas.length === 0" style="text-align:center;color:var(--ggg-text-dim);padding:20px;font-size:12px;">
                                未发现酒馆 Persona。请先在酒馆 → User Settings → Persona Management 中创建账号；或安装 st-api-wrapper 扩展以获得更好兼容性。
                            </div>
                            <div v-else class="ggg-pp-account-list">
                                <div v-for="p in personas" :key="p.avatar"
                                     class="ggg-pp-account-item"
                                     :class="{ current: p.isCurrent }"
                                     @click="pickPersona(p)">
                                    <img :src="p.url" :alt="p.name" loading="lazy"
                                         onerror="this.style.display='none'" />
                                    <div class="meta">
                                        <div class="name">{{ p.name }}</div>
                                        <div class="key">{{ p.avatar }}</div>
                                    </div>
                                    <i v-if="p.isCurrent" class="ggg-fa fa-solid fa-circle-check"
                                       style="color:var(--ggg-accent);"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 设置 + 日夜切换：独立放左下角 -->
                <div class="ggg-pp-profile-footer">
                    <button class="ggg-pp-profile-footer-btn" @click="onItem('settings')" title="设置">
                        <i class="ggg-fa fa-solid fa-gear"></i>
                        <span>设置</span>
                    </button>
                    <button class="ggg-pp-profile-footer-btn theme" @click="toggleTheme" :title="'切换主题（当前：' + theme + '）'">
                        <i class="ggg-fa fa-solid" :class="theme === 'dark' ? 'fa-moon' : 'fa-sun'"></i>
                        <span>{{ theme === 'dark' ? '夜间' : '日间' }}</span>
                    </button>
                </div>
            </div>
        `,
    });
}
