import axios from 'axios';
import { TOKEN_KEY, USER_KEY, ACTIVE_SITE_KEY } from '../utils/constants';

const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export const api = axios.create({ baseURL, withCredentials: false });

// Multi-tenant: superadmin için ?siteId query param otomatik enjekte
// edilir (backend zorunlu kılıyor). Site-bağlı user'lar için backend
// kendi site'sini JWT'den çıkarır — query param yoksayılır.
// /sites/* endpoint'leri kendi içlerinde site_id'yi path'ten alır,
// query param eklemeye gerek yok ama ekstra gönderse de zararsız.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  try {
    const raw = localStorage.getItem(USER_KEY);
    const user = raw ? JSON.parse(raw) : null;
    if (user?.rol === 'superadmin') {
      const activeSite = localStorage.getItem(ACTIVE_SITE_KEY);
      if (activeSite) {
        config.params = config.params || {};
        if (config.params.siteId == null && config.params.site_id == null) {
          config.params.siteId = activeSite;
        }
      }
    }
  } catch { /* ignore */ }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.assign('/login');
      }
    }
    return Promise.reject(err);
  }
);

export function apiError(err) {
  return err?.response?.data?.error || err?.message || 'Beklenmeyen hata.';
}
