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

- Keep the default edition local-first, usable offline after first load, and free of telemetry.
- Preserve lossless export and backward-compatible imports. Schema changes need a migration and round-trip tests.
- Completed calibration records and issued artifacts must not be silently rewritten.
- Do not add claims of ISO/IEC 17025, FDA, 21 CFR Part 11, accreditation, validation, or traceability without a precisely scoped, independently reviewable basis.
- Measurement calculations need unit tests for boundaries, date handling, decimal behavior, and failure modes.
- UI changes should remain keyboard accessible and usable at mobile widths.

## Pull requests

Keep changes focused. Describe the operator problem, the chosen behavior, tests, data-model impact, and screenshots for visible changes. Link an issue when practical. By contributing, you agree that your contribution is licensed under Apache-2.0.
