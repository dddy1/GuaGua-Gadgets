import { settings, saveAllSettings } from '../../../../../index.js';
import { applyPPAppearanceStyles } from '../components.js';

const FONT_PRICE = 6;
const PAGE_SIZE = 6;
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
const COLOR_CONTROLS = [
    { key: 'light', label: '日间背景', fallback: DEFAULT_THEME_COLORS.light },
    { key: 'dark', label: '夜间背景', fallback: DEFAULT_THEME_COLORS.dark },
    { key: 'text', label: '正文颜色', fallback: '#0f172a' },
    { key: 'textDim', label: '次要文字', fallback: DEFAULT_THEME_COLORS.textDim },
    { key: 'card', label: '卡片颜色', fallback: DEFAULT_THEME_COLORS.card },
    { key: 'cardHover', label: '卡片悬停', fallback: DEFAULT_THEME_COLORS.cardHover },
    { key: 'border', label: '边框颜色', fallback: DEFAULT_THEME_COLORS.border },
    { key: 'accent', label: '强调颜色', fallback: DEFAULT_THEME_COLORS.accent },
    { key: 'icon', label: '图标颜色', fallback: DEFAULT_THEME_COLORS.icon },
    { key: 'topbar', label: '顶栏颜色', fallback: DEFAULT_THEME_COLORS.topbar },
    { key: 'bottombar', label: '底栏颜色', fallback: DEFAULT_THEME_COLORS.bottombar },
];

function normalizeBalance(value, fallback = 3.0) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : fallback;
}

function currentPersonaKey() {
    const liveMe = (typeof window !== 'undefined') ? window.__ggg_phone_pp_store?.state?.me : null;
    const key = liveMe?.avatarKey || settings.phone?.pp?.me?.avatarKey || '';
    return key || '__none__';
}

function createAppearance() {
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

function clonePlain(value) {
    return JSON.parse(JSON.stringify(value));
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
    if (!settings.phone) settings.phone = {};
    if (!settings.phone.pp) settings.phone.pp = {};
    if (!settings.phone.pp.wallet) settings.phone.pp.wallet = { balance: 3.0, history: [] };
    settings.phone.pp.wallet.balance = normalizeBalance(settings.phone.pp.wallet.balance);
    if (!Array.isArray(settings.phone.pp.wallet.history)) settings.phone.pp.wallet.history = [];

    const liveState = (typeof window !== 'undefined') ? window.__ggg_phone_pp_store?.state : null;
    const pp = liveState || settings.phone.pp;
    if (!pp.appearanceByPersona) pp.appearanceByPersona = {};
    if (!pp.appearanceByPersona[personaKey]) pp.appearanceByPersona[personaKey] = createAppearance();
    const app = pp.appearanceByPersona[personaKey];
    if (!app.fonts) app.fonts = { selfBubble: '', otherBubble: '', global: '' };
    if (!app.bubbles) app.bubbles = createAppearance().bubbles;
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
        app.themeEffects[key].opacity = Math.min(1, Math.max(0.05, Number(app.themeEffects[key].opacity ?? value.opacity)));
        app.themeEffects[key].blur = Math.min(24, Math.max(0, Number(app.themeEffects[key].blur ?? value.blur)));
    });
    if (!Array.isArray(app.ownedFonts)) app.ownedFonts = [];

    // 兼容旧版全局字段：当前 persona 第一次打开时继承旧购买/应用状态。
    const legacy = pp.appearance || settings.phone.pp.appearance;
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

    settings.phone.pp.appearanceByPersona = pp.appearanceByPersona;
    const fonts = app.fonts;
    [fonts.selfBubble, fonts.otherBubble, fonts.global].filter(Boolean).forEach(id => {
        if (!app.ownedFonts.includes(id)) {
            app.ownedFonts.push(id);
        }
    });
    return app;
}

