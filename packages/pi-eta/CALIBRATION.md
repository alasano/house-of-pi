# Calibration

How `pi-eta` computes the corrected ETA from completed tasks.

Every completed task gives one data point, how long the agent said it would take against how long it actually took. The multiplier is the median of those ratios, taken in log space so a few wild outliers don't drag it around.

For completed tasks, `pi-eta` computes:

```text
ratio = actual_wall_minutes / raw_estimate_center_minutes
log_ratio = ln(ratio)
multiplier = exp(median(log_ratio))
```

Estimate ranges use the geometric midpoint as their center. Spread is calculated with log-space MAD:

```text
mad = median(abs(log_ratio - median_log_ratio))
robust_sigma = 1.4826 * mad
spread_factor = exp(robust_sigma)
```

When verbose output is enabled or a tool result is expanded with Ctrl+O, three or more effective samples unlock a typical historical variation band and the robust geometric variation factor (`σg`). At ten or more effective samples, verbose output also shows an approximate 95% multiplier confidence range.

## Execution profile hierarchy

A model and thinking level you just started using has no history of its own, but evidence from related profiles is still worth something. Blended mode starts the new profile from what related profiles have shown and hands control over to its own samples as they accumulate.

Blended calibration is the default. Evidence is split into three **disjoint** strata relative to the running profile, so no sample is ever counted twice:

| Stratum                  | Contents                             |
| ------------------------ | ------------------------------------ |
| Current profile          | Same model, same thinking level      |
| Same model, other levels | Same model, any other thinking level |
| Other models             | Every other model                    |

Each layer shrinks toward the next in log space, with the parent contributing a capped number of prior samples:

```text
parent_prior = blend(same_model_other_levels, other_models, cap = 10)
effective    = blend(current_profile,         parent_prior, cap = 5)

blend(child, parent, cap):
  prior_samples = min(parent_samples, cap)
  child_weight  = child_samples / (child_samples + prior_samples)
  multiplier    = exp(child_weight * ln(child) + (1 - child_weight) * ln(parent))
```

The smaller cap on the profile's prior means level-specific evidence takes control quickly, while a brand-new profile still starts from a mature baseline. Records with no recorded thinking level form their own `unknown` profile and never merge with a known level.

## Size effect

The model may estimate more or less accurately depending on the size of the estimate. Its ability to estimate a task it thinks will take 30 minutes and one it thinks will take 8 hours can be different, so `pi-eta` measures that and corrects for it.

A constant multiplier assumes calibration error is proportional at every task size. `pi-eta` tests that assumption by fitting a robust log-log regression with Theil-Sen:

```text
ln(actual) = a + b * ln(agent_estimate_center)
```

Pairwise slopes are taken only within one execution profile, so speed differences between profiles cannot masquerade as a size effect; the result is one shared slope with per-profile intercepts. `b = 1` reproduces the constant multiplier exactly. The fitted slope is shrunk toward 1 by sample count, so a thin history degrades gracefully instead of over-correcting:

```text
slope = 1 + (raw_slope - 1) * n / (n + 10)
multiplier(center) = effective_multiplier * (center / reference_center) ^ (slope - 1)
```

While the size effect is active, each stratum's multiplier is computed from size-detrended ratios, so it expresses the correction at the reference estimate size and the size term is never counted twice. The correction is neutral at a typical estimate size, applies one multiplier per estimate computed at its geometric center, and is clamped to the observed estimate range rather than extrapolated. It activates only with at least 12 pairable samples (samples from profiles with two or more of them) and at least a 4x estimate-size spread inside a single profile; until then calibration is the flat multiplier, and the overlay states which condition is unmet.
