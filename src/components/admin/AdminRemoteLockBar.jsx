import React, { useCallback, useEffect, useRef, useState } from 'react';
import RemoteBridgeControls from '@/components/admin/RemoteBridgeControls';
import { bridgeOnlineFromDevices, loadLockPresenceDevices, watchManualLockAfterCommand } from '@/utils/lockPresence';

export default function AdminRemoteLockBar() {
  const [devices, setDevices] = useState([]);
  const [optimisticTimes, setOptimisticTimes] = useState(null);
  const [watching, setWatching] = useState(false);
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
      watching={watching}
      onSuccess={(data) => {
        const nextState = data?.currentState
          || (data?.action === 'remote_unlock' ? 'unlocked' : data?.action === 'remote_lock' ? 'locked' : null);
        if (data?.lastOpenedAt || data?.lastClosedAt || nextState) {
          setOptimisticTimes({
            lastOpenedAt: data?.lastOpenedAt ?? null,
            lastClosedAt: data?.lastClosedAt ?? null,
            currentState: nextState,
          });
        }
        stopWatch.current?.();
        const alreadyClosed = data?.action === 'remote_unlock' && data?.currentState === 'locked';
        if (alreadyClosed) {
          setWatching(false);
          load();
          return;
        }
        setWatching(data?.action === 'remote_unlock');
        stopWatch.current = watchManualLockAfterCommand({
          action: data?.action,
          lastOpenedAt: data?.lastOpenedAt,
          lastClosedAt: data?.lastClosedAt,
          currentState: data?.currentState,
          onDevices: (next, { done }) => {
            setDevices(next || []);
            if (done) {
              setOptimisticTimes(null);
              setWatching(false);
            }
          },
        });
      }}
    />
  );
}
