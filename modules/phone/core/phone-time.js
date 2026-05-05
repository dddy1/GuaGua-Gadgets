/**
 * 手机时间源
 * - local：跟随浏览器本地时间
 * - custom：进入手机时从最新匹配楼层解析一个锚点时间，之后按真实流逝推进
 */
import { settings, saveAllSettings } from '../../../index.js';

const DEFAULT_TIME = {
    mode: 'local',
    pattern: '',
    dateGroup: '1',
    timeGroup: '2',
    weekGroup: '',
    weatherGroup: '',
};

let _anchor = null;
let _lastScanKey = '';

export function ensurePhoneTimeSettings() {
    if (!settings.phone) settings.phone = {};
    if (!settings.phone.time || typeof settings.phone.time !== 'object') settings.phone.time = {};
    const t = settings.phone.time;
    Object.entries(DEFAULT_TIME).forEach(([k, v]) => {
        if (typeof t[k] !== 'string') t[k] = v;
    });
    if (t.mode !== 'custom') t.mode = 'local';
    if (!t.state || typeof t.state !== 'object') t.state = null;
    return t;
}

export function getPhoneTimeSettings() {
    return ensurePhoneTimeSettings();
}

export function setPhoneTimeMode(mode, { save = true, scan = true } = {}) {
    const t = ensurePhoneTimeSettings();
    t.mode = mode === 'custom' ? 'custom' : 'local';
    if (t.mode === 'local') {
        _anchor = null;
        _lastScanKey = '';
        t.state = null;
    } else if (scan) {
        scanCustomPhoneTimeFromLatest({ force: true });
    }
    if (save) saveAllSettings();
    window.dispatchEvent(new CustomEvent('ggg-phone-time-change', { detail: getPhoneTimeSnapshot() }));
}

export function savePhoneTimeSettings(patch = {}) {
    const t = ensurePhoneTimeSettings();
    Object.assign(t, patch);
    if (t.mode !== 'custom') t.mode = 'local';
    if (patch.pattern != null || patch.dateGroup != null || patch.timeGroup != null || patch.weekGroup != null || patch.weatherGroup != null) {
        _anchor = null;
        _lastScanKey = '';
        if (t.mode === 'custom') scanCustomPhoneTimeFromLatest({ force: true });
    }
    saveAllSettings();
    window.dispatchEvent(new CustomEvent('ggg-phone-time-change', { detail: getPhoneTimeSnapshot() }));
}

export function getPhoneNow() {
    const t = ensurePhoneTimeSettings();
    if (t.mode === 'custom' && !_anchor) hydrateAnchorFromState(t);
    if (t.mode !== 'custom' || !_anchor) return new Date();
    return new Date(_anchor.baseMs + (Date.now() - _anchor.realBaseMs));
}

export function getPhoneTimeISO() {
    return getPhoneNow().toISOString();
}

export function getPhoneTimeSnapshot() {
    const now = getPhoneNow();
    const sameAnchorDay = _anchor && sameLocalDate(now, new Date(_anchor.baseMs));
    return {
        mode: ensurePhoneTimeSettings().mode,
        now,
        iso: now.toISOString(),
        week: sameAnchorDay && _anchor.week ? _anchor.week : weekText(now),
        date: `${now.getMonth() + 1}月${now.getDate()}日`,
        weather: _anchor?.weather || '',
        matched: _anchor?.matched || '',
        floor: _anchor?.floor ?? -1,
    };
}

export function scanCustomPhoneTimeFromLatest({ force = false } = {}) {
    const conf = ensurePhoneTimeSettings();
    hydrateAnchorFromState(conf);
    if (conf.mode !== 'custom') return null;
    const pattern = String(conf.pattern || '').trim();
    if (!pattern) {
        _anchor = null;
        conf.state = null;
        return null;
    }

    const chat = readChat();
    const key = [
        pattern, conf.dateGroup, conf.timeGroup, conf.weekGroup, conf.weatherGroup,
        chat.length, readMessageText(chat[chat.length - 1]).slice(0, 160),
    ].join('\u0001');
    if (!force && _anchor && _lastScanKey === key) return _anchor;
    _lastScanKey = key;

    const re = makeRegex(pattern);
    if (!re) {
        _anchor = null;
        return null;
    }

    for (let i = chat.length - 1; i >= 0; i--) {
        const text = readMessageText(chat[i]);
        if (!text) continue;
        const match = re.exec(text);
        if (!match) continue;
        const parsed = parseMatch(match, conf);
        if (!parsed) continue;
        const sourceKey = makeSourceKey(conf, match[0]);
        if (_anchor?.sourceKey === sourceKey) {
            _anchor.floor = i;
            _anchor.matched = match[0];
            _anchor.week = parsed.week || _anchor.week || '';
            _anchor.weather = parsed.weather || _anchor.weather || '';
            persistAnchor(conf, _anchor, { save: false });
            return _anchor;
        }
        _anchor = {
            baseMs: parsed.date.getTime(),
            realBaseMs: Date.now(),
            sourceKey,
            week: parsed.week,
            weather: parsed.weather,
            matched: match[0],
            floor: i,
        };
        persistAnchor(conf, _anchor, { save: true });
        return _anchor;
    }

    _anchor = null;
    conf.state = null;
    return null;
}

