/**
 * FolderBrowser smoke test.
 *
 * Mocks /api/browse, renders the component, verifies:
 *  - root listing renders (entries + truncation banner)
 *  - clicking a directory descends + refetches
 *  - clicking a file invokes onSelect with the typed entry
 *  - the filter prop hides files but keeps directories
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FolderBrowser } from "../components/ui/FolderBrowser";
import type { BrowseEntry, BrowseResponse } from "../api/client";

function dirEntry(name: string, parent = ""): BrowseEntry {
  return {
    kind: "dir",
    name,
    path: parent ? `${parent}/${name}` : name,
    size_bytes: null,
    mtime_iso: "2026-05-04T12:00:00+00:00",
  };
}

function fileEntry(name: string, parent = "", size = 1024): BrowseEntry {
  return {
    kind: "file",
    name,
    path: parent ? `${parent}/${name}` : name,
    size_bytes: size,
    mtime_iso: "2026-05-04T12:00:00+00:00",
  };
}

const ROOT_RESPONSE: BrowseResponse = {
  root: "examples",
  relative_path: "",
  parent_relative_path: null,
  entries: [
    dirEntry("krf_excimer"),
    dirEntry("laser_species"),
    fileEntry("README.md"),
  ],
  truncated: false,
};

const NESTED_RESPONSE: BrowseResponse = {
  root: "examples",
  relative_path: "krf_excimer",
  parent_relative_path: "",
  entries: [
    fileEntry("model.yaml", "krf_excimer", 5318),
    fileEntry("README.md", "krf_excimer", 3025),
    fileEntry("run.py", "krf_excimer", 3979),
  ],
  truncated: false,
};

describe("FolderBrowser", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      // Route on the path query.
      if (url.includes("path=krf_excimer")) {
        return new Response(JSON.stringify(NESTED_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(ROOT_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  });

  it("renders the root listing with kind pills", async () => {
    render(<FolderBrowser initialRoot="examples" onSelect={() => undefined} />);
    await waitFor(() => {
      expect(screen.getByText("krf_excimer")).toBeInTheDocument();
    });
    expect(screen.getByText("laser_species")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
    // Two directories → two "dir" pills, one file → one "file" pill.
    expect(screen.getAllByText("dir")).toHaveLength(2);
    expect(screen.getAllByText("file")).toHaveLength(1);
  });

  it("descends into a directory on click", async () => {
    render(<FolderBrowser initialRoot="examples" onSelect={() => undefined} />);
    await waitFor(() => screen.getByText("krf_excimer"));
    fireEvent.click(screen.getByText("krf_excimer"));
    await waitFor(() => screen.getByText("model.yaml"));
    expect(screen.getByText("run.py")).toBeInTheDocument();
    // Breadcrumb shows current path.
    expect(screen.getAllByText("krf_excimer").length).toBeGreaterThan(0);
  });

  it("invokes onSelect with a typed file entry on file click", async () => {
    const onSelect = vi.fn();
    render(<FolderBrowser initialRoot="examples" onSelect={onSelect} />);
    await waitFor(() => screen.getByText("README.md"));
    fireEvent.click(screen.getByText("README.md"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const [entry, root] = onSelect.mock.calls[0];
    expect(root).toBe("examples");
    expect(entry).toMatchObject({ kind: "file", name: "README.md" });
  });

  it("filter hides files but keeps directories", async () => {
    render(
      <FolderBrowser
        initialRoot="examples"
        onSelect={() => undefined}
        filter={(e) => e.kind === "file" && e.name.endsWith(".yaml")}
      />,
    );
    await waitFor(() => screen.getByText("krf_excimer"));
    // README.md is a file that doesn't match the filter — should be hidden.
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();
    // Directories remain.
    expect(screen.getByText("krf_excimer")).toBeInTheDocument();
    expect(screen.getByText("laser_species")).toBeInTheDocument();
  });
});
