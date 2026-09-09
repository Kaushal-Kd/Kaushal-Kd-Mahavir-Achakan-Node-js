import {
  Clock,
  FileDigit,
  Hash,
  ListOrdered,
  Ruler,
  Scale,
  Scissors,
  Sparkles,
  Tags,
} from 'lucide-react';

/**
 * Shared config for the Configuration navigation.
 *
 * Used by:
 *   - `components/layout/Sidebar.jsx` (Master) → labels and kinds for `/master/:tab`.
 *   - `pages/master/Master.jsx` → resolves the active tab, mounts the matching editor, and uses
 *     full-width layout (no max-width cap) for these screens.
 */
export const CONFIG_ITEMS = [
  {
    id: 'categories',
    label: 'Categories',
    description: 'Product categories (Sherwani, Lehenga, Kurta, …)',
    icon: Tags,
    kind: 'records',
  },
  {
    id: 'colors',
    label: 'Color families',
    description: 'Colors used for tagging products',
    icon: Sparkles,
    kind: 'list',
    // Stays alphabetical as values are added; the ↑↓ arrows still override.
    autoSort: true,
  },
  {
    id: 'sizes',
    label: 'Sizes',
    description: 'Size options (XS, S, M, L, XL, …)',
    icon: Ruler,
    kind: 'list',
  },
  {
    id: 'units',
    label: 'Units',
    description: 'Units of measure (pcs, pair, meter, …)',
    icon: Scale,
    kind: 'list',
  },
  {
    id: 'code-format',
    label: 'Code format',
    description: 'Per-category prefixes and number padding for product codes',
    icon: Hash,
    kind: 'code_format',
  },
  {
    id: 'time-slots',
    label: 'Time Slots',
    description:
      'Delivery and return times (12-hour AM/PM), plus one default delivery and one default return time for new bookings',
    icon: Clock,
    kind: 'time_slots',
  },
  {
    id: 'laundry-priority',
    label: 'Laundry priority',
    description: 'Days-until-next-pickup thresholds for Urgent, High, Medium, and Low',
    icon: ListOrdered,
    kind: 'laundry_priority',
  },
  {
    id: 'bill-numbering',
    label: 'Bill numbering',
    description: 'Order / bill number prefix for this shop (unique sequence per shop)',
    icon: FileDigit,
    kind: 'bill_numbering',
  },
  {
    id: 'custom-order-fields',
    label: 'Custom order measurements',
    description:
      'Measurement fields for customized product orders (length, sleeve, neck, height, …)',
    icon: Ruler,
    kind: 'custom_order_fields',
  },
  {
    id: 'tailors',
    label: 'Tailors',
    description: 'Tailor names for custom orders',
    icon: Scissors,
    kind: 'list',
  },
];

export const DEFAULT_CONFIG_TAB = 'categories';
