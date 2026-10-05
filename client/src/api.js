// Small fetch wrapper. Staff token is kept in localStorage; the guest token only lives in memory.
const STAFF_KEY = 'dm_staff_token';

export const staffToken = {
  get: () => localStorage.getItem(STAFF_KEY),
  set: (t) => localStorage.setItem(STAFF_KEY, t),
  clear: () => localStorage.removeItem(STAFF_KEY),
};

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Demo build for GitHub Pages: no server, a fake API runs in the browser (see src/demo/mockApi.js)
export const IS_DEMO = import.meta.env.VITE_DEMO === '1';
const BASE = import.meta.env.BASE_URL || '/';
async function demoRequest(method, url, opts) {
  const { mockRequest } = await import('./demo/mockApi.js');
  try {
    return await mockRequest(method, url, opts);
  } catch (e) {
    throw new ApiError(e.status || 500, e.message);
  }
}

async function request(method, url, { body, token = staffToken.get(), raw = false } = {}) {
  if (IS_DEMO) return demoRequest(method, url, { body, token, raw });
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${url}`, { method, headers, body: payload });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    if (res.status === 401 && token === staffToken.get() && !url.startsWith('/guest')) {
      staffToken.clear();
      const here = location.pathname.slice(BASE.length - 1);
      if (!/^\/(login|welcome|scan|t\/)/.test(here)) location.href = `${BASE}welcome`;
    }
    throw new ApiError(res.status, msg);
  }
  if (raw) return res.blob();
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (url, opts) => request('GET', url, opts),
  post: (url, body, opts) => request('POST', url, { ...opts, body }),
  patch: (url, body, opts) => request('PATCH', url, { ...opts, body }),
  del: (url, opts) => request('DELETE', url, opts),
  blob: (url, opts) => request('GET', url, { ...opts, raw: true }),
};

/** Upload with progress (fetch has no upload progress). Resolves with parsed JSON. */
export function uploadWithProgress(url, formData, onProgress) {
  if (IS_DEMO) {
    onProgress?.(0.5);
    return request('POST', url, { body: formData }).then((r) => { onProgress?.(1); return r; });
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${url}`);
    const t = staffToken.get();
    if (t) xhr.setRequestHeader('Authorization', `Bearer ${t}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Network error. Check your connection.'));
    xhr.send(formData);
  });
}

/** Downloads a protected file (staff only) by fetching it as a blob first. */
export async function downloadProtected(url, filename) {
  const blob = await api.blob(url);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const fmtBytes = (n) => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
};

export const fmtDate = (s) => (s ? new Date(s.endsWith('Z') || s.includes('T') ? s : `${s.replace(' ', 'T')}Z`).toLocaleString() : '—');
