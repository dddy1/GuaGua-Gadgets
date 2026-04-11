/**
 * 字体 IndexedDB 存储模块
 * - 将字体二进制数据存储在浏览器本地 IndexedDB 中
 * - 支持存/取/删/遍历
 * - v2：同步存储字体元数据，便于在 extension_settings 丢失后恢复
 */

const DB_NAME = 'ggg-fonts';
const STORE_NAME = 'fontFiles';
const DB_VERSION = 2;

/** 打开（或初始化/升级）数据库 */
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
            // v2 升级：objectStore 已存在时无需操作（metadata 字段在 put 时自然写入）
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

/**
 * 保存字体二进制数据及元数据
 * @param {string} id - 字体唯一 ID
 * @param {ArrayBuffer} arrayBuffer - 字体二进制数据
 * @param {string} filename - 原始文件名
 * @param {string} format - 字体格式（truetype / opentype / woff / woff2）
 * @param {object} [metadata] - 字体元数据（name / zhName / fontFaceName 等），用于恢复
 */
export async function saveFontData(id, arrayBuffer, filename, format, metadata = null) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({
            id,
            data: arrayBuffer,
            filename,
            format,
            size: arrayBuffer.byteLength,
            savedAt: Date.now(),
            metadata: metadata || null,
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = (e) => { db.close(); reject(e.target.error); };
    });
}

/** 读取字体二进制数据（含元数据） */
export async function getFontData(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(id);
        req.onsuccess = () => { db.close(); resolve(req.result || null); };
        req.onerror = (e) => { db.close(); reject(e.target.error); };
    });
}

/** 删除指定字体数据 */
export async function deleteFontData(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = (e) => { db.close(); reject(e.target.error); };
    });
}

/** 获取所有已存储的字体记录（含二进制数据和元数据） */
export async function getAllFontData() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => { db.close(); resolve(req.result || []); };
        req.onerror = (e) => { db.close(); reject(e.target.error); };
    });
}

/** 清空所有字体数据 */
export async function clearAllFontData() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = (e) => { db.close(); reject(e.target.error); };
    });
}
