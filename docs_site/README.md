# docs_site/

Documentation site for the Scientific Simulation Workbench. Vite + React + React Router.

The same source pages are loaded inside the workbench UI under the **Documentation** panel — there is one canonical doc source. Do not duplicate documentation strings into the UI.

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
```

## Build

```bash
npm run build
npm run preview
```

## Layout

```
docs_site/
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  src/
    main.tsx          # entry
    App.tsx           # router
    styles.css
    pages/
      Index.tsx       # landing
      docsPages.ts    # registry of all content pages
    components/
      Layout.tsx
      Sidebar.tsx
    content/
      overview.tsx
      installation.tsx
      usage.tsx
      architecture.tsx
      module_development.tsx
      internal_tools.tsx
      simulation_capsules.tsx
      agent_workflows.tsx
      validation.tsx
      troubleshooting.tsx
```

Each `content/<page>.tsx` is a self-contained React component. The page set is enumerated in `pages/docsPages.ts`; routing is generated from that array. To add a page, add a content file and register it in `docsPages.ts`.

## Status

Phase 0 — page contents are skeletons. They will be expanded in the phases noted at the top of each page.
