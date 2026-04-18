/**
 * 手机顶部状态栏
 * 显示：左 时间 ；右 信号/Wi-Fi/电量
 * 电量用 navigator.getBattery()（Chromium 系），失败则隐藏
 */

let _cleanups = [];

export function mountStatusBar() {
    const slot = document.querySelector('#ggg-phone-shell .ggg-phone-status');
    if (!slot) return;
    slot.innerHTML = `
        <div class="ggg-status-left">
            <span class="ggg-status-time">--:--</span>
        </div>
        <div class="ggg-status-right">
            <i class="ggg-fa fa-solid fa-signal"></i>
            <i class="ggg-fa fa-solid fa-wifi"></i>
            <span class="ggg-status-bat">
                <i class="ggg-fa fa-solid fa-battery-full"></i>
                <span class="ggg-status-bat-pct"></span>
            </span>
        </div>
    `;

    // 时间
    const timeEl = slot.querySelector('.ggg-status-time');
    const tick = () => {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        timeEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    tick();
    const t = setInterval(tick, 30 * 1000);
    _cleanups.push(() => clearInterval(t));

    // 电量
    const batEl = slot.querySelector('.ggg-status-bat');
    const pctEl = slot.querySelector('.ggg-status-bat-pct');
    const iconEl = batEl.querySelector('i');
    if (typeof navigator.getBattery === 'function') {
        navigator.getBattery().then((bat) => {
            const update = () => {
                const lvl = Math.round(bat.level * 100);
                pctEl.textContent = `${lvl}%`;
                iconEl.className = 'ggg-fa fa-solid '
                    + (lvl > 80 ? 'fa-battery-full'
                    : lvl > 55 ? 'fa-battery-three-quarters'
                    : lvl > 30 ? 'fa-battery-half'
                    : lvl > 10 ? 'fa-battery-quarter'
                    : 'fa-battery-empty');
                iconEl.style.color = bat.charging ? '#4ade80'
                    : (lvl <= 15 ? '#ef4444' : '');
            };
            update();
            bat.addEventListener('levelchange', update);
            bat.addEventListener('chargingchange', update);
            _cleanups.push(() => {
                bat.removeEventListener('levelchange', update);
                bat.removeEventListener('chargingchange', update);
            });
        }).catch(() => { batEl.style.display = 'none'; });
    } else {
        batEl.style.display = 'none';
    }
}

export function unmountStatusBar() {
    _cleanups.forEach(fn => { try { fn(); } catch {} });
    _cleanups = [];
}
