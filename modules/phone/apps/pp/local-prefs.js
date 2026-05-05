/**
 * PP 本地偏好存储。
 * 颜色、气泡、字体、聊天背景属于 PP 内部表现，不写入 SillyTavern settings.json。
 */
const STORAGE_KEY = 'ggg-phone-pp-local-prefs-v1';

function clonePlain(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

function emptyPrefs() {
    return {
        appearanceByPersona: {},
        contactExtByKey: {},
    };
}

export function readPPLocalPrefs() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return {
            ...emptyPrefs(),
            ...(parsed && typeof parsed === 'object' ? parsed : {}),
            appearanceByPersona: parsed?.appearanceByPersona && typeof parsed.appearanceByPersona === 'object'
                ? parsed.appearanceByPersona
                : {},
            contactExtByKey: parsed?.contactExtByKey && typeof parsed.contactExtByKey === 'object'
                ? parsed.contactExtByKey
                : {},
        };
    } catch {
        return emptyPrefs();
    }
}

function writePPLocalPrefs(prefs) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...emptyPrefs(),
        ...clonePlain(prefs),
    }));
}

export function readLocalAppearance(personaKey) {
    const key = personaKey || '__none__';
    return readPPLocalPrefs().appearanceByPersona[key] || null;
}

export function writeLocalAppearance(personaKey, appearance) {
    const key = personaKey || '__none__';
    const prefs = readPPLocalPrefs();
    prefs.appearanceByPersona[key] = clonePlain(appearance);
    writePPLocalPrefs(prefs);
}

export function readLocalContactExt(key) {
    return key ? (readPPLocalPrefs().contactExtByKey[key] || null) : null;
}

export function writeLocalContactExt(key, patch) {
    if (!key) return;
    const prefs = readPPLocalPrefs();
    prefs.contactExtByKey[key] = {
        ...(prefs.contactExtByKey[key] || {}),
        ...clonePlain(patch),
    };
    writePPLocalPrefs(prefs);
}
