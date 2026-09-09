import { Zap } from 'lucide-react';

import PlaceholderPage from '../PlaceholderPage.jsx';

const QuickAccessoryBill = () => (
  <PlaceholderPage
    title="Quick Accessory Bill"
    description="Fast walk-in billing for accessory-only sales (requirements \u00a756)"
    icon={Zap}
    note="Dedicated 1-2 screen flow for sale-only accessories (mojdi, safa, mala, brooch, stole). Wire up: customer phone lookup \u2192 accessory scan \u2192 payment \u2192 thermal print."
  />
);

export default QuickAccessoryBill;
