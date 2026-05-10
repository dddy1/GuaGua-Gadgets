/**
 * 移动端调试面板
 * 实时显示视口、焦点元素、布局信息，用于定位 textarea 消失和自动填充栏错位问题。
 * 临时模块，问题修复后删除。
 */

const PANEL_ID = 'ggg-debug-panel';
const LOG_MAX = 80;
let _mounted = false;
let _logs = [];
let _cleanups = [];

function getViewportInfo() {
    const vv = window.visualViewport;
    return {
        innerW: window.innerWidth,
        innerH: window.innerHeight,
        vvW: vv ? Math.round(vv.width) : '-',
        vvH: vv ? Math.round(vv.height) : '-',
        vvOffsetTop: vv ? Math.round(vv.offsetTop) : '-',
        vvOffsetLeft: vv ? Math.round(vv.offsetLeft) : '-',
        vvScale: vv?.scale ?? '-',
        docElScrollTop: Math.round(document.documentElement.scrollTop),
        bodyScrollTop: Math.round(document.body.scrollTop),
        docElScrollLeft: Math.round(document.documentElement.scrollLeft),
        bodyScrollLeft: Math.round(document.body.scrollLeft),
        fullscreen: !!(document.fullscreenElement || document.webkitFullscreenElement),
    };
}

function getElementInfo(el) {
    if (!el) return null;
    const tag = el.tagName?.toLowerCase() || '?';
    const id = el.id ? '#' + el.id : '';
    const cls = el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
        : '';
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    return {
        sel: tag + id + cls,
        rect: { t: Math.round(rect.top), l: Math.round(rect.left), w: Math.round(rect.width), h: Math.round(rect.height) },
        position: cs.position,
        zIndex: cs.zIndex,
        visibility: cs.visibility,
        display: cs.display,
        transform: cs.transform === 'none' ? '-' : cs.transform.slice(0, 40),
        overflow: cs.overflow,
        opacity: cs.opacity,
    };
}

function getAncestorChain(el, maxDepth = 8) {
    const chain = [];
    let cur = el?.parentElement;
    let depth = 0;
    while (cur && depth < maxDepth) {
        const cs = window.getComputedStyle(cur);
        const tag = cur.tagName.toLowerCase();
        const id = cur.id ? '#' + cur.id : '';
        chain.push(tag + id + ' [' + cs.position + '/' + cs.visibility + '/' + cs.display + '/' + cs.overflow + (cs.transform !== 'none' ? '/TF' : '') + ']');
        cur = cur.parentElement;
        depth++;
    }
    return chain;
}

function addLog(type, msg) {
    const now = new Date();
    const ts = String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0') + '.' + String(now.getMilliseconds()).padStart(3, '0');
    _logs.push({ ts, type, msg });
    if (_logs.length > LOG_MAX) _logs.shift();
    renderLogs();
}

// 生成纯文本版本用于复制
function logsToText() {
    const infoEl = document.getElementById('ggg-debug-info');
    const infoText = infoEl ? infoEl.innerText : '';
    const logText = _logs.map(l => l.ts + ' [' + l.type + '] ' + l.msg.replace(/<[^>]*>/g, '')).join('\n');
    return '=== GGG DEBUG INFO ===\n' + infoText + '\n\n=== GGG DEBUG LOG ===\n' + logText;
}

function renderLogs() {
    const logEl = document.getElementById('ggg-debug-log');
    if (!logEl) return;
    logEl.innerHTML = _logs.map(function (l) {
        return '<div class="ggg-dbg-line"><span class="ggg-dbg-ts">' + l.ts + '</span> <span class="ggg-dbg-type">[' + l.type + ']</span> ' + l.msg + '</div>';
    }).join('');
    logEl.scrollTop = logEl.scrollHeight;
}

