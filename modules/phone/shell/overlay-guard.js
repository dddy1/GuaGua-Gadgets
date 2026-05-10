/**
 * 外部弹层检测模块 v0.2.57
 * 检测酒馆/插件弹层是否覆盖在手机壳上方，让手机壳让出点击层。
 * 从 phone.js 原样提取，逻辑不变。
 */

const EXTERNAL_OVERLAY_CLASS = 'ggg-phone-external-overlay-open';
const EXTERNAL_DRAWER_CLASS = 'ggg-phone-external-drawer-open';

const EXTERNAL_OVERLAY_SELECTORS = [
    '#shadow_popup',
    '#dialogue_popup',
    '.dialogue_popup',
    '.popup',
    '.popup-container',
    '.popup_container',
    '.modal',
    '.drawer',
    '.drawer-content',
    '.drawer-content-open',
    '.textarea_companion',
    '.expanded_textarea',
    'textarea.expanded_textarea',
    'body > textarea',
];

const INTERNAL_OVERLAY_SELECTORS = [
    '#ggg-phone-shell',
    '#ggg-floating-ball',
    '#ggg-floating-ball-panel',
    '.ggg-wi-overlay',
    '.ggg-wi-sheet',
    '.ggg-ss-overlay',
    '.ggg-ss-sheet',
    '#ggg-longshot-range-panel',
];

let _observer = null;
let _refresh = null;
let _raf = 0;
let _timer = 0;

function isInternalOverlay(el) {
    return INTERNAL_OVERLAY_SELECTORS.some(sel => el.matches?.(sel) || el.closest?.(sel));
}

// 酒馆/插件弹层的 class/id 不完全稳定，除固定选择器外再用命名特征兜住 textarea 弹窗等变体。
function hasOverlayLikeName(el) {
    const text = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`.toLowerCase();
    return /popup|dialog|modal|drawer|textarea_companion|expanded_textarea/.test(text);
}

// 外部弹层检测不能只查固定选择器：部分 textarea 展开层会换 class 或嵌套在 body 子节点里。
// 同时排除呱呱自己的手机壳、底部 sheet、悬浮球，避免误把内部控件当成外部弹窗。
function collectCandidates() {
    const set = new Set();
    EXTERNAL_OVERLAY_SELECTORS.forEach(sel => {
        try { document.querySelectorAll(sel).forEach(el => set.add(el)); } catch {}
    });
    try {
        document.querySelectorAll([
            'body > dialog',
            'body > [role="dialog"]',
            'body > [aria-modal="true"]',
            'body > #shadow_popup',
            'body > #dialogue_popup',
            'body > .dialogue_popup',
            'body > .popup',
            'body > .popup-container',
            'body > .popup_container',
            'body > .popup_wrapper',
            'body > .popup-wrapper',
            'body > .drawer',
            'body > .drawer-content',
            'body > .textarea_companion',
            'body > .expanded_textarea',
            'body > textarea.expanded_textarea',
        ].join(',')).forEach(el => set.add(el));
    } catch {}
    return Array.from(set).filter(el => el instanceof Element && !isInternalOverlay(el));
}

// 只要发现可见的酒馆弹层，就让手机壳/悬浮球让出点击层；全屏状态本身不改变。
function isVisibleOverlay(el) {
    if (!el || !(el instanceof Element)) return false;
    const shell = document.getElementById('ggg-phone-shell');
    if (shell && shell.contains(el)) return false;
    if (isInternalOverlay(el)) return false;
    const style = window.getComputedStyle?.(el);
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number(style.opacity || '1') <= 0.01) return false;
    const rect = el.getBoundingClientRect?.();
    if (!rect || rect.width < 1 || rect.height < 1) return false;

    const isExplicitPopup = ['shadow_popup', 'dialogue_popup'].includes(el.id)
        || el.matches?.('body > .popup, body > .popup-container, body > .popup_container, body > .popup_wrapper, body > .popup-wrapper, body > .dialogue_popup, body > .drawer, body > .drawer-content, body > .textarea_companion, body > .expanded_textarea, body > textarea, body > textarea.expanded_textarea, .textarea_companion, .expanded_textarea, textarea.expanded_textarea');
    if (isExplicitPopup) return true;

    const zIndex = Number.parseInt(style.zIndex, 10);
    const hasOverlayLayer = Number.isFinite(zIndex) && zIndex >= 1000;
    const isOverlayPosition = ['fixed', 'absolute', 'sticky'].includes(style.position);
    return (hasOverlayLayer && isOverlayPosition) || (hasOverlayLikeName(el) && isOverlayPosition);
}

function isDrawerOverlay(el) {
    return el?.matches?.('body > .drawer, body > .drawer-content, .drawer-content.openDrawer, .drawer-content-open')
        || /\bdrawer\b/.test(typeof el?.className === 'string' ? el.className : '');
}

function refreshState() {
    _raf = 0;
    const html = document.documentElement;
    if (!html.classList.contains('ggg-phone-open')) {
        html.classList.remove(EXTERNAL_OVERLAY_CLASS);
        html.classList.remove(EXTERNAL_DRAWER_CLASS);
        return;
    }
    const visibleOverlays = collectCandidates().filter(isVisibleOverlay);
    const hasOverlay = visibleOverlays.length > 0;
    html.classList.toggle(EXTERNAL_OVERLAY_CLASS, hasOverlay);
    html.classList.toggle(EXTERNAL_DRAWER_CLASS, visibleOverlays.some(isDrawerOverlay));
}

function scheduleRefresh({ delayed = true } = {}) {
    if (_raf) return;
    _raf = requestAnimationFrame(() => {
        try { refreshState(); } catch {}
        if (!delayed) return;
        if (_timer) clearTimeout(_timer);
        _timer = setTimeout(() => {
            _timer = 0;
            try { refreshState(); } catch {}
        }, 120);
    });
}

export function setupOverlayGuard() {
    teardownOverlayGuard();
    _refresh = () => scheduleRefresh();
    _observer = new MutationObserver(_refresh);
    _observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'open'],
    });
    document.addEventListener('focusin', _refresh, true);
    window.addEventListener('resize', _refresh, { passive: true });
    window.visualViewport?.addEventListener('resize', _refresh, { passive: true });
    window.visualViewport?.addEventListener('scroll', _refresh, { passive: true });
    scheduleRefresh({ delayed: false });
}

export function teardownOverlayGuard() {
    _observer?.disconnect();
    _observer = null;
    if (_raf) cancelAnimationFrame(_raf);
    if (_timer) clearTimeout(_timer);
    _raf = 0;
    _timer = 0;
    if (_refresh) {
        document.removeEventListener('focusin', _refresh, true);
        window.removeEventListener('resize', _refresh);
        window.visualViewport?.removeEventListener('resize', _refresh);
        window.visualViewport?.removeEventListener('scroll', _refresh);
    }
    _refresh = null;
    document.documentElement.classList.remove(EXTERNAL_OVERLAY_CLASS);
    document.documentElement.classList.remove(EXTERNAL_DRAWER_CLASS);
}

export function hasVisibleExternalOverlay() {
    try { return collectCandidates().some(isVisibleOverlay); }
    catch { return false; }
}
