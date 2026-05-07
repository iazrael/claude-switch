const API = '/api';
let presets = {};
let editingProfile = null;

function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

async function fetchJSON(url, opt) {
  const res = await fetch(url, opt);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || '请求失败');
  }
  return res.json();
}

// 加载预设模板
async function loadPresets() {
  presets = await fetchJSON(`${API}/presets`);
  const select = document.getElementById('presetSelect');
  while (select.firstChild) select.removeChild(select.firstChild);
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '-- 手动填写 --';
  select.appendChild(defaultOpt);
  Object.entries(presets).forEach(([key, data]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = data.label;
    select.appendChild(opt);
  });
}

// 应用预设
function applyPreset() {
  const key = document.getElementById('presetSelect').value;
  if (!key || !presets[key]) return;
  const p = presets[key];
  document.getElementById('newBaseUrl').value = p.baseUrl || '';
  document.getElementById('newOpus').value = p.opus || '';
  document.getElementById('newSonnet').value = p.sonnet || '';
  document.getElementById('newHaiku').value = p.haiku || '';
}

// 加载当前环境
async function loadCurrent() {
  try {
    const data = await fetchJSON(`${API}/current`);
    const env = data.env || {};
    const activeProfile = data.activeProfile;
    const mismatch = data.mismatch;

    const keys = Object.keys(env);
    if (keys.length === 0) {
      document.getElementById('currentEnv').textContent = '未配置环境变量';
    } else {
      document.getElementById('currentEnv').textContent = keys.map(k => k + ': ' + env[k]).join('\n');
    }

    // 更新当前套餐名显示
    const currentNameEl = document.getElementById('currentName');
    if (activeProfile) {
      const model = env.ANTHROPIC_DEFAULT_SONNET_MODEL || '';
      let text = activeProfile + (model ? ' (' + model + ')' : '');
      if (mismatch) {
        text += ' ⚠️ 环境已变更';
      }
      currentNameEl.textContent = text;
      currentNameEl.style.color = mismatch ? 'var(--warning)' : 'var(--accent)';
    } else {
      const model = env.ANTHROPIC_DEFAULT_SONNET_MODEL || '';
      currentNameEl.textContent = model ? '未知 (' + model + ')' : '无';
      currentNameEl.style.color = 'var(--accent)';
    }
  } catch (e) {
    document.getElementById('currentEnv').textContent = '加载失败: ' + e.message;
  }
}

// 加载套餐列表
async function loadProfiles() {
  try {
    const data = await fetchJSON(`${API}/profiles`);
    const profiles = data.profiles || {};
    const active = data.active;
    const mismatch = data.mismatch;
    const names = Object.keys(profiles);

    // 更新当前环境变量显示（从 /api/current 获取）
    const currentData = await fetchJSON(`${API}/current`);
    const currentEnv = currentData.env || {};
    const currentEnvKeys = Object.keys(currentEnv);
    if (currentEnvKeys.length === 0) {
      document.getElementById('currentEnv').textContent = '未配置环境变量';
    } else {
      document.getElementById('currentEnv').textContent = currentEnvKeys.map(k => k + ': ' + currentEnv[k]).join('\n');
    }

    // 更新当前套餐名
    const currentNameEl = document.getElementById('currentName');
    if (active) {
      const model = currentEnv.ANTHROPIC_DEFAULT_SONNET_MODEL || '';
      let text = active + (model ? ' (' + model + ')' : '');
      if (mismatch) {
        text += ' ⚠️ 环境已变更';
      }
      currentNameEl.textContent = text;
      currentNameEl.style.color = mismatch ? 'var(--warning)' : 'var(--accent)';
    } else {
      const model = currentEnv.ANTHROPIC_DEFAULT_SONNET_MODEL || '';
      currentNameEl.textContent = model ? '未知 (' + model + ')' : '无';
      currentNameEl.style.color = 'var(--accent)';
    }

    // 清空列表
    const listDiv = document.getElementById('profileList');
    while (listDiv.firstChild) listDiv.removeChild(listDiv.firstChild);

    if (names.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      emptyDiv.textContent = '暂无套餐，请在下方添加';
      listDiv.appendChild(emptyDiv);
      return;
    }

    names.forEach(name => {
      const env = profiles[name].env || {};
      const model = env.ANTHROPIC_DEFAULT_SONNET_MODEL || env.ANTHROPIC_MODEL || '无模型';
      const baseUrl = env.ANTHROPIC_BASE_URL || '';
      const isCurrent = (name === active);

      const item = document.createElement('div');
      item.className = 'profile-item';

      const infoDiv = document.createElement('div');
      infoDiv.className = 'profile-info';

      const nameDiv = document.createElement('div');
      nameDiv.className = 'profile-name';
      nameDiv.textContent = name;
      if (isCurrent) {
        const badge = document.createElement('span');
        badge.className = 'current-badge';
        badge.textContent = '当前';
        nameDiv.appendChild(badge);
        if (mismatch) {
          const mismatchBadge = document.createElement('span');
          mismatchBadge.className = 'mismatch-badge';
          mismatchBadge.textContent = '⚠️ 环境已变更';
          nameDiv.appendChild(mismatchBadge);
        }
      }

      const metaDiv = document.createElement('div');
      metaDiv.className = 'profile-meta';
      metaDiv.innerHTML = '';
      metaDiv.appendChild(document.createTextNode('模型：' + model));
      metaDiv.appendChild(document.createElement('br'));
      metaDiv.appendChild(document.createTextNode('Base：' + (baseUrl || '默认')));

      infoDiv.appendChild(nameDiv);
      infoDiv.appendChild(metaDiv);

      const btnRow = document.createElement('div');
      btnRow.className = 'row';

      const switchBtn = document.createElement('button');
      switchBtn.className = 'btn btn-primary btn-sm';
      switchBtn.textContent = '切换';
      switchBtn.onclick = () => switchTo(name);

      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-outline btn-sm';
      editBtn.textContent = '✏️';
      editBtn.onclick = () => editProfile(name);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-danger btn-sm';
      delBtn.textContent = '删除';
      delBtn.onclick = () => deleteProfile(name);

      btnRow.appendChild(switchBtn);
      btnRow.appendChild(editBtn);
      btnRow.appendChild(delBtn);

      item.appendChild(infoDiv);
      item.appendChild(btnRow);
      listDiv.appendChild(item);
    });
  } catch (e) {
    const listDiv = document.getElementById('profileList');
    while (listDiv.firstChild) listDiv.removeChild(listDiv.firstChild);
    const errDiv = document.createElement('div');
    errDiv.className = 'empty-state';
    errDiv.textContent = '加载失败: ' + e.message;
    listDiv.appendChild(errDiv);
  }
}

