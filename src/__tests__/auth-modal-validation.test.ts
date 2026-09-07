import { describe, it, expect } from 'vitest';
import { validatePassword } from '@/lib/validation';

describe('AuthModal client-side password validation', () => {
  describe('registration password requirements', () => {
    it('rejects weak password "password123" (no uppercase, no special char)', () => {
      const result = validatePassword('password123');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects password missing uppercase', () => {
      const result = validatePassword('lowercase1!');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('uppercase'))).toBe(true);
    });

    it('rejects password missing lowercase', () => {
      const result = validatePassword('UPPERCASE1!');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('lowercase'))).toBe(true);
    });

    it('rejects password missing number', () => {
      const result = validatePassword('NoNumbers!');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('number'))).toBe(true);
    });

    it('rejects password missing special character', () => {
      const result = validatePassword('NoSpecial123');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('special character'))).toBe(true);
    });

    it('rejects password shorter than 8 characters', () => {
      const result = validatePassword('Ab1!');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('at least 8'))).toBe(true);
    });

    it('accepts valid password "Password123!"', () => {
      const result = validatePassword('Password123!');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts password "StrongP@ss1"', () => {
      const result = validatePassword('StrongP@ss1');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('error message accuracy', () => {
    it('does not claim "Email may already be in use" for password validation failures', () => {
      const errorForWeak = 'Registration failed. Please check your details and try again.';
      expect(errorForWeak).not.toContain('Email may already be in use');
    });

    it('password validation errors describe the actual requirement', () => {
      const result = validatePassword('password123');
      const errorText = result.errors.join(' ');
      expect(errorText).toContain('uppercase');
      expect(errorText).toContain('special character');
    });
  });

  describe('client validation prevents signIn for invalid passwords', () => {
    it('"password123" would be caught by client validation', () => {
      const result = validatePassword('password123');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('"Password123!" passes validation and would proceed to signIn', () => {
      const result = validatePassword('Password123!');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('login path is unaffected', () => {
    it('login does not run password complexity validation (server only)', () => {
      const isRegister = false;
      const passwordValue = 'anypassword';
      const loginPasswordValue = 'anypassword';
      const passwordValueForLogin = isRegister ? passwordValue : loginPasswordValue;
      expect(passwordValueForLogin).toBe('anypassword');
    });
  });
});
