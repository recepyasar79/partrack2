import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function ProtectedRoute({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  // Superadmin sadece /sites altında çalışır — başka sayfaya gelirse
  // (örn. /, /daireler, /araclar) doğrudan /sites'a yönlendir.
  if (user.rol === 'superadmin' && !location.pathname.startsWith('/sites')) {
    return <Navigate to="/sites" replace />;
  }
  return children;
}

export function RoleRoute({ roller, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!roller.includes(user.rol)) return <Navigate to="/yetkisiz" replace />;
  return children;
}
