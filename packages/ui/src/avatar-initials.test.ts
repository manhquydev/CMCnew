import { describe, it, expect } from 'vitest';
import { initialsOf, colorOf } from './avatar-initials.js';

describe('initialsOf', () => {
  it('takes first letter of first word + first letter of last word for multi-word names', () => {
    expect(initialsOf('Nguyễn Thành Trung')).toBe('NT');
  });

  it('handles a two-word name', () => {
    expect(initialsOf('Trần Bình')).toBe('TB');
  });

  it('takes the first two characters for a single-word name', () => {
    expect(initialsOf('Admin')).toBe('AD');
  });

  it('uppercases the result', () => {
    expect(initialsOf('nguyễn văn an')).toBe('NA');
  });

  it('collapses extra whitespace between words', () => {
    expect(initialsOf('  Lê   Minh  Châu  ')).toBe('LC');
  });

  it('falls back to "?" for an empty name', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
  });
});

describe('colorOf', () => {
  it('is deterministic — same name always resolves to the same color family', () => {
    expect(colorOf('Nguyễn Văn An')).toBe(colorOf('Nguyễn Văn An'));
  });

  it('only ever returns a color from the semantic palette', () => {
    const palette = ['cmc', 'cmcGreen', 'cmcAmber', 'cmcRed', 'cmcGray'];
    const names = ['Trần Thị Bình', 'Lê Minh Châu', 'Phạm Thu Dung', 'Hoàng Văn Em', 'Admin'];
    for (const name of names) {
      expect(palette).toContain(colorOf(name));
    }
  });

  it('spreads across the whole palette (single-char names chosen so char-code sums land on every mod-5 bucket)', () => {
    expect(colorOf('a')).toBe('cmcAmber');
    expect(colorOf('b')).toBe('cmcRed');
    expect(colorOf('c')).toBe('cmcGray');
    expect(colorOf('d')).toBe('cmc');
    expect(colorOf('e')).toBe('cmcGreen');
  });
});