function persistAppearance(personaKey, app) {
    if (!settings.phone) settings.phone = {};
    if (!settings.phone.pp) settings.phone.pp = {};
    if (!settings.phone.pp.appearanceByPersona || typeof settings.phone.pp.appearanceByPersona !== 'object') {
        settings.phone.pp.appearanceByPersona = {};
    }
    const plain = clonePlain(app);
    settings.phone.pp.appearanceByPersona[personaKey] = plain;
    const liveState = (typeof window !== 'undefined') ? window.__ggg_phone_pp_store?.state : null;
    if (liveState) {
        if (!liveState.appearanceByPersona || typeof liveState.appearanceByPersona !== 'object') {
            liveState.appearanceByPersona = {};
        }
        liveState.appearanceByPersona[personaKey] = clonePlain(plain);
    }
    saveAllSettings();
}

function fontName(font) {
    return font?.zhName || font?.name || font?.enName || font?.filename || '未命名字体';
}

function fontFace(font) {
    return font?.fontFaceName || font?.name || font?.zhName || '';
}

function ensureWallet(wallet) {
    const liveWallet = (typeof window !== 'undefined') ? window.__ggg_phone_pp_store?.state?.wallet : null;
    const target = liveWallet || wallet || settings.phone?.pp?.wallet || {};
    target.balance = normalizeBalance(target.balance);
    if (!Array.isArray(target.history)) target.history = [];
    settings.phone.pp.wallet = target;
    return target;
}

