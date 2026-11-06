import { describe, expect, it } from 'vitest';
import { validateCashfreeConfig } from '@/lib/cashfree-config';

const productionConfig = {
  CASHFREE_ENV: 'production',
  NEXT_PUBLIC_CASHFREE_ENV: 'production',
  CASHFREE_API_VERSION: '2022-09-01',
  CASHFREE_APP_ID: 'dummy-app-id',
  CASHFREE_SECRET_KEY: 'dummy-secret-key',
};

describe.each([
  ['CASHFREE_APP_ID', 'appId'],
  ['CASHFREE_SECRET_KEY', 'secretKey'],
] as const)('%s credential validation', (variable, property) => {
  it.each([
    ['normal', 'dummy-credential'],
    ['unmatched leading single quote', "'dummy-credential"],
    ['unmatched trailing single quote', "dummy-credential'"],
    ['unmatched leading double quote', '"dummy-credential'],
    ['unmatched trailing double quote', 'dummy-credential"'],
    ['mismatched surrounding quotes', "'dummy-credential\""],
    ['reverse mismatched surrounding quotes', '"dummy-credential\''],
    ['internal quote', "dummy'credential"],
    ['one single quote', "'"],
    ['one double quote', '"'],
  ])('accepts %s unchanged', (_label, value) => {
    const result = validateCashfreeConfig({ ...productionConfig, [variable]: value }, true);
    expect(result[property]).toBe(value);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['leading whitespace', ' dummy-credential'],
    ['trailing whitespace', 'dummy-credential '],
    ['leading tab', '\tdummy-credential'],
    ['trailing newline', 'dummy-credential\n'],
    ['internal whitespace', 'dummy credential'],
    ['matching single quotes', "'dummy-credential'"],
    ['matching double quotes', '"dummy-credential"'],
    ['empty single-quoted value', "''"],
    ['empty double-quoted value', '""'],
  ])('rejects %s with the existing error', (_label, value) => {
    expect(() => validateCashfreeConfig({ ...productionConfig, [variable]: value }, true))
      .toThrowError(new Error('cashfree_credentials_invalid'));
  });
});
