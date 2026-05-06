import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';
import { initSentry } from './sentry.js';

initSentry();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// Yeni deploy sonrası eski sekmede chunk hash'leri 404 olursa sayfayı yenile
window.addEventListener('vite:preloadError', (event) => {
  if (!sessionStorage.getItem('preloadReloaded')) {
    sessionStorage.setItem('preloadReloaded', '1');
    event.preventDefault();
    window.location.reload();
  }
});
