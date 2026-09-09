import { Navigate, useParams } from 'react-router-dom';

import { DEFAULT_SETTINGS_TAB } from './settingsNav.js';
import AppSettingsTab from './tabs/AppSettingsTab.jsx';
import WhatsAppSettingsTab from './tabs/WhatsAppSettingsTab.jsx';
import PaymentsTab from './tabs/PaymentsTab.jsx';
import PermissionsTab from './tabs/PermissionsTab.jsx';
import ShopsTab from './tabs/ShopsTab.jsx';
import SystemLogsTab from './tabs/SystemLogsTab.jsx';
import DevicesTab from './tabs/DevicesTab.jsx';
import IpWhitelistingTab from './tabs/IpWhitelistingTab.jsx';
import { useAuthStore } from '../../stores/authStore.js';

const TAB_COMPONENTS = {
  shops: ShopsTab,
  permissions: PermissionsTab,
  payments: PaymentsTab,
  'app-settings': AppSettingsTab,
  whatsapp: WhatsAppSettingsTab,
  'system-logs': SystemLogsTab,
  devices: DevicesTab,
  'ip-whitelisting': IpWhitelistingTab,
};

/**
 * Settings page shell.
 *
 * The active tab (driven by `/settings/:tab`) renders as a full page.
 * The left sidebar (in the main layout) handles navigation; no inner
 * sidebar or page header is drawn here — every Tab paints its own.
 */
const Settings = () => {
  const { tab } = useParams();
  const userRole = useAuthStore((state) => state.user?.role);
  if (tab === 'notifications') {
    return <Navigate to="/master/reminders" replace />;
  }
  const activeId = tab || DEFAULT_SETTINGS_TAB;

  if (activeId === 'ip-whitelisting' && !['super_admin', 'shop_admin'].includes(userRole)) {
    return <Navigate to={`/settings/${DEFAULT_SETTINGS_TAB}`} replace />;
  }

  if (!TAB_COMPONENTS[activeId]) {
    return <Navigate to={`/settings/${DEFAULT_SETTINGS_TAB}`} replace />;
  }

  const Active = TAB_COMPONENTS[activeId];

  return (
    <div className="min-h-0 lg:h-[calc(100vh-120px)] lg:overflow-hidden">
      <div className="min-h-0 min-w-0 overflow-x-auto lg:h-full lg:overflow-y-auto">
        <div
          className={
            activeId === 'app-settings' || activeId === 'whatsapp' || activeId === 'system-logs'
              ? 'flex min-h-0 w-full min-w-0 flex-1 flex-col px-0 sm:px-0'
              : 'mx-auto max-w-6xl w-full min-w-0 px-0 sm:px-0'
          }
        >
          <Active />
        </div>
      </div>
    </div>
  );
};

export default Settings;
