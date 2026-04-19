/**
 * 主页（Home）—— Vue 组件
 * - 时间小组件：高度三行
 * - APP 图标 / 小组件：Pointer Events 拖拽换位
 *   v0.2.22：彻底重写为 PointerEvents 自定义拖拽
 *     - 长按 350ms 进入编辑模式（touchmove 阈值 10px 才算取消，防误触）
 *     - 编辑模式下 pointerdown 立刻抓起元素 → transform 跟随手指
 *     - pointermove 用 elementFromPoint 找当前 hover 目标，可视化高亮
 *     - pointerup swap，多余的边界 case 都处理掉
 *     - 抛弃了 HTML5 draggable（手机 webview 几乎不可用）
 *   - 存 settings.phone.home.layout: 数组 [{type, key, w, h}]
 *   - app: type='app' key=appId; 小组件 type='widget' key='time'|'fav'|'music'
 *   - 顺序在数组里，渲染时按顺序填进 4 列网格（每个 item 自带 colspan/rowspan）
 */

import { settings, saveAllSettings } from '../../../../index.js';

const APP_DEFS = [
    { id: 'pp',         name: 'PP',     icon: 'fa-comments',     color: '#3b82f6', enabled: true  },
    { id: 'notebook',   name: '小呱书',  icon: 'fa-book-open',    color: '#ec4899', enabled: false },
    { id: 'gallery',    name: '图库',    icon: 'fa-images',       color: '#06b6d4', enabled: true  },
    { id: 'settings',   name: '设置',    icon: 'fa-gear',         color: '#64748b', enabled: true  },
    { id: 'image-gen',  name: '生图',    icon: 'fa-image',        color: '#a855f7', enabled: false },
    { id: 'og',         name: 'OG',     icon: 'fa-circle-nodes', color: '#10b981', enabled: false },
    { id: 'go3',        name: 'GO3',    icon: 'fa-gamepad',      color: '#f59e0b', enabled: false },
    { id: 'phone-call', name: '电话',    icon: 'fa-phone',        color: '#22c55e', enabled: false },
];
const APP_BY_ID = Object.fromEntries(APP_DEFS.map(a => [a.id, a]));

// 默认布局（4 列网格）
function defaultLayout() {
    return [
        { type: 'widget', key: 'time', w: 4, h: 3 },   // 时间组件占满 4 列 × 3 行
        { type: 'app',    key: 'pp',        w: 1, h: 1 },
        { type: 'app',    key: 'notebook',  w: 1, h: 1 },
        { type: 'app',    key: 'gallery',   w: 1, h: 1 },
        { type: 'app',    key: 'settings',  w: 1, h: 1 },
        { type: 'widget', key: 'fav',  w: 2, h: 2 },
        { type: 'widget', key: 'music',w: 2, h: 2 },
        { type: 'app',    key: 'image-gen', w: 1, h: 1 },
        { type: 'app',    key: 'og',        w: 1, h: 1 },
        { type: 'app',    key: 'go3',       w: 1, h: 1 },
        { type: 'app',    key: 'phone-call',w: 1, h: 1 },
    ];
}

function ensureLayout() {
    if (!settings.phone) settings.phone = {};
    if (!settings.phone.home) settings.phone.home = {};
    if (!Array.isArray(settings.phone.home.layout) || settings.phone.home.layout.length === 0) {
        settings.phone.home.layout = defaultLayout();
        saveAllSettings();
    }
}

