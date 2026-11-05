// Server/build configuration only. Never import this module into client code.
export type CashfreeEnv = 'sandbox' | 'production';
export const CASHFREE_API_VERSION = '2022-09-01';
type Environment = Record<string, string | undefined>;

/** Hosted deployments must expose their system context. NODE_ENV alone is not a deployment identity. */
export function requiresCashfreeProduction(env: Environment = process.env): boolean {
  const context = env.VERCEL_ENV;
  const target = env.VERCEL_TARGET_ENV;
  const valid = ['production', 'preview', 'development'];
  if ((env.VERCEL === '1' && !context) || (context && !valid.includes(context))) {
    throw new Error('cashfree_deployment_context_invalid');
  }
  if (context && target && (context === 'production') !== (target === 'production')) {
    throw new Error('cashfree_deployment_context_invalid');
  }
  return context === 'production' || target === 'production';
}

export function getCashfreeEnv(): CashfreeEnv {
  const env = process.env.CASHFREE_ENV;
  if (env !== 'production' && env !== 'sandbox') throw new Error('cashfree_env_invalid');
  // These direct accesses are replaced with immutable literals by next.config.
  const productionBuild = process.env.NEXT_PUBLIC_CASHFREE_PRODUCTION_ONLY === 'true';
  const buildEnv = process.env.CASHFREE_BUILD_ENV;
  if ((productionBuild || requiresCashfreeProduction()) && env !== 'production') {
    throw new Error('cashfree_production_required');
  }
  if (buildEnv !== undefined && buildEnv !== env) throw new Error('cashfree_environment_changed');
  return env;
}

function credential(value: string | undefined): string {
  if (!value || value.trim() !== value || /\s/.test(value)) throw new Error('cashfree_credentials_invalid');
  return value;
}

/** Pure validator also used by next.config before a Production build can succeed. */
export function validateCashfreeConfig(env: Environment, productionOnly: boolean) {
  const mode = env.CASHFREE_ENV;
  if (mode !== 'sandbox' && mode !== 'production') throw new Error('cashfree_env_invalid');
  if (productionOnly && mode !== 'production') throw new Error('cashfree_production_required');
  if (env.NEXT_PUBLIC_CASHFREE_ENV !== mode) throw new Error('cashfree_env_mismatch');
  if (env.CASHFREE_API_VERSION !== CASHFREE_API_VERSION) throw new Error('cashfree_api_version_invalid');
  return {
    mode,
    baseUrl: mode === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg',
    appId: credential(env.CASHFREE_APP_ID),
    secretKey: credential(env.CASHFREE_SECRET_KEY),
    apiVersion: CASHFREE_API_VERSION,
  };
}

export function getCashfreeConfig() {
  const mode = getCashfreeEnv();
  return validateCashfreeConfig({
    CASHFREE_ENV: mode,
    NEXT_PUBLIC_CASHFREE_ENV: process.env.NEXT_PUBLIC_CASHFREE_ENV,
    CASHFREE_API_VERSION: process.env.CASHFREE_API_VERSION,
    CASHFREE_APP_ID: process.env.CASHFREE_APP_ID,
    CASHFREE_SECRET_KEY: process.env.CASHFREE_SECRET_KEY,
  }, requiresCashfreeProduction() || process.env.NEXT_PUBLIC_CASHFREE_PRODUCTION_ONLY === 'true');
}

export function cashfreeHeaders(): Record<string, string> {
  const config = getCashfreeConfig();
  return {
    'Content-Type': 'application/json',
    'x-client-id': config.appId,
    'x-client-secret': config.secretKey,
    'x-api-version': config.apiVersion,
  };
}
