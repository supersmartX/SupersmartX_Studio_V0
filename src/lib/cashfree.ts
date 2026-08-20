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

function getCashfreeMode(): string {
  if (typeof window === 'undefined') return 'sandbox';
  const env = process.env.NEXT_PUBLIC_CASHFREE_ENV || 'sandbox';
  return env === 'production' ? 'production' : 'sandbox';
}

let cashfreePromise: Promise<CashfreeInstance> | null = null;

export function loadCashfreeSDK(): Promise<CashfreeInstance> {
  if (cashfreePromise) return cashfreePromise;

  cashfreePromise = new Promise((resolve, reject) => {
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
  });

  return cashfreePromise;
}
