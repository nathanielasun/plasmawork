/// <reference types="vite/client" />

/**
 * Project-specific Vite env variables.
 *
 * VITE_DOCS_BASE_URL — overrides the in-app DocsViewer iframe URL
 * (default `http://localhost:3000`). Set when running the docs server
 * on a non-default port.
 */
interface ImportMetaEnv {
  readonly VITE_DOCS_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
