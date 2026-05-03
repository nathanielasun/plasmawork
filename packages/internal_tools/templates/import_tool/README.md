# Import tool template

Starting point for an import tool — PDF importer, CSV parser, HDF5
loader, cross-section table importer.

Per plan §9.7, **imports must not scatter files** across the user's
system. Copy imported assets into `local_cache/imported_tools/` or the
project-local registry; never write to arbitrary user paths. The
default `BaseTool` inputs/outputs make it easy: take a `source_path`
parameter and return a structured payload, leaving the file-management
to the caller.
