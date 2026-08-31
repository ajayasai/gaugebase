# Metrology methods and assumptions

GaugeBase exposes calculation inputs, unrounded intermediate results, assumptions, and warnings so a qualified reviewer can reproduce the work. The software cannot determine whether an input model or dataset is technically valid for a particular calibration.

## Uncertainty budgets

For contributor `i`, GaugeBase calculates standard uncertainty and its signed sensitivity contribution as:

```text
u_i = quoted_uncertainty_i / divisor_i
c_i u_i = sensitivity_coefficient_i × u_i
```

Unless an explicit positive divisor is entered, the distribution defaults are:

| Distribution | Default divisor | Interpretation expected by the engine                                                                 |
| ------------ | --------------: | ----------------------------------------------------------------------------------------------------- |
| Normal       |               1 | Enter a standard uncertainty, or override the divisor when entering an expanded value such as `k = 2` |
| Rectangular  |              √3 | Enter the distribution half-width                                                                     |
| Triangular   |              √6 | Enter the distribution half-width                                                                     |
| U-shaped     |              √2 | Enter the distribution half-width                                                                     |

Independent contributions are combined by root sum square:

```text
u_c = sqrt(sum((c_i u_i)^2))
U = k × u_c
```

The default coverage factor is 2. The engine does not infer a confidence level or select a Student-t coverage factor from effective degrees of freedom; the organization must choose and justify `k`.

Finite contributor degrees of freedom are combined with the Welch–Satterthwaite approximation. Omitted degrees of freedom are treated as infinite. Variance percentages are calculated against the combined variance. Values are returned without deliberate rounding; display rounding must not be fed back into a later calculation.

### Required reviewer judgments

- Define the measurand and measurement model.
- Confirm all quantities are expressed in compatible units; GaugeBase labels units but does not perform dimensional conversion or dimensional analysis.
- Decide whether quoted inputs are standard uncertainties, expanded uncertainties, or distribution half-widths, and set divisors accordingly.
- Establish Type A statistics, Type B evidence, degrees of freedom, sensitivity coefficients, and coverage factor.
- Address drift, resolution, repeatability, reproducibility, environmental effects, method bias, reference-standard uncertainty, and other applicable contributors.
- Resolve correlation. The engine assumes independent contributors and does not include covariance terms. Correlated quantities must be transformed appropriately or evaluated outside this calculator.
- Review significant figures and the reporting rule only after the calculation.

The calculator does not implement nonlinear propagation, Monte Carlo methods, asymmetric distributions, covariance matrices, Bayesian models, automatic unit conversion, or automatic uncertainty extraction from certificates.

## Conformity decision rules

The engine requires at least one finite specification limit and records the selected rule. Limits are inclusive.

### Simple acceptance

The measured value passes when it is within the stated limit or limits and fails when outside. Uncertainty is not considered. This is sometimes called shared-risk acceptance; the organization remains responsible for deciding whether it is permitted.

### Guard-banded acceptance

An absolute non-negative guard band is moved inward from each available specification limit. A value:

- inside the narrower acceptance interval is `pass`;
- outside specification is `fail`; and
- inside specification but outside the narrowed acceptance interval is `conditional` and requires review.

The calibration-entry workflow derives the guard band from the reading’s expanded uncertainty multiplied by the configured guard-band multiplier. The pure calculation engine also accepts a directly supplied absolute guard band. A guard band larger than the available two-sided specification interval is rejected.

### Uncertainty-aware interval

The engine forms `[measured value - U, measured value + U]` from the entered expanded uncertainty:

- the whole interval inside specification is `pass`;
- the whole interval outside specification is `fail`;
- an in-specification measured value whose interval crosses a limit is `conditional`; and
- an out-of-specification measured value whose interval overlaps the conforming region is `indeterminate`.

This is an explicit interval rule, not an automatic claim of a particular false-accept or false-reject probability. Any customer-agreed decision rule, guard-band basis, risk model, and wording must be reviewed and documented by the issuing organization.

### Calibration-level outcomes

Point-level results are evidence for the operator-selected calibration outcome. Conditional calibration release requires a documented use limitation, review date, and approver. A failed calibration changes the equipment lifecycle to out of service. These workflow controls do not replace a technical review of adjustment, as-found versus as-left behavior, or affected-product risk.

## Crossed Gage R&R

GaugeBase implements the **balanced crossed average-and-range method**.

Input must include:

- at least two parts;
- at least two appraisers;
- at least two trials per part/appraiser cell; and
- exactly the same complete trial set for every crossed cell.

Duplicate cells, missing observations, incomplete crosses, and non-finite values are rejected. Repeatability is estimated from the average within-cell range and the applicable `d2` constant. Reproducibility is estimated from the range of appraiser grand means with the average-and-range repeatability correction. Part-to-part variation comes from the range of part grand means. Negative corrected reproducibility variance is truncated to zero and reported as a warning.

