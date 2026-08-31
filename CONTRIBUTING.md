# Contributing to GaugeBase

Thanks for helping make calibration recordkeeping more open and portable.

## Development

Requirements: Node.js 22.13 or newer and npm.

```bash
npm ci
npm run dev
```

Before opening a pull request, run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Principles

- Keep local mode account-free, usable offline after first load, and free of application telemetry.
- Keep team mode optional. Enforce workspace membership and role checks on the server; never rely on hidden UI controls for authorization.
- Preserve lossless export and backward-compatible imports. Schema changes need a migration and round-trip tests.
- Completed calibration cores and captured equipment snapshots must not be silently rewritten. New evidence and approvals may be appended without changing the sealed core hash.
- Treat identity headers as trusted only when supplied by the supported authentication gateway. Do not add development shortcuts that turn arbitrary client headers into authenticated identities.
- Store team attachment bytes in object storage, not in the synchronized workspace JSON. Validate size, scope access by active membership, and verify digests server-side.
- Preserve optimistic version checks for team writes and make conflicts visible. Do not introduce last-writer-wins data loss.
- Do not add claims of ISO/IEC 17025, FDA, 21 CFR Part 11, accreditation, validation, or traceability without a precisely scoped, independently reviewable basis.
- Measurement calculations need documented assumptions plus unit tests for boundaries, distributions, degrees of freedom, balanced-design requirements, dates, decimal behavior, and failure modes.
- New integrity controls must document what is and is not covered by a hash. Do not call a checksum a digital signature.
- UI changes should remain keyboard accessible and usable at mobile widths.
- Documentation and migrations are part of the change. Update the relevant operator, validation, security, privacy, or API notes whenever behavior changes.

## Pull requests

Keep changes focused. Describe the operator problem, the chosen behavior, tests, data-model and migration impact, security/privacy considerations, and screenshots for visible changes. Link an issue when practical.

For a metrology change, include representative hand calculations or a cited, independently reproducible reference dataset without copying restricted material. State the measurement model and assumptions. A green unit test alone is not evidence that a method is fit for a particular laboratory.

For a team API change, add authorization tests for allowed and denied roles, stale-version behavior, malformed and oversized inputs, and cross-workspace object access. Treat API responses and free text as untrusted input.

By contributing, you agree that your contribution is licensed under Apache-2.0.
