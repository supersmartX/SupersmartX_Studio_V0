export type CheckoutNoticeKind =
  | 'temporary'
  | 'checking'
  | 'activating'
  | 'cancelled'
  | 'unknown'
  | 'unavailable'
  | 'conflict'
  | 'payment_retry'
  | 'timeout';

export const CHECKOUT_NOTICE: Record<CheckoutNoticeKind, { title: string; message: string }> = {
  temporary: { title: "We couldn't start checkout", message: 'Something went wrong while connecting to our payment provider. Please try again.' },
  checking: { title: 'Checking your previous checkout', message: "We're checking whether your previous checkout is still open. You won't be charged again while we check." },
  activating: { title: 'Payment received — activating Creator', message: 'Your payment is confirmed by Paddle. We are finishing access activation now; your current access stays unchanged until that is complete.' },
  cancelled: { title: "Payment wasn't completed", message: "Your payment wasn't completed. You can return to your plans and try again." },
  unknown: { title: 'Previous checkout needs checking', message: "We couldn't confirm whether the previous checkout finished. Check its status before starting another payment." },
  unavailable: { title: 'This plan is temporarily unavailable', message: "We're unable to process this subscription right now. Please try again later." },
  conflict: { title: 'You already have an active subscription', message: 'Your current plan is still active.' },
  payment_retry: { title: 'Your subscription payment needs attention', message: 'Your subscription is already in payment recovery. Update your payment method from the account menu to retry it.' },
  timeout: { title: 'Checkout is still processing', message: 'This can happen when Paddle or the confirmation service is delayed. Check again, or close this window and return later — do not pay twice.' },
};

export function checkoutNoticeFor(status: number, body: { state?: unknown; reservationId?: unknown }): CheckoutNoticeKind {
  if (status === 409 && body.state === 'active_subscription') return 'conflict';
  if (status === 409 && body.state === 'payment_action_required') return 'payment_retry';
  if (typeof body.reservationId === 'string') return 'unknown';
  if (status === 400 || status === 409 || status === 503) return 'unavailable';
  return 'temporary';
}
