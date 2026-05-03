# Visualization tool template

Starting point for a visualization tool — line plots, animations,
phase-space viewers, particle viewers. The output is a figure object;
the workbench UI knows how to render `matplotlib.Figure` directly.

## Quickstart

1. Copy this directory into the registry under your tool name.
2. Edit `tool.yaml` and `src/tool.py`.
3. The default renders a single line plot; replace `run` with your own
   plotting code. Keep returning a `ToolOutput({"figure": ...})` so
   downstream consumers can find the figure by a stable key.
