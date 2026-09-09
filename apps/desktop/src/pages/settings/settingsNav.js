import { Laptop, MessageCircle, ScrollText, Settings2, Shield, ShieldCheck, Store } from 'lucide-react';

/**
 * Shared config for the Settings navigation.
 *
 * Used by:
 *   - `components/layout/Sidebar.jsx`  → to render the Settings dropdown
 *     in the main application sidebar.
 *   - `pages/settings/Settings.jsx`    → to resolve the active tab from
 *     the URL (`/settings/:tab`) and render the right component.
 *
 * Keep icons + labels here; component imports live in Settings.jsx so the
 * sidebar stays light.
 */
export const SETTINGS_GROUPS = [
  {
    id: 'organization',
    label: 'Organization',
    items: [
      { id: 'shops', label: 'Shops / Branches', icon: Store, description: 'Multi-branch setup' },
    ],
  },
  {
    id: 'access',
    label: 'Access control',
    items: [
      { id: 'permissions', label: 'Roles & Permissions', icon: Shield, description: 'Default permissions per role' },
      { id: 'devices', label: 'Login User Device', icon: Laptop, description: 'Active logins and remote sign-out' },
      {
        id: 'ip-whitelisting',
        label: 'IP Whitelisting',
        icon: ShieldCheck,
        description: 'Shop and user network access rules',
        adminOnly: true,
      },
      {
        id: 'system-logs',
        label: 'System Logs',
        icon: ScrollText,
        description: 'Create, update, and delete audit trail with bill snapshots',
      },
    ],
  },
  {
    id: 'configuration',
    label: 'Configuration',
    items: [
      {
        id: 'app-settings',
        label: 'App settings',
        icon: Settings2,
        description: 'GST, booking defaults, invoices, and shop behaviour',
      },
      {
        id: 'whatsapp',
        label: 'WhatsApp messages',
        icon: MessageCircle,
        description: 'Message templates and variables for WhatsApp (config only)',
      },
    ],
  },
];

export const ALL_SETTINGS_ITEMS = SETTINGS_GROUPS.flatMap((g) =>
  g.items.map((it) => ({ ...it, group: g.id, groupLabel: g.label }))
);

export const DEFAULT_SETTINGS_TAB = 'shops';
