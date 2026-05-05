/**
 * PP - Contacts 页 ：联系人 —— v0.2.57
 *   - 分组：特别关心 / 好友 / 黑名单 / 群组
 *   - 点击好友/群 → onOpenChat(contact, scope)
 */
export function createPPContactsPage(Vue) {
    return Vue.defineComponent({
        name: 'PPContacts',
        props: {
            friends:    { type: Array, required: true },
            groups:     { type: Array, required: true },
            onOpenChat: { type: Function, required: true },
        },
        setup(props) {
            const { computed } = Vue;
            const uniqueById = (list) => {
                const seen = new Set();
                const out = [];
                for (const item of list || []) {
                    const id = item?.fromCharacter ? `char:${item.fromCharacter}` : (item?.id || item?.nickname || item?.name);
                    if (!id || seen.has(id)) continue;
                    seen.add(id);
                    out.push(item);
                }
                return out;
            };
            const friends = computed(() => uniqueById(props.friends));
            const groups = computed(() => uniqueById(props.groups));
            const special = computed(() => friends.value.filter(f => f.special));
            const normal = computed(() => friends.value.filter(f => !f.special && f.group !== 'blocked_me' && f.group !== 'blocked_by_me'));
            const blocked = computed(() => friends.value.filter(f => f.group === 'blocked_me'));
            const blockedByThem = computed(() => friends.value.filter(f => f.group === 'blocked_by_me'));
            const dotColor = (s) => {
                if (s === 'online') return '#22c55e';
                if (s === 'busy')   return '#f59e0b';
                return '#9ca3af';
            };
            return { special, normal, blocked, blockedByThem, groups, dotColor };
        },
        template: /* html */ `
            <div class="ggg-pp-page ggg-pp-contacts">
                <div class="ggg-pp-section">
                    <div class="ggg-pp-section-title">
                        <i class="ggg-fa fa-solid fa-heart" style="color:#ef4444"></i> 特别关心
                    </div>
                    <div v-if="special.length === 0" class="ggg-pp-empty-mini">尚未设置</div>
                    <div v-else class="ggg-pp-contact-list">
                        <div v-for="f in special" :key="f.id" class="ggg-pp-contact-item" @click="onOpenChat(f, 'private')">
                            <div class="avatar">
                                <img v-if="f.avatar" :src="f.avatar" alt="" />
                                <i v-else class="ggg-fa fa-solid fa-user"></i>
                            </div>
                            <div class="meta">
                                <div class="name">
                                    <span class="online-dot" :style="{background: dotColor(f.online)}"></span>
                                    {{ f.remark || f.nickname }}
                                </div>
                                <div class="sig" v-if="f.signature">{{ f.signature }}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="ggg-pp-section">
                    <div class="ggg-pp-section-title">
                        <i class="ggg-fa fa-solid fa-user-group"></i> 好友 ({{ normal.length }})
                    </div>
                    <div v-if="normal.length === 0" class="ggg-pp-empty-mini">还没有好友</div>
                    <div v-else class="ggg-pp-contact-list">
                        <div v-for="f in normal" :key="f.id" class="ggg-pp-contact-item" @click="onOpenChat(f, 'private')">
                            <div class="avatar">
                                <img v-if="f.avatar" :src="f.avatar" alt="" />
                                <i v-else class="ggg-fa fa-solid fa-user"></i>
                            </div>
                            <div class="meta">
                                <div class="name">
                                    <span class="online-dot" :style="{background: dotColor(f.online)}"></span>
                                    {{ f.remark || f.nickname }}
                                </div>
                                <div class="sig" v-if="f.signature">{{ f.signature }}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="ggg-pp-section" v-if="blocked.length > 0">
                    <div class="ggg-pp-section-title">
                        <i class="ggg-fa fa-solid fa-ban" style="color:#9ca3af"></i> 黑名单 ({{ blocked.length }})
                    </div>
                    <div class="ggg-pp-contact-list">
                        <div v-for="f in blocked" :key="f.id" class="ggg-pp-contact-item" style="opacity:.6;">
                            <div class="avatar"><i class="ggg-fa fa-solid fa-user-slash"></i></div>
                            <div class="name">{{ f.remark || f.nickname }}</div>
                        </div>
                    </div>
                </div>

                <div class="ggg-pp-section" v-if="blockedByThem.length > 0">
                    <div class="ggg-pp-section-title">
                        <i class="ggg-fa fa-solid fa-user-xmark" style="color:#dc2626"></i> 已被对方拉黑 ({{ blockedByThem.length }})
                    </div>
                    <div class="ggg-pp-contact-list">
                        <div v-for="f in blockedByThem" :key="f.id" class="ggg-pp-contact-item" style="opacity:.5;">
                            <div class="avatar"><i class="ggg-fa fa-solid fa-user-large-slash"></i></div>
                            <div class="name">{{ f.remark || f.nickname }} <span style="font-size:10px;color:#dc2626;">（无法添加）</span></div>
                        </div>
                    </div>
                </div>

                <div class="ggg-pp-section">
                    <div class="ggg-pp-section-title">
                        <i class="ggg-fa fa-solid fa-users"></i> 群组 ({{ groups.length }})
                    </div>
                    <div v-if="groups.length === 0" class="ggg-pp-empty-mini">还没有群组</div>
                    <div v-else class="ggg-pp-contact-list">
                        <div v-for="g in groups" :key="g.id" class="ggg-pp-contact-item" @click="onOpenChat(g, 'group')">
                            <div class="avatar group">
                                <img v-if="g.avatar" :src="g.avatar" alt="" />
                                <i v-else class="ggg-fa fa-solid fa-users"></i>
                            </div>
                            <div class="name">{{ g.name }}</div>
                        </div>
                    </div>
                </div>
            </div>
        `,
    });
}
