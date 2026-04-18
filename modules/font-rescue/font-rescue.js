/**
 * 字体复原（紧急救援）
 * 检测到 body 计算字体 > 3em (≈48px) 时：
 *   1. 关闭/清空与字体相关的设置（ST 自带 + GuaGua-Gadgets 自定义）
 *   2. 强制覆盖 inline 字体变量
 *   3. 设置 sessionStorage 防循环刷新标志
 *   4. 自动刷新页面恢复默认
 *
 * 用 sessionStorage 标志防止刷新后再次触发死循环。
 */

const RESCUE_FLAG = 'ggg_font_rescued';
const RESCUE_THRESHOLD_PX = 48; // 3em ≈ 48px（按 16px 基础）

function _resetAllFontSettings() {
    try {
        const ctx = (window.SillyTavern || window).getContext?.()
            || SillyTavern.getContext();

        // 1. ST 自带字体缩放
        if (ctx?.powerUserSettings) {
            ctx.powerUserSettings.font_scale = 1;
        }

        // 2. GuaGua-Gadgets 自定义字体 / CSS
        const ext = ctx?.extensionSettings?.['GuaGua-Gadgets'];
        if (ext?.fonts) {
            ext.fonts.enabled = false;
            ext.fonts.list = [];
        }
        if (ext && typeof ext.customCSS === 'string') {
            ext.customCSS = '';
        }

        ctx?.saveSettingsDebounced?.();
    } catch (e) {
        console.warn('[ggg-font-rescue] 重置 ST 设置失败：', e);
    }

    // 3. 强制覆盖 CSS 变量 + body inline 字号
    try {
        document.documentElement.style.setProperty('--mainFontSize', '14px');
        document.body.style.fontSize = '';
    } catch (_) { /* ignore */ }
}

export function initFontRescue() {
    // 防循环：刚救完跳过本次
    if (sessionStorage.getItem(RESCUE_FLAG)) {
        sessionStorage.removeItem(RESCUE_FLAG);
        console.info('[ggg-font-rescue] 上一次已自动复原，本次跳过检测');
        return;
    }

    // 等 ST 主题/CSS 加载完毕再测，否则会误判
    setTimeout(() => {
        const fontPx = parseFloat(getComputedStyle(document.body).fontSize) || 0;
        if (fontPx <= RESCUE_THRESHOLD_PX) return;

        console.warn(
            `[ggg-font-rescue] 检测到 body 字体异常：${fontPx}px（阈值 ${RESCUE_THRESHOLD_PX}px），启动复原`
        );
        _resetAllFontSettings();

        // 4. 标记 + 刷新
        sessionStorage.setItem(RESCUE_FLAG, '1');
        setTimeout(() => location.reload(), 200);
    }, 1500);
}