export function createPPAppearancePage(Vue) {
    const { computed, ref } = Vue;

    return Vue.defineComponent({
        name: 'PPAppearancePage',
        props: {
            wallet: { type: Object, required: true },
            vip: { type: Object, required: true },
            onBack: { type: Function, required: true },
        },
        setup(props) {
            const tick = ref(0);
            const notice = ref('');
            const activeTab = ref('fonts');
            const ownedPage = ref(1);
            const marketPage = ref(1);
            const pickerInteractiveUntil = ref(0);
            const personaKey = computed(() => {
                tick.value;
                return currentPersonaKey();
            });
            ensurePPAppearance(personaKey.value);

            const appearance = computed(() => {
                tick.value;
                return ensurePPAppearance(personaKey.value);
            });
            const walletBalance = computed(() => {
                tick.value;
                return Number(ensureWallet(props.wallet).balance || 0).toFixed(2);
            });
            const vipActive = computed(() => {
                tick.value;
                return !!props.vip && props.vip.tier !== 'none' && Number(props.vip.expireAt || 0) > Date.now();
            });
            const vipExpireText = computed(() => {
                tick.value;
                const ts = Number(props.vip?.expireAt || 0);
                if (!vipActive.value || !ts) return '';
                const d = new Date(ts);
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            });
            const fonts = computed(() => {
                tick.value;
                const list = settings.fonts?.list || [];
                return list
                    .map(font => ({
                        ...font,
                        displayName: fontName(font),
                        face: fontFace(font),
                    }))
                    .filter(font => font.id && font.face);
            });
            const ownedFontIds = computed(() => new Set(appearance.value.ownedFonts || []));
            const ownedFonts = computed(() => fonts.value.filter(font => ownedFontIds.value.has(font.id)));
            const marketFonts = computed(() => fonts.value.filter(font => !ownedFontIds.value.has(font.id)));
            const pageSlice = (list, page) => list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
            const ownedPageCount = computed(() => Math.max(1, Math.ceil(ownedFonts.value.length / PAGE_SIZE)));
            const marketPageCount = computed(() => Math.max(1, Math.ceil(marketFonts.value.length / PAGE_SIZE)));
            const ownedPageFonts = computed(() => pageSlice(ownedFonts.value, Math.min(ownedPage.value, ownedPageCount.value)));
            const marketPageFonts = computed(() => pageSlice(marketFonts.value, Math.min(marketPage.value, marketPageCount.value)));
            const setOwnedPage = (delta) => {
                ownedPage.value = Math.min(ownedPageCount.value, Math.max(1, ownedPage.value + delta));
            };
            const setMarketPage = (delta) => {
                marketPage.value = Math.min(marketPageCount.value, Math.max(1, marketPage.value + delta));
            };
            const isApplied = (fontId, scope) => appearance.value.fonts?.[scope] === fontId;
            const buyFont = (font) => {
                if (!font?.id) return;
                const app = ensurePPAppearance(personaKey.value);
                if (app.ownedFonts.includes(font.id)) return;
                const wallet = ensureWallet(props.wallet);
                if (Number(wallet.balance || 0) < FONT_PRICE) {
                    notice.value = `余额不足：购买字体需要 ¥${FONT_PRICE}，当前余额 ¥${Number(wallet.balance || 0).toFixed(2)}`;
                    return;
                }
                wallet.balance = Math.round((Number(wallet.balance || 0) - FONT_PRICE) * 100) / 100;
                wallet.history.push({
                    ts: Date.now(),
                    type: 'out',
                    amount: FONT_PRICE,
                    to: 'PP装扮',
                    note: `购买字体：${font.displayName}`,
                });
                app.ownedFonts.push(font.id);
                persistAppearance(personaKey.value, app);
                notice.value = `已购买字体：${font.displayName}`;
                tick.value++;
            };
            const toggleScope = (font, scope) => {
                if (!font?.id || !ownedFontIds.value.has(font.id)) return;
                const app = ensurePPAppearance(personaKey.value);
                app.fonts[scope] = app.fonts[scope] === font.id ? '' : font.id;
                persistAppearance(personaKey.value, app);
                applyPPAppearanceStyles();
                notice.value = '';
                tick.value++;
            };
            const resetFonts = () => {
                const app = ensurePPAppearance(personaKey.value);
                app.fonts.selfBubble = '';
                app.fonts.otherBubble = '';
                app.fonts.global = '';
                persistAppearance(personaKey.value, app);
                applyPPAppearanceStyles();
                notice.value = '';
                tick.value++;
            };
            const updateBubble = (side, key, value) => {
                if (!vipActive.value) {
                    notice.value = '购买会员后可自定义气泡颜色、透明度与模糊度';
                    return;
                }
                const app = ensurePPAppearance(personaKey.value);
                if (!app.bubbles[side]) app.bubbles[side] = side === 'self'
                    ? { color: '#95ec69', opacity: 1, blur: 0 }
                    : { color: '#ffffff', opacity: 1, blur: 0 };
                if (key === 'color') {
                    const color = normalizeHexColor(value);
                    if (!color) return;
                    app.bubbles[side].color = color;
                }
                if (key === 'opacity') app.bubbles[side].opacity = Math.min(1, Math.max(0.2, Number(value) || 1));
                if (key === 'blur') app.bubbles[side].blur = Math.min(24, Math.max(0, Number(value) || 0));
                persistAppearance(personaKey.value, app);
                applyPPAppearanceStyles();
                notice.value = '';
                tick.value++;
            };
            const updateThemeColor = (mode, value) => {
                if (!vipActive.value) {
                    notice.value = '购买会员后可全局调节日间与夜间主题颜色';
                    return;
                }
                const app = ensurePPAppearance(personaKey.value);
                if (!app.themeColors) app.themeColors = { ...DEFAULT_THEME_COLORS };
                const color = normalizeHexColor(value);
                if (!color) return;
                app.themeColors[mode] = color;
                persistAppearance(personaKey.value, app);
                applyPPAppearanceStyles();
                notice.value = '';
                tick.value++;
            };
            const updateThemeEffect = (mode, key, value) => {
                if (!vipActive.value) {
                    notice.value = '购买会员后可全局调节日间与夜间主题颜色';
                    return;
                }
                const app = ensurePPAppearance(personaKey.value);
                if (!app.themeEffects) app.themeEffects = cloneThemeEffects();
                if (!app.themeEffects[mode]) app.themeEffects[mode] = { opacity: 1, blur: 0 };
                if (key === 'opacity') app.themeEffects[mode].opacity = Math.min(1, Math.max(0.05, Number(value) || 1));
                if (key === 'blur') app.themeEffects[mode].blur = Math.min(24, Math.max(0, Number(value) || 0));
                persistAppearance(personaKey.value, app);
                applyPPAppearanceStyles();
                notice.value = '';
                tick.value++;
            };
            const pickerHex = (event, fallback = '#ffffff') => {
                const hex = event?.detail?.hex || event?.target?.hex || event?.target?.getAttribute?.('color');
                return normalizeHexColor(hex) || normalizeHexColor(fallback);
            };
            const markPickerInteraction = () => {
                pickerInteractiveUntil.value = Date.now() + 30000;
            };
            const pickerChangeHex = (event, fallback = '#ffffff') => {
                const next = pickerHex(event, fallback);
                const current = normalizeHexColor(fallback);
                if (!next) return '';
                if (next.toLowerCase() === current.toLowerCase()) return next;
                if (next.toLowerCase() === '#000000' && Date.now() > pickerInteractiveUntil.value) return '';
                return next;
            };
            const previewFamily = (font) => `'${String(font?.face || '').replace(/'/g, "\\'")}', sans-serif`;
            const bubblePreviewStyle = (side) => {
                const bubble = appearance.value.bubbles?.[side] || {};
                const color = bubble.color || (side === 'self' ? '#95ec69' : '#ffffff');
                const opacity = Math.min(1, Math.max(0.2, Number(bubble.opacity ?? 1)));
                const blur = Math.min(24, Math.max(0, Number(bubble.blur || 0)));
                return {
                    backgroundColor: color,
                    opacity,
                    backdropFilter: `blur(${blur}px)`,
                    WebkitBackdropFilter: `blur(${blur}px)`,
                };
            };

            return {
                FONT_PRICE,
                COLOR_CONTROLS,
                notice,
                activeTab,
                fonts, ownedFonts, marketFonts, ownedPageFonts, marketPageFonts,
                ownedPage, marketPage, ownedPageCount, marketPageCount, setOwnedPage, setMarketPage,
                walletBalance,
                appearance, vipActive, vipExpireText,
                isApplied, buyFont, toggleScope, resetFonts, previewFamily,
                updateBubble, bubblePreviewStyle, updateThemeColor, updateThemeEffect,
                markPickerInteraction, pickerChangeHex,
            };
        },
        template: /* html */ `
            <div class="ggg-pp-appearance-page">
                <div class="ggg-pp-appearance-topbar">
                    <button class="ggg-pp-iconbtn" @click="onBack" title="返回">
                        <i class="ggg-fa fa-solid fa-chevron-left"></i>
                    </button>
                    <div class="title">装扮</div>
                    <div class="balance">¥{{ walletBalance }}</div>
                </div>

                <div class="ggg-pp-appearance-body">
                    <div class="ggg-pp-appearance-grid four">
                        <button class="ggg-pp-appearance-nav" :class="{active: activeTab === 'bubbles'}" @click="activeTab = 'bubbles'">
                            <i class="ggg-fa fa-solid fa-comment-dots"></i><span>气泡</span><small>会员</small>
                        </button>
                        <button class="ggg-pp-appearance-nav" :class="{active: activeTab === 'colors'}" @click="activeTab = 'colors'">
                            <i class="ggg-fa fa-solid fa-palette"></i><span>颜色</span><small>会员</small>
                        </button>
                        <button class="ggg-pp-appearance-nav placeholder">
                            <i class="ggg-fa fa-solid fa-images"></i><span>头像库</span><small>占位</small>
                        </button>
                        <button class="ggg-pp-appearance-nav" :class="{active: activeTab === 'fonts'}" @click="activeTab = 'fonts'">
                            <i class="ggg-fa fa-solid fa-font"></i><span>字体</span><small>商城</small>
                        </button>
                    </div>

                    <div v-if="notice" class="ggg-pp-appearance-notice">
                        {{ notice }}
                    </div>

                    <div v-if="activeTab === 'bubbles'" class="ggg-pp-appearance-section">
                        <div class="sec-head">
                            <span>会员气泡</span>
                            <small v-if="vipActive">有效至 {{ vipExpireText }}</small>
                            <small v-else>会员专属</small>
                        </div>
                        <div class="ggg-pp-bubble-editor" :class="{locked: !vipActive}">
                            <div v-if="!vipActive" class="bubble-lock">
                                <i class="ggg-fa fa-solid fa-crown"></i>
                                <span>购买会员后可自定义自己和对方气泡</span>
                            </div>
                            <div class="bubble-edit-card">
                                <div class="bubble-preview-row mine">
                                    <span class="bubble-demo" :style="bubblePreviewStyle('self')">自己的气泡</span>
                                </div>
                                <div class="bubble-controls">
                                    <label>颜色 <toolcool-color-picker class="ggg-pp-color-picker" :color.attr="appearance.bubbles.self.color || '#95ec69'" @pointerdown.capture="markPickerInteraction" @change="updateBubble('self', 'color', pickerChangeHex($event, appearance.bubbles.self.color || '#95ec69'))"></toolcool-color-picker></label>
                                    <label>透明度 <input type="range" min="0.2" max="1" step="0.05" :value="appearance.bubbles.self.opacity" :disabled="!vipActive" @input="updateBubble('self', 'opacity', $event.target.value)" /></label>
                                    <label>模糊度 <input type="range" min="0" max="24" step="1" :value="appearance.bubbles.self.blur" :disabled="!vipActive" @input="updateBubble('self', 'blur', $event.target.value)" /></label>
                                </div>
                            </div>
                            <div class="bubble-edit-card">
                                <div class="bubble-preview-row">
                                    <span class="bubble-demo" :style="bubblePreviewStyle('other')">对方的气泡</span>
                                </div>
                                <div class="bubble-controls">
                                    <label>颜色 <toolcool-color-picker class="ggg-pp-color-picker" :color.attr="appearance.bubbles.other.color || '#ffffff'" @pointerdown.capture="markPickerInteraction" @change="updateBubble('other', 'color', pickerChangeHex($event, appearance.bubbles.other.color || '#ffffff'))"></toolcool-color-picker></label>
                                    <label>透明度 <input type="range" min="0.2" max="1" step="0.05" :value="appearance.bubbles.other.opacity" :disabled="!vipActive" @input="updateBubble('other', 'opacity', $event.target.value)" /></label>
                                    <label>模糊度 <input type="range" min="0" max="24" step="1" :value="appearance.bubbles.other.blur" :disabled="!vipActive" @input="updateBubble('other', 'blur', $event.target.value)" /></label>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div v-if="activeTab === 'colors'" class="ggg-pp-appearance-section">
                        <div class="sec-head">
                            <span>会员自定义颜色</span>
                            <small v-if="vipActive">仅 PP 内生效</small>
                            <small v-else>会员专属</small>
                        </div>
                        <div class="ggg-pp-theme-color-editor" :class="{locked: !vipActive}">
                            <div v-if="!vipActive" class="bubble-lock">
                                <i class="ggg-fa fa-solid fa-crown"></i>
                                <span>购买会员后可调节 PP 的背景、文字、卡片、边框、强调色与栏位颜色</span>
                            </div>
                            <label v-for="item in COLOR_CONTROLS" :key="item.key">
                                <span>{{ item.label }}</span>
                                <toolcool-color-picker class="ggg-pp-color-picker" :color.attr="appearance.themeColors[item.key] || item.fallback" @pointerdown.capture="markPickerInteraction" @change="updateThemeColor(item.key, pickerChangeHex($event, appearance.themeColors[item.key] || item.fallback))"></toolcool-color-picker>
                                <em :style="{ backgroundColor: appearance.themeColors[item.key] || item.fallback, opacity: appearance.themeEffects[item.key]?.opacity ?? 1, filter: 'blur(' + (appearance.themeEffects[item.key]?.blur || 0) + 'px)' }"></em>
                                <small>透明</small>
                                <input type="range" min="0.05" max="1" step="0.05" :value="appearance.themeEffects[item.key]?.opacity ?? 1" :disabled="!vipActive" @input="updateThemeEffect(item.key, 'opacity', $event.target.value)" />
                                <small>模糊</small>
                                <input type="range" min="0" max="24" step="1" :value="appearance.themeEffects[item.key]?.blur || 0" :disabled="!vipActive" @input="updateThemeEffect(item.key, 'blur', $event.target.value)" />
                            </label>
                        </div>
                    </div>

                    <div v-if="activeTab === 'fonts'" class="ggg-pp-appearance-section">
                        <div class="sec-head">
                            <span>已拥有字体</span>
                            <button class="mini" @click="resetFonts">恢复默认</button>
                        </div>
                        <div v-if="ownedFonts.length === 0" class="ggg-pp-appearance-empty">
                            尚未购买字体
                        </div>
                        <div v-else class="ggg-pp-font-card-list">
                            <div v-for="font in ownedPageFonts" :key="'owned:' + font.id" class="ggg-pp-font-card owned">
                                <div class="sample" :style="{ fontFamily: previewFamily(font) }">
                                    <span>Aa</span><span>呱呱</span><span>123</span>
                                </div>
                                <div class="meta">
                                    <div class="name">{{ font.displayName }}</div>
                                </div>
                                <div class="scope-row">
                                    <button :class="{on:isApplied(font.id, 'selfBubble')}" @click="toggleScope(font, 'selfBubble')">自己气泡</button>
                                    <button :class="{on:isApplied(font.id, 'otherBubble')}" @click="toggleScope(font, 'otherBubble')">对方气泡</button>
                                    <button :class="{on:isApplied(font.id, 'global')}" @click="toggleScope(font, 'global')">全局 PP</button>
                                </div>
                            </div>
                        </div>
                        <div v-if="ownedFonts.length > 0 && ownedPageCount > 1" class="ggg-pp-font-pager">
                            <button :disabled="ownedPage <= 1" @click="setOwnedPage(-1)"><i class="ggg-fa fa-solid fa-chevron-left"></i></button>
                            <span>{{ ownedPage }} / {{ ownedPageCount }}</span>
                            <button :disabled="ownedPage >= ownedPageCount" @click="setOwnedPage(1)"><i class="ggg-fa fa-solid fa-chevron-right"></i></button>
                        </div>
                    </div>

                    <div v-if="activeTab === 'fonts'" class="ggg-pp-appearance-section">
                        <div class="sec-head">
                            <span>字体商城</span>
                            <small>每款 ¥{{ FONT_PRICE }} · 购买后选择应用范围</small>
                        </div>
                        <div v-if="fonts.length === 0" class="ggg-pp-appearance-empty">
                            暂无可用字体。请先在酒馆扩展菜单 → 呱呱小工具 → 美化 → 字体管理 中导入字体。
                        </div>
                        <div v-else-if="marketFonts.length === 0" class="ggg-pp-appearance-empty">
                            字体已全部拥有
                        </div>
                        <div v-else class="ggg-pp-font-card-list">
                            <div v-for="font in marketPageFonts" :key="'market:' + font.id" class="ggg-pp-font-card">
                                <div class="sample" :style="{ fontFamily: previewFamily(font) }">
                                    <span>Aa</span><span>呱呱</span><span>123</span>
                                </div>
                                <div class="meta">
                                    <div class="name">{{ font.displayName }}</div>
                                </div>
                                <button class="buy" @click="buyFont(font)">¥{{ FONT_PRICE }} 购买</button>
                            </div>
                        </div>
                        <div v-if="marketFonts.length > 0 && marketPageCount > 1" class="ggg-pp-font-pager">
                            <button :disabled="marketPage <= 1" @click="setMarketPage(-1)"><i class="ggg-fa fa-solid fa-chevron-left"></i></button>
                            <span>{{ marketPage }} / {{ marketPageCount }}</span>
                            <button :disabled="marketPage >= marketPageCount" @click="setMarketPage(1)"><i class="ggg-fa fa-solid fa-chevron-right"></i></button>
                        </div>
                    </div>
                </div>
            </div>
        `,
    });
}