async function switchTo(name) {
  if (!confirm('确定切换至套餐 "' + name + '" 吗？')) return;
  try {
    await fetchJSON(`${API}/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    showToast('已切换到「' + name + '」，请重启 Claude Code');
    loadCurrent();
    loadProfiles();
  } catch (e) {
    showToast('切换失败: ' + e.message);
  }
}

async function deleteProfile(name) {
  if (!confirm('确定删除套餐 "' + name + '" 吗？\n此操作有备份，可还原。')) return;
  try {
    await fetchJSON(`${API}/profiles/${encodeURIComponent(name)}`, { method: 'DELETE' });
    showToast('已删除「' + name + '」');
    loadProfiles();
  } catch (e) {
    showToast('删除失败: ' + e.message);
  }
}

// 编辑：从列表数据中填充表单，API Key 显示占位符
async function editProfile(name) {
  try {
    const data = await fetchJSON(`${API}/profiles`);
    const profiles = data.profiles || {};
    const profile = profiles[name];
    if (!profile) return showToast('套餐不存在');
    editingProfile = name;
    document.getElementById('newName').value = name;
    document.getElementById('newName').disabled = true;
    document.getElementById('saveAsBtn').style.display = '';
    document.getElementById('newToken').value = '';
    document.getElementById('newToken').placeholder = '保持不变（留空不修改）';
    document.getElementById('newBaseUrl').value = profile.env.ANTHROPIC_BASE_URL || '';
    document.getElementById('newOpus').value = profile.env.ANTHROPIC_DEFAULT_OPUS_MODEL || '';
    document.getElementById('newSonnet').value = profile.env.ANTHROPIC_DEFAULT_SONNET_MODEL || profile.env.ANTHROPIC_MODEL || '';
    document.getElementById('newHaiku').value = profile.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || '';
    document.getElementById('presetSelect').value = '';
    window.scrollTo({ top: document.querySelectorAll('.card')[2].offsetTop - 20, behavior: 'smooth' });
  } catch (e) {
    showToast('加载失败: ' + e.message);
  }
}

function clearForm() {
  editingProfile = null;
  document.getElementById('newName').disabled = false;
  document.getElementById('saveAsBtn').style.display = 'none';
  ['newName', 'newToken', 'newBaseUrl', 'newOpus', 'newSonnet', 'newHaiku'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('newToken').placeholder = 'sk-...';
  document.getElementById('presetSelect').value = '';
}

async function addOrUpdateProfile() {
  const name = editingProfile || document.getElementById('newName').value.trim();
  const token = document.getElementById('newToken').value.trim();
  const baseUrl = document.getElementById('newBaseUrl').value.trim();
  const opus = document.getElementById('newOpus').value.trim();
  const sonnet = document.getElementById('newSonnet').value.trim();
  const haiku = document.getElementById('newHaiku').value.trim();

  if (!name) return showToast('请填写套餐名称');

  const env = {};
  if (token) env.ANTHROPIC_AUTH_TOKEN = token;
  if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;
  if (opus) env.ANTHROPIC_DEFAULT_OPUS_MODEL = opus;
  if (sonnet) env.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet;
  if (haiku) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku;

  try {
    if (editingProfile) {
      if (!token && Object.keys(env).length === 0) return showToast('请至少填写一项');
      await fetchJSON(`${API}/profiles/${encodeURIComponent(editingProfile)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env })
      });
      showToast('套餐「' + name + '」已更新');
    } else {
      if (!token) return showToast('请填写 API Key');
      await fetchJSON(`${API}/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, env })
      });
      showToast('套餐「' + name + '」已添加');
    }
    clearForm();
    loadProfiles();
    loadCurrent();
  } catch (e) {
    showToast('保存失败: ' + e.message);
  }
}

async function saveAsNewProfile() {
  if (!editingProfile) return;
  const newName = prompt('请输入新套餐名称：');
  if (!newName || !newName.trim()) return;
  const token = document.getElementById('newToken').value.trim();
  const baseUrl = document.getElementById('newBaseUrl').value.trim();
  const opus = document.getElementById('newOpus').value.trim();
  const sonnet = document.getElementById('newSonnet').value.trim();
  const haiku = document.getElementById('newHaiku').value.trim();

  const overrides = {};
  if (token) overrides.ANTHROPIC_AUTH_TOKEN = token;
  if (baseUrl) overrides.ANTHROPIC_BASE_URL = baseUrl;
  if (opus) overrides.ANTHROPIC_DEFAULT_OPUS_MODEL = opus;
  if (sonnet) overrides.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet;
  if (haiku) overrides.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku;

  try {
    await fetchJSON(`${API}/profiles/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: editingProfile, name: newName.trim(), overrides })
    });
    showToast('已另存为新套餐「' + newName.trim() + '」');
    clearForm();
    loadProfiles();
  } catch (e) {
    showToast('保存失败: ' + e.message);
  }
}

