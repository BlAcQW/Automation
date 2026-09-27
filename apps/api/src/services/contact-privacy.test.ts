import { describe, expect, it } from 'vitest';
import {
  maskPhone,
  maskHandle,
  maskEmail,
  shouldMaskContacts,
  maskContact,
} from './contact-privacy.js';

describe('maskPhone', () => {
  it('keeps the last four digits and the leading plus', () => {
    expect(maskPhone('+233241234567')).toBe('+••••••••4567');
  });

  it('masks a local-format number', () => {
    expect(maskPhone('0241234567')).toBe('••••••4567');
  });

  it('ignores spaces and punctuation when counting digits', () => {
    // The mask must not be defeated by formatting.
    expect(maskPhone('+233 24 123 4567')).toBe('+••••••••4567');
  });

  it('masks everything when the number is too short to keep a tail', () => {
    expect(maskPhone('123')).toBe('•••');
  });

  it('returns empty for empty input', () => {
    expect(maskPhone('')).toBe('');
  });
});

describe('maskHandle', () => {
  it('keeps the first two characters and the last one', () => {
    expect(maskHandle('amaboateng')).toBe('am•••••••g');
  });

  it('preserves a leading @', () => {
    expect(maskHandle('@amaboateng')).toBe('@am•••••••g');
  });

  it('masks all but the first character on a short handle', () => {
    expect(maskHandle('ama')).toBe('a••');
  });

  it('returns empty for empty input', () => {
    expect(maskHandle('')).toBe('');
  });
});

describe('maskEmail', () => {
  it('keeps the first character and the domain', () => {
    // Domain is kept: it helps staff recognise a customer without
    // giving them an address they can export and message.
    expect(maskEmail('amaboateng@gmail.com')).toBe('a•••••••••@gmail.com');
  });

  it('masks a single-character local part', () => {
    expect(maskEmail('a@gmail.com')).toBe('•@gmail.com');
  });

  it('falls back to handle masking when there is no @', () => {
    expect(maskEmail('notanemail')).toBe('no•••••••l');
  });
});

describe('shouldMaskContacts', () => {
  it('never masks for the owner', () => {
    // The owner owns the customer list; masking them would be theatre.
    expect(shouldMaskContacts('OWNER', true)).toBe(false);
    expect(shouldMaskContacts('OWNER', false)).toBe(false);
  });

  it('masks for staff when the tenant has it switched on', () => {
    expect(shouldMaskContacts('STAFF', true)).toBe(true);
  });

  it('does not mask for staff when the tenant has switched it off', () => {
    expect(shouldMaskContacts('STAFF', false)).toBe(false);
  });

  it('masks for an unrecognised role when enabled', () => {
    // Fail closed: an unknown role is not trusted with raw contacts.
    expect(shouldMaskContacts('SOMETHING_NEW', true)).toBe(true);
  });
});

describe('maskContact', () => {
  it('leaves the record untouched when masking is off', () => {
    const row = { customerName: 'Ama', customerPhone: '+233241234567' };
    expect(maskContact(row, false)).toEqual(row);
  });

  it('masks phone, handle and email but never the name', () => {
    // Staff need the name to do the job; it is not a contact channel.
    expect(
      maskContact(
        {
          customerName: 'Ama Boateng',
          customerPhone: '+233241234567',
          customerEmail: 'amaboateng@gmail.com',
          customerHandle: '@amaboateng',
        },
        true,
      ),
    ).toEqual({
      customerName: 'Ama Boateng',
      customerPhone: '+••••••••4567',
      customerEmail: 'a•••••••••@gmail.com',
      customerHandle: '@am•••••••g',
      contactMasked: true,
    });
  });

  it('passes through fields it does not know about', () => {
    const out = maskContact({ id: 'c1', customerPhone: '+233241234567' }, true);
    expect(out.id).toBe('c1');
  });

  it('tolerates null contact fields', () => {
    const out = maskContact({ customerPhone: null, customerEmail: null }, true);
    expect(out.customerPhone).toBeNull();
    expect(out.customerEmail).toBeNull();
  });
});
