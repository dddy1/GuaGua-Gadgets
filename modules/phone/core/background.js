/**
 * 手机背景管理
 * 数据源优先级：
 *   1) settings.phone.backgroundUrl —— 用户在图库里手动选过
 *   2) 酒馆背景列表第一张（从 DOM `#bg_menu_content .bg_example` 读，
 *      与 ui-custom 模块同款方案，比 /api/backgrounds/all 稳）
 *   3) 兜底渐变（不写 url）
 */
import { settings, saveAllSettings } from '../../../index.js';

const SHELL_VP = '#ggg-phone-viewport';
const BG_EVENT = 'ggg-phone-bg-change';

/**
 * 从酒馆 DOM 读取所有背景文件
 * 返回：[{ name, url }]
 */
export function listStBackgrounds() {
    const out = [];
    document.querySelectorAll('#bg_menu_content .bg_example').forEach(el => {
        const f = el.getAttribute('bgfile');
        if (f && !f.startsWith('ggg_')) {
            out.push({ name: f, url: `/backgrounds/${f}` });
        }
    });
    return out;
}

export function getBgUrl() {
    return settings.phone?.backgroundUrl || '';
}

export function setBgUrl(url) {
    if (!settings.phone) settings.phone = {};
    settings.phone.backgroundUrl = url || '';
    saveAllSettings();
    applyBgToShell();
    window.dispatchEvent(new CustomEvent(BG_EVENT, { detail: { url } }));
}

/**
 * 第一次启用 / 没自定义时，自动取酒馆背景的第一张
 */
export function ensureDefaultBg() {
    if (settings.phone?.backgroundUrl) {
        applyBgToShell();
        return;
    }
    const list = listStBackgrounds();
    if (list.length > 0) {
        if (!settings.phone) settings.phone = {};
        settings.phone.backgroundUrl = list[0].url;
        saveAllSettings();
        applyBgToShell();
    }
}

/**
 * 把背景实时套到当前全屏壳的 viewport 上（若已挂载）
 */
export function applyBgToShell() {
    const vp = document.querySelector(SHELL_VP);
    if (!vp) return;
    const url = getBgUrl();
    if (url) {
        vp.style.setProperty('background-image', `url("${url}")`, 'important');
        vp.style.setProperty('background-size', 'cover', 'important');
        vp.style.setProperty('background-position', 'center', 'important');
    } else {
        vp.style.removeProperty('background-image');
    }
}

export const BG_CHANGE_EVENT = BG_EVENT;
