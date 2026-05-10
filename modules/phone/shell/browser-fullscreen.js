/**
 * 浏览器全屏统一模块 v0.2.57
 * 所有全屏 API 调用从此模块导入，不再分散到各文件。
 */

// ─── 基础 API ───

export function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

export async function enterFullscreen() {
    if (isFullscreen()) return true;
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!fn) return false;
    try {
        await fn.call(el);
        return true;
    } catch {
        return false;
    }
}

export async function exitFullscreen() {
    if (!isFullscreen()) return true;
    const fn = document.exitFullscreen || document.webkitExitFullscreen;
    if (!fn) return false;
    try {
        _intentionalExit = true;
        await fn.call(document);
        return true;
    } catch {
        _intentionalExit = false;
        return false;
    }
}

export async function toggleFullscreen() {
    return isFullscreen() ? exitFullscreen() : enterFullscreen();
}

export function onFullscreenChange(callback) {
    const handler = () => callback(isFullscreen());
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    return () => {
        document.removeEventListener('fullscreenchange', handler);
        document.removeEventListener('webkitfullscreenchange', handler);
    };
}

// ─── 持久全屏模式 ───
// 全屏丢失后在下次用户交互时自动恢复，除非：
//   1. 通过 exitFullscreen() / disablePersistentFullscreen() 主动退出
//   2. 浏览器后台超过 BACKGROUND_THRESHOLD 再回来

const BACKGROUND_THRESHOLD = 30_000;
const KB_STYLE_ID = 'ggg-fullscreen-kb-style';

let _persistent = false;
let _intentionalExit = false;
let _pendingRestore = false;
let _backgroundedAt = 0;

let _cleanupFullscreenChange = null;
let _cleanupVisibility = null;
let _cleanupGesture = null;
let _cleanupKeyboard = null;

// 全屏变化时判断是否需要恢复
function _onFullscreenChanged() {
    if (isFullscreen()) {
        _pendingRestore = false;
        _intentionalExit = false;
        return;
    }
    // 全屏丢失
    if (_intentionalExit) {
        _intentionalExit = false;
        _pendingRestore = false;
        return;
    }
    // 意外丢失 → 标记待恢复
    _pendingRestore = true;
}

// 用户交互时尝试恢复全屏
function _onGesture() {
    if (!_pendingRestore || !_persistent) return;
    _pendingRestore = false;
    enterFullscreen();
}

export function markFullscreenRestoreNeeded() {
    if (_persistent) _pendingRestore = true;
}

// 后台/前台切换
function _onVisibilityChange() {
    if (document.hidden) {
        _backgroundedAt = Date.now();
    } else {
        if (_backgroundedAt && Date.now() - _backgroundedAt > BACKGROUND_THRESHOLD) {
            _pendingRestore = false;
        }
        _backgroundedAt = 0;
    }
}

// ─── 键盘补偿 ───
// 全屏时移动端软键盘弹出可能不缩小 layout viewport，
// 主动监听 visualViewport 把 #sheld / #form_sheld 推上去。

function _kbApply(kbH) {
    let s = document.getElementById(KB_STYLE_ID);
    if (!s) {
        s = document.createElement('style');
        s.id = KB_STYLE_ID;
        document.head.appendChild(s);
    }
    s.textContent = kbH > 50
        ? `#sheld { bottom: ${kbH}px !important; transition: bottom .15s ease; }
           #form_sheld { bottom: ${kbH}px !important; transition: bottom .15s ease; }`
        : '';
}

function _kbCheck() {
    if (!isFullscreen()) { _kbApply(0); return; }
    const vv = window.visualViewport;
    if (!vv) return;
    const kb = Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0));
    _kbApply(kb);
}

function _setupKeyboardCompensation() {
    if (_cleanupKeyboard || !window.visualViewport) return;
    const handler = () => _kbCheck();
    window.visualViewport.addEventListener('resize', handler);
    window.visualViewport.addEventListener('scroll', handler);
    _cleanupKeyboard = () => {
        window.visualViewport.removeEventListener('resize', handler);
        window.visualViewport.removeEventListener('scroll', handler);
        _kbApply(0);
        document.getElementById(KB_STYLE_ID)?.remove();
        _cleanupKeyboard = null;
    };
}

function _teardownKeyboardCompensation() {
    _cleanupKeyboard?.();
}

// ─── 持久模式公开 API ───

export async function enablePersistentFullscreen() {
    if (_persistent) return;
    _persistent = true;
    _intentionalExit = false;
    _pendingRestore = false;
    _backgroundedAt = 0;

    // 进入全屏
    await enterFullscreen();

    // 监听全屏变化
    _cleanupFullscreenChange = onFullscreenChange(_onFullscreenChanged);

    // 监听用户手势以恢复全屏
    document.addEventListener('pointerdown', _onGesture, true);
    _cleanupGesture = () => {
        document.removeEventListener('pointerdown', _onGesture, true);
        _cleanupGesture = null;
    };

    // 监听后台/前台
    document.addEventListener('visibilitychange', _onVisibilityChange);
    _cleanupVisibility = () => {
        document.removeEventListener('visibilitychange', _onVisibilityChange);
        _cleanupVisibility = null;
    };

    // 键盘补偿
    _setupKeyboardCompensation();
}

export function disablePersistentFullscreen() {
    if (!_persistent) return;
    _persistent = false;
    _pendingRestore = false;
    _intentionalExit = false;
    _backgroundedAt = 0;

    _cleanupFullscreenChange?.();
    _cleanupFullscreenChange = null;
    _cleanupGesture?.();
    _cleanupVisibility?.();
    _teardownKeyboardCompensation();
}
