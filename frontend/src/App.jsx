import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ThemeProvider } from './theme/ThemeContext';
import { ToastProvider } from './components/ui/Toast';
import { ProtectedRoute, RoleRoute } from './auth/ProtectedRoute';
import Layout from './components/Layout';

import Login from './pages/Login';
import Home from './pages/Home';
import Daireler from './pages/Daireler';
import AracListesi from './pages/AracListesi';
import MisafirAraclar from './pages/MisafirAraclar';
import Kullanicilar from './pages/Kullanicilar';
import AuditLog from './pages/AuditLog';
import SifreDegistir from './pages/SifreDegistir';
import Yetkisiz from './pages/Yetkisiz';
import Kontrol from './pages/Kontrol';
import AksamKontrolu from './pages/AksamKontrolu';
import Raporlar from './pages/Raporlar';
import Kvkk from './pages/Kvkk';
import OcrIstatistik from './pages/OcrIstatistik';

export default function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/kvkk" element={<Kvkk />} />
          <Route path="/yetkisiz" element={<Layout><Yetkisiz /></Layout>} />

          <Route
            path="/"
            element={<ProtectedRoute><Layout><Home /></Layout></ProtectedRoute>}
          />
          <Route
            path="/daireler"
            element={<ProtectedRoute><Layout><Daireler /></Layout></ProtectedRoute>}
          />
          <Route
            path="/araclar"
            element={<ProtectedRoute><Layout><AracListesi /></Layout></ProtectedRoute>}
          />
          <Route
            path="/misafir-araclar"
            element={<ProtectedRoute><Layout><MisafirAraclar /></Layout></ProtectedRoute>}
          />
          <Route
            path="/sifre-degistir"
            element={<ProtectedRoute><Layout><SifreDegistir /></Layout></ProtectedRoute>}
          />
          <Route
            path="/kontrol"
            element={<ProtectedRoute><Layout><Kontrol /></Layout></ProtectedRoute>}
          />
          <Route
            path="/kontrol/aksam"
            element={<ProtectedRoute><Layout><AksamKontrolu /></Layout></ProtectedRoute>}
          />
          <Route
            path="/raporlar"
            element={<ProtectedRoute><Layout><Raporlar /></Layout></ProtectedRoute>}
          />

          <Route
            path="/kullanicilar"
            element={
              <RoleRoute roller={['yonetici']}>
                <Layout><Kullanicilar /></Layout>
              </RoleRoute>
            }
          />
          <Route
            path="/audit"
            element={
              <RoleRoute roller={['yonetici']}>
                <Layout><AuditLog /></Layout>
              </RoleRoute>
            }
          />
          <Route
            path="/ocr-istatistik"
            element={
              <RoleRoute roller={['yonetici']}>
                <Layout><OcrIstatistik /></Layout>
              </RoleRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
    </ThemeProvider>
  );
}
