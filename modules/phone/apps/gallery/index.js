/**
 * 图库 App —— 三个 Tab：
 *   - 酒馆背景：从酒馆 DOM #bg_menu_content 直读
 *   - 呱呱图库：读 settings.gallery
 *   - 聊天图片：占位
 *
 * 筛选：
 *   - tag 筛选：呱呱图库支持（settings.gallery 里有 tags 字段）
 *   - 尺寸筛选：横 / 竖 / 方（懒加载图片探测 naturalWidth/Height 后归类）
 */
import { settings, saveAllSettings } from '../../../../index.js';
import { getBgUrl, setBgUrl, listStBackgrounds } from '../../core/background.js';

export function createGalleryComponent(Vue) {
    const { ref, computed, onMounted, watch } = Vue;

    return Vue.defineComponent({
        name: 'PhoneGallery',
        props: { onBack: { type: Function, required: true } },

        setup(props) {
            const tab = ref('st-bg');
            const stBgs = ref([]);
            const gggImgs = ref([]);
            const memes = ref([]);
            const chatImgs = ref([]);
            const currentBg = ref(getBgUrl());
            const memeEditMode = ref(false);
            const memeSelected = ref(new Set());

            // 筛选状态
            const sizeFilter = ref('all');   // all | landscape | portrait | square
            const tagFilter = ref('');       // '' | 某个 tag

            // 图片尺寸缓存：url → 'landscape' | 'portrait' | 'square'
            const sizeCache = ref({});
            let probeRunId = 0;
            const probeSize = (url) => {
                if (sizeCache.value[url]) return;
                const img = new Image();
                img.decoding = 'async';
                img.onload = () => {
                    const w = img.naturalWidth, h = img.naturalHeight;
                    let kind = 'square';
                    if (w / h > 1.15) kind = 'landscape';
                    else if (h / w > 1.15) kind = 'portrait';
                    sizeCache.value = { ...sizeCache.value, [url]: kind };
                };
                img.src = url;
            };
            const ensureSizeInfoForFilter = async () => {
                if (sizeFilter.value === 'all') return;
                const runId = ++probeRunId;
                const urls = rawList.value.map(it => it.url).filter(url => url && !sizeCache.value[url]);
                const queue = urls.slice();
                const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
                    while (queue.length && runId === probeRunId) {
                        const url = queue.shift();
                        await new Promise(resolve => {
                            const img = new Image();
                            img.decoding = 'async';
                            img.onload = () => {
                                const w = img.naturalWidth, h = img.naturalHeight;
                                let kind = 'square';
                                if (w / h > 1.15) kind = 'landscape';
                                else if (h / w > 1.15) kind = 'portrait';
                                sizeCache.value = { ...sizeCache.value, [url]: kind };
                                resolve();
                            };
                            img.onerror = () => {
                                sizeCache.value = { ...sizeCache.value, [url]: 'unknown' };
                                resolve();
                            };
                            img.src = url;
                        });
                    }
                });
                await Promise.all(workers);
            };

            const onSetBg = (img) => { setBgUrl(img.url); currentBg.value = img.url; };
            const onClearBg = () => { setBgUrl(''); currentBg.value = ''; };

            const loadStBgs = () => { stBgs.value = listStBackgrounds(); };
            const loadGggImgs = () => {
                gggImgs.value = (settings.gallery || []).map(item => ({
                    name: item.name || item.id || '',
                    url: item.url || item.dataUrl || '',
                    tags: Array.isArray(item.tags) ? item.tags : [],
                }));
            };
            const loadMemes = () => {
                memes.value = (settings.memes || []).map((item, index) => ({
                    index,
                    name: item.name || '',
                    url: item.url || item.dataUrl || '',
                    filename: item.filename || '',
                    tags: Array.isArray(item.tags) ? item.tags : [],
                })).filter(x => x.url);
            };
            onMounted(() => { loadStBgs(); loadGggImgs(); loadMemes(); });

            const tabs = [
                { id: 'st-bg', name: '酒馆背景' },
                { id: 'ggg',   name: '呱呱图库' },
                { id: 'meme',  name: '表情包' },
                { id: 'chat',  name: '聊天图片' },
            ];

            // 当前 tab 的全部图片
            const rawList = computed(() => {
                if (tab.value === 'st-bg') return stBgs.value;
                if (tab.value === 'ggg')   return gggImgs.value;
                if (tab.value === 'meme')  return memes.value;
                return chatImgs.value;
            });

            // 所有可用的 tag（呱呱图库 / 表情包）
            const allTags = computed(() => {
                if (tab.value !== 'ggg' && tab.value !== 'meme') return [];
                const set = new Set();
                const src = tab.value === 'meme' ? memes.value : gggImgs.value;
                src.forEach(it => (it.tags || []).forEach(t => set.add(t)));
                return ['', ...Array.from(set).sort()]; // '' 表示"全部"
            });

            // 应用筛选
            const filtered = computed(() => {
                let list = rawList.value;
                // tag 筛选
                if ((tab.value === 'ggg' || tab.value === 'meme') && tagFilter.value) {
                    list = list.filter(it => (it.tags || []).includes(tagFilter.value));
                }
                // 尺寸筛选
                if (sizeFilter.value !== 'all') {
                    list = list.filter(it => sizeCache.value[it.url] === sizeFilter.value);
                }
                return list;
            });
            watch([rawList, sizeFilter], ensureSizeInfoForFilter);

            // 切 tab 时清筛选
            const switchTab = (id) => {
                tab.value = id;
                tagFilter.value = '';
                sizeFilter.value = 'all';
                memeEditMode.value = false;
                memeSelected.value = new Set();
                if (id === 'meme') loadMemes();
            };

            const sizeChips = [
                { id: 'all',       name: '全部', icon: 'fa-border-all' },
                { id: 'landscape', name: '横',   icon: 'fa-square' },
                { id: 'portrait',  name: '竖',   icon: 'fa-mobile-screen' },
                { id: 'square',    name: '方',   icon: 'fa-stop' },
            ];

            const syncMemes = () => {
                const src = settings.memes || [];
                memes.value.forEach(view => {
                    if (src[view.index]) src[view.index].tags = [...(view.tags || [])];
                });
                settings.memes = src;
                saveAllSettings();
                loadMemes();
            };
            const toggleMemeSelected = (img) => {
                if (!memeEditMode.value) return;
                const next = new Set(memeSelected.value);
                if (next.has(img.index)) next.delete(img.index);
                else next.add(img.index);
                memeSelected.value = next;
            };
            const selectAllMemes = () => {
                memeSelected.value = new Set(filtered.value.map(x => x.index));
            };
            const clearMemeSelection = () => { memeSelected.value = new Set(); };
            const askMemeName = async (file) => {
                const base = String(file?.name || '').replace(/\.[^.]+$/, '');
                try {
                    const ctx = SillyTavern?.getContext?.();
                    if (ctx?.callGenericPopup && ctx?.POPUP_TYPE) {
                        const id = `ggg-phone-meme-name-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                        const html = `
                            <div class="ggg-phone-popup-form">
                                <div class="ggg-phone-popup-title">表情包名</div>
                                <input id="${id}" class="text_pole" value="${String(base).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])}" placeholder="写入 PP 表情包消息时使用的名字">
                            </div>`;
                        setTimeout(() => {
                            const input = document.getElementById(id);
                            input?.focus();
                            input?.select();
                            ['keydown','keyup','keypress','input'].forEach(ev => input?.addEventListener(ev, e => e.stopPropagation()));
                        }, 80);
                        const ok = await ctx.callGenericPopup(html, ctx.POPUP_TYPE.CONFIRM, '', { okButton: '上传', cancelButton: '取消' });
                        if (!ok) return '';
                        return String(document.getElementById(id)?.value || '').trim();
                    }
                } catch {}
                return base;
            };
            const addTagToSelectedMemes = () => {
                const tag = window.prompt('添加标签：', '');
                if (!tag) return;
                const src = settings.memes || [];
                memeSelected.value.forEach(idx => {
                    const item = src[idx];
                    if (!item) return;
                    if (!Array.isArray(item.tags)) item.tags = [];
                    if (!item.tags.includes(tag)) item.tags.push(tag);
                });
                settings.memes = src;
                saveAllSettings();
                loadMemes();
            };
            const removeTagFromSelectedMemes = () => {
                const tag = window.prompt('删除标签：', tagFilter.value || '');
                if (!tag) return;
                const src = settings.memes || [];
                memeSelected.value.forEach(idx => {
                    const item = src[idx];
                    if (item?.tags) item.tags = item.tags.filter(t => t !== tag);
                });
                settings.memes = src;
                saveAllSettings();
                loadMemes();
            };
            const deleteSelectedMemes = async () => {
                if (memeSelected.value.size === 0) return;
                if (!confirm(`确定删除选中的 ${memeSelected.value.size} 张表情包吗？`)) return;
                const src = settings.memes || [];
                const idxArr = [...memeSelected.value].sort((a, b) => b - a);
                for (const idx of idxArr) {
                    const item = src[idx];
                    if (item?.filename) {
                        try {
                            await fetch('/api/backgrounds/delete', {
                                method: 'POST',
                                headers: SillyTavern.getContext().getRequestHeaders(),
                                body: JSON.stringify({ bg: item.filename }),
                            });
                        } catch (err) { console.warn('[ggg] 删除表情包文件失败:', err); }
                    }
                    src.splice(idx, 1);
                }
                settings.memes = src;
                saveAllSettings();
                memeSelected.value = new Set();
                loadMemes();
            };
            const renameMeme = async (img) => {
                const src = settings.memes || [];
                const item = src[img.index];
                if (!item) return;
                const base = String(item.name || img.name || '').trim();
                let next = '';
                try {
                    const ctx = SillyTavern?.getContext?.();
                    if (ctx?.callGenericPopup && ctx?.POPUP_TYPE) {
                        const id = `ggg-phone-meme-rename-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                        const html = `
                            <div class="ggg-phone-popup-form">
                                <div class="ggg-phone-popup-title">修改表情包名称</div>
                                <input id="${id}" class="text_pole" value="${String(base).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])}" placeholder="写入 PP 表情包消息时使用的名字">
                            </div>`;
                        setTimeout(() => {
                            const input = document.getElementById(id);
                            input?.focus();
                            input?.select();
                            ['keydown','keyup','keypress','input'].forEach(ev => input?.addEventListener(ev, e => e.stopPropagation()));
                        }, 80);
                        const ok = await ctx.callGenericPopup(html, ctx.POPUP_TYPE.CONFIRM, '', { okButton: '确定', cancelButton: '取消' });
                        if (!ok) return;
                        next = String(document.getElementById(id)?.value || '').trim();
                    }
                } catch {}
                if (!next) next = String(window.prompt('修改表情包名称：', base) || '').trim();
                if (!next) return;
                item.name = next;
                settings.memes = src;
                saveAllSettings();
                loadMemes();
            };
            const uploadMemeFromPhone = () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.multiple = true;
                input.addEventListener('change', async (e) => {
                    const files = e.target.files;
                    if (!files || !files.length) return;
                    for (const file of files) {
                        const name = await askMemeName(file);
                        if (!name) continue;
                        const filename = `ggg_meme_${Date.now()}_${file.name}`;
                        const fd = new FormData();
                        fd.append('avatar', file, filename);
                        const headers = {};
                        const origH = SillyTavern.getContext().getRequestHeaders();
                        for (const [k, v] of Object.entries(origH)) {
                            if (k.toLowerCase() !== 'content-type') headers[k] = v;
                        }
                        const resp = await fetch('/api/backgrounds/upload', { method: 'POST', headers, body: fd });
                        if (!resp.ok) continue;
                        if (!Array.isArray(settings.memes)) settings.memes = [];
                        settings.memes.push({ name: String(name).trim(), url: `/backgrounds/${filename}`, filename, timestamp: Date.now(), tags: [] });
                    }
                    saveAllSettings();
                    loadMemes();
                });
                input.click();
            };

            return {
                tab, tabs, switchTab,
                rawList, filtered, sizeFilter, sizeChips, tagFilter, allTags,
                currentBg, onSetBg, onClearBg, probeSize,
                memeEditMode, memeSelected, toggleMemeSelected, selectAllMemes, clearMemeSelection,
                addTagToSelectedMemes, removeTagFromSelectedMemes, deleteSelectedMemes, uploadMemeFromPhone,
                renameMeme,
                syncMemes,
                onBack: props.onBack,
            };
        },

        template: /* html */ `
            <div class="ggg-phone-app ggg-phone-gallery" style="background: var(--ggg-bg);">
                <div class="ggg-phone-app-topbar">
                    <button class="ggg-phone-iconbtn" @click="onBack" aria-label="返回">
                        <i class="ggg-fa fa-solid fa-chevron-left"></i>
                    </button>
                    <div class="ggg-phone-app-title">图库</div>
                    <button v-if="tab === 'meme'" class="ggg-phone-iconbtn" @click="uploadMemeFromPhone" title="上传表情包">
                        <i class="ggg-fa fa-solid fa-upload"></i>
                    </button>
                    <button v-else-if="currentBg" class="ggg-phone-iconbtn" @click="onClearBg" title="清除手机背景">
                        <i class="ggg-fa fa-solid fa-eraser"></i>
                    </button>
                    <div v-else class="ggg-phone-iconbtn placeholder"></div>
                </div>

                <div v-if="tab === 'st-bg'" class="ggg-phone-gallery-hint">
                    点图片设为手机背景（当前 {{ currentBg ? '已自定义' : '默认' }}）
                </div>
                <div v-if="tab === 'meme'" class="ggg-phone-gallery-hint">
                    {{ memeEditMode ? '编辑模式：点选表情包后可批量管理' : '表情包消息写入名称即可渲染对应图片' }}
                </div>

                <div class="ggg-phone-tabs">
                    <div
                        v-for="t in tabs"
                        :key="t.id"
                        class="ggg-phone-tab"
                        :class="{ active: tab === t.id }"
                        @click="switchTab(t.id)">
                        {{ t.name }}
                    </div>
                </div>

                <!-- 筛选条 -->
                <div class="ggg-phone-gallery-filter">
                    <div
                        v-for="c in sizeChips"
                        :key="c.id"
                        class="ggg-phone-gallery-chip"
                        :class="{ active: sizeFilter === c.id }"
                        @click="sizeFilter = c.id">
                        <i class="ggg-fa fa-solid" :class="c.icon" style="margin-right:3px;"></i>{{ c.name }}
                    </div>
                    <template v-if="(tab === 'ggg' || tab === 'meme') && allTags.length > 1">
                        <div style="width:100%;height:0;"></div>
                        <div
                            v-for="t in allTags"
                            :key="t || '__all__'"
                            class="ggg-phone-gallery-chip"
                            :class="{ active: tagFilter === t }"
                            @click="tagFilter = t">
                            <i class="ggg-fa fa-solid fa-tag" style="margin-right:3px;"></i>{{ t || '全部 tag' }}
                        </div>
                    </template>
                </div>

                <div v-if="tab === 'meme'" class="ggg-phone-gallery-filter ggg-phone-meme-editbar">
                    <button class="ggg-phone-gallery-chip" :class="{active:memeEditMode}" @click="memeEditMode=!memeEditMode; clearMemeSelection()">
                        <i class="ggg-fa fa-solid fa-pen-to-square"></i> 编辑
                    </button>
                    <template v-if="memeEditMode">
                        <button class="ggg-phone-gallery-chip" @click="selectAllMemes"><i class="ggg-fa fa-solid fa-check-double"></i> 全选</button>
                        <button class="ggg-phone-gallery-chip" @click="clearMemeSelection"><i class="ggg-fa fa-solid fa-xmark"></i> 取消</button>
                        <button class="ggg-phone-gallery-chip" @click="addTagToSelectedMemes"><i class="ggg-fa fa-solid fa-tag"></i> 加标签</button>
                        <button class="ggg-phone-gallery-chip" @click="removeTagFromSelectedMemes"><i class="ggg-fa fa-solid fa-minus"></i> 删标签</button>
                        <button class="ggg-phone-gallery-chip danger" @click="deleteSelectedMemes"><i class="ggg-fa fa-solid fa-trash"></i> 删除 {{ memeSelected.size }}</button>
                    </template>
                </div>

                <div class="ggg-phone-gallery-grid">
                    <div v-if="filtered.length === 0" class="ggg-phone-gallery-empty">
                        <template v-if="rawList.length === 0">暂无图片</template>
                        <template v-else>没有符合筛选的图片</template>
                    </div>
                    <div
                        v-for="img in filtered"
                        :key="img.url"
                        class="ggg-phone-gallery-cell"
                        :class="{ active: tab !== 'meme' && currentBg === img.url, selected: tab === 'meme' && memeSelected.has(img.index) }"
                        :title="img.name"
                        @click="tab === 'meme' ? toggleMemeSelected(img) : onSetBg(img)">
                        <img :src="img.url" :alt="img.name" loading="lazy" decoding="async" @load="probeSize(img.url)" />
                        <div v-if="tab === 'meme'" class="ggg-phone-meme-name">{{ img.name }}</div>
                        <button
                            v-if="tab === 'meme' && memeEditMode"
                            class="ggg-phone-gallery-mark ggg-phone-meme-rename"
                            title="修改名称"
                            @click.stop="renameMeme(img)">
                            <i class="ggg-fa fa-solid fa-pen"></i>
                        </button>
                        <div v-if="tab === 'meme' && memeSelected.has(img.index)" class="ggg-phone-gallery-mark">
                            <i class="ggg-fa fa-solid fa-check"></i>
                        </div>
                        <div v-else-if="tab !== 'meme' && currentBg === img.url" class="ggg-phone-gallery-mark">
                            <i class="ggg-fa fa-solid fa-check"></i>
                        </div>
                    </div>
                </div>
            </div>
        `,
    });
}
