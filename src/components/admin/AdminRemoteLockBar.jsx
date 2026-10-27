import React, { useCallback, useEffect, useRef, useState } from 'react';
import RemoteBridgeControls from '@/components/admin/RemoteBridgeControls';
import { bridgeOnlineFromDevices, loadLockPresenceDevices, lockDisplayFromCommand, watchManualLockAfterCommand } from '@/utils/lockPresence';

export default function AdminRemoteLockBar() {
  const [devices, setDevices] = useState([]);
  const [optimisticTimes, setOptimisticTimes] = useState(null);
  const stopWatch = useRef(null);

  const load = useCallback(async () => {
    const { devices: next } = await loadLockPresenceDevices();
    setDevices(next);
    setOptimisticTimes(null);
  }, []);

  useEffect(() => {
    load();
    return () => stopWatch.current?.();
  }, [load]);

  const primary = devices[0] || null;
  const lastOpenedAt = optimisticTimes?.lastOpenedAt ?? primary?.last_opened_at;
  const lastClosedAt = optimisticTimes?.lastClosedAt ?? primary?.last_closed_at;
  const currentState = optimisticTimes?.currentState ?? primary?.current_state ?? null;

  return (
    <RemoteBridgeControls
      compact
      bridgeOnline={bridgeOnlineFromDevices(devices)}
      lastOpenedAt={lastOpenedAt}
      lastClosedAt={lastClosedAt}
      currentState={currentState}
      onSuccess={(data) => {
        const display = lockDisplayFromCommand(data, {
          lastOpenedAt,
          lastClosedAt,
          currentState,
        });
        if (display) setOptimisticTimes(display);
        stopWatch.current?.();
        if (data?.action !== 'remote_unlock' && data?.action !== 'remote_lock') return;
        stopWatch.current = watchManualLockAfterCommand({
          action: data.action,
          lastOpenedAt: display?.lastOpenedAt ?? data?.lastOpenedAt,
          lastClosedAt: display?.lastClosedAt ?? data?.lastClosedAt,
          onDevices: (next, { done }) => {
            setDevices(next || []);
            if (done) setOptimisticTimes(null);
          },
        });
      }}
    />
  );
}
