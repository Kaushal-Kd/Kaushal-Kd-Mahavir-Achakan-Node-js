import { Navigate, useParams } from 'react-router-dom';

import { DEFAULT_CONFIG_TAB } from './configurationNav.js';
import { MASTER_DEFAULT_TAB, MASTER_TAB_IDS } from '../master/masterNav.js';

/**
 * Legacy `/configuration/*` routes redirect to `/master/*`.
 * Editors live under `pages/master/Master.jsx` and `pages/configuration/editors/`.
 */
const Configuration = () => {
  const { tab } = useParams();
  const raw = tab || DEFAULT_CONFIG_TAB;
  if (raw === 'booking-defaults' || raw === 'gst-settings') {
    return <Navigate to="/settings/app-settings" replace />;
  }
  const mapped = raw === 'product-code' || raw === 'accessory-code' ? 'code-format' : raw;
  const next = MASTER_TAB_IDS.has(mapped) ? mapped : MASTER_DEFAULT_TAB;
  return <Navigate to={`/master/${next}`} replace />;
};

export default Configuration;
