import { useEffect, useState } from 'react';

import { syncService } from '../services/syncService.js';

export function useOnlineStatus() {
  const [online, setOnline] = useState(syncService.getState().online);

  useEffect(() => syncService.subscribe((next) => setOnline(next.online)), []);

  return online;
}
