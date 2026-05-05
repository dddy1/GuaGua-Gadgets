import { readStAllPersonas, readStAllPersonasAsync } from '../store.js';
import { saveAllSettings } from '../../../../../index.js';

function walletBalanceNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

const VIP_PLANS = [
    { id: 'month', name: '月度付款', months: 1, price: 20, desc: '¥20 / 月' },
    { id: 'quarter', name: '季度付款', months: 3, price: 57, desc: '95 折' },
    { id: 'year', name: '年度付款', months: 12, price: 216, desc: '9 折' },
];

export function createPPProfileActionPage(Vue) {
    const { computed, onMounted, ref } = Vue;

    return Vue.defineComponent({
        name: 'PPProfileActionPage',
        props: {
            page: { type: String, required: true },
            me: { type: Object, required: true },
            wallet: { type: Object, required: true },
            vip: { type: Object, required: true },
            onBack: { type: Function, required: true },
            onSwitchAccount: { type: Function, default: () => {} },
        },
        setup(props) {
            const personas = ref([]);
            const personasLoading = ref(false);
            const notice = ref('');
            const titleMap = {
                'switch-account': '切换账号',
                wallet: '钱包',
                vip: '会员',
                fav: '收藏',
                dev: '开发者',
                settings: '设置',
            };
            const title = computed(() => titleMap[props.page] || 'PP');
            const walletHistory = computed(() => {
                const list = Array.isArray(props.wallet?.history) ? props.wallet.history : [];
                return list.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
            });
            const walletBalanceText = computed(() => walletBalanceNumber(props.wallet?.balance).toFixed(2));
            const vipActive = computed(() => !!props.vip && props.vip.tier !== 'none' && Number(props.vip.expireAt || 0) > Date.now());
            const vipExpireText = computed(() => {
                const ts = Number(props.vip?.expireAt || 0);
                if (!vipActive.value || !ts) return '未开通';
                const d = new Date(ts);
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            });
            const fmtWalletTime = (ts) => {
                if (!ts) return '';
                const d = new Date(ts);
                if (Number.isNaN(d.getTime())) return '';
                return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            };
            const refreshPersonas = async () => {
                personas.value = readStAllPersonas();
                personasLoading.value = true;
                try {
                    const list = await readStAllPersonasAsync();
                    if (list && list.length) personas.value = list;
                } finally {
                    personasLoading.value = false;
                }
            };
            const pickPersona = (p) => {
                props.onSwitchAccount?.(p);
                props.onBack?.();
            };
            const buyVip = (plan) => {
                if (!plan) return;
                const balance = walletBalanceNumber(props.wallet?.balance);
                if (balance < plan.price) {
                    notice.value = `余额不足：购买${plan.name}需要 ¥${plan.price}，当前余额 ¥${balance.toFixed(2)}`;
                    return;
                }
                props.wallet.balance = Math.round((balance - plan.price) * 100) / 100;
                if (!Array.isArray(props.wallet.history)) props.wallet.history = [];
                props.wallet.history.push({
                    ts: Date.now(),
                    type: 'out',
                    amount: plan.price,
                    to: 'PP会员',
                    note: `购买会员：${plan.name}`,
                });
                const base = Math.max(Date.now(), Number(props.vip?.expireAt || 0));
                const d = new Date(base);
                d.setMonth(d.getMonth() + plan.months);
                props.vip.tier = 'vip';
                props.vip.plan = plan.id;
                props.vip.expireAt = d.getTime();
                saveAllSettings();
                notice.value = `已购买${plan.name}`;
            };
            onMounted(() => {
                if (props.page === 'switch-account') refreshPersonas();
            });
            return {
                title,
                notice,
                personas, personasLoading, pickPersona,
                walletHistory, walletBalanceText, fmtWalletTime,
                VIP_PLANS, vipActive, vipExpireText, buyVip,
            };
        },
        template: /* html */ `
            <div class="ggg-pp-profile-page">
                <div class="ggg-pp-profile-page-topbar">
                    <button class="ggg-pp-iconbtn" @click="onBack" title="返回">
                        <i class="ggg-fa fa-solid fa-chevron-left"></i>
                    </button>
                    <div class="title">{{ title }}</div>
                    <div class="spacer"></div>
                </div>

                <div class="ggg-pp-profile-page-body">
                    <div v-if="notice" class="ggg-pp-profile-notice">{{ notice }}</div>

                    <template v-if="page === 'switch-account'">
                        <div v-if="personasLoading && personas.length === 0" class="ggg-pp-profile-empty">正在读取酒馆账号...</div>
                        <div v-else-if="personas.length === 0" class="ggg-pp-profile-empty">未发现酒馆 Persona</div>
                        <div v-else class="ggg-pp-account-list">
                            <div v-for="p in personas" :key="p.avatar"
                                 class="ggg-pp-account-item"
                                 :class="{ current: p.isCurrent }"
                                 @click="pickPersona(p)">
                                <img :src="p.url" :alt="p.name" loading="lazy" onerror="this.style.display='none'" />
                                <div class="meta">
                                    <div class="name">{{ p.name }}</div>
                                    <div class="key">{{ p.avatar }}</div>
                                </div>
                                <i v-if="p.isCurrent" class="ggg-fa fa-solid fa-circle-check" style="color:var(--ggg-accent);"></i>
                            </div>
                        </div>
                    </template>

                    <template v-else-if="page === 'wallet'">
                        <div class="ggg-pp-wallet-balance">
                            <span>余额</span>
                            <b>¥{{ walletBalanceText }}</b>
                        </div>
                        <div v-if="walletHistory.length === 0" class="ggg-pp-wallet-empty">暂无收支记录</div>
                        <div v-else class="ggg-pp-wallet-list">
                            <div v-for="(h, idx) in walletHistory" :key="idx + ':' + h.ts" class="ggg-pp-wallet-row">
                                <div class="meta">
                                    <div class="title">{{ h.note || (h.type === 'in' ? '收款' : '支出') }}</div>
                                    <div class="sub">
                                        {{ fmtWalletTime(h.ts) }}
                                        <template v-if="h.from"> · 来自 {{ h.from }}</template>
                                        <template v-if="h.to"> · 转给 {{ h.to }}</template>
                                    </div>
                                </div>
                                <div class="amount" :class="{ out: h.type === 'out' }">
                                    {{ h.type === 'out' ? '-' : '+' }}¥{{ Number(h.amount || 0).toFixed(2) }}
                                </div>
                            </div>
                        </div>
                    </template>

                    <template v-else-if="page === 'vip'">
                        <div class="ggg-pp-vip-status" :class="{active: vipActive}">
                            <i class="ggg-fa fa-solid fa-crown"></i>
                            <div>
                                <div class="name">{{ vipActive ? '会员已开通' : '未开通会员' }}</div>
                                <div class="sub">{{ vipActive ? ('有效期至 ' + vipExpireText) : '开通后可在装扮中调节气泡颜色、透明度与模糊度' }}</div>
                            </div>
                        </div>
                        <div class="ggg-pp-vip-plan-list">
                            <button v-for="plan in VIP_PLANS" :key="plan.id"
                                    class="ggg-pp-vip-plan"
                                    @click="buyVip(plan)">
                                <div class="meta">
                                    <span>{{ plan.name }}</span>
                                    <small>{{ plan.desc }}</small>
                                </div>
                                <b>¥{{ plan.price }}</b>
                            </button>
                        </div>
                    </template>

                    <div v-else class="ggg-pp-profile-empty"></div>
                </div>
            </div>
        `,
    });
}
