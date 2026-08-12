// 搜索历史记录: localStorage 持久化, 按 key 区分不同搜索框(顶栏全局 / 资源列表页等)
// 默认 key 为空字符串 → 存储键为 'search-history'(兼容旧版顶栏数据); 其余传 'folder' 等区分。
const PREFIX = 'search-history';
const MAX = 12;

function storageKey(key) {
  return key ? `${PREFIX}:${key}` : PREFIX;
}

export function loadSearchHistory(key = '') {
  try {
    const a = JSON.parse(localStorage.getItem(storageKey(key)) || '[]');
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [];
  } catch (e) {
    return [];
  }
}

export function saveSearchHistory(arr, key = '') {
  try {
    const list = (Array.isArray(arr) ? arr : []).map(String).filter(Boolean).slice(0, MAX);
    localStorage.setItem(storageKey(key), JSON.stringify(list));
  } catch (e) {
    /* ignore quota / private mode */
  }
}

export function addSearchHistory(word, key = '') {
  const w = String(word || '').trim();
  if (!w) return;
  const list = loadSearchHistory(key).filter((x) => x !== w);
  list.unshift(w);
  saveSearchHistory(list, key);
}

export function removeSearchHistory(word, key = '') {
  saveSearchHistory(loadSearchHistory(key).filter((x) => x !== word), key);
}
