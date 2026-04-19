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
import { settings } from '../../../../index.js';
import { getBgUrl, setBgUrl, listStBackgrounds } from '../../core/background.js';

export function createGalleryComponent(Vue) {
    const { ref, computed, onMounted } = Vue;

    return Vue.defineComponent({
        name: 'PhoneGallery',
        props: { onBack: { type: Function, required: true } },

        setup(props) {
            const tab = ref('st-bg');
            const stBgs = ref([]);
            const gggImgs = ref([]);
            const chatImgs = ref([]);
            const currentBg = ref(getBgUrl());

            // 筛选状态
            const sizeFilter = ref('all');   // all | landscape | portrait | square
            const tagFilter = ref('');       // '' | 某个 tag

            // 图片尺寸缓存：url → 'landscape' | 'portrait' | 'square'
            const sizeCache = ref({});
            const probeSize = (url) => {
                if (sizeCache.value[url]) return;
                const img = new Image();
                img.onload = () => {
                    const w = img.naturalWidth, h = img.naturalHeight;
                    let kind = 'square';
                    if (w / h > 1.15) kind = 'landscape';
                    else if (h / w > 1.15) kind = 'portrait';
                    sizeCache.value = { ...sizeCache.value, [url]: kind };
                };
                img.src = url;
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
            onMounted(() => { loadStBgs(); loadGggImgs(); });

            const tabs = [
                { id: 'st-bg', name: '酒馆背景' },
                { id: 'ggg',   name: '呱呱图库' },
                { id: 'chat',  name: '聊天图片' },
            ];

            // 当前 tab 的全部图片
            const rawList = computed(() => {
                if (tab.value === 'st-bg') return stBgs.value;
                if (tab.value === 'ggg')   return gggImgs.value;
                return chatImgs.value;
            });

            // 所有可用的 tag（仅呱呱图库）
            const allTags = computed(() => {
                if (tab.value !== 'ggg') return [];
                const set = new Set();
                gggImgs.value.forEach(it => (it.tags || []).forEach(t => set.add(t)));
                return ['', ...Array.from(set).sort()]; // '' 表示"全部"
            });

            // 应用筛选
            const filtered = computed(() => {
                let list = rawList.value;
                // tag 筛选
                if (tab.value === 'ggg' && tagFilter.value) {
                    list = list.filter(it => (it.tags || []).includes(tagFilter.value));
                }
                // 尺寸筛选
                if (sizeFilter.value !== 'all') {
                    list = list.filter(it => sizeCache.value[it.url] === sizeFilter.value);
                }
                return list;
            });

            // 切 tab 时清筛选
            const switchTab = (id) => { tab.value = id; tagFilter.value = ''; sizeFilter.value = 'all'; };

            const sizeChips = [
                { id: 'all',       name: '全部', icon: 'fa-border-all' },
                { id: 'landscape', name: '横',   icon: 'fa-square' },
                { id: 'portrait',  name: '竖',   icon: 'fa-mobile-screen' },
                { id: 'square',    name: '方',   icon: 'fa-stop' },
            ];

            return {
                tab, tabs, switchTab,
                rawList, filtered, sizeFilter, sizeChips, tagFilter, allTags,
                currentBg, onSetBg, onClearBg, probeSize,
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
                    <button v-if="currentBg" class="ggg-phone-iconbtn" @click="onClearBg" title="清除手机背景">
                        <i class="ggg-fa fa-solid fa-eraser"></i>
                    </button>
                    <div v-else class="ggg-phone-iconbtn placeholder"></div>
                </div>

                <div v-if="tab === 'st-bg'" class="ggg-phone-gallery-hint">
                    点图片设为手机背景（当前 {{ currentBg ? '已自定义' : '默认' }}）
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
                    <template v-if="tab === 'ggg' && allTags.length > 1">
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

                <div class="ggg-phone-gallery-grid">
                    <div v-if="filtered.length === 0" class="ggg-phone-gallery-empty">
                        <template v-if="rawList.length === 0">暂无图片</template>
                        <template v-else>没有符合筛选的图片</template>
                    </div>
                    <div
                        v-for="img in filtered"
                        :key="img.url"
                        class="ggg-phone-gallery-cell"
                        :class="{ active: currentBg === img.url }"
                        :title="img.name"
                        @click="onSetBg(img)">
                        <img :src="img.url" :alt="img.name" loading="lazy" @load="probeSize(img.url)" />
                        <div v-if="currentBg === img.url" class="ggg-phone-gallery-mark">
                            <i class="ggg-fa fa-solid fa-check"></i>
                        </div>
                    </div>
                </div>
            </div>
        `,
    });
}
