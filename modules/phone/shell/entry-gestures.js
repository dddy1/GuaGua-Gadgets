/**
 * 入口手势 —— 灵动岛 / PC 悬浮窗 / 移动端悬浮球 共用
 * v0.2.17 操作改造：
 *   单击：手机外 = 切换酒馆 #top-bar 显隐；手机内 = 返回上一级
 *   双击：进入 / 退出手机
 *   三击：切换浏览器全屏
 *
 * 实现说明：
 *   累计 click count，setTimeout 280ms 后判定一次/两次；
 *   第三次 tap 立即触发 —— 这一点很重要：
 *     requestFullscreen 必须在用户手势上下文里调，setTimeout 里不算。
 *     所以三击专门跳出 setTimeout 立即执行。
 */

import { settings } from '../../../index.js';
import { RELEASE_MODE } from '../release-flag.js';

const TOP_BAR_HIDDEN_CLASS = 'ggg-phone-topbar-hidden';
const TAP_DELAY = 280;

/** 安全请求浏览器全屏（必须在用户手势上下文里调） */
function requestBrowserFullscreen() {
    if (document.fullscreenElement) return;
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen
        || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (fn) try { fn.call(el); } catch (e) { console.warn('[ggg-phone] 进入全屏失败：', e); }
}
function exitBrowserFullscreen() {
    if (!document.fullscreenElement) return;
    const fn = document.exitFullscreen || document.webkitExitFullscreen
        || document.mozCancelFullScreen || document.msExitFullscreen;
    if (fn) try { fn.call(document); } catch (e) { console.warn('[ggg-phone] 退出全屏失败：', e); }
}
function toggleBrowserFullscreen() {
    if (document.fullscreenElement) exitBrowserFullscreen();
    else requestBrowserFullscreen();
}

/** 兼容老版：alwaysFullscreen 开启时，单击/双击进入手机前先尝试全屏 */
function tryRequestFullscreenForOpen() {
    if (!settings.phone?.alwaysFullscreen) return;
    requestBrowserFullscreen();
}

/**
 * 给入口元素绑定 单/双/三 击行为
 * @param {HTMLElement} el           入口 DOM
 * @param {() => boolean} isOpen     当前手机是否打开
 * @param {() => void} onEnter       双击进入手机
 * @param {() => void} onExit        双击退出手机
 * @param {() => boolean} draggedRef 拖拽态：拖拽完成后的 click 不当作 tap
 */
export function bindEntryGestures(el, { isOpen, onEnter, onExit, draggedRef = () => false }) {
    let clickCount = 0;
    let timer = null;

    const handleSingle = () => {
        if (isOpen()) {
            // 手机内：返回
            if (typeof window.gggPhoneBack === 'function') window.gggPhoneBack();
        } else {
            // 手机外：切酒馆 topbar + extensionTopBar，并立刻刷新灵动岛位置
            document.documentElement.classList.toggle(TOP_BAR_HIDDEN_CLASS);
            // 异步加载，避免循环引用
            import('./dynamic-island.js').then(m => m.refreshIslandPosition?.()).catch(() => {});
        }
    };
    const handleDouble = () => {
        // 发布模式：手机本体未发布，双击进入手机被禁用
        if (RELEASE_MODE) return;
        if (isOpen()) onExit?.();
        else onEnter?.();
    };
    const handleTriple = () => {
        // 三击：直接切浏览器全屏（独立于"进入手机自动全屏"开关）
        toggleBrowserFullscreen();
    };

    const onTap = (e) => {
        if (draggedRef()) return;
        e.preventDefault?.();
        clickCount++;

        if (timer) { clearTimeout(timer); timer = null; }

        if (clickCount >= 3) {
            // 三击在用户手势里立即触发（保留 fullscreen 调用权限）
            clickCount = 0;
            handleTriple();
            return;
        }

        // 第一次 / 第二次 tap：等 TAP_DELAY 后再判定
        // 注意：之前在这里调过 tryRequestFullscreenForOpen，导致"单击切 topbar"
        //       的轻点也触发全屏。已移除——只保留三击主动切全屏。
        timer = setTimeout(() => {
            const c = clickCount;
            clickCount = 0;
            timer = null;
            if (c === 1) handleSingle();
            else if (c === 2) handleDouble();
        }, TAP_DELAY);
    };

    el.addEventListener('click', onTap);
}
