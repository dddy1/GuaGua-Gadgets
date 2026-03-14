/**
 * 图库模块
 */
import { getSettings, saveAllSettings } from '../../index.js';

let galleryImages = [];

export function initGallery() {
  const settings = getSettings();
  galleryImages = settings.gallery || [];

  renderGalleryPanel();
  initGalleryEvents();
  refreshGalleryGrid();

  // 监听上传请求（来自 ui-custom 模块）
  document.addEventListener('ggg-upload-request', async e => {
    const { files, callback } = e.detail;
    let count = 0;
    for (const file of files) {
      try {
        await uploadToGGG(file, 'gallery');
        count++;
      } catch (err) {
        console.error('[ggg] 上传失败:', err);
        toastr.error(`上传失败: ${file.name}`);
      }
    }
    saveAllSettings();
    if (count > 0) toastr.success(`已上传 ${count} 张图片`);
    refreshGalleryGrid();
    if (callback) callback();
  });
}

export function getGalleryImages() {
  return galleryImages;
}

// 新增：tag分组功能
function renderGalleryPanel() {
  const panel = document.getElementById('ggg-panel-gallery');
  if (!panel || panel.querySelector('#ggg-gallery-subtabs')) return;

  panel.innerHTML = `
        <div id="ggg-gallery-subtabs">
            <div class="ggg-gallery-subtab active" data-gallery-tab="gallery"><i class="ggg-fa fa-solid fa-images"></i> 图库</div>
            <div class="ggg-gallery-subtab" data-gallery-tab="sticker"><i class="ggg-fa fa-solid fa-face-smile"></i> 表情包</div>
        </div>
        <div id="ggg-gallery-panel-gallery" class="ggg-gallery-panel active">
            <div class="ggg-gallery-toolbar-row">
                <span class="ggg-gallery-count" id="ggg-gallery-count">0 张图片</span>
                <div id="ggg-btn-upload-gallery" class="menu_button menu_button_icon ggg-btn-small" title="上传图片"><i class="ggg-fa fa-solid fa-upload"></i> 上传</div>
                <div id="ggg-gallery-tag-filter"></div>
            </div>
            <div id="ggg-gallery-grid"></div>
            <div id="ggg-no-gallery" class="ggg-empty-state">
                <div class="ggg-empty-icon"><i class="ggg-fa fa-solid fa-images"></i></div>
                <div>还没有上传图片</div>
                <div class="ggg-empty-hint">点击上方"上传"按钮添加图片</div>
            </div>
        </div>
        <div id="ggg-gallery-panel-sticker" class="ggg-gallery-panel">
            <div class="ggg-empty-state">
                <div class="ggg-empty-icon"><i class="ggg-fa fa-solid fa-face-smile"></i></div>
                <div>表情包功能 - 开发中</div>
            </div>
        </div>`;
}

function initGalleryEvents() {
  document.querySelectorAll('.ggg-gallery-subtab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ggg-gallery-subtab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.ggg-gallery-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`ggg-gallery-panel-${tab.dataset.galleryTab}`)?.classList.add('active');
    });
  });

  document.getElementById('ggg-btn-upload-gallery')?.addEventListener('click', () => {
    triggerUpload('gallery', () => refreshGalleryGrid());
  });
}

function triggerUpload(type, callback) {
  const fileInput = document.getElementById('ggg-file-input');
  if (!fileInput) return;
  const handler = async e => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    let count = 0;
    for (const file of files) {
      try {
        await uploadToGGG(file, type);
        count++;
      } catch (err) {
        console.error('[ggg] 上传失败:', err);
        toastr.error(`上传失败: ${file.name}`);
      }
    }
    fileInput.value = '';
    fileInput.removeEventListener('change', handler);
    saveAllSettings();
    if (count > 0) toastr.success(`已上传 ${count} 张图片`);
    if (callback) callback();
  };
  fileInput.addEventListener('change', handler);
  fileInput.click();
}

async function uploadToGGG(file, type = 'gallery') {
  const prefix = `ggg_${type}_${Date.now()}_`;
  const filename = prefix + file.name;
  const formData = new FormData();
  formData.append('avatar', file, filename);
  const headers = {};
  const origH = SillyTavern.getContext().getRequestHeaders();
  for (const [k, v] of Object.entries(origH)) {
    if (k.toLowerCase() !== 'content-type') headers[k] = v;
  }
  const resp = await fetch('/api/backgrounds/upload', { method: 'POST', headers, body: formData });
  if (!resp.ok) throw new Error(`上传失败: ${resp.status}`);
  const url = `/backgrounds/${filename}`;
  galleryImages.push({ name: file.name, url, filename, timestamp: Date.now(), tags: [] });
  const settings = getSettings();
  settings.gallery = galleryImages;
  return url;
}

