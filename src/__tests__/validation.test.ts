import { describe, it, expect } from 'vitest';
import { validatePassword, type PasswordValidation } from '@/lib/validation';

describe('validatePassword', () => {
  it('rejects password shorter than 8 characters', () => {
    const result = validatePassword('Ab1!');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('at least 8'))).toBe(true);
  });

  it('rejects password longer than 128 characters', () => {
    const longPw = 'A' + 'a'.repeat(126) + '1!';
    const result = validatePassword(longPw);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('at most 128'))).toBe(true);
  });

  it('rejects password without uppercase', () => {
    const result = validatePassword('lowercase1!');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('uppercase'))).toBe(true);
  });

  it('rejects password without lowercase', () => {
    const result = validatePassword('UPPERCASE1!');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('lowercase'))).toBe(true);
  });

  it('rejects password without number', () => {
    const result = validatePassword('NoNumbers!');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('number'))).toBe(true);
  });

  it('rejects password without special character', () => {
    const result = validatePassword('NoSpecial123');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('special character'))).toBe(true);
  });

  it('accepts valid password meeting all requirements', () => {
    const result = validatePassword('StrongP@ss1');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns multiple errors for invalid password', () => {
    const result = validatePassword('weak');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });

  it('accepts password with various special characters', () => {
    const specials = ['!', '@', '#', '*', '+', '-', '=', '[', ']', '{', '}', '|', ';', ':', ',', '.', '<', '>', '/', '?'];
    for (const char of specials) {
      const pw = 'Test' + char + 'abc1';
      const result = validatePassword(pw);
      expect(result.valid, `Failed for char: ${char} (${char.charCodeAt(0)})`).toBe(true);
    }
  });
});
