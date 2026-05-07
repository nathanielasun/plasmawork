import { Link } from "react-router-dom";
import { docsPages } from "./docsPages";

export default function Index() {
  const sections = Array.from(new Set(docsPages.map((page) => page.section)));

  return (
    <article>
      <h1>Documentation</h1>
      <p>
        The Scientific Simulation Workbench is a modular platform for laser
        physics, laser fusion, secure multi-user simulation workflows, and
        computational experimentation. Use the searchable sidebar to browse the
        manual by topic.
      </p>
      <p className="page-status">
        Documentation pages are loaded from <code>docs_site/src/content/</code>
        and reused inside the workbench UI. Major behavior, API, security, or
        workflow changes should update the matching page and sidebar metadata.
      </p>
      <div className="doc-index-grid">
        {sections.map((section) => (
          <section key={section}>
            <h2>{section}</h2>
            <ul>
              {docsPages
                .filter((page) => page.section === section)
                .map((page) => (
                  <li key={page.slug}>
                    <Link to={"/" + page.slug}>{page.title}</Link>
                    <p>{page.summary}</p>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}
