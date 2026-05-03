# Validation tool template

Starting point for a validation tool — conservation checker, convergence
tester, benchmark comparator.

Validation tools return a clear `passed: bool` plus structured
`violations` so the workbench's Validation tab can render the result
without parsing free-form text. Tests under `tests/` should cover
both the green path (all observations within tolerance) and at least
one negative case.
