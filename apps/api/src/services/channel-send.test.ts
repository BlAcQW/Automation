import { describe, expect, it } from 'vitest';
import { buildTextRequest, supportsOutOfWindowMessaging } from './channel-send.js';

const creds = { senderId: 'SENDER1', accessToken: 'tok' };

describe('buildTextRequest', () => {
  it('uses the WhatsApp envelope for WhatsApp', () => {
    const { url, body } = buildTextRequest({
      channel: 'WHATSAPP',
      credentials: creds,
      recipientId: '+233241234567',
      text: 'Hello',
    });
    expect(url).toBe('https://graph.facebook.com/v21.0/SENDER1/messages');
    expect(body).toEqual({
      messaging_product: 'whatsapp',
      to: '+233241234567',
      type: 'text',
      text: { body: 'Hello' },
    });
  });

  it('uses the Send API envelope for Messenger', () => {
    // Different shape entirely from WhatsApp — recipient/message, not to/text.
    const { body } = buildTextRequest({
      channel: 'MESSENGER',
      credentials: creds,
      recipientId: 'PSID1',
      text: 'Hello',
    });
    expect(body).toEqual({
      recipient: { id: 'PSID1' },
      message: { text: 'Hello' },
      messaging_type: 'RESPONSE',
    });
  });

  it('uses the same Send API envelope for Instagram', () => {
    const { body } = buildTextRequest({
      channel: 'INSTAGRAM',
      credentials: creds,
      recipientId: 'IGSID1',
      text: 'Hi',
    });
    expect(body).toEqual({
      recipient: { id: 'IGSID1' },
      message: { text: 'Hi' },
      messaging_type: 'RESPONSE',
    });
  });

  it('addresses Instagram by the IG user id, not the page id', () => {
    const { url } = buildTextRequest({
      channel: 'INSTAGRAM',
      credentials: { senderId: 'IGUSER9', accessToken: 'tok' },
      recipientId: 'IGSID1',
      text: 'Hi',
    });
    expect(url).toBe('https://graph.facebook.com/v21.0/IGUSER9/messages');
  });
});

describe('supportsOutOfWindowMessaging', () => {
  // This guards a real product trap: reminders are the core of the no-show
  // story, and only WhatsApp can deliver one after the window shuts. On the
  // other channels the caller has to fall back to SMS.
  it('is true only for WhatsApp', () => {
    expect(supportsOutOfWindowMessaging('WHATSAPP')).toBe(true);
    expect(supportsOutOfWindowMessaging('INSTAGRAM')).toBe(false);
    expect(supportsOutOfWindowMessaging('MESSENGER')).toBe(false);
  });
});
