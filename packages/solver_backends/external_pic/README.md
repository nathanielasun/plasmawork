# external_pic — Phase 8 external PIC adapter

Phase 8 ships the adapter contract (`ExternalSimulatorAdapter`) and a
reference `StubPICAdapter` that demonstrates the input-deck / submit /
import_result shape. Validated wrappers around real PIC codes (WarpX,
EPOCH, Smilei) land per-need in downstream work.

## Contract

```python
from simworkbench.backends.external import ExternalSimulatorAdapter, ExternalJobSpec
from packages.solver_backends.external_pic import StubPICAdapter

adapter = StubPICAdapter()
deck = adapter.write_input_deck(experiment, target="/path/to/bundle/")
job = ExternalJobSpec(name="run_001", input_deck_path=deck)
handle = adapter.submit(job)                              # external scheduler id
adapter.import_result(handle, target_capsule="/path/to/capsule/")
```

The base class (`ExternalSimulatorAdapter`) is abstract; instantiating
it directly raises `TypeError` so callers can't accidentally use
the contract without picking a concrete simulator.
