import { useEffect, useRef } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { canAccessRoute } from '../../lib/routePermissions.js';
import { useAuthStore } from '../../stores/authStore.js';
import { toast } from '../../stores/uiStore.js';

const PermissionRoute = () => {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const lastDenied = useRef('');

  const allowed = canAccessRoute(user, location.pathname);

  useEffect(() => {
    if (!allowed && lastDenied.current !== location.pathname) {
      lastDenied.current = location.pathname;
      toast.error('You do not have permission to access this page');
    }
  }, [allowed, location.pathname]);

  if (!allowed) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
};

export default PermissionRoute;
