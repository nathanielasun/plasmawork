# Sample paper — KrF excimer kinetics (synthesized for tests)

## Abstract

We study a simplified two-level rate model for KrF excimer formation
under nanosecond pumping. The dominant kinetic equation is

$$\frac{dN_2}{dt} = k_p N_1 - \gamma N_2$$

where $N_1, N_2$ are the lower- and upper-state populations, $k_p$ is
the pumping rate, and $\gamma$ is the spontaneous-emission rate.

## Parameters

The rate constants used in our simulation:

- pumping_rate = 5.0e7 1/s
- spontaneous_emission_rate = 4.0e8 1/s
- pulse_duration = 25 ns
- pulse_energy = 1.5 J
- ambient_temperature = 300 K
- placeholder_efficiency = 0.85

## Method

The model assumes a homogeneous medium and ignores spatial diffusion
(valid for spot sizes much smaller than the diffusion length over the
pulse duration).

## Validity domain

The two-level approximation is valid for intensities below 10 MW/cm^2;
above that, vibrational manifolds must be resolved.

## Cross-section table

Selected absorption cross-sections used in the simulation:

| Wavelength | Cross-section | Source |
|------------|---------------|--------|
| 248 nm     | 1.2e-20       | Smith 2018 |
| 308 nm     | 4.5e-21       | Jones 2020 |

## Figures

![KrF kinetics schematic](figures/kinetics.png "Two-level model")

Figure 1: Two-level rate-equation schematic showing the pumping rate
kp and spontaneous-emission rate γ.
