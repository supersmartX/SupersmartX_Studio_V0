# Payment reliability requirements

Platform: existing Next.js SaaS. Approved implementation follows the payment audit and TODO list in this chat on 2026-11-20.

Customers must complete one checkout, receive only verified paid access, renew without reusing an initial transaction identity, recover interruptions, and cancel future collection without losing paid coverage. Browser callbacks never grant access. Preserve legacy access and payment evidence. Live activation and deployment require separate release evidence.

Authentication, ownership and basic billing exist. Gaps remain in payment-method updates, invoices, notifications, pending-payment UX, operational recovery and live verification; see PAYMENT_REMEDIATION.md. Empty/loading/success/error/offline/permission/rate-limit states are required for billing screens.
