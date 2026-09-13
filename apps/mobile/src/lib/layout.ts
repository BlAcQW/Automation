/**
 * Shared metrics for the floating (glass) tab bar.
 *
 * The tab bar is absolutely positioned so screen content scrolls *underneath*
 * the blur. That means scroll containers on tab screens have to reserve room at
 * the bottom themselves — use TAB_BAR_INSET for their contentContainerStyle so
 * the last row never sits trapped behind the bar.
 */
export const TAB_BAR_HEIGHT = 62;

/** Gap between the bar and the screen edges. */
export const TAB_BAR_MARGIN = 16;

export const TAB_BAR_RADIUS = 26;

/** Bottom padding for scrollable content on tab screens. */
export const TAB_BAR_INSET = TAB_BAR_HEIGHT + TAB_BAR_MARGIN * 2 + 12;
