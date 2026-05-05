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
import { settings as gggSettings } from '../../../../index.js';
import { persistCurrentMeProfile } from './store.js';

/* v0.2.52：默认头像（极简人头+肩膀，纯色背景） */
export const DEFAULT_AVATAR = "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'>
        <rect width='200' height='200' fill='#94a3b8'/>
        <circle cx='100' cy='78' r='32' fill='#f1f5f9'/>
        <path d='M44 200 C 44 148, 156 148, 156 200 Z' fill='#f1f5f9'/>
    </svg>`
);
const DEFAULT_THEME_COLORS = {
    light: '#f8fafc',
    dark: '#0f172a',
    text: '',
    textDim: '#64748b',
    card: '#ffffff',
    cardHover: '#f1f5f9',
    border: '#e2e8f0',
    accent: '#3b82f6',
    icon: '#3b82f6',
    topbar: '#ffffff',
    bottombar: '#ffffff',
};
const DEFAULT_THEME_EFFECTS = Object.fromEntries(
    Object.keys(DEFAULT_THEME_COLORS).map(key => [key, { opacity: 1, blur: 0 }])
);

function currentPersonaKey() {
    const liveMe = (typeof window !== 'undefined') ? window.__ggg_phone_pp_store?.state?.me : null;
    const key = liveMe?.avatarKey || gggSettings.phone?.pp?.me?.avatarKey || '';
    return key || '__none__';
}

function createPPAppearance() {
    return {
        fonts: { selfBubble: '', otherBubble: '', global: '' },
        bubbles: {
            self: { color: '#95ec69', opacity: 1, blur: 0 },
            other: { color: '#ffffff', opacity: 1, blur: 0 },
        },
        themeColors: { ...DEFAULT_THEME_COLORS },
        themeEffects: cloneThemeEffects(),
        ownedFonts: [],
    };
}

function cloneThemeEffects() {
    return Object.fromEntries(
        Object.entries(DEFAULT_THEME_EFFECTS).map(([key, effect]) => [key, { ...effect }])
    );
}

function normalizeHexColor(value) {
    const hex = String(value || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '';
}

function isBlackHex(value) {
    return normalizeHexColor(value).toLowerCase() === '#000000';
}

function repairPickerBlackout(app) {
    const keys = Object.keys(DEFAULT_THEME_COLORS).filter(key => key !== 'text');
    const blackCount = keys.filter(key => isBlackHex(app.themeColors?.[key])).length;
    if (blackCount >= keys.length - 1) {
        app.themeColors = { ...DEFAULT_THEME_COLORS };
        if (isBlackHex(app.bubbles?.self?.color)) app.bubbles.self.color = '#95ec69';
        if (isBlackHex(app.bubbles?.other?.color)) app.bubbles.other.color = '#ffffff';
    }
}

function ensurePPAppearance(personaKey = currentPersonaKey()) {
    if (!gggSettings.phone) gggSettings.phone = {};
    if (!gggSettings.phone.pp) gggSettings.phone.pp = {};
    const liveState = (typeof window !== 'undefined') ? window.__ggg_phone_pp_store?.state : null;
    const pp = liveState || gggSettings.phone.pp;
    if (!pp.appearanceByPersona) pp.appearanceByPersona = {};
    if (!pp.appearanceByPersona[personaKey]) pp.appearanceByPersona[personaKey] = createPPAppearance();
    const app = pp.appearanceByPersona[personaKey];
    if (!app.fonts) app.fonts = { selfBubble: '', otherBubble: '', global: '' };
    if (!app.bubbles) app.bubbles = createPPAppearance().bubbles;
    if (!app.bubbles.self) app.bubbles.self = { color: '#95ec69', opacity: 1, blur: 0 };
    if (!app.bubbles.other) app.bubbles.other = { color: '#ffffff', opacity: 1, blur: 0 };
    if (!app.themeColors) app.themeColors = { ...DEFAULT_THEME_COLORS };
    Object.entries(DEFAULT_THEME_COLORS).forEach(([key, value]) => {
        if (!app.themeColors[key] && key !== 'text') app.themeColors[key] = value;
    });
    repairPickerBlackout(app);
    if (!app.themeEffects) app.themeEffects = cloneThemeEffects();
    Object.entries(DEFAULT_THEME_EFFECTS).forEach(([key, value]) => {
        if (!app.themeEffects[key]) app.themeEffects[key] = { ...value };
        app.themeEffects[key].opacity = clampNumber(app.themeEffects[key].opacity, 0.05, 1, value.opacity);
        app.themeEffects[key].blur = clampNumber(app.themeEffects[key].blur, 0, 24, value.blur);
    });
    if (!Array.isArray(app.ownedFonts)) app.ownedFonts = [];

    const legacy = pp.appearance || gggSettings.phone.pp.appearance;
    if (legacy && !app._migratedFromGlobal) {
        if (Array.isArray(legacy.ownedFonts)) {
            legacy.ownedFonts.forEach(id => { if (id && !app.ownedFonts.includes(id)) app.ownedFonts.push(id); });
        }
        if (legacy.fonts) {
            app.fonts.selfBubble = app.fonts.selfBubble || legacy.fonts.selfBubble || '';
            app.fonts.otherBubble = app.fonts.otherBubble || legacy.fonts.otherBubble || '';
            app.fonts.global = app.fonts.global || legacy.fonts.global || '';
        }
        app._migratedFromGlobal = true;
    }
    gggSettings.phone.pp.appearanceByPersona = pp.appearanceByPersona;
    return app;
}

function cssString(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function hexToRgb(hex, fallback = [255, 255, 255]) {
    const m = String(hex || '').trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) return fallback;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function isHexColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || '').trim());
}

function themeEffect(themeEffects, key) {
    return themeEffects?.[key] || DEFAULT_THEME_EFFECTS[key] || { opacity: 1, blur: 0 };
}

function colorWithAlpha(hex, alpha, fallbackHex) {
    const [r, g, b] = hexToRgb(hex, hexToRgb(fallbackHex));
    const a = clampNumber(alpha, 0.05, 1, 1);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function readableTextColor(hex, lightText = '#f8fafc', darkText = '#0f172a') {
    const [r, g, b] = hexToRgb(hex, [248, 250, 252]);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 150 ? darkText : lightText;
}

function isVipActive() {
    const vip = gggSettings.phone?.pp?.vip;
    return !!vip && vip.tier !== 'none' && Number(vip.expireAt || 0) > Date.now();
}

function fontFamilyById(id) {
    if (!id) return '';
    const font = (gggSettings.fonts?.list || []).find(f => f.id === id);
    if (!font) return '';
    return font.fontFaceName || font.name || font.zhName || '';
}

export function applyPPAppearanceStyles() {
    const appearance = ensurePPAppearance();
    const fonts = appearance.fonts || {};
    const bubbles = appearance.bubbles || {};
    const themeColors = appearance.themeColors || {};
    const themeEffects = appearance.themeEffects || {};
    let styleEl = document.getElementById('ggg-pp-appearance-fonts');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'ggg-pp-appearance-fonts';
        document.head.appendChild(styleEl);
    }

    const globalFamily = fontFamilyById(fonts.global);
    const selfFamily = fontFamilyById(fonts.selfBubble);
    const otherFamily = fontFamilyById(fonts.otherBubble);
    const rules = [];

    if (globalFamily) {
        rules.push(`.ggg-pp-app, .ggg-pp-app button, .ggg-pp-app input, .ggg-pp-app select, .ggg-pp-app textarea { font-family: '${cssString(globalFamily)}', sans-serif !important; }`);
    }
    if (selfFamily) {
        rules.push(`.ggg-pp-cd-row.mine .ggg-pp-cd-bubble, .ggg-pp-cd-row.mine .ggg-pp-cd-card-transfer, .ggg-pp-cd-row.mine .img-card { font-family: '${cssString(selfFamily)}', sans-serif !important; }`);
    }
    if (otherFamily) {
        rules.push(`.ggg-pp-cd-row:not(.mine) .ggg-pp-cd-bubble, .ggg-pp-cd-row:not(.mine) .ggg-pp-cd-card-transfer, .ggg-pp-cd-row:not(.mine) .img-card { font-family: '${cssString(otherFamily)}', sans-serif !important; }`);
    }
    if (isVipActive()) {
        const lightBg = isHexColor(themeColors.light) ? themeColors.light : '#f8fafc';
        const darkBg = isHexColor(themeColors.dark) ? themeColors.dark : '#0f172a';
        const textColor = isHexColor(themeColors.text) ? themeColors.text : '';
        const lightText = textColor || readableTextColor(lightBg);
        const darkText = textColor || readableTextColor(darkBg);
        const textDim = isHexColor(themeColors.textDim) ? themeColors.textDim : '#64748b';
        const card = isHexColor(themeColors.card) ? themeColors.card : '#ffffff';
        const cardHover = isHexColor(themeColors.cardHover) ? themeColors.cardHover : '#f1f5f9';
        const border = isHexColor(themeColors.border) ? themeColors.border : '#e2e8f0';
        const accent = isHexColor(themeColors.accent) ? themeColors.accent : '#3b82f6';
        const icon = isHexColor(themeColors.icon) ? themeColors.icon : accent;
        const topbar = isHexColor(themeColors.topbar) ? themeColors.topbar : '#ffffff';
        const bottombar = isHexColor(themeColors.bottombar) ? themeColors.bottombar : topbar;
        const topbarText = textColor || readableTextColor(topbar);
        const bottombarText = textColor || readableTextColor(bottombar);
        const lightBgCss = colorWithAlpha(lightBg, themeEffect(themeEffects, 'light').opacity, '#f8fafc');
        const darkBgCss = colorWithAlpha(darkBg, themeEffect(themeEffects, 'dark').opacity, '#0f172a');
        const cardCss = colorWithAlpha(card, themeEffect(themeEffects, 'card').opacity, '#ffffff');
        const cardHoverCss = colorWithAlpha(cardHover, themeEffect(themeEffects, 'cardHover').opacity, '#f1f5f9');
        const borderCss = colorWithAlpha(border, themeEffect(themeEffects, 'border').opacity, '#e2e8f0');
        const accentCss = colorWithAlpha(accent, themeEffect(themeEffects, 'accent').opacity, '#3b82f6');
        const iconCss = colorWithAlpha(icon, themeEffect(themeEffects, 'icon').opacity, '#3b82f6');
        const topbarEffect = themeEffect(themeEffects, 'topbar');
        const bottombarEffect = themeEffect(themeEffects, 'bottombar');
        const topbarCss = colorWithAlpha(topbar, topbarEffect.opacity, '#ffffff');
        const bottombarCss = colorWithAlpha(bottombar, bottombarEffect.opacity, '#ffffff');
        const lightBlur = clampNumber(themeEffect(themeEffects, 'light').blur, 0, 24, 0);
        const darkBlur = clampNumber(themeEffect(themeEffects, 'dark').blur, 0, 24, 0);
        const topbarBlur = clampNumber(topbarEffect.blur, 0, 24, 0);
        const bottombarBlur = clampNumber(bottombarEffect.blur, 0, 24, 0);
        rules.push(`#ggg-phone-shell .ggg-pp-app, #ggg-phone-shell .ggg-pp-profile-page, #ggg-phone-shell .ggg-pp-appearance-page { --ggg-text-dim: ${textDim} !important; --ggg-card: ${cardCss} !important; --ggg-card-hover: ${cardHoverCss} !important; --ggg-border: ${borderCss} !important; --ggg-accent: ${accentCss} !important; --ggg-icon-color: ${iconCss} !important; }`);
        rules.push(`#ggg-phone-shell.theme-light .ggg-pp-app, #ggg-phone-shell.theme-light .ggg-pp-profile-page, #ggg-phone-shell.theme-light .ggg-pp-appearance-page { --ggg-bg: ${lightBgCss} !important; --ggg-text: ${lightText} !important; background: ${lightBgCss} !important; backdrop-filter: blur(${lightBlur}px) !important; -webkit-backdrop-filter: blur(${lightBlur}px) !important; }`);
        rules.push(`#ggg-phone-shell.theme-dark .ggg-pp-app, #ggg-phone-shell.theme-dark .ggg-pp-profile-page, #ggg-phone-shell.theme-dark .ggg-pp-appearance-page { --ggg-bg: ${darkBgCss} !important; --ggg-text: ${darkText} !important; background: ${darkBgCss} !important; backdrop-filter: blur(${darkBlur}px) !important; -webkit-backdrop-filter: blur(${darkBlur}px) !important; }`);
        rules.push(`#ggg-phone-shell.ggg-phone-app-pp .ggg-phone-status { background: ${topbarCss} !important; color: ${topbarText} !important; backdrop-filter: blur(${topbarBlur}px) !important; -webkit-backdrop-filter: blur(${topbarBlur}px) !important; }`);
        rules.push(`#ggg-phone-shell.ggg-phone-app-pp .ggg-phone-status * { color: ${topbarText} !important; }`);
        rules.push(`#ggg-phone-shell .ggg-pp-topbar, #ggg-phone-shell .ggg-pp-cd-topbar, #ggg-phone-shell .ggg-pp-profile-page-topbar, #ggg-phone-shell .ggg-pp-appearance-topbar { background: ${topbarCss} !important; color: ${topbarText} !important; backdrop-filter: blur(${topbarBlur}px) !important; -webkit-backdrop-filter: blur(${topbarBlur}px) !important; }`);
        rules.push(`#ggg-phone-shell .ggg-pp-topbar *, #ggg-phone-shell .ggg-pp-cd-topbar *, #ggg-phone-shell .ggg-pp-profile-page-topbar *, #ggg-phone-shell .ggg-pp-appearance-topbar * { color: ${topbarText} !important; }`);
        rules.push(`#ggg-phone-shell .ggg-pp-bottombar { background: ${bottombarCss} !important; color: ${bottombarText} !important; backdrop-filter: blur(${bottombarBlur}px) !important; -webkit-backdrop-filter: blur(${bottombarBlur}px) !important; }`);
        rules.push(`#ggg-phone-shell .ggg-pp-bottombar * { color: ${bottombarText} !important; }`);
        rules.push(`#ggg-phone-shell .ggg-pp-app .ggg-fa, #ggg-phone-shell .ggg-pp-profile-page .ggg-fa, #ggg-phone-shell .ggg-pp-appearance-page .ggg-fa, #ggg-phone-shell .ggg-pp-app .online-dot, #ggg-phone-shell .ggg-pp-app .sub-line .dot { color: var(--ggg-icon-color) !important; }`);
        rules.push(`#ggg-phone-shell .ggg-pp-contact-item .online-dot { background: var(--ggg-icon-color) !important; }`);
        if (textColor) {
            rules.push(`#ggg-phone-shell .ggg-pp-app, #ggg-phone-shell .ggg-pp-app input, #ggg-phone-shell .ggg-pp-app textarea, #ggg-phone-shell .ggg-pp-app select, #ggg-phone-shell .ggg-pp-app button { color: ${textColor} !important; }`);
        }
        const selfBubble = bubbles.self || {};
        const otherBubble = bubbles.other || {};
        const [sr, sg, sb] = hexToRgb(selfBubble.color, [149, 236, 105]);
        const [or, og, ob] = hexToRgb(otherBubble.color, [255, 255, 255]);
        const selfOpacity = clampNumber(selfBubble.opacity, 0.2, 1, 1);
        const otherOpacity = clampNumber(otherBubble.opacity, 0.2, 1, 1);
        const selfBlur = clampNumber(selfBubble.blur, 0, 24, 0);
        const otherBlur = clampNumber(otherBubble.blur, 0, 24, 0);
        rules.push(`.ggg-pp-cd-row.mine .ggg-pp-cd-bubble:not(.bubble-image-v2):not(.bubble-sticker), .ggg-pp-cd-row.mine .voice-trans-inner { background-color: rgba(${sr}, ${sg}, ${sb}, ${selfOpacity}) !important; backdrop-filter: blur(${selfBlur}px); -webkit-backdrop-filter: blur(${selfBlur}px); }`);
        rules.push(`.ggg-pp-cd-row:not(.mine) .ggg-pp-cd-bubble:not(.bubble-image-v2):not(.bubble-sticker), .ggg-pp-cd-row:not(.mine) .voice-trans-inner { background-color: rgba(${or}, ${og}, ${ob}, ${otherOpacity}) !important; backdrop-filter: blur(${otherBlur}px); -webkit-backdrop-filter: blur(${otherBlur}px); }`);
    }

    styleEl.textContent = rules.join('\n');
}

