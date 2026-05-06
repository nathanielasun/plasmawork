/**
 * Local ambient declaration for `@truestamp/canonify`.
 *
 * The upstream package ships a `dist/index.d.ts` with a `canonify`
 * function, but its `package.json#exports` map omits the `"types"`
 * condition — TypeScript with `moduleResolution: "Bundler"` therefore
 * reports TS7016 ("could not find a declaration file") even though
 * the types exist on disk. Re-declaring the surface we use here is
 * cheaper than patching the dependency or weakening tsconfig strictness.
 *
 * Mirror of the upstream signature in `node_modules/@truestamp/canonify/
 * dist/index.d.ts`. If the upstream library publishes a fixed exports
 * map this file may be deleted.
 */
declare module "@truestamp/canonify" {
  /**
   * Convert a JSON-serializable value to its RFC 8785 canonical
   * string. Returns `undefined` for inputs the upstream library
   * rejects (the L1.2 wrapper refuses these BEFORE delegating).
   */
  export function canonify(object: unknown): string | undefined;
}
