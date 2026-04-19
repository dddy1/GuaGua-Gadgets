/**
 * 手机根组件 —— 极简路由（栈式）+ 右滑返回手势
 * 维护 viewStack：['home', 'gallery', 'pp', ...]
 * 提供 openApp / back 给子组件
 */

import { createHomeComponent } from '../apps/home/index.js';
import { createGalleryComponent } from '../apps/gallery/index.js';
import { createPPComponent } from '../apps/pp/index.js';
import { createSettingsComponent } from '../apps/settings/index.js';

export function createPhoneRoot(Vue) {
    const { ref, computed, onMounted, onBeforeUnmount } = Vue;

    const Home = createHomeComponent(Vue);
    const Gallery = createGalleryComponent(Vue);
    const PP = createPPComponent(Vue);
    const Settings = createSettingsComponent(Vue);

    // App id → 组件
    const APP_MAP = {
        home: Home,
        gallery: Gallery,
        pp: PP,
        settings: Settings,
    };

    return Vue.defineComponent({
        name: 'PhoneRoot',
        components: APP_MAP,
        setup() {
            const stack = ref(['home']);
            const swipeOffset = ref(0); // 实时显示的右滑偏移（px），用于反馈
            const containerEl = ref(null);

            const current = computed(() => stack.value[stack.value.length - 1]);
            const currentComp = computed(() => APP_MAP[current.value] || Home);
            const canBack = computed(() => stack.value.length > 1);

            const openApp = (id) => {
                if (!APP_MAP[id]) {
                    console.warn('[ggg-phone] App 未注册：', id);
                    return;
                }
                stack.value = [...stack.value, id];
            };
            const back = () => {
                if (stack.value.length > 1) {
                    stack.value = stack.value.slice(0, -1);
                }
            };

            // ---- 右滑返回手势（手机内部，不是浏览器后退） ----
            // 关键：用原生 addEventListener 绑 { passive: false }，
            // 这样 touchstart/touchmove 时可以 preventDefault，阻止
            // iOS Safari / Chrome 的"边缘右滑后退"被触发。
            // 触发条件：左边缘 24px 内 touchstart + 横向位移 > 60px
            let startX = 0, startY = 0, tracking = false;
            const EDGE = 24, THRESHOLD = 60;

            const handleStart = (e) => {
                if (!canBack.value) return;
                const t = e.touches?.[0];
                if (!t) return;
                if (t.clientX > EDGE) return;
                startX = t.clientX;
                startY = t.clientY;
                tracking = true;
                swipeOffset.value = 0;
                // 提前 prevent，阻止浏览器接管这次手势
                e.preventDefault();
            };
            const handleMove = (e) => {
                if (!tracking) return;
                const t = e.touches?.[0];
                if (!t) return;
                const dx = t.clientX - startX;
                const dy = Math.abs(t.clientY - startY);
                if (dy > 40 && dy > dx) { tracking = false; swipeOffset.value = 0; return; }
                if (dx > 0) {
                    swipeOffset.value = Math.min(dx, 240);
                    e.preventDefault();
                }
            };
            const handleEnd = () => {
                if (!tracking) return;
                if (swipeOffset.value >= THRESHOLD) back();
                swipeOffset.value = 0;
                tracking = false;
            };

            onMounted(() => {
                // 暴露 back 给入口（灵动岛/悬浮窗/球）单击调用
                window.gggPhoneBack = back;
                const el = containerEl.value;
                if (!el) return;
                el.addEventListener('touchstart', handleStart, { passive: false });
                el.addEventListener('touchmove',  handleMove,  { passive: false });
                el.addEventListener('touchend',   handleEnd);
                el.addEventListener('touchcancel', handleEnd);
            });
            onBeforeUnmount(() => {
                if (window.gggPhoneBack === back) window.gggPhoneBack = null;
                const el = containerEl.value;
                if (!el) return;
                el.removeEventListener('touchstart', handleStart);
                el.removeEventListener('touchmove',  handleMove);
                el.removeEventListener('touchend',   handleEnd);
                el.removeEventListener('touchcancel', handleEnd);
            });

            return {
                current, currentComp, openApp, back,
                swipeOffset, containerEl,
            };
        },
        template: /* html */ `
            <div
                class="ggg-phone-root"
                ref="containerEl"
                :style="{ transform: swipeOffset ? 'translateX(' + swipeOffset + 'px)' : '', transition: swipeOffset ? 'none' : 'transform 0.18s' }">
                <component
                    :is="currentComp"
                    :on-open-app="openApp"
                    :on-back="back" />
            </div>
        `,
    });
}
