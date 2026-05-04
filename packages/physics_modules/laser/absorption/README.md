# Absorption (candidate)

Small linear-absorption helper module. It computes `alpha = sigma * n` from a caller-supplied absorption cross-section and absorber density, then applies Lambert-Beer transmission.

This module is `candidate`: it is reusable infrastructure, not a validated material model. Cross-sections must come from reviewed input data.
