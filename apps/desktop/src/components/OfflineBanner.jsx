import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

import { syncService } from '../services/syncService.js';

const OfflineBanner = () => {
  const [online, setOnline] = useState(syncService.getState().online);

  useEffect(() => syncService.subscribe((s) => setOnline(s.online)), []);

  if (online) return null;

  return (
    <div className="bg-red-600 text-white text-xs py-1.5 px-4 flex items-center justify-center gap-2">
      <WifiOff size={14} />
      <span>
        You are offline. Changes will be saved locally and synced automatically when the connection
        is restored.
      </span>
    </div>
  );
};

export default OfflineBanner;
