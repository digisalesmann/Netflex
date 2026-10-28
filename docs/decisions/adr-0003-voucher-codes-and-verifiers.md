# ADR-0003: Voucher code format and storage

- Status: Proposed (Phase 0) — usability check with owner pending
- Date: 2026-10-28

## Context

Spec §8.2: CSPRNG codes, enough entropy, no confusing characters, store a keyed verifier not plaintext, never log codes, rate-limit redemption.

## Decision

- Alphabet (31 chars, no `0 O 1 I L`): `23456789ABCDEFGHJKMNPQRSTUVWXYZ`.
- Length 12, displayed `XXXX-XXXX-XXXX`. Entropy = 12 × log2(31) ≈ **59.4 bits**. With redemption limited to e.g. 10 attempts/hour per device and per IP, plus a global anomaly alarm, guessing any one of even 10,000 live codes is infeasible (2^59.4 ≈ 7.8 × 10^17 codes; with 10^4 live codes an attacker needs on the order of 10^13 guesses to hit one).
- Generated with `crypto.randomInt` (rejection-free uniform choice).
- Input normalization: uppercase, strip spaces/dashes, map common confusions (`O→0` is _not_ valid since 0 isn't in the alphabet → reject generically).
- Stored: `verifier = HMAC-SHA256(VOUCHER_PEPPER, normalizedCode)` (unique index) + `hint = last 4 chars` for support lookups. Pepper lives in the secret manager and is versioned (`verifierKeyVersion`) to allow rotation.
- Plaintext is shown once to the buyer (order status page, receipt SMS/email if configured) and never logged; logger redaction includes `code`, `voucher`, `voucherCode`.
- Errors are generic: "That code can't be used. Check it and try again, or contact support." The same response for not-found, revoked, wrong property.

## Interaction with the gateway

If the gateway authenticates vouchers locally (HotSpot local users), the router needs a usable credential, which conflicts with verifier-only storage. Options are compared in ADR-0004; the RADIUS route keeps the voucher verifier-only.

## Consequences

- A DB leak doesn't reveal usable codes without the pepper.
  − Lost codes can't be "looked up"; recovery = verified owner requests a reissue (old revoked).