export function createHomeComponent(Vue) {
    const { ref, reactive, onMounted, onBeforeUnmount } = Vue;

    return Vue.defineComponent({
        name: 'PhoneHome',
        props: { onOpenApp: { type: Function, required: true } },
        setup(props) {
            ensureLayout();

            const now = ref(new Date());
            let timer = null;
            onMounted(() => { timer = setInterval(() => now.value = new Date(), 30 * 1000); });
            onBeforeUnmount(() => { if (timer) clearInterval(timer); });

            const pad = (n) => String(n).padStart(2, '0');
            const fmtHM   = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
            const fmtWeek = (d) => ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
            const fmtMD   = (d) => `${d.getMonth()+1}月${d.getDate()}日`;

            // 用 reactive 数组拿 settings 的 layout 引用
            const layout = reactive(settings.phone.home.layout);

            const editMode = ref(false);
            const dragIdx = ref(-1);     // 当前正在被拖动的 layout 下标
            const hoverIdx = ref(-1);    // 当前 hover 的目标下标（用来高亮）
            // 浮动跟随：相对手指位置的偏移 + 当前手指相对 grid 容器的坐标
            const dragGhost = reactive({ active: false, x: 0, y: 0, w: 0, h: 0, idx: -1 });

            // ============ 长按进入编辑模式 ============
            let pressTimer = null;
            let pressStart = null;       // {x, y}
            const PRESS_MOVE_TOL = 10;   // 手指偏移 ≤10px 不算取消（防止细微抖动）
            const startPress = (e) => {
                if (editMode.value) return;
                const p = pointFromEvt(e);
                pressStart = p;
                if (pressTimer) clearTimeout(pressTimer);
                pressTimer = setTimeout(() => {
                    editMode.value = true;
                    pressTimer = null;
                    // 触发轻微震动（如果设备支持），给用户编辑模式开始的反馈
                    try { navigator.vibrate?.(15); } catch {}
                }, 350);
            };
            const movePress = (e) => {
                if (!pressTimer || !pressStart) return;
                const p = pointFromEvt(e);
                const dx = Math.abs(p.x - pressStart.x);
                const dy = Math.abs(p.y - pressStart.y);
                if (dx > PRESS_MOVE_TOL || dy > PRESS_MOVE_TOL) {
                    clearTimeout(pressTimer); pressTimer = null;
                }
            };
            const cancelPress = () => {
                if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
                pressStart = null;
            };
            const exitEdit = () => {
                editMode.value = false;
                dragIdx.value = -1; hoverIdx.value = -1;
                dragGhost.active = false;
                saveAllSettings();
            };

            // ============ 编辑模式下的自定义拖拽 ============
            let dragOriginEl = null;
            let dragOffsetX = 0, dragOffsetY = 0;       // 手指在原元素内的偏移
            let dragMoveHandler = null, dragUpHandler = null;

            const pointFromEvt = (e) => {
                if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
                if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
                return { x: e.clientX, y: e.clientY };
            };

            const onCellPointerDown = (idx, e) => {
                if (!editMode.value) {
                    // 不在编辑模式：仍然走"长按进编辑"判定
                    startPress(e);
                    return;
                }
                // 在编辑模式：立即开始拖拽（无需再长按）
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                const target = e.currentTarget;
                if (!target) return;
                e.preventDefault();
                const rect = target.getBoundingClientRect();
                const p = pointFromEvt(e);
                dragOriginEl = target;
                dragOffsetX = p.x - rect.left;
                dragOffsetY = p.y - rect.top;
                dragIdx.value = idx;
                hoverIdx.value = idx;
                dragGhost.active = true;
                dragGhost.idx = idx;
                dragGhost.w = rect.width;
                dragGhost.h = rect.height;
                dragGhost.x = rect.left;
                dragGhost.y = rect.top;

                // 锁住 pointer，确保 move/up 都派发到当前元素
                try { target.setPointerCapture?.(e.pointerId); } catch {}

                dragMoveHandler = (ev) => onDragMove(ev);
                dragUpHandler = (ev) => onDragUp(ev);
                window.addEventListener('pointermove', dragMoveHandler, { passive: false });
                window.addEventListener('pointerup', dragUpHandler);
                window.addEventListener('pointercancel', dragUpHandler);
            };

            const onDragMove = (e) => {
                if (!dragGhost.active) return;
                e.preventDefault();
                const p = pointFromEvt(e);
                dragGhost.x = p.x - dragOffsetX;
                dragGhost.y = p.y - dragOffsetY;
                // 用屏幕坐标找当前指向哪个 cell
                // 临时把 ghost 隐藏，否则 elementFromPoint 拿到的是它自己
                const prevPe = dragOriginEl ? dragOriginEl.style.pointerEvents : '';
                if (dragOriginEl) dragOriginEl.style.pointerEvents = 'none';
                const el = document.elementFromPoint(p.x, p.y);
                if (dragOriginEl) dragOriginEl.style.pointerEvents = prevPe;
                const cell = el?.closest?.('.ggg-phone-home-cell');
                if (cell && cell.dataset?.idx != null) {
                    const idx = Number(cell.dataset.idx);
                    if (!Number.isNaN(idx)) hoverIdx.value = idx;
                }
            };

            const onDragUp = () => {
                window.removeEventListener('pointermove', dragMoveHandler);
                window.removeEventListener('pointerup', dragUpHandler);
                window.removeEventListener('pointercancel', dragUpHandler);
                dragMoveHandler = dragUpHandler = null;
                const from = dragIdx.value;
                const to = hoverIdx.value;
                dragGhost.active = false;
                dragIdx.value = -1; hoverIdx.value = -1;
                dragOriginEl = null;
                if (from >= 0 && to >= 0 && from !== to) {
                    const moved = layout.splice(from, 1)[0];
                    layout.splice(to, 0, moved);
                    saveAllSettings();
                }
            };

            const onAppTap = (appId, ev) => {
                if (editMode.value) { ev?.stopPropagation?.(); return; }
                const a = APP_BY_ID[appId];
                if (!a || !a.enabled) {
                    console.log('[ggg-phone] APP 占位中：', appId);
                    return;
                }
                props.onOpenApp(appId);
            };

            const getApp = (id) => APP_BY_ID[id] || { id, name: id, icon: 'fa-question', color: '#888', enabled: false };

            // 计算 ghost 的内联样式
            const ghostStyle = Vue.computed(() => ({
                position: 'fixed',
                left: dragGhost.x + 'px',
                top:  dragGhost.y + 'px',
                width: dragGhost.w + 'px',
                height: dragGhost.h + 'px',
                pointerEvents: 'none',
                zIndex: 9999,
                opacity: 0.92,
                transform: 'scale(1.08)',
                transition: 'transform 0.12s ease',
                filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.35))',
            }));

            return {
                now, fmtHM, fmtWeek, fmtMD,
                layout, editMode, exitEdit,
                dragIdx, hoverIdx, dragGhost, ghostStyle,
                onCellPointerDown, movePress, cancelPress,
                onAppTap, getApp,
            };
        },
        template: /* html */ `
            <div class="ggg-phone-home" :class="{ 'edit-mode': editMode, 'dragging-active': dragGhost.active }">
                <div v-if="editMode" class="ggg-phone-home-edit-bar">
                    <span><i class="ggg-fa fa-solid fa-arrows-up-down-left-right"></i> 拖拽图标排序</span>
                    <button class="ggg-set-btn primary" @click="exitEdit">完成</button>
                </div>

                <div class="ggg-phone-home-grid">
                    <div
                        v-for="(it, idx) in layout"
                        :key="it.type + ':' + it.key"
                        :data-idx="idx"
                        class="ggg-phone-home-cell"
                        :class="['cell-' + it.type, {
                            dragging: dragIdx === idx,
                            'drop-target': editMode && dragIdx >= 0 && hoverIdx === idx && dragIdx !== idx
                        }]"
                        :style="{ gridColumn: 'span ' + it.w, gridRow: 'span ' + it.h }"
                        @pointerdown="onCellPointerDown(idx, $event)"
                        @pointermove="movePress"
                        @pointerup="cancelPress"
                        @pointercancel="cancelPress"
                        @pointerleave="cancelPress">

                        <!-- 时间组件 -->
                        <template v-if="it.type === 'widget' && it.key === 'time'">
                            <div class="ggg-phone-widget ggg-phone-widget-time">
                                <div class="t-row1">
                                    <div class="t-time">{{ fmtHM(now) }}</div>
                                    <div class="t-meta">
                                        <div class="t-week">{{ fmtWeek(now) }}</div>
                                        <div class="t-date">{{ fmtMD(now) }}</div>
                                    </div>
                                </div>
                                <div class="t-row2">
                                    <div><i class="ggg-fa fa-solid fa-sun" style="color:#fbbf24;"></i> 晴 · 22°</div>
                                    <div>农历 三月初二</div>
                                </div>
                                <div class="t-row3">
                                    <div><i class="ggg-fa fa-solid fa-location-dot"></i> 杭州</div>
                                    <div>湿度 56% · 东北风</div>
                                </div>
                            </div>
                        </template>

                        <!-- 收藏组件 -->
                        <template v-else-if="it.type === 'widget' && it.key === 'fav'">
                            <div class="ggg-phone-widget ggg-phone-widget-fav">
                                <div class="ggg-phone-widget-title">
                                    <i class="ggg-fa fa-solid fa-star"></i> 收藏消息
                                </div>
                                <div class="ggg-phone-widget-empty">暂无收藏</div>
                            </div>
                        </template>

                        <!-- 音乐组件 -->
                        <template v-else-if="it.type === 'widget' && it.key === 'music'">
                            <div class="ggg-phone-widget ggg-phone-widget-music">
                                <div class="ggg-phone-widget-title">
                                    <i class="ggg-fa fa-solid fa-music"></i> 音乐
                                </div>
                                <div class="ggg-phone-widget-empty">暂无播放</div>
                            </div>
                        </template>

                        <!-- App -->
                        <template v-else-if="it.type === 'app'">
                            <div
                                class="ggg-phone-app-cell"
                                :class="{ disabled: !getApp(it.key).enabled }"
                                @click="onAppTap(it.key)">
                                <div class="ggg-phone-app-icon" :style="{ '--icon-base': getApp(it.key).color, background: getApp(it.key).color }">
                                    <i class="ggg-fa fa-solid" :class="getApp(it.key).icon"></i>
                                </div>
                                <div class="ggg-phone-app-name">{{ getApp(it.key).name }}</div>
                            </div>
                        </template>
                    </div>
                </div>

                <!-- v0.2.22：拖拽时跟随手指的浮动副本（克隆原 cell 的可视部分） -->
                <div v-if="dragGhost.active && layout[dragGhost.idx]" :style="ghostStyle" class="ggg-phone-home-ghost">
                    <div class="ggg-phone-home-cell" :class="'cell-' + layout[dragGhost.idx].type" style="width:100%;height:100%;">
                        <template v-if="layout[dragGhost.idx].type === 'app'">
                            <div class="ggg-phone-app-cell">
                                <div class="ggg-phone-app-icon" :style="{ background: getApp(layout[dragGhost.idx].key).color }">
                                    <i class="ggg-fa fa-solid" :class="getApp(layout[dragGhost.idx].key).icon"></i>
                                </div>
                                <div class="ggg-phone-app-name">{{ getApp(layout[dragGhost.idx].key).name }}</div>
                            </div>
                        </template>
                        <template v-else-if="layout[dragGhost.idx].type === 'widget'">
                            <div class="ggg-phone-widget" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
                                <i class="ggg-fa fa-solid fa-square" style="font-size:28px;opacity:0.4;"></i>
                            </div>
                        </template>
                    </div>
                </div>
            </div>
        `,
    });
}