export function createPPProfilePanelComponent(Vue) {
    const { ref, computed, onMounted } = Vue;
    return Vue.defineComponent({
        name: 'PPProfilePanel',
        props: {
            open: { type: Boolean, default: false },
            me: { type: Object, required: true },
            wallet: { type: Object, required: true },
            vip: { type: Object, required: true },
            onClose: { type: Function, required: true },
            onOpenAppearance: { type: Function, default: () => {} },
            onOpenProfilePage: { type: Function, default: () => {} },
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
            const onItem = (id) => {
                if (id === 'switch-account') {
                    props.onOpenProfilePage?.('switch-account');
                    return;
                }
                if (id === 'wallet') {
                    props.onOpenProfilePage?.('wallet');
                    return;
                }
                if (id === 'vip') {
                    props.onOpenProfilePage?.('vip');
                    return;
                }
                if (id === 'deco') {
                    props.onOpenAppearance?.();
                    return;
                }
                if (id === 'fav' || id === 'dev') {
                    props.onOpenProfilePage?.(id);
                    return;
                }
                if (id === 'settings') {
                    props.onOpenProfilePage?.('settings');
                    return;
                }
                console.log('[ggg-phone] PP 面板项点击：', id);
            };
            onMounted(() => {
                applyPPAppearanceStyles();
            });

            const theme = ref(getTheme());
            const toggleTheme = () => {
                const next = theme.value === 'dark' ? 'light' : 'dark';
                setTheme(next);
                theme.value = next;
            };

            // ===== inline 编辑 =====
            const editing = ref(''); // 'nick' | 'sig' | ''
            const startEdit = (k) => { editing.value = k; };
            const saveField = (k, val) => {
                if (k === 'nick') props.me.nickname  = String(val || '').slice(0, 30);
                if (k === 'sig')  props.me.signature = String(val || '').slice(0, 100);
                delete props.me.ppId;
                persistCurrentMeProfile(props.me);
                editing.value = '';
            };

            // ===== 头像选择器 =====
            const pickerOpen = ref(false);
            // 头像库（gggSettings.avatars），不是普通图库
            const galleryImgs = computed(() => {
                const list = gggSettings.avatars || [];
                return list.map(it => ({
                    url: it.url || it.dataUrl || '',
                    name: it.name || '',
                })).filter(it => it.url);
            });
            const openPicker = () => { pickerOpen.value = true; };
            const closePicker = () => { pickerOpen.value = false; };
            const setAvatar = (url) => {
                props.me.avatar = url;
                persistCurrentMeProfile(props.me);
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
                pickerOpen, galleryImgs, openPicker, closePicker, setAvatar, onUpload,
                DEFAULT_AVATAR,
            };
        },
        template: /* html */ `
            <div v-if="open" class="ggg-pp-profile-panel open">
                <div class="ggg-pp-profile-page-topbar">
                    <button class="ggg-pp-iconbtn" @click="onClose" title="返回">
                        <i class="ggg-fa fa-solid fa-chevron-left"></i>
                    </button>
                    <div class="title">我的 PP</div>
                    <button class="ggg-pp-iconbtn" @click="toggleTheme" :title="'切换主题（当前：' + theme + '）'">
                        <i class="ggg-fa fa-solid" :class="theme === 'dark' ? 'fa-moon' : 'fa-sun'"></i>
                    </button>
                </div>
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
                    </div>
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
                        <div class="ggg-pp-avatar-picker-body">
                            <div class="ggg-pp-avatar-picker-actions">
                                <label class="ggg-set-btn">
                                    <i class="ggg-fa fa-solid fa-cloud-arrow-up"></i> 本地上传
                                    <input type="file" accept="image/*" @change="onUpload" style="display:none;" />
                                </label>
                                <button class="ggg-set-btn" @click="setAvatar(DEFAULT_AVATAR)">
                                    <i class="ggg-fa fa-solid fa-user"></i> 默认
                                </button>
                                <button v-if="me.avatar" class="ggg-set-btn" @click="setAvatar('')">
                                    <i class="ggg-fa fa-solid fa-trash"></i> 清除
                                </button>
                            </div>
                            <div v-if="galleryImgs.length === 0" style="text-align:center;color:var(--ggg-text-dim);padding:20px;font-size:12px;">
                                呱呱头像库为空。请先在酒馆扩展菜单 → 呱呱小工具 → 图库 → 头像库 上传图片。
                            </div>
                            <div v-else class="ggg-pp-avatar-picker-grid">
                                <div v-for="img in galleryImgs" :key="img.url" @click="setAvatar(img.url)" :title="img.name">
                                    <img :src="img.url" :alt="img.name" loading="lazy" />
                                </div>
                            </div>
                        </div>
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

                <!-- 设置：独立放左下角 -->
                <div class="ggg-pp-profile-footer">
                    <button class="ggg-pp-profile-footer-btn" @click="onItem('settings')" title="设置">
                        <i class="ggg-fa fa-solid fa-gear"></i>
                        <span>设置</span>
                    </button>
                </div>
            </div>
        `,
    });
}
