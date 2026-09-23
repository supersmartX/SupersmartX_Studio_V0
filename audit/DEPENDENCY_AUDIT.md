# DEPENDENCY AUDIT (Supply Chain)

28 direct deps, all with explicit licenses, zero GPL/AGPL/LGPL/UNKNOWN
(manifest evidence, 2026-09-23). No deprecated flags. Single React 19 /
Next 16 lines. Prod `npm audit`: 0 vulnerabilities (Next 16.3.6 patched
RCEs; sharp transitive fixed). Dev-only moderate (esbuild via vitest)
deferred — fix requires breaking vitest major.

| Notable | Status |
| ------- | ------ |
| next-auth 5.0.0-beta.32 (ISC) | P2 SEC-002: only prerelease in tree; auth-critical |
| mediabunny 1.59.0 exact (MPL-2.0) | P3: sole weak-copyleft; consumed unmodified from node_modules — counsel confirm |
| @cashfreepayments/cashfree-js (MIT) | P3 QUAL-002: zero imports — dead dep, remove |
| @types/better-sqlite3 (MIT) | P3 QUAL-002: orphan types, no runtime — remove |
| Everything else (MIT/Apache-2.0/ISC) | OK |

Range policy: 26/28 `^`-ranged (float within major — acceptable with
lockfile committed); mediabunny exact-pinned (correct for a fragile
media engine). No vendored code. No install scripts flagged (not
deep-scanned — recommend `npm audit signatures` / Socket pre-close).
Transitive tree not fully enumerated — acquirer should run SCA (Snyk/
Socket/Dependabot) and enable alerts; low cost, standard practice.
