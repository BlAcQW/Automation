import { describe, expect, it } from 'vitest';
import { buildExpoMessages } from './push.js';

describe('buildExpoMessages', () => {
  it('keeps valid Expo tokens and drops invalid ones', () => {
    const tokens = [
      'ExponentPushToken[abc123]',
      'ExpoPushToken[xyz]',
      'not-a-token',
      'fcm:randomstring',
      '',
    ];
    const messages = buildExpoMessages(tokens, { title: 'Hi', body: 'There' });
    expect(messages.map((m) => m.to)).toEqual(['ExponentPushToken[abc123]', 'ExpoPushToken[xyz]']);
  });

  it('shapes the Expo message with title, body, data and sound', () => {
    const [msg] = buildExpoMessages(['ExponentPushToken[a]'], {
      title: 'New booking',
      body: 'Ama booked Haircut',
      data: { type: 'NEW_BOOKING', bookingId: 'b1' },
    });
    expect(msg).toEqual({
      to: 'ExponentPushToken[a]',
      title: 'New booking',
      body: 'Ama booked Haircut',
      data: { type: 'NEW_BOOKING', bookingId: 'b1' },
      sound: 'default',
    });
  });

  it('defaults data to an empty object', () => {
    const [msg] = buildExpoMessages(['ExponentPushToken[a]'], { title: 't', body: 'b' });
    expect(msg.data).toEqual({});
  });

  it('returns an empty array when there are no valid tokens', () => {
    expect(buildExpoMessages(['bad', ''], { title: 't', body: 'b' })).toEqual([]);
  });
});
