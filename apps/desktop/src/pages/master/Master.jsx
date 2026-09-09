import { Navigate, useParams } from 'react-router-dom';

import Tab from '../settings/tabs/_Tab.jsx';
import BillTemplatesTab from '../settings/tabs/BillTemplatesTab.jsx';

import BillNumberingEditor from '../configuration/editors/BillNumberingEditor.jsx';
import CategoriesEditor from '../configuration/editors/CategoriesEditor.jsx';
import CodeFormatEditor from '../configuration/editors/CodeFormatEditor.jsx';
import LaundryPriorityEditor from '../configuration/editors/LaundryPriorityEditor.jsx';
import SimpleListEditor from '../configuration/editors/SimpleListEditor.jsx';
import TimeSlotsEditor from '../configuration/editors/TimeSlotsEditor.jsx';
import CustomOrderFieldsEditor from '../configuration/editors/CustomOrderFieldsEditor.jsx';
import { CONFIG_ITEMS } from '../configuration/configurationNav.js';
import AccessoryList from '../accessories/AccessoryList.jsx';
import AccountsConfigTab from '../settings/tabs/AccountsConfigTab.jsx';
import RemindersTab from '../settings/tabs/RemindersTab.jsx';
import UsersTab from '../settings/tabs/UsersTab.jsx';

import { MASTER_DEFAULT_TAB, MASTER_NAV_ITEMS, MASTER_TAB_IDS } from './masterNav.js';

function renderConfigEditor(def) {
  if (!def) return null;
  if (def.kind === 'records') return <CategoriesEditor />;
  if (def.kind === 'code_format') return <CodeFormatEditor />;
  if (def.kind === 'bill_numbering') return <BillNumberingEditor />;
  if (def.kind === 'laundry_priority') return <LaundryPriorityEditor />;
  if (def.kind === 'time_slots') return <TimeSlotsEditor def={def} />;
  if (def.kind === 'custom_order_fields') return <CustomOrderFieldsEditor def={def} />;
  return <SimpleListEditor type={def.id} def={def} />;
}

const Master = () => {
  const { tab } = useParams();
  const activeId = tab || MASTER_DEFAULT_TAB;

  if (tab === 'product-code' || tab === 'accessory-code') {
    return <Navigate to="/master/code-format" replace />;
  }

  if (tab === 'booking-defaults' || tab === 'gst-settings') {
    return <Navigate to="/settings/app-settings" replace />;
  }

  if (!MASTER_TAB_IDS.has(activeId)) {
    return <Navigate to={`/master/${MASTER_DEFAULT_TAB}`} replace />;
  }

  const navItem = MASTER_NAV_ITEMS.find((it) => it.id === activeId);
  if (!navItem) {
    return <Navigate to={`/master/${MASTER_DEFAULT_TAB}`} replace />;
  }

  const def =
    navItem.kind === 'config' && navItem.configId
      ? CONFIG_ITEMS.find((c) => c.id === navItem.configId)
      : null;

  if (navItem.kind === 'config' && !def) {
    return <Navigate to={`/master/${MASTER_DEFAULT_TAB}`} replace />;
  }

  const shellClass = 'min-h-0 lg:h-[calc(100vh-120px)] lg:overflow-hidden';
  const scrollClass = 'min-h-0 min-w-0 overflow-x-auto lg:h-full lg:overflow-y-auto';
  const innerClass = 'w-full min-w-0';

  if (navItem.kind === 'users') {
    return (
      <div className={shellClass}>
        <div className={scrollClass}>
          <div className={innerClass}>
            <UsersTab />
          </div>
        </div>
      </div>
    );
  }

  if (navItem.kind === 'reminders') {
    return (
      <div className={shellClass}>
        <div className={scrollClass}>
          <div className={innerClass}>
            <RemindersTab />
          </div>
        </div>
      </div>
    );
  }

  if (navItem.kind === 'accounts') {
    return (
      <div className={shellClass}>
        <div className={scrollClass}>
          <div className={innerClass}>
            <AccountsConfigTab />
          </div>
        </div>
      </div>
    );
  }

  if (navItem.kind === 'bill_templates') {
    return (
      <div className={shellClass}>
        <div className={scrollClass}>
          <div className={innerClass}>
            <BillTemplatesTab />
          </div>
        </div>
      </div>
    );
  }

  if (navItem.kind === 'accessory') {
    return (
      <div className={shellClass}>
        <div className={scrollClass}>
          <div className={innerClass}>
            <AccessoryList />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={shellClass}>
      <div className={scrollClass}>
        <div className={innerClass}>
          <Tab title={def.label} description={def.description}>
            {renderConfigEditor(def)}
          </Tab>
        </div>
      </div>
    </div>
  );
};

export default Master;