function refreshGalleryGrid(selectedTag = null) {
  const grid = document.getElementById('ggg-gallery-grid');
  const empty = document.getElementById('ggg-no-gallery');
  const countEl = document.getElementById('ggg-gallery-count');
  if (!grid) return;

  if (countEl) countEl.textContent = `${galleryImages.length} 张图片`;

  // tag分组
  const allTags = Array.from(new Set(galleryImages.flatMap(img => img.tags || [])));
  const tagFilter = document.getElementById('ggg-gallery-tag-filter');
  if (tagFilter) {
    tagFilter.innerHTML = allTags
      .map(tag => `<span class="ggg-gallery-tag-filter-btn${selectedTag === tag ? ' active' : ''}" data-tag="${escapeAttr(tag)}">${escapeHtml(tag)}</span>`)
      .join('');
    tagFilter.querySelectorAll('.ggg-gallery-tag-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (selectedTag === btn.dataset.tag) refreshGalleryGrid(null); // 再次点击取消选择
        else refreshGalleryGrid(btn.dataset.tag);
      });
    });
  }

  // 多选、全选按钮
  const toolbar = document.querySelector('.ggg-gallery-toolbar-row');
  if (toolbar && !toolbar.querySelector('.ggg-gallery-multiselect-btn')) {
    toolbar.insertAdjacentHTML('beforeend', `
      <div style="display:flex;gap:4px;">
        <button class="ggg-gallery-multiselect-btn menu_button ggg-btn-small">多选</button>
        <button class="ggg-gallery-selectall-btn menu_button ggg-btn-small">全选</button>
      </div>
    `);
    toolbar.querySelector('.ggg-gallery-multiselect-btn').addEventListener('click', () => {
      document.querySelectorAll('.ggg-gallery-item').forEach(item => item.classList.toggle('selected'));
    });
    toolbar.querySelector('.ggg-gallery-selectall-btn').addEventListener('click', () => {
      document.querySelectorAll('.ggg-gallery-item').forEach(item => item.classList.add('selected'));
    });
  }

  let imgs = galleryImages;
  if (selectedTag) imgs = imgs.filter(img => (img.tags || []).includes(selectedTag));

  if (imgs.length === 0) {
    grid.innerHTML = '';
    grid.style.display = 'none';
    if (empty) empty.style.display = '';
    return;
  }

  grid.style.display = '';
  if (empty) empty.style.display = 'none';

  grid.innerHTML = imgs
    .map(
      (img, i) => `
        <div class="ggg-gallery-item" style="background-image: url('${escapeAttr(img.url)}')" data-index="${i}">
            <button class="ggg-gallery-delete" data-index="${i}" title="删除"><i class="ggg-fa fa-solid fa-xmark"></i></button>
            <div class="ggg-gallery-item-name" title="${escapeAttr(img.name)}">${escapeHtml(img.name)}</div>
            <div class="ggg-gallery-item-tags">${(img.tags || [])
              .map(t => `<span class='ggg-gallery-tag'>${escapeHtml(t)}</span>`)
              .join('')}</div>
        </div>
    `,
    )
    .join('');

  // 新增：点击图片弹窗编辑tag，长按多选
  let multiSelect = new Set();
  let longPressTimer = null;
  grid.querySelectorAll('.ggg-gallery-item').forEach(item => {
    const idx = parseInt(item.dataset.index);
    item.addEventListener('mousedown', e => {
      longPressTimer = setTimeout(() => {
        item.classList.toggle('selected');
        if (item.classList.contains('selected')) multiSelect.add(idx);
        else multiSelect.delete(idx);
      }, 400);
    });
    item.addEventListener('mouseup', e => {
      clearTimeout(longPressTimer);
    });
    item.addEventListener('mouseleave', e => {
      clearTimeout(longPressTimer);
    });
    item.addEventListener('click', async e => {
      const { callGenericPopup, POPUP_TYPE } = SillyTavern.getContext();
      if (multiSelect.size > 0) {
        // 批量操作弹窗
        let tagHtml = allTags.map(t => `<label style='margin-right:8px;'><input type='checkbox' value='${escapeAttr(t)}'>${escapeHtml(t)}</label>`).join('');
        const popupHtml = `<div>批量添加标签（逗号分隔或勾选）：<div style='margin-top:8px;'>${tagHtml}</div></div><div style='margin-top:12px;'><button id='ggg-gallery-batch-del-btn' style='color:#fff;background:#a33;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;'>批量删除图片</button></div>`;
        const tagStr = await callGenericPopup(popupHtml, POPUP_TYPE.INPUT, '', { rows: 1 });
        let tags = [];
        if (tagStr && tagStr.trim()) tags = tagStr.split(',').map(t => t.trim()).filter(Boolean);
        document.querySelectorAll('.popup input[type=checkbox]:checked').forEach(chk => tags.push(chk.value));
        tags = Array.from(new Set(tags));
        if (tags.length > 0) {
          multiSelect.forEach(idx => {
            const img = galleryImages[idx];
            img.tags = Array.from(new Set([...(img.tags || []), ...tags]));
          });
          saveAllSettings();
          refreshGalleryGrid(selectedTag);
          toastr.success('已批量添加标签');
        }
        // 批量删除按钮
        setTimeout(() => {
          const delBtn = document.getElementById('ggg-gallery-batch-del-btn');
          if (delBtn) {
            delBtn.onclick = async () => {
              const delIdxs = Array.from(multiSelect);
              for (const i of delIdxs.sort((a, b) => b - a)) {
                const img = galleryImages[i];
                if (img?.filename) {
                  try {
                    await fetch('/api/backgrounds/delete', {
                      method: 'POST',
                      headers: SillyTavern.getContext().getRequestHeaders(),
                      body: JSON.stringify({ bg: img.filename }),
                    });
                  } catch (err) { console.warn('[ggg] 删除服务器文件失败:', err); }
                }
                galleryImages.splice(i, 1);
              }
              const settings = getSettings();
              settings.gallery = galleryImages;
              saveAllSettings();
              refreshGalleryGrid(selectedTag);
              toastr.success('已批量删除图片');
              multiSelect.clear();
              grid.querySelectorAll('.ggg-gallery-item.selected').forEach(el => el.classList.remove('selected'));
            };
          }
        }, 100);
        multiSelect.clear();
        grid.querySelectorAll('.ggg-gallery-item.selected').forEach(el => el.classList.remove('selected'));
        return;
      }
      // 单个图片弹窗
      const img = galleryImages[idx];
      let tagHtml = (img.tags || []).map(t => `<span class='ggg-gallery-tag' data-tag-del='${escapeAttr(t)}' style='margin-right:4px;background:#a33;color:#fff;cursor:pointer;'>${escapeHtml(t)} <i class='ggg-fa fa-solid fa-xmark'></i></span>`).join('');
      tagHtml += '<div style="margin-top:8px;">' + allTags.map(t => `<label style='margin-right:8px;'><input type='checkbox' value='${escapeAttr(t)}'>${escapeHtml(t)}</label>`).join('') + '</div>';
      const tagStr = await callGenericPopup(`编辑图片标签（逗号分隔或勾选）：<div style='margin-top:8px;'>${tagHtml}</div>`, POPUP_TYPE.INPUT, (img.tags || []).join(','), { rows: 1 });
      let tags = [];
      if (tagStr !== null) {
        if (tagStr.trim()) tags = tagStr.split(',').map(t => t.trim()).filter(Boolean);
        document.querySelectorAll('.popup input[type=checkbox]:checked').forEach(chk => tags.push(chk.value));
        tags = Array.from(new Set(tags));
        img.tags = tags;
        saveAllSettings();
        refreshGalleryGrid(selectedTag);
        toastr.success('已更新标签');
      }
      // 删除tag功能
      setTimeout(() => {
        document.querySelectorAll('.popup .ggg-gallery-tag').forEach(tagEl => {
          tagEl.onclick = () => {
            const delTag = tagEl.dataset.tagDel;
            img.tags = (img.tags || []).filter(t => t !== delTag);
            saveAllSettings();
            refreshGalleryGrid(selectedTag);
            toastr.success('已删除标签');
          };
        });
      }, 100);
    });
  });
  grid.querySelectorAll('.ggg-gallery-delete').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      if (multiSelect.size > 0) {
        // 批量删除
        const delIdxs = Array.from(multiSelect);
        for (const i of delIdxs.sort((a, b) => b - a)) {
          const img = galleryImages[i];
          if (img?.filename) {
            try {
              await fetch('/api/backgrounds/delete', {
                method: 'POST',
                headers: SillyTavern.getContext().getRequestHeaders(),
                body: JSON.stringify({ bg: img.filename }),
              });
            } catch (err) {
              console.warn('[ggg] 删除服务器文件失败:', err);
            }
          }
          galleryImages.splice(i, 1);
        }
        const settings = getSettings();
        settings.gallery = galleryImages;
        saveAllSettings();
        refreshGalleryGrid(selectedTag);
        toastr.success('已批量删除图片');
        multiSelect.clear();
        grid.querySelectorAll('.ggg-gallery-item.selected').forEach(el => el.classList.remove('selected'));
        return;
      }
      // 单个删除
      const img = galleryImages[idx];
      if (img?.filename) {
        try {
          await fetch('/api/backgrounds/delete', {
            method: 'POST',
            headers: SillyTavern.getContext().getRequestHeaders(),
            body: JSON.stringify({ bg: img.filename }),
          });
        } catch (err) {
          console.warn('[ggg] 删除服务器文件失败:', err);
        }
      }
      galleryImages.splice(idx, 1);
      const settings = getSettings();
      settings.gallery = galleryImages;
      saveAllSettings();
      refreshGalleryGrid(selectedTag);
      toastr.success('已删除图片');
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
function escapeAttr(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
