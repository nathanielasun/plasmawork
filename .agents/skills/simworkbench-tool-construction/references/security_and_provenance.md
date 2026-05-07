# TOOL-SECURITY Security and Provenance

Tool execution must preserve the workbench security model.

## Identity and Authorization

Do not trust `actor`, `user_id`, `workspace_id`, `role`, `status`,
`storage_path`, `content_hash`, timestamps, or approval fields from request
bodies. Derive identity, membership, capability, storage facts, status, and
hashes server-side.

Global unscoped tool, artifact, run, or capsule endpoints are not acceptable
for deployed multi-user mode. Secure routes are workspace scoped.

## Filesystem and Artifacts

Local single-user artifacts stay under workbench-managed roots. Secure
multi-user artifacts stay under:

```text
workspaces/<workspace_id>/
```

Tools accept artifact ids or local package-relative references, not arbitrary
server paths. Validate the complete write plan before any file is created.
Clean up partial artifacts on failure.

## Permissions

Declare filesystem, network, export, promotion, and high-risk actions in the
contract. Missing or incomplete authorization fails closed. High-risk actions
require approval before side effects and must re-check capability at commit.

## Sandbox and Network

Do not silently grant network or unrestricted filesystem access. Network access
requires an explicit permission and a governed proxy path. Sandbox violations
are failures, not warnings.

## Provenance

Record tool name, version, package path, skill version or git commit when
agent-generated, input artifact ids, parameters, validation evidence, output
artifact ids, output hashes, actor identity from session context, and errors.
Provenance is evidence; it is not a substitute for authorization.
