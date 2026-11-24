# Billing components

PaddleCheckout (organism): opens an existing transaction with the sandbox public token. Props: token, transactionId. States: loading, open, closed, error, awaiting confirmation. No plan activation callbacks. Accessible status region, actionable retry and Studio return. Acceptance: a callback can change explanatory text but never paid access; retry reopens the same transaction. Uses the existing Button atom.

PricingModal and Header remain the existing selection and account-status owners. Do not duplicate them on the payment page.