The default study variation is six times standard deviation. When both specification limits are supplied, the result also reports percent of tolerance. The calculator reports:

- repeatability/equipment variation;
- reproducibility/appraiser variation;
- combined Gage R&R;
- part-to-part and total variation;
- standard deviation, variance, study variation, percent study variation, percent contribution, and optional percent tolerance; and
- number of distinct categories, calculated as the floored `1.41 × part variation / Gage R&R` ratio.

The displayed screening classification uses common thresholds:

- `acceptable`: Gage R&R is at most 10% of total study variation and `ndc` is at least 5;
- `conditionally acceptable`: Gage R&R is at most 30% and `ndc` is at least 2; and
- `unacceptable`: otherwise.

Constant data is `indeterminate`. These labels are advisory. Process risk, tolerance, cost, intended use, customer requirements, and sampling validity can justify a different conclusion.

### Method assumptions and exclusions

- Parts represent the intended process range.
- Appraisers follow one defined method.
- Repeated readings are independent.
- Measurement error is stable and approximately normal.
- The design is fully crossed and balanced.

The average-and-range method does not estimate part-by-appraiser interaction. Use a qualified ANOVA Gage R&R when interaction matters. GaugeBase 1.0 does not implement nested, destructive, attribute, or ANOVA Gage R&R. It also does not select sample sizes or randomize the run order.

## Bias

The bias study compares at least two repeated measurements with one accepted reference value. It reports individual and mean bias, sample standard deviation, standard error, a two-sided approximate 95% Student-t confidence interval, and whether that interval excludes zero. Reference uncertainty is not included in the interval. Independence, approximate normality, measurement-system stability, and suitability of the reference remain reviewer judgments; statistical non-significance does not prove the absence of practically important bias.

## Linearity

The linearity study requires observations at at least three distinct accepted reference levels. It uses unweighted ordinary least squares for:

```text
bias = measured - reference
bias = intercept + slope × reference
```

It reports slope, intercept, residual standard deviation, R², coefficient standard errors, an approximate 95% slope interval, fitted bias at each level, and fitted bias change across the studied range. The model assumes independent, approximately normal, constant-variance residuals and negligible reference uncertainty. A non-significant slope means the study did not detect changing bias; it does not prove linearity or fitness across an unstudied range.

## Stability

The stability study accepts strictly chronological, balanced rational subgroups of size 2–25. It builds classical Xbar and R limits from the submitted baseline using tabulated `A2`, `D3`, and `D4` constants. It identifies points beyond control limits, eight consecutive Xbar points on one side of the center line, and six-point Xbar trends.

These are preliminary limits calculated from the same data being screened, not qualified long-term limits. Establish range-chart control before interpreting Xbar signals. The application does not automatically remove special causes, recalculate a qualified baseline, account for seasonality, or approve a control plan.

## Calibration-interval recommendations

Interval analysis is deliberately conservative and explainable. It uses completed history for one gauge:

- a failure among the latest six events suggests shortening, more aggressively for critical equipment;
- a recent conditional result suggests a modest shortening review;
- at least five consecutive passes may suggest an extension for active, non-critical equipment, capped at 60 months; and
- limited or mixed evidence retains the current interval.

Confidence is based only on history count (`low` below 4, `medium` from 4–7, `high` from 8). It is not a statistical confidence interval. The rule does not model drift magnitude, usage intensity, environmental stress, manufacturer instructions, historical interval censoring, cost, or product risk. A suggestion changes nothing until a permitted operator applies it, and the application records that action in history.

## Traceability and quality cases

Reference standards can carry certificate number, validity date, and a human-entered traceability source. Calibration records can link to reference-standard record IDs. For a new structured link, the application requires an active standard, a certificate number, a traceability source, and validity/due dates covering the calibration date, then freezes that metadata into the sealed calibration. The traceability view flags downstream records when a linked standard later becomes overdue, failed, or restriction-expired and can open a recall case with an impact window.

This graph is a record relationship and risk-screening aid. Eligibility checks use organization-entered dates and statuses; they do not verify certificate authenticity, scope, uncertainty, calibration hierarchy, SI realization, or accreditation status. Free-text references are retained for context but do not create a queryable graph. A qualified reviewer must determine actual traceability and product/customer impact.

## Validation expectation

Before relying on any calculation:

1. document intended use and the approved method;
2. verify formulas against independent examples and boundary cases;
3. challenge invalid, missing, extreme, and rounded inputs;
4. establish reviewer qualifications and approval meaning;
5. preserve the tested application version and configuration; and
6. execute the organization’s change-control and periodic-review process.

See [Validation and IQ/OQ/PQ](VALIDATION.md). The presence of a saved `reviewed` study records the application workflow state; it is not independent proof of technical validity.
