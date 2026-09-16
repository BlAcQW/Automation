import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Haptic feedback, by meaning rather than by intensity.
 *
 * Callers say what happened ("a message was sent"), not how hard to buzz, so
 * the physical vocabulary stays consistent across the app instead of each
 * screen picking an intensity at random.
 *
 * Every call is fire-and-forget and swallows its error: haptics are unavailable
 * on simulators, on some Android hardware, and when the user has disabled
 * system haptics — none of which should ever surface as a failure.
 */

function fire(run: () => Promise<void>): void {
    // Android's generic vibration is coarse enough that firing it on every tap
    // reads as noise rather than feedback; keep the light cues to iOS.
    if (Platform.OS === 'web') return;
    void run().catch(() => undefined);
}

/** A button, tab or row was tapped. The default for anything pressable. */
export function tap(): void {
    if (Platform.OS !== 'ios') return;
    fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** A more consequential press — sending, confirming, committing. */
export function press(): void {
    fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** A long-press opened something, or a selection changed. */
export function select(): void {
    if (Platform.OS !== 'ios') return;
    fire(() => Haptics.selectionAsync());
}

/** The thing the user wanted worked — booking made, message delivered. */
export function success(): void {
    fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** It didn't work. Worth a buzz on both platforms. */
export function error(): void {
    fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
