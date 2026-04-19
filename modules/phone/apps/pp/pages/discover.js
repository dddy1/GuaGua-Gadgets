/**
 * PP - Discover 页 ：动态（占位）
 */
export function createPPDiscoverPage(Vue) {
    return Vue.defineComponent({
        name: 'PPDiscover',
        template: /* html */ `
            <div class="ggg-pp-page ggg-pp-discover">
                <div class="ggg-pp-empty">
                    <i class="ggg-fa fa-solid fa-compass"></i>
                    <div>动态时间线（Phase 5 实装）</div>
                    <div class="hint">这里会按编号倒序显示好友 / 群组动态</div>
                </div>
            </div>
        `,
    });
}
