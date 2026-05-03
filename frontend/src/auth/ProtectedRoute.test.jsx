import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import { ProtectedRoute, RoleRoute } from './ProtectedRoute';
import { TOKEN_KEY, USER_KEY } from '../utils/constants';

function App({ initial = '/protected' }) {
  return (
    <MemoryRouter initialEntries={[initial]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div>LOGIN_PAGE</div>} />
          <Route path="/yetkisiz" element={<div>YETKISIZ_PAGE</div>} />
          <Route
            path="/protected"
            element={<ProtectedRoute><div>SECRET</div></ProtectedRoute>}
          />
          <Route
            path="/admin"
            element={<RoleRoute roller={['yonetici']}><div>ADMIN_AREA</div></RoleRoute>}
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  test('user yok → /login redirect', () => {
    render(<App />);
    expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument();
  });

  test('user var → child render', () => {
    localStorage.setItem(TOKEN_KEY, 'fake');
    localStorage.setItem(USER_KEY, JSON.stringify({ id: 1, kullanici_adi: 'admin', rol: 'yonetici' }));
    render(<App />);
    expect(screen.getByText('SECRET')).toBeInTheDocument();
  });
});

describe('RoleRoute', () => {
  test('yanlış rol → /yetkisiz', () => {
    localStorage.setItem(TOKEN_KEY, 'fake');
    localStorage.setItem(USER_KEY, JSON.stringify({ id: 2, kullanici_adi: 'g', rol: 'guvenlik' }));
    render(<App initial="/admin" />);
    expect(screen.getByText('YETKISIZ_PAGE')).toBeInTheDocument();
  });

  test('doğru rol → child render', () => {
    localStorage.setItem(TOKEN_KEY, 'fake');
    localStorage.setItem(USER_KEY, JSON.stringify({ id: 1, kullanici_adi: 'admin', rol: 'yonetici' }));
    render(<App initial="/admin" />);
    expect(screen.getByText('ADMIN_AREA')).toBeInTheDocument();
  });
});