async function loadBackups() {
  const type = document.getElementById('backupType').value;
  try {
    const list = await fetchJSON(`${API}/backups/${type}`);
    const div = document.getElementById('backupList');
    while (div.firstChild) div.removeChild(div.firstChild);
    if (list.length === 0) {
      div.textContent = '暂无备份';
      return;
    }
    list.forEach(item => {
      const wrapper = document.createElement('div');
      wrapper.className = 'backup-item';
      const leftDiv = document.createElement('div');
      leftDiv.style.display = 'flex';
      leftDiv.style.alignItems = 'center';
      leftDiv.style.gap = '4px';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = item.fileName;
      leftDiv.appendChild(nameSpan);
      if (item.reason) {
        const reasonTag = document.createElement('span');
        reasonTag.className = 'backup-reason';
        reasonTag.textContent = item.reason;
        leftDiv.appendChild(reasonTag);
      }
      const btnDiv = document.createElement('div');
      btnDiv.style.display = 'flex';
      btnDiv.style.gap = '4px';
      const previewBtn = document.createElement('button');
      previewBtn.className = 'btn btn-sm btn-outline';
      previewBtn.textContent = '预览';
      previewBtn.onclick = () => showDiffPreview(type, item.fileName);
      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'btn btn-sm btn-outline';
      restoreBtn.textContent = '还原';
      restoreBtn.onclick = () => restoreBackup(type, item.fileName);
      btnDiv.appendChild(previewBtn);
      btnDiv.appendChild(restoreBtn);
      wrapper.appendChild(leftDiv);
      wrapper.appendChild(btnDiv);
      div.appendChild(wrapper);
    });
  } catch (e) {
    showToast('加载备份失败: ' + e.message);
  }
}

