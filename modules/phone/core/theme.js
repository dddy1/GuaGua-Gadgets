/**
 * 手机主题：dark / light
 * 通过给 #ggg-phone-shell 加 .theme-dark / .theme-light 类切换 CSS 变量
 * 设置在 settings.phone.theme
 */
import { settings, saveAllSettings } from '../../../index.js';

const SHELL_ID = 'ggg-phone-shell';

export function getTheme() {
    return settings.phone?.theme === 'light' ? 'light' : 'dark';
}

export function setTheme(t) {
    if (!settings.phone) settings.phone = {};
    settings.phone.theme = (t === 'light') ? 'light' : 'dark';
    saveAllSettings();
    applyTheme();
}

export function applyTheme() {
    const shell = document.getElementById(SHELL_ID);
    if (!shell) return;
    shell.classList.remove('theme-dark', 'theme-light');
    shell.classList.add(`theme-${getTheme()}`);
}
