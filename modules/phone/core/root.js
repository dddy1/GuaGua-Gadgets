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
    const { ref, computed, watch, onMounted, onBeforeUnmount } = Vue;

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
            const controlsOpen = ref(false);
            const controlAnchor = ref(null);
            const backendOpen = ref(false);
            const backendSnap = ref(null);
            const backendRaw = ref('');
            const backendBusy = ref(false);
            const backendMsg = ref('');
            const backendTab = ref('prompt');
            const backendPromptLoaded = ref(false);
            const selectedVersionId = ref('');
            const ppOpenRequest = ref(null);

            const current = computed(() => stack.value[stack.value.length - 1]);
            const currentComp = computed(() => APP_MAP[current.value] || Home);
            const canBack = computed(() => stack.value.length > 1);
            const shellAppClasses = Object.keys(APP_MAP).map(id => `ggg-phone-app-${id}`);
            const syncShellAppClass = (id) => {
                const shell = document.getElementById('ggg-phone-shell');
                if (!shell) return;
                shell.classList.remove(...shellAppClasses);
                shell.classList.add(`ggg-phone-app-${id || 'home'}`);
            };

            const openApp = (id) => {
                if (!APP_MAP[id]) {
                    console.warn('[ggg-phone] App 未注册：', id);
                    return;
                }
                stack.value = [...stack.value, id];
            };
            const openPPChat = (target) => {
                if (!target) return;
                ppOpenRequest.value = { ...target, token: Date.now() };
                stack.value = ['home', 'pp'];
            };
            const consumePendingRoute = () => {
                const route = window.__ggg_phone_pending_route;
                if (route?.app === 'pp' && route.ppChat) {
                    window.__ggg_phone_pending_route = null;
                    openPPChat(route.ppChat);
                }
            };
            const back = () => {
                if (stack.value.length > 1) {
                    stack.value = stack.value.slice(0, -1);
                }
            };
            const smartBack = () => {
                if (typeof window.gggPhoneAppBack === 'function') window.gggPhoneAppBack();
                else back();
                controlsOpen.value = false;
            };
            const goHome = () => {
                stack.value = ['home'];
                controlsOpen.value = false;
            };
            const openControls = (anchorRect = null) => {
                if (anchorRect && typeof anchorRect.left === 'number') {
                    controlAnchor.value = {
                        left: anchorRect.left,
                        top: anchorRect.top,
                        width: anchorRect.width || 0,
                        height: anchorRect.height || 0,
                    };
                } else {
                    controlAnchor.value = null;
                }
                controlsOpen.value = true;
            };
            const closeControls = () => {
                controlsOpen.value = false;
            };
            const controlPanelStyle = computed(() => {
                const a = controlAnchor.value;
                if (!a) return {};
                const panelW = 292;
                const gap = 10;
                const vw = window.innerWidth || 360;
                const vh = window.innerHeight || 640;
                const centerX = a.left + a.width / 2;
                const left = Math.max(10, Math.min(vw - panelW - 10, centerX - panelW / 2));
                const preferTop = a.top - 142 - gap;
                const top = preferTop > 10
                    ? preferTop
                    : Math.min(vh - 154, a.top + a.height + gap);
                return {
                    position: 'fixed',
                    left: `${Math.round(left)}px`,
                    top: `${Math.round(Math.max(10, top))}px`,
                    width: `${panelW}px`,
                    margin: '0',
                };
            });
            const refreshBackendSnap = () => {
                const api = window.__ggg_pp_backend;
                const snap = api?.getSnapshot?.() || window.__ggg_pp_last_send || null;
                backendSnap.value = snap;
                backendRaw.value = snap?.rawResponse || '';
                backendPromptLoaded.value = !!snap?.promptPreviewLoaded;
                const versions = Array.isArray(snap?.replyVersions) ? snap.replyVersions : [];
                selectedVersionId.value = versions[versions.length - 1]?.id || '';
                backendMsg.value = snap ? '' : '尚未发送过 PP 消息';
            };
            const openBackend = () => {
                refreshBackendSnap();
                backendOpen.value = true;
                controlsOpen.value = false;
            };
            const closeBackend = () => {
                backendOpen.value = false;
                backendSnap.value = null;
                backendRaw.value = '';
                backendPromptLoaded.value = false;
            };
            const estimateBackendTokens = (text) => {
                const s = String(text || '');
                if (!s) return 0;
                try {
                    const ctx = (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null;
                    if (ctx && typeof ctx.getTokenCount === 'function') {
                        const n = ctx.getTokenCount(s);
                        if (typeof n === 'number' && n >= 0) return n;
                    }
                    if (typeof window.getTokenCount === 'function') {
                        const n = window.getTokenCount(s);
                        if (typeof n === 'number' && n >= 0) return n;
                    }
                } catch {}
                let cn = 0, other = 0;
                for (const ch of s) {
                    if (/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch)) cn++;
                    else other++;
                }
                return Math.ceil(cn / 1.5 + other / 4);
            };
            const normalizePromptMessage = (msg, index) => {
                if (typeof msg === 'string') {
                    return {
                        key: `${index}:builtin:${msg}`,
                        role: 'builtin',
                        source: msg,
                        content: msg,
                        tokens: estimateBackendTokens(msg),
                    };
                }
                const role = String(msg?.role || 'system').toLowerCase();
                const content = String(msg?.content ?? msg?.message ?? '');
                return {
                    key: `${index}:${role}:${content.slice(0, 24)}`,
                    role,
                    source: msg?.source || '',
                    content,
                    tokens: estimateBackendTokens(content),
                };
            };
            const backendPromptItems = computed(() => {
                const msgs = backendSnap.value?.sentMessagesForDisplay || backendSnap.value?.sentMessages || [];
                return Array.isArray(msgs) ? msgs.map(normalizePromptMessage) : [];
            });
            const backendPromptTotalTokens = computed(() =>
                backendPromptItems.value.reduce((sum, item) => sum + (item.tokens || 0), 0)
            );
            const roleIconClass = (role) => {
                if (role === 'user') return 'fa-user';
                if (role === 'assistant') return 'fa-robot';
                if (role === 'builtin') return 'fa-puzzle-piece';
                return 'fa-gear';
            };
            const roleLabel = (role) => {
                if (role === 'builtin') return 'builtin';
                return role || 'system';
            };
            const promptPreviewLine = (content) => {
                const line = String(content || '').split(/\r?\n/).map(s => s.trim()).find(Boolean) || '(空)';
                return line.length > 54 ? line.slice(0, 54) + '...' : line;
            };
            const backendPromptText = computed(() => {
                const msgs = backendSnap.value?.sentMessagesForDisplay || backendSnap.value?.sentMessages;
                return msgs ? JSON.stringify(msgs, null, 2) : '';
            });
            const backendParsedText = computed(() => {
                const parsed = backendSnap.value?.parsed;
                return parsed ? JSON.stringify(parsed, null, 2) : '';
            });
            const replyVersions = computed(() => {
                const snap = backendSnap.value;
                const versions = Array.isArray(snap?.replyVersions) ? snap.replyVersions.slice() : [];
                if (!versions.length && (snap?.rawResponse || snap?.parsed)) {
                    versions.push({
                        id: 'v1',
                        number: 1,
                        label: '版本 1',
                        rawResponse: snap.rawResponse || '',
                        parsed: snap.parsed || null,
                        savedMsgIds: snap.savedMsgIds || [],
                        ts: snap.ts || Date.now(),
                    });
                }
                return versions
                    .map((v, i) => ({
                        ...v,
                        number: Number(v.number) || i + 1,
                        label: `版本 ${Number(v.number) || i + 1}`,
                    }))
                    .sort((a, b) => a.number - b.number);
            });
            const selectedVersion = computed(() =>
                replyVersions.value.find(v => v.id === selectedVersionId.value)
                    || replyVersions.value.find(v => v.id === backendSnap.value?.activeVersionId)
                    || replyVersions.value[replyVersions.value.length - 1]
                    || null
            );
            const loadBackendPrompt = async () => {
                const api = window.__ggg_pp_backend;
                if (!api?.previewPrompt) { backendMsg.value = '请先进入 PP 聊天页'; return; }
                backendBusy.value = true;
                backendMsg.value = '';
                try {
                    backendSnap.value = await api.previewPrompt();
                    backendPromptLoaded.value = true;
                    backendMsg.value = '已获取总提示词';
                } catch (e) {
                    backendMsg.value = String(e?.message || e);
                } finally {
                    backendBusy.value = false;
                }
            };
            const copyBackend = async () => {
                const api = window.__ggg_pp_backend;
                if (api?.copySnapshot) {
                    backendMsg.value = await api.copySnapshot() ? '已复制' : '复制失败';
                    return;
                }
                if (!backendSnap.value) return;
                try {
                    await navigator.clipboard.writeText(JSON.stringify(backendSnap.value, null, 2));
                    backendMsg.value = '已复制';
                } catch {
                    backendMsg.value = '复制失败';
                }
            };
            const applyBackendRaw = async () => {
                const api = window.__ggg_pp_backend;
                if (!api?.applyRawResponse) { backendMsg.value = '请先进入 PP 聊天页'; return; }
                backendBusy.value = true;
                backendMsg.value = '';
                try {
                    const versionId = selectedVersion.value?.id || selectedVersionId.value || backendSnap.value?.activeVersionId || '';
                    backendSnap.value = await api.applyRawResponse(backendRaw.value, versionId);
                    selectedVersionId.value = backendSnap.value?.activeVersionId || versionId;
                    backendMsg.value = '已应用编辑后的回复';
                } catch (e) {
                    backendMsg.value = String(e?.message || e);
                } finally {
                    backendBusy.value = false;
                }
            };
            const refreshBackendAI = async () => {
                const api = window.__ggg_pp_backend;
                if (!api?.refreshAIReply) { backendMsg.value = '请先进入 PP 聊天页'; return; }
                backendBusy.value = true;
                backendMsg.value = '';
                try {
                    backendSnap.value = await api.refreshAIReply();
                    backendRaw.value = backendSnap.value?.rawResponse || '';
                    const versions = Array.isArray(backendSnap.value?.replyVersions) ? backendSnap.value.replyVersions : [];
                    selectedVersionId.value = backendSnap.value?.activeVersionId || versions[versions.length - 1]?.id || '';
                    backendMsg.value = backendSnap.value?.error || '已刷新 AI 回复';
                } catch (e) {
                    backendMsg.value = String(e?.message || e);
                } finally {
                    backendBusy.value = false;
                }
            };
            const useSelectedVersion = async () => {
                const v = selectedVersion.value;
                if (!v) { backendMsg.value = '没有可用版本'; return; }
                backendRaw.value = v.rawResponse || '';
                await applyBackendRaw();
            };
            const exitPhone = () => {
                controlsOpen.value = false;
                backendOpen.value = false;
                window.__ggg_phone_exit?.();
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
                // 暴露 back 给入口（悬浮窗/球）单击调用
                window.gggPhoneBack = back;
                window.gggPhoneOpenControls = openControls;
                window.__ggg_phone_open_pp_chat = openPPChat;
                consumePendingRoute();
                syncShellAppClass(current.value);
                const el = containerEl.value;
                if (!el) return;
                el.addEventListener('touchstart', handleStart, { passive: false });
                el.addEventListener('touchmove',  handleMove,  { passive: false });
                el.addEventListener('touchend',   handleEnd);
                el.addEventListener('touchcancel', handleEnd);
            });
            watch(current, (id) => syncShellAppClass(id), { immediate: true });
            onBeforeUnmount(() => {
                if (window.gggPhoneBack === back) window.gggPhoneBack = null;
                if (window.gggPhoneOpenControls === openControls) window.gggPhoneOpenControls = null;
                if (window.__ggg_phone_open_pp_chat === openPPChat) window.__ggg_phone_open_pp_chat = null;
                document.getElementById('ggg-phone-shell')?.classList.remove(...shellAppClasses);
                backendSnap.value = null;
                backendRaw.value = '';
                const el = containerEl.value;
                if (!el) return;
                el.removeEventListener('touchstart', handleStart);
                el.removeEventListener('touchmove',  handleMove);
                el.removeEventListener('touchend',   handleEnd);
                el.removeEventListener('touchcancel', handleEnd);
            });

            return {
                current, currentComp, openApp, back,
                ppOpenRequest,
                swipeOffset, containerEl,
                controlsOpen, backendOpen, backendSnap, backendRaw, backendBusy, backendMsg,
                backendTab, backendPromptLoaded, selectedVersionId,
                backendPromptText, backendPromptItems, backendPromptTotalTokens,
                backendParsedText, replyVersions, selectedVersion,
                roleIconClass, roleLabel, promptPreviewLine,
                controlPanelStyle,
                openControls, closeControls, goHome, openBackend, closeBackend, refreshBackendSnap,
                smartBack, loadBackendPrompt, copyBackend, applyBackendRaw, refreshBackendAI, useSelectedVersion, exitPhone,
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
                    :on-back="back"
                    :pp-open-request="ppOpenRequest" />

                <div v-if="controlsOpen" class="ggg-phone-control-mask" @click.self="closeControls">
                    <div class="ggg-phone-control-panel" :style="controlPanelStyle">
                        <button class="ggg-phone-control-item" @click="smartBack">
                            <i class="ggg-fa fa-solid fa-chevron-left"></i><span>返回上一页</span>
                        </button>
                        <button class="ggg-phone-control-item" @click="goHome">
                            <i class="ggg-fa fa-solid fa-house"></i><span>返回主页</span>
                        </button>
                        <button class="ggg-phone-control-item" @click="openBackend">
                            <i class="ggg-fa fa-solid fa-rectangle-list"></i><span>查看后台</span>
                        </button>
                        <button class="ggg-phone-control-item danger" @click="exitPhone">
                            <i class="ggg-fa fa-solid fa-power-off"></i><span>退出手机</span>
                        </button>
                    </div>
                </div>

                <div v-if="backendOpen" class="ggg-phone-backend-mask" @click.self="closeBackend">
                    <div class="ggg-phone-backend-panel">
                        <div class="backend-head">
                            <span>后台</span>
                            <div class="backend-actions">
                                <button @click="refreshBackendSnap" title="刷新视图"><i class="ggg-fa fa-solid fa-rotate"></i></button>
                                <button @click="copyBackend" title="复制快照"><i class="ggg-fa fa-solid fa-copy"></i></button>
                                <button @click="closeBackend" title="关闭"><i class="ggg-fa fa-solid fa-xmark"></i></button>
                            </div>
                        </div>
                        <div class="backend-tabs">
                            <button :class="{active: backendTab === 'prompt'}" @click="backendTab = 'prompt'">
                                <i class="ggg-fa fa-solid fa-layer-group"></i> 总提示词
                            </button>
                            <button :class="{active: backendTab === 'reply'}" @click="backendTab = 'reply'">
                                <i class="ggg-fa fa-solid fa-message"></i> AI 回复
                            </button>
                        </div>
                        <div class="backend-body">
                            <div v-if="backendTab === 'prompt'" class="backend-section backend-card">
                                <div class="backend-title">总提示词 / 实际发送 messages</div>
                                <div v-if="!backendPromptLoaded" class="backend-empty compact">
                                    <div>提示词预览默认为空。</div>
                                    <button class="backend-btn primary" :disabled="backendBusy" @click="loadBackendPrompt">
                                        <i class="ggg-fa fa-solid fa-eye"></i> 查看提示词
                                    </button>
                                </div>
                                <template v-else>
                                    <div class="backend-prompt-summary">
                                        <span>{{ backendPromptItems.length }} 条 messages</span>
                                        <strong>约 {{ backendPromptTotalTokens }} tokens</strong>
                                    </div>
                                    <div class="backend-prompt-list">
                                        <details
                                            v-for="(m, i) in backendPromptItems"
                                            :key="m.key"
                                            class="backend-prompt-item"
                                            :class="'role-' + m.role">
                                            <summary>
                                                <span class="pi-role" :title="roleLabel(m.role)">
                                                    <i class="ggg-fa fa-solid" :class="roleIconClass(m.role)"></i>
                                                </span>
                                                <span class="pi-main">
                                                    <span class="pi-top">
                                                        <b>#{{ i + 1 }}</b>
                                                        <small v-if="m.source">{{ m.source }}</small>
                                                    </span>
                                                    <span class="pi-preview">{{ promptPreviewLine(m.content) }}</span>
                                                </span>
                                                <span class="pi-tokens">{{ m.tokens }} tk</span>
                                                <i class="ggg-fa fa-solid fa-chevron-down pi-chevron"></i>
                                            </summary>
                                            <div class="pi-content">
                                                <div class="pi-content-card">{{ m.content }}</div>
                                            </div>
                                        </details>
                                    </div>
                                </template>
                            </div>

                            <template v-if="backendTab === 'reply'">
                            <div v-if="!backendSnap" class="backend-empty">尚未发送过消息</div>
                            <div v-else class="backend-section backend-card">
                                <div class="backend-title">AI 原始回复（可编辑）</div>
                                <div v-if="replyVersions.length" class="backend-version-row">
                                    <button
                                        v-for="v in replyVersions"
                                        :key="v.id"
                                        :class="{active: selectedVersionId === v.id}"
                                        @click="selectedVersionId = v.id; backendRaw = v.rawResponse || ''">
                                        {{ v.label }}
                                    </button>
                                </div>
                                <textarea v-model="backendRaw" spellcheck="false"></textarea>
                                <div class="backend-row">
                                    <button class="backend-btn" :disabled="backendBusy" @click="applyBackendRaw">
                                        <i class="ggg-fa fa-solid fa-check"></i> 应用编辑
                                    </button>
                                    <button class="backend-btn primary" :disabled="backendBusy" @click="refreshBackendAI">
                                        <i class="ggg-fa fa-solid fa-arrows-rotate"></i> 刷新 AI 回复
                                    </button>
                                    <button class="backend-btn" :disabled="backendBusy || !selectedVersion" @click="useSelectedVersion">
                                        <i class="ggg-fa fa-solid fa-upload"></i> 使用此版本
                                    </button>
                                </div>
                            </div>
                            <div class="backend-section backend-card">
                                <div class="backend-title">解析结果</div>
                                <pre>{{ selectedVersion?.parsed ? JSON.stringify(selectedVersion.parsed, null, 2) : backendParsedText }}</pre>
                            </div>
                            </template>
                            <div v-if="backendSnap && backendSnap.error" class="backend-msg error">{{ backendSnap.error }}</div>
                            <div v-if="backendMsg" class="backend-msg">{{ backendMsg }}</div>
                        </div>
                    </div>
                </div>
            </div>
        `,
    });
}
