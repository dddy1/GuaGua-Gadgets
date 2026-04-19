/**
 * PP - Contacts 页 ：联系人（占位）
 * 分组：特别关心 / 好友 / 群组
 */
export function createPPContactsPage(Vue) {
    return Vue.defineComponent({
        name: 'PPContacts',
        props: {
            friends: { type: Array, required: true },
            groups: { type: Array, required: true },
        },
        setup(props) {
            const { computed } = Vue;
            const special = computed(() => props.friends.filter(f => f.special));
            const normal = computed(() => props.friends.filter(f => !f.special));
            return { special, normal };
        },
        template: /* html */ `
            <div class="ggg-pp-page ggg-pp-contacts">
                <div class="ggg-pp-section">
                    <div class="ggg-pp-section-title">
                        <i class="ggg-fa fa-solid fa-heart" style="color:#ef4444"></i> 特别关心
                    </div>
                    <div v-if="special.length === 0" class="ggg-pp-empty-mini">尚未设置</div>
                    <div v-else class="ggg-pp-contact-list">
                        <div v-for="f in special" :key="f.id" class="ggg-pp-contact-item">
                            <div class="avatar"><i class="ggg-fa fa-solid fa-user"></i></div>
                            <div class="name">{{ f.remark || f.nickname }}</div>
                        </div>
                    </div>
                </div>

                <div class="ggg-pp-section">
                    <div class="ggg-pp-section-title">
                        <i class="ggg-fa fa-solid fa-user-group"></i> 好友 ({{ normal.length }})
                    </div>
                    <div v-if="normal.length === 0" class="ggg-pp-empty-mini">还没有好友</div>
                    <div v-else class="ggg-pp-contact-list">
                        <div v-for="f in normal" :key="f.id" class="ggg-pp-contact-item">
                            <div class="avatar"><i class="ggg-fa fa-solid fa-user"></i></div>
                            <div class="name">{{ f.remark || f.nickname }}</div>
                        </div>
                    </div>
                </div>

                <div class="ggg-pp-section">
                    <div class="ggg-pp-section-title">
                        <i class="ggg-fa fa-solid fa-users"></i> 群组 ({{ groups.length }})
                    </div>
                    <div v-if="groups.length === 0" class="ggg-pp-empty-mini">还没有群组</div>
                    <div v-else class="ggg-pp-contact-list">
                        <div v-for="g in groups" :key="g.id" class="ggg-pp-contact-item">
                            <div class="avatar group"><i class="ggg-fa fa-solid fa-users"></i></div>
                            <div class="name">{{ g.name }}</div>
                        </div>
                    </div>
                </div>
            </div>
        `,
    });
}
