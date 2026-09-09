import { KeyRound, ListChecks, LogOut, Settings, User as UserIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, hardLogout } from '../../lib/api.js';
import { canAccessRoute } from '../../lib/routePermissions.js';
import { useAuthStore } from '../../stores/authStore.js';

const menuBtn =
  'w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 text-left text-gray-900';

const UserMenu = () => {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const onLogout = async () => {
    setOpen(false);
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    }
    hardLogout();
    navigate('/login');
  };

  const go = (path) => {
    setOpen(false);
    navigate(path);
  };

  if (!user) return null;

  const showMenuPermission = canAccessRoute(user, '/settings/permissions');
  const showSettings = canAccessRoute(user, '/settings/app-settings');

  const initials = (user.name || user.email || '?')
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md hover:bg-gray-100 px-2 py-1"
        aria-label="User menu"
      >
        <div className="w-8 h-8 rounded-full bg-brand-light text-brand flex items-center justify-center text-xs font-semibold">
          {initials}
        </div>
        <div className="text-left hidden sm:block">
          <div className="text-sm font-medium text-gray-900 leading-tight">{user.name}</div>
          <div className="text-xs text-gray-500 leading-tight capitalize">
            {user.role?.replace(/_/g, ' ')}
          </div>
        </div>
      </button>

      {open ? (
        <div className="absolute right-0 mt-1 w-56 rounded-md border border-gray-200 bg-surface shadow-pop z-30 py-1">
          <button type="button" onClick={() => go('/profile')} className={menuBtn}>
            <UserIcon size={14} className="text-gray-500 shrink-0" />
            Profile
          </button>
          <button type="button" onClick={() => go('/profile/change-password')} className={menuBtn}>
            <KeyRound size={14} className="text-gray-500 shrink-0" />
            Change Password
          </button>

          {showMenuPermission || showSettings ? (
            <>
              <div className="border-t border-gray-100 my-1" />
              {showMenuPermission ? (
                <button type="button" onClick={() => go('/settings/permissions')} className={menuBtn}>
                  <ListChecks size={14} className="text-gray-500 shrink-0" />
                  Set Menu Permission
                </button>
              ) : null}
              {showSettings ? (
                <button type="button" onClick={() => go('/settings/app-settings')} className={menuBtn}>
                  <Settings size={14} className="text-gray-500 shrink-0" />
                  Settings
                </button>
              ) : null}
            </>
          ) : null}

          <div className="border-t border-gray-100 my-1" />
          <button type="button" onClick={onLogout} className={`${menuBtn} text-red-600`}>
            <LogOut size={14} className="shrink-0" />
            Log out
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default UserMenu;
