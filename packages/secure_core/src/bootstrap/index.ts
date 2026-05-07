/**
 * Bootstrap barrel — Phase 0.5 Layer 4 task L4.9.
 *
 * Re-exports the public surface of the v4 §22.1 bootstrap subsystem:
 * the gated service, the WORM-marker provider abstraction, and the
 * production / fake providers.
 */

export {
  BootstrapService,
  BootstrapGateClosedError,
  BootstrapCredentialMismatchError,
  type BootstrapServiceOptions,
  type BootstrapDbAdapter,
  type AttemptBootstrapOptions,
  type AttemptBootstrapResult,
} from "./service.js";

export {
  FakeWormMarkerProvider,
  S3WormMarkerProvider,
  type BootstrapWormMarkerProvider,
  type BootstrapMarkerPayload,
  type S3WormMarkerOptions,
} from "./wormMarker.js";
