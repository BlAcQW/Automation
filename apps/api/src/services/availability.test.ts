import { describe, expect, it } from 'vitest';
import { maxConcurrentDuring } from './availability.js';

/** Helper: build an interval from "HH:MM" pairs on a fixed day. */
function iv(from: string, to: string) {
  const day = '2026-10-05T';
  return { startTime: new Date(`${day}${from}:00Z`), endTime: new Date(`${day}${to}:00Z`) };
}

describe('maxConcurrentDuring', () => {
  it('returns 0 when nothing overlaps', () => {
    expect(maxConcurrentDuring(iv('14:00', '15:00'), [iv('09:00', '10:00')])).toBe(0);
  });

  it('counts a single overlapping booking', () => {
    expect(maxConcurrentDuring(iv('14:00', '15:00'), [iv('14:00', '15:00')])).toBe(1);
  });

  it('counts bookings that overlap at the same instant', () => {
    expect(
      maxConcurrentDuring(iv('14:00', '15:00'), [iv('14:00', '15:00'), iv('14:30', '15:30')]),
    ).toBe(2);
  });

  // The reason this is a sweep and not a simple count. Two bookings that each
  // overlap a long candidate slot, but never each other, only ever occupy ONE
  // resource at a time — so a 2-chair salon can still take the candidate.
  // Counting overlaps would say 2 and wrongly refuse the booking.
  it('does not double-count bookings that never overlap each other', () => {
    expect(
      maxConcurrentDuring(iv('14:00', '15:30'), [iv('14:00', '14:30'), iv('15:00', '15:30')]),
    ).toBe(1);
  });

  it('finds the busiest moment, not the first or last', () => {
    // 14:30-15:00 has three at once; the edges have fewer.
    expect(
      maxConcurrentDuring(iv('14:00', '16:00'), [
        iv('14:00', '15:00'),
        iv('14:30', '15:30'),
        iv('14:30', '15:00'),
        iv('15:45', '16:00'),
      ]),
    ).toBe(3);
  });

  it('treats touching intervals as not overlapping', () => {
    // A booking ending exactly when the slot starts frees the chair.
    expect(maxConcurrentDuring(iv('14:00', '15:00'), [iv('13:00', '14:00')])).toBe(0);
    expect(maxConcurrentDuring(iv('14:00', '15:00'), [iv('15:00', '16:00')])).toBe(0);
  });

  it('clips overlap to the candidate window', () => {
    // A long booking spanning the whole day still only counts as one here.
    expect(maxConcurrentDuring(iv('14:00', '14:30'), [iv('08:00', '20:00')])).toBe(1);
  });

  it('handles an empty booking list', () => {
    expect(maxConcurrentDuring(iv('14:00', '15:00'), [])).toBe(0);
  });
});
