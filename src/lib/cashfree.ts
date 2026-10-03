declare global {
  interface Window {
    Cashfree?: (options: { mode: string }) => CashfreeInstance;
  }
}

interface CashfreeInstance {
  checkout: (options: {
    paymentSessionId: string;
    redirectTarget: string;
    returnUrl?: string;
  }) => Promise<{ error?: { message: string }; redirect?: boolean }>;
}

export type CashfreeEnv = 'sandbox' | 'production';

/**
 * Non-throwing read of the build-time browser mode, or `null` when it is unset
 * or not exactly `sandbox`/`production`.
 *
 * Callers that merely need to compare the browser against the server must use
 * this rather than treating a missing value as sandbox: an unset build-time
 * variable would otherwise compare equal to a sandbox order and look healthy.
 */
export function resolveCashfreeMode(): CashfreeEnv | null {
  const env = process.env.NEXT_PUBLIC_CASHFREE_ENV;
  if (env === 'sandbox' || env === 'production') return env;
  return null;
}

/**
 * The browser's authoritative Cashfree environment, mirroring the server guard
 * in `cashfree-fulfillment.ts`.
 *
 * The SDK's mode is fixed when the script loads and every later checkout reuses
 * that one instance, so a wrong mode here is not recoverable mid-session. This
 * used to resolve anything unrecognised — including an unset variable — to
 * `sandbox`, which is the one silent fallback that can point a live browser at
 * the wrong Cashfree environment without anything reporting a failure. Only the
 * two exact values are accepted, and anything else throws.
 */
export function getCashfreeMode(): CashfreeEnv {
  const mode = resolveCashfreeMode();
  if (mode) return mode;
  throw new Error('cashfree_env_invalid');
}

let cashfreePromise: Promise<CashfreeInstance> | null = null;

export function loadCashfreeSDK(): Promise<CashfreeInstance> {
  if (cashfreePromise) return cashfreePromise;

  cashfreePromise = new Promise<CashfreeInstance>((resolve, reject) => {
    if (window.Cashfree) {
      const cf = window.Cashfree({ mode: getCashfreeMode() });
      resolve(cf);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
    script.async = true;
    script.onload = () => {
      if (window.Cashfree) {
        const cf = window.Cashfree({ mode: getCashfreeMode() });
        resolve(cf);
      } else {
        reject(new Error('Cashfree SDK failed to load'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load Cashfree SDK'));
    document.head.appendChild(script);
  }).catch((err) => {
    cashfreePromise = null;
    throw err;
  });

  return cashfreePromise;
}
