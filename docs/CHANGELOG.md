# Change log

## 2026-11-20 payment remediation

Implemented initial enrollment recovery, Paddle payment handoff, paid-only entitlement, renewal attribution, serialized account updates, and active/failed-payment customer guidance. Validation and remaining release work are tracked in PAYMENT_REMEDIATION.md. No deployment or live activation implied.

## 2026-11-21 Paddle confirmation email

Connected the existing Resend confirmation to verified Paddle transaction completion, addressed to the customer email on the Paddle transaction and deduplicated by transaction ID. Pending payments do not send confirmation. Resend must be configured; sandbox and production email delivery still require runtime verification.