async function restoreBackup(type, fileName) {
  if (!confirm('确定还原 ' + type + ' 到 ' + fileName + '？\n当前配置会被自动备份。')) return;
  try {
    await fetchJSON(`${API}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, backupFileName: fileName })
    });
    showToast('还原成功，请重启 Claude Code');
    loadCurrent();
    loadProfiles();
  } catch (e) {
    showToast('还原失败: ' + e.message);
  }
}

async function loadLogs() {
  const date = document.getElementById('logDate').value;
  try {
    const logs = await fetchJSON(`${API}/logs${date ? '?date=' + date : ''}`);
    const div = document.getElementById('logContent');
    if (logs.length === 0) {
      div.textContent = '暂无日志';
      return;
    }
    div.textContent = logs.map(l => '📅 ' + l.date + '\n' + l.content).join('\n\n');
  } catch (e) {
    showToast('加载日志失败: ' + e.message);
  }
}

function closeDiffModal() {
  const overlay = document.getElementById('diffModalOverlay');
  if (overlay) overlay.remove();
}

async function showDiffPreview(type, fileName) {
  try {
    const diff = await fetchJSON(`${API}/backups/${type}/${encodeURIComponent(fileName)}/preview`);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'diffModalOverlay';
    overlay.onclick = (e) => { if (e.target === overlay) closeDiffModal(); };
    const modal = document.createElement('div');
    modal.className = 'modal';
    const title = document.createElement('h3');
    title.textContent = 'Diff 预览: ' + fileName;
    modal.appendChild(title);
    if (diff.profiles !== undefined) {
      const info = document.createElement('div');
      info.style.marginBottom = '12px';
      info.style.fontSize = '0.85rem';
      info.style.color = 'var(--sub)';
      const parts = [];
      if (diff.added.length) parts.push('新增: ' + diff.added.join(', '));
      if (diff.removed.length) parts.push('删除: ' + diff.removed.join(', '));
      if (diff.changed.length) parts.push('变更: ' + diff.changed.map(c => c.profile).join(', '));
      if (diff.unchanged.length) parts.push('未变: ' + diff.unchanged.join(', '));
      info.textContent = parts.join(' | ') || '无差异';
      modal.appendChild(info);
      if (diff.changed.length > 0) {
        diff.changed.forEach(ch => {
          const sub = document.createElement('div');
          sub.style.marginBottom = '10px';
          const subTitle = document.createElement('div');
          subTitle.style.fontWeight = '600';
          subTitle.style.marginBottom = '4px';
          subTitle.textContent = '套餐: ' + ch.profile;
          sub.appendChild(subTitle);
          const table = buildDiffTable(ch.changes);
          sub.appendChild(table);
          modal.appendChild(sub);
        });
      }
    } else {
      const table = buildDiffTable(diff.changed || []);
      const infoDiv = document.createElement('div');
      infoDiv.style.marginBottom = '8px';
      infoDiv.style.fontSize = '0.85rem';
      infoDiv.style.color = 'var(--sub)';
      const parts = [];
      if (diff.added && diff.added.length) parts.push('新增: ' + diff.added.join(', '));
      if (diff.removed && diff.removed.length) parts.push('删除: ' + diff.removed.join(', '));
      if (diff.changed && diff.changed.length) parts.push('变更: ' + diff.changed.length + ' 项');
      if (diff.unchanged && diff.unchanged.length) parts.push('未变: ' + diff.unchanged.length + ' 项');
      infoDiv.textContent = parts.join(' | ') || '无差异';
      modal.appendChild(infoDiv);
      modal.appendChild(table);
    }
    const btnRow = document.createElement('div');
    btnRow.className = 'row';
    btnRow.style.justifyContent = 'flex-end';
    btnRow.style.marginTop = '16px';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-outline';
    cancelBtn.textContent = '取消';
    cancelBtn.onclick = closeDiffModal;
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn btn-danger';
    confirmBtn.textContent = '确认还原';
    confirmBtn.onclick = () => {
      closeDiffModal();
      restoreBackup(type, fileName);
    };
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  } catch (e) {
    showToast('加载预览失败: ' + e.message);
  }
}

function buildDiffTable(changes) {
  const table = document.createElement('table');
  table.className = 'diff-table';
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['Key', '当前值', '备份值'].forEach(text => {
    const th = document.createElement('th');
    th.textContent = text;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  (changes || []).forEach(ch => {
    const tr = document.createElement('tr');
    tr.className = 'diff-changed';
    const keyTd = document.createElement('td');
    keyTd.textContent = ch.key;
    const oldTd = document.createElement('td');
    oldTd.textContent = typeof ch.oldValue === 'object' ? JSON.stringify(ch.oldValue) : String(ch.oldValue ?? '');
    const newTd = document.createElement('td');
    newTd.textContent = typeof ch.newValue === 'object' ? JSON.stringify(ch.newValue) : String(ch.newValue ?? '');
    tr.appendChild(keyTd);
    tr.appendChild(newTd);
    tr.appendChild(oldTd);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

// 初始化
loadPresets();
loadCurrent();
loadProfiles();
