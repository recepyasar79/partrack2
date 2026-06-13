import axios from 'axios';
import { TOKEN_KEY } from '../utils/constants';

const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export const api = axios.create({ baseURL, withCredentials: false });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
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
  if (!err) return 'Beklenmeyen hata.';
  // Backend'in yapısal hatası en açıklayıcı.
  if (err.response?.data?.error) return err.response.data.error;
  // Axios ağ/timeout hataları — err.code ile ayırt edilip anlamlı mesaj.
  if (err.code === 'ECONNABORTED') {
    return 'İstek zaman aşımına uğradı. Bağlantınızı kontrol edip tekrar deneyin.';
  }
  if (err.code === 'ERR_NETWORK' || err.message === 'Network Error') {
    return 'Ağ hatası. İnternet bağlantınızı kontrol edip tekrar deneyin.';
  }
  if (err.message) return err.message;
  // Error olmayan throw (ör. foto decode başarısızlığında gelen DOM Event'in
  // message'ı yoktur) — eskiden "Beklenmeyen hata." dönüyordu.
  return 'İşlem tamamlanamadı. Lütfen tekrar deneyin.';
}
