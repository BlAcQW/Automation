import { useCallback, useState } from 'react';

/**
 * Pull-to-refresh state that belongs to the user's gesture, not to the query.
 *
 * Binding `RefreshControl.refreshing` to React Query's `isRefetching` looks
 * right but isn't: every background refetch — the 30s poll, a cache
 * invalidation from a websocket event, a tab remount — flips `refreshing` to
 * true, and on iOS a programmatic `refreshing={true}` drags the list down and
 * shows the spinner. iOS only snaps it back once the user touches the list, so
 * the spinner sits above loaded data "until you push it".
 *
 * The spinner should mean one thing: "you pulled, we're fetching". So it tracks
 * the gesture alone, and background refetches stay invisible — the data just
 * updates in place.
 */
export function usePullRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  return { refreshing, onRefresh };
}