export function registerPhoneTimeMacro() {
    try {
        const ctx = (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null;
        if (typeof ctx?.registerMacro === 'function') {
            ctx.registerMacro('phone_time', () => getPhoneTimeISO(), '呱呱手机当前时间');
        }
    } catch (e) {
        console.warn('[ggg-phone-time] 注册 phone_time 宏失败', e);
    }
}

function readChat() {
    try {
        const ctx = (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null;
        return Array.isArray(ctx?.chat) ? ctx.chat : [];
    } catch {
        return [];
    }
}

function readMessageText(m) {
    return String(m?.mes ?? m?.message ?? '').trim();
}

function makeRegex(input) {
    try {
        const s = String(input || '').trim();
        const slash = s.match(/^\/([\s\S]*)\/([a-z]*)$/i);
        if (slash) {
            const flags = slash[2].replace(/[gy]/g, '');
            return new RegExp(slash[1], flags);
        }
        return new RegExp(s, 'm');
    } catch (e) {
        console.warn('[ggg-phone-time] 时间正则无效', e);
        return null;
    }
}

function makeSourceKey(conf, matched) {
    return [
        String(conf.pattern || '').trim(),
        conf.dateGroup || '',
        conf.timeGroup || '',
        conf.weekGroup || '',
        conf.weatherGroup || '',
        String(matched || ''),
    ].join('\u0001');
}

function hydrateAnchorFromState(conf = ensurePhoneTimeSettings()) {
    if (_anchor) return _anchor;
    const s = conf?.state;
    if (!s || typeof s !== 'object') return null;
    const baseMs = Number(s.baseMs);
    const realBaseMs = Number(s.realBaseMs);
    if (!Number.isFinite(baseMs) || !Number.isFinite(realBaseMs)) return null;
    _anchor = {
        baseMs,
        realBaseMs,
        sourceKey: String(s.sourceKey || ''),
        week: String(s.week || ''),
        weather: String(s.weather || ''),
        matched: String(s.matched || ''),
        floor: Number.isInteger(Number(s.floor)) ? Number(s.floor) : -1,
    };
    return _anchor;
}

function persistAnchor(conf, anchor, { save = false } = {}) {
    conf.state = {
        baseMs: Number(anchor.baseMs),
        realBaseMs: Number(anchor.realBaseMs),
        sourceKey: String(anchor.sourceKey || ''),
        week: String(anchor.week || ''),
        weather: String(anchor.weather || ''),
        matched: String(anchor.matched || ''),
        floor: Number.isInteger(Number(anchor.floor)) ? Number(anchor.floor) : -1,
    };
    if (save) saveAllSettings();
}

function groupValue(match, key) {
    const k = String(key || '').trim();
    if (!k) return '';
    if (/^\d+$/.test(k)) return String(match[Number(k)] ?? '').trim();
    return String(match.groups?.[k] ?? '').trim();
}

function parseMatch(match, conf) {
    const dateText = groupValue(match, conf.dateGroup);
    const timeText = groupValue(match, conf.timeGroup);
    if (!dateText || !timeText) return null;
    const dateParts = parseDateParts(dateText);
    const timeParts = parseTimeParts(timeText);
    if (!dateParts || !timeParts) return null;
    const d = new Date(dateParts.y, dateParts.m - 1, dateParts.d, timeParts.h, timeParts.min, timeParts.s || 0, 0);
    if (Number.isNaN(d.getTime())) return null;
    return {
        date: d,
        week: groupValue(match, conf.weekGroup),
        weather: groupValue(match, conf.weatherGroup),
    };
}

function normalizeDigits(s) {
    return String(s || '').replace(/[０-９]/g, ch => String(ch.charCodeAt(0) - 0xff10));
}

function parseDateParts(raw) {
    const s = normalizeDigits(raw).trim();
    const now = new Date();
    let m = s.match(/(\d{4})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})/);
    if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
    m = s.match(/^(\d{1,2})\s*[-.]\s*(\d{1,2})\s*[-.]\s*(\d{4})$/);
    if (m) return { y: Number(m[3]), m: Number(m[2]), d: Number(m[1]) };
    m = s.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/);
    if (m) {
        const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
        return a > 12 ? { y, m: b, d: a } : { y, m: a, d: b };
    }
    m = s.match(/(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})/);
    if (m) return { y: now.getFullYear(), m: Number(m[1]), d: Number(m[2]) };
    return null;
}

function parseTimeParts(raw) {
    const s = normalizeDigits(raw).trim();
    const pm = /(下午|晚上|夜里|傍晚|pm)/i.test(s);
    const am = /(上午|早上|凌晨|am)/i.test(s);
    const m = s.match(/(\d{1,2})(?:\s*[:：点时]\s*(\d{1,2}))?(?:\s*[:：分]\s*(\d{1,2}))?/);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2] || 0);
    const sec = Number(m[3] || 0);
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;
    if (h > 23 || min > 59 || sec > 59) return null;
    return { h, min, s: sec };
}

function weekText(d) {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
}

function sameLocalDate(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}
