import { Link } from "react-router-dom";
import { docsPages } from "./docsPages";

export default function Index() {
  return (
    <article>
      <h1>Documentation</h1>
      <p>
        The Scientific Simulation Workbench is a modular platform for laser
        physics, laser fusion, and computational experimentation. Pick a
        section to begin.
      </p>
      <p className="page-status">
        Phase 0 — skeleton. Page contents will be filled out as the project
        progresses through its phases.
      </p>
      <ul>
        {docsPages.map((p) => (
          <li key={p.slug}>
            <Link to={"/" + p.slug}>{p.title}</Link>
          </li>
        ))}
      </ul>
    </article>
  );
}
