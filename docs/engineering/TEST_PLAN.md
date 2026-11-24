# Payment acceptance checks

- Given an unpaid billed transaction, when a notification arrives, then access is not granted.
- Given a renewal with inherited enrollment metadata and a new transaction ID, when its paid transaction is verified, then its period is applied without changing the original reservation identity.
- Given a foreign subscription/customer or invalid original consent, when a renewal arrives, then it is rejected for review.
- Given temporarily incomplete paid transaction details, when processed, then retry rather than permanently classify as invalid.
- Given concurrent grants/refunds, when they update one user, then account locking serializes coverage reads and writes. Validate with disposable PostgreSQL, not mocks alone.
- Given a valid merchant payment URL, when redirected, then only the configured origin/path is accepted; lookalikes and credentials are rejected.
- Given a durable webhook receipt, when worker triggering is slow, then acknowledgement does not wait for it.

Run targeted Vitest, TypeScript, lint and build. Provider sandbox and browser E2E, PostgreSQL concurrency and migration rehearsals remain separate acceptance evidence. Never run destructive database suites against a deployed URL.
