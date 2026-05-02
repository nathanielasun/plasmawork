import { Link, NavLink } from "react-router-dom";
import { docsPages } from "../pages/docsPages";

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <h1>
        <Link to="/">Scientific Simulation Workbench</Link>
      </h1>
      <ul>
        {docsPages.map((p) => (
          <li key={p.slug}>
            <NavLink
              to={"/" + p.slug}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              {p.title}
            </NavLink>
          </li>
        ))}
      </ul>
    </aside>
  );
}
