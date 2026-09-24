import React, { useCallback, useEffect, useState } from 'react';
import RemoteBridgeControls from '@/components/admin/RemoteBridgeControls';
import { bridgeOnlineFromDevices, loadLockPresenceDevices } from '@/utils/lockPresence';

export default function AdminRemoteLockBar() {
  const [devices, setDevices] = useState([]);
  const [optimisticTimes, setOptimisticTimes] = useState(null);

  const load = useCallback(async () => {
    const { devices: next } = await loadLockPresenceDevices();
    setDevices(next);
    setOptimisticTimes(null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const primary = devices[0] || null;
  const lastOpenedAt = optimisticTimes?.lastOpenedAt ?? primary?.last_opened_at;
  const lastClosedAt = optimisticTimes?.lastClosedAt ?? primary?.last_closed_at;

  return (
    <RemoteBridgeControls
      compact
      bridgeOnline={bridgeOnlineFromDevices(devices)}
      lastOpenedAt={lastOpenedAt}
      lastClosedAt={lastClosedAt}
      onSuccess={(data) => {
        if (data?.lastOpenedAt || data?.lastClosedAt) {
          setOptimisticTimes((prev) => ({
            lastOpenedAt: data.lastOpenedAt ?? prev?.lastOpenedAt ?? null,
            lastClosedAt: data.lastClosedAt ?? prev?.lastClosedAt ?? null,
          }));
        }
        load();
      }}
    />
  );
}