function renderInfo() {
    const infoEl = document.getElementById('ggg-debug-info');
    if (!infoEl) return;
    const vp = getViewportInfo();
    const activeEl = document.activeElement;
    const activeInfo = getElementInfo(activeEl);

    const lines = [];
    lines.push('Viewport ' + vp.innerW + 'x' + vp.innerH + ' | VV ' + vp.vvW + 'x' + vp.vvH + ' off(' + vp.vvOffsetTop + ',' + vp.vvOffsetLeft + ') s=' + vp.vvScale);
    lines.push('Scroll docEl(' + vp.docElScrollTop + ',' + vp.docElScrollLeft + ') body(' + vp.bodyScrollTop + ',' + vp.bodyScrollLeft + ') | FS=' + vp.fullscreen);

    const htmlCS = window.getComputedStyle(document.documentElement);
    const bodyCS = window.getComputedStyle(document.body);
    lines.push('html ov=' + htmlCS.overflow + ' ovx=' + htmlCS.overflowX + ' ovy=' + htmlCS.overflowY + ' pos=' + htmlCS.position);
    lines.push('body ov=' + bodyCS.overflow + ' ovx=' + bodyCS.overflowX + ' ovy=' + bodyCS.overflowY + ' pos=' + bodyCS.position);

    const vpMeta = document.querySelector('meta[name="viewport"]');
    if (vpMeta) lines.push('meta[viewport] ' + vpMeta.content);

    if (activeInfo) {
        lines.push('Focus ' + activeInfo.sel + ' rect(' + activeInfo.rect.t + ',' + activeInfo.rect.l + ',' + activeInfo.rect.w + 'x' + activeInfo.rect.h + ') pos=' + activeInfo.position + ' z=' + activeInfo.zIndex + ' vis=' + activeInfo.visibility + ' disp=' + activeInfo.display + (activeInfo.transform !== '-' ? ' tf=' + activeInfo.transform : ''));
    }
    infoEl.innerText = lines.join('\n');
}

function listen(target, event, handler, opts) {
    target.addEventListener(event, handler, opts);
    _cleanups.push(function () { target.removeEventListener(event, handler, opts); });
}

