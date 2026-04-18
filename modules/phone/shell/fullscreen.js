/**
 * 手机全屏壳管理
 * 进入时：注入全屏蒙层 + Vue 挂载点；隐藏酒馆主 UI（#top-bar / #form_sheld 等）
 * 退出时：相反操作
 */

const SHELL_ID = 'ggg-phone-shell';
const HTML_PHONE_OPEN_CLASS = 'ggg-phone-open';

export function mountPhoneShell() {
    if (document.getElementById(SHELL_ID)) {
        return document.getElementById(SHELL_ID);
    }

    const shell = document.createElement('div');
    shell.id = SHELL_ID;
    shell.className = 'ggg-phone-shell';
    // 关键定位 —— 同样规避 <html> transform 包含块问题
    const s = shell.style;
    s.setProperty('position', 'fixed', 'important');
    s.setProperty('top', '0', 'important');
    s.setProperty('left', '0', 'important');
    s.setProperty('width', '100vw', 'important');
    s.setProperty('height', '100vh', 'important');
    s.setProperty('z-index', '99990', 'important');
    s.setProperty('display', 'flex', 'important');
    s.setProperty('flex-direction', 'column', 'important');
    // 起始：从下方升起
    s.setProperty('transform', 'translateY(100vh)', 'important');

    // 灵动岛模式靠 css 给 .ggg-phone-status 加 margin-top:36px
    // 同时由 #ggg-phone-shell::before 填充 36px 黑色刘海
    shell.innerHTML = `
        <div class="ggg-phone-status"></div>
        <div class="ggg-phone-viewport" id="ggg-phone-viewport">
            <!-- Vue 在此挂载 -->
            <div id="ggg-phone-app-mount"></div>
        </div>
    `;
    document.body.appendChild(shell);

    document.documentElement.classList.add(HTML_PHONE_OPEN_CLASS);

    // 灵动岛模式下，顶部留出"刘海"区域（让灵动岛压在 shell 顶部上方）
    // 注意 SETTINGS_KEY 是 'ggg' 而不是 'guagua-gadgets'
    let isIsland = true;
    try {
        const s = window.extension_settings?.['ggg'];
        const mode = s?.phone?.entryMode || 'island';
        isIsland = (mode === 'island');
        if (isIsland) document.documentElement.classList.add('ggg-phone-island-mode');
        else document.documentElement.classList.remove('ggg-phone-island-mode');
    } catch (e) {}
    // v0.2.13：灵动岛模式下 status 不再单占 36px，直接和灵动岛胶囊共享顶部 36px 区
    //   清掉之前可能残留的 inline marginTop
    const status = shell.querySelector('.ggg-phone-status');
    if (status) status.style.removeProperty('margin-top');

    // 触发上升动画
    requestAnimationFrame(() => requestAnimationFrame(() => {
        shell.style.setProperty('transform', 'translateY(0)', 'important');
    }));

    return shell;
}

export function unmountPhoneShell() {
    const shell = document.getElementById(SHELL_ID);
    if (!shell) return;
    shell.style.setProperty('transform', 'translateY(100vh)', 'important');
    setTimeout(() => {
        shell.remove();
        document.documentElement.classList.remove(HTML_PHONE_OPEN_CLASS);
        // 注意：不要在关手机时去掉 ggg-phone-island-mode！
        // 灵动岛 class 是常驻的（由 phone.js 根据 entryMode 控制），
        // 关掉之后酒馆顶部的 36px 黑条要继续保留
    }, 280);
}

export function isPhoneShellOpen() {
    return !!document.getElementById(SHELL_ID);
}
