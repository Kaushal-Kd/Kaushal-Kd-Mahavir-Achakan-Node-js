import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { createPortal } from 'react-dom';

import { useUIStore } from '../../stores/uiStore.js';

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: TriangleAlert,
  info: Info,
};

const COLORS = {
  success: 'text-green-700 border-green-400',
  error: 'text-red-700 border-red-400',
  warning: 'text-yellow-700 border-yellow-400',
  info: 'text-brand border-brand',
};

const Toaster = () => {
  const toasts = useUIStore((s) => s.toasts);
  const dismiss = useUIStore((s) => s.dismissToast);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 w-[min(380px,calc(100vw-2rem))]">
      {toasts.map((t) => {
        const Icon = ICONS[t.type] || Info;
        return (
          <div
            key={t.id}
            className={`card border-l-4 ${COLORS[t.type] || COLORS.info} px-4 py-3 flex items-start gap-3`}
          >
            <Icon size={18} className="mt-0.5 shrink-0" />
            <div className="flex-1 text-sm">
              {t.title ? <div className="font-semibold text-gray-900">{t.title}</div> : null}
              <div className="text-gray-700">{t.message}</div>
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="text-gray-400 hover:text-gray-700"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
};

export default Toaster;
