"""Phase 1E — Plotter smoke tests.

Plotters return matplotlib Figures. We only assert that figures are produced,
have the expected components, and don't contain NaN/Inf in axis ranges. We do
not pin pixel-perfect output — that's a Phase 7 concern.
"""

from __future__ import annotations

import matplotlib
import numpy as np
import pytest

matplotlib.use("Agg")  # headless

from simworkbench.diagnostics import heatmap, line_plot, particle_scatter


def test_line_plot_renders_multiple_series():
    t = np.linspace(0, 1, 100)
    fig = line_plot(
        t,
        {"A": np.exp(-t), "B": 1 - np.exp(-t)},
        x_label="time (s)",
        y_label="density (1 / m**3)",
        title="rate equations",
    )
    ax = fig.axes[0]
    assert len(ax.lines) == 2
    # Y range should be finite.
    ymin, ymax = ax.get_ylim()
    assert np.isfinite(ymin) and np.isfinite(ymax)


def test_line_plot_legend_labels_match_series_keys():
    t = np.array([0.0, 1.0])
    fig = line_plot(t, {"alpha": np.array([0.0, 1.0]), "beta": np.array([1.0, 0.0])})
    ax = fig.axes[0]
    labels = [line.get_label() for line in ax.lines]
    assert set(labels) == {"alpha", "beta"}


def test_heatmap_renders_2d_field():
    field = np.outer(np.linspace(0, 1, 16), np.linspace(0, 1, 16))
    fig = heatmap(field, title="density", colorbar_label="n (1 / m**3)")
    assert len(fig.axes) >= 1
    # The first axes is the heatmap, the second is the colorbar.
    assert fig.axes[0].images
    img = fig.axes[0].images[0]
    np.testing.assert_array_equal(img.get_array().data, field)


def test_heatmap_rejects_non_2d():
    with pytest.raises(ValueError, match="2D"):
        heatmap(np.array([1.0, 2.0, 3.0]))


def test_particle_scatter_renders_positions():
    rng = np.random.default_rng(0)
    positions = rng.uniform(0, 1, size=(32, 2))
    fig = particle_scatter(positions, title="particles")
    ax = fig.axes[0]
    # One PathCollection from the scatter call.
    assert len(ax.collections) >= 1


def test_particle_scatter_with_velocities_adds_quiver():
    rng = np.random.default_rng(0)
    positions = rng.uniform(0, 1, size=(8, 2))
    velocities = rng.standard_normal((8, 2))
    fig = particle_scatter(positions, velocities=velocities)
    ax = fig.axes[0]
    # collections list now contains scatter + quiver.
    assert len(ax.collections) >= 2


def test_particle_scatter_rejects_wrong_shape():
    with pytest.raises(ValueError, match="positions"):
        particle_scatter(np.array([1.0, 2.0, 3.0]))


def test_particle_scatter_rejects_velocity_shape_mismatch():
    pos = np.zeros((4, 2))
    bad_v = np.zeros((3, 2))
    with pytest.raises(ValueError, match="velocities"):
        particle_scatter(pos, velocities=bad_v)
