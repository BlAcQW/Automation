/**
 * Shared metrics for the floating (glass) tab bar.
 *
 * The tab bar is absolutely positioned so screen content scrolls *underneath*
 * the blur. That means scroll containers on tab screens have to reserve room at
 * the bottom themselves — use TAB_BAR_INSET for their contentContainerStyle so
 * the last row never sits trapped behind the bar.
 */
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const TAB_BAR_HEIGHT = 62;

/** Gap between the bar and the screen edges. */
export const TAB_BAR_MARGIN = 16;

export const TAB_BAR_RADIUS = 26;

/** Bottom padding for scrollable content on tab screens. */
export const TAB_BAR_INSET = TAB_BAR_HEIGHT + TAB_BAR_MARGIN * 2 + 12;

/**
 * Bottom padding for scrollable content on *pushed* (stack) screens — the ones
 * with an AppHeader and no tab bar.
 *
 * These still have to clear the phone's system UI: the home indicator on iOS and
 * the gesture/navigation bar on Android, which RN 0.81 draws content under by
 * default (edge-to-edge). Without this the last row of a list or the final
 * button in a form sits beneath the system bar and can't be tapped.
 */
export function useBottomInset(extra = 16): number {
  const insets = useSafeAreaInsets();
  return insets.bottom + extra;
}
