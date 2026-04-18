/**
 * Vue 3 加载器 —— 通过 ESM CDN 动态加载 Vue
 * 缓存到模块级变量，多次调用只加载一次
 */
let vuePromise = null;

const VUE_CDN = 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';

export function loadVue() {
    if (vuePromise) return vuePromise;
    vuePromise = import(/* @vite-ignore */ VUE_CDN).catch(err => {
        console.error('[ggg-phone] Vue 加载失败：', err);
        vuePromise = null;
        throw err;
    });
    return vuePromise;
}