export function mountDebugPanel() {
    if (_mounted) return;
    _mounted = true;
    _logs = [];

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = [
        '<style>',
        '#ggg-debug-panel { position:fixed; z-index:2147483647; bottom:0; left:0; right:0; max-height:45vh; background:rgba(0,0,0,0.92); color:#0f0; font:10px/1.4 monospace; display:flex; flex-direction:column; pointer-events:auto; }',
        '#ggg-debug-panel .ggg-dbg-bar { display:flex; gap:4px; padding:4px 6px; border-bottom:1px solid #333; flex-shrink:0; flex-wrap:wrap; }',
        '#ggg-debug-panel .ggg-dbg-bar button { font:10px monospace; background:#333; color:#0f0; border:1px solid #555; border-radius:3px; padding:2px 6px; cursor:pointer; -webkit-tap-highlight-color:transparent; }',
        '#ggg-debug-panel #ggg-debug-info { padding:4px 6px; border-bottom:1px solid #333; flex-shrink:0; max-height:25vh; overflow-y:auto; white-space:pre-wrap; word-break:break-all; user-select:text; -webkit-user-select:text; }',
        '#ggg-debug-panel #ggg-debug-log { flex:1; overflow-y:auto; padding:4px 6px; min-height:60px; user-select:text; -webkit-user-select:text; }',
        '#ggg-debug-panel .ggg-dbg-line { border-bottom:1px solid #1a1a1a; padding:1px 0; word-break:break-all; }',
        '#ggg-debug-panel .ggg-dbg-ts { color:#888; }',
        '#ggg-debug-panel .ggg-dbg-type { color:#ff0; }',
        '#ggg-debug-panel .ggg-dbg-ok { color:#0f0; }',
        '</style>',
        '<div class="ggg-dbg-bar">',
        '  <button id="ggg-dbg-refresh">刷新</button>',
        '  <button id="ggg-dbg-focus-dump">Dump焦点链</button>',
        '  <button id="ggg-dbg-copy">复制全部</button>',
        '  <button id="ggg-dbg-clear">清空</button>',
        '  <button id="ggg-dbg-close">关闭</button>',
        '</div>',
        '<div id="ggg-debug-info"></div>',
        '<div id="ggg-debug-log"></div>',
    ].join('\n');
    document.body.appendChild(panel);

    panel.querySelector('#ggg-dbg-refresh').onclick = function () { renderInfo(); };
    panel.querySelector('#ggg-dbg-clear').onclick = function () { _logs = []; renderLogs(); };
    panel.querySelector('#ggg-dbg-close').onclick = function () { unmountDebugPanel(); };

    panel.querySelector('#ggg-dbg-copy').onclick = function () {
        const text = logsToText();
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                addLog('SYS', '<span class="ggg-dbg-ok">已复制到剪贴板</span>');
            }, function () {
                fallbackCopy(text);
            });
        } else {
            fallbackCopy(text);
        }
    };

    panel.querySelector('#ggg-dbg-focus-dump').onclick = function () {
        const el = document.activeElement;
        if (!el || el === document.body) { addLog('DUMP', '无焦点元素'); return; }
        const info = getElementInfo(el);
        addLog('DUMP', info.sel + ' rect(' + info.rect.t + ',' + info.rect.l + ',' + info.rect.w + 'x' + info.rect.h + ') pos=' + info.position + ' z=' + info.zIndex + ' vis=' + info.visibility);
        var chain = getAncestorChain(el, 8);
        chain.forEach(function (c, i) { addLog('DUMP', repeat('  ', i + 1) + '↑ ' + c); });
    };

    // 实时监听
    listen(document, 'focusin', function (e) {
        const info = getElementInfo(e.target);
        if (!info) return;
        addLog('FOCUS', info.sel + ' rect(' + info.rect.t + ',' + info.rect.l + ',' + info.rect.w + 'x' + info.rect.h + ') pos=' + info.position + ' z=' + info.zIndex + ' vis=' + info.visibility);
        renderInfo();
    }, true);

    listen(document, 'focusout', function (e) {
        const tag = e.target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea') {
            addLog('BLUR', tag + (e.target.id ? '#' + e.target.id : ''));
        }
    }, true);

    listen(window, 'resize', function () {
        const vv = window.visualViewport;
        addLog('RESIZE', 'inner=' + window.innerWidth + 'x' + window.innerHeight + ' vv=' + (vv ? Math.round(vv.width) + 'x' + Math.round(vv.height) : '-') + ' vvOff=' + (vv ? Math.round(vv.offsetTop) : '-'));
        renderInfo();
    }, { passive: true });

    if (window.visualViewport) {
        listen(window.visualViewport, 'resize', function () {
            const vv = window.visualViewport;
            addLog('VV-RSZ', Math.round(vv.width) + 'x' + Math.round(vv.height) + ' off(' + Math.round(vv.offsetTop) + ',' + Math.round(vv.offsetLeft) + ') scale=' + vv.scale);
            renderInfo();
        }, { passive: true });
        listen(window.visualViewport, 'scroll', function () {
            const vv = window.visualViewport;
            addLog('VV-SCR', 'off(' + Math.round(vv.offsetTop) + ',' + Math.round(vv.offsetLeft) + ')');
        }, { passive: true });
    }

    listen(document, 'scroll', function () {
        addLog('SCROLL', 'docEl(' + Math.round(document.documentElement.scrollTop) + ',' + Math.round(document.documentElement.scrollLeft) + ') body(' + Math.round(document.body.scrollTop) + ',' + Math.round(document.body.scrollLeft) + ')');
    }, { passive: true, capture: true });

    listen(document, 'fullscreenchange', function () {
        addLog('FS', String(!!(document.fullscreenElement || document.webkitFullscreenElement)));
        renderInfo();
    });

    renderInfo();
    addLog('INIT', '调试面板已启动 — 点"复制全部"可复制日志');
}

function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); addLog('SYS', '<span class="ggg-dbg-ok">已复制（fallback）</span>'); }
    catch (e) { addLog('SYS', '复制失败: ' + e.message); }
    ta.remove();
}

function repeat(s, n) {
    var r = '';
    for (var i = 0; i < n; i++) r += s;
    return r;
}

export function unmountDebugPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
    _cleanups.forEach(function (fn) { try { fn(); } catch (e) {} });
    _cleanups = [];
    _mounted = false;
}

export function isDebugPanelOpen() {
    return _mounted;
}
