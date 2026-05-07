export default function OperatingSystemCompatibility() {
  return (
    <article>
      <h1>Operating System Compatibility</h1>
      <p className="page-status">
        Current compatibility target: day-to-day local development works on
        macOS, Linux, and Windows when the required Python and Node runtimes are
        installed. Production security probes, sandbox enforcement, and
        accelerated solver backends remain platform- and deployment-dependent.
      </p>

      <h2>Compatibility tiers</h2>
      <ul>
        <li>
          <strong>Cross-platform core:</strong> Python package code, ModelSpec
          loading, units, experiment/runtime orchestration, local simulation
          runs, capsule serialization, and regression tests are intended to run
          on macOS, Linux, and Windows.
        </li>
        <li>
          <strong>Cross-platform web surfaces:</strong> the workbench UI and
          documentation site use Node.js tooling and are expected to build on
          macOS, Linux, and Windows.
        </li>
        <li>
          <strong>Shell-wrapper parity:</strong> launchers that need argument
          parsing should delegate to Python or TypeScript code. The backend
          launcher provides Unix, PowerShell, cmd.exe, and shell-neutral Python
          entrypoints.
        </li>
        <li>
          <strong>Deployment-dependent features:</strong> gVisor/runsc live
          probes, production Postgres role probes, WORM/S3 anchor probes, GPU
          kernels, compiled kernels, and external HPC/PIC integrations require
          their documented target runtimes.
        </li>
      </ul>

      <h2>Supported local-development entrypoints</h2>
      <pre>
        <code>{`# macOS / Linux / Git Bash
./scripts/dev/run_backend.sh

# Windows PowerShell
.\\scripts\\dev\\run_backend.ps1

# Windows cmd.exe
scripts\\dev\\run_backend.cmd

# Any shell with Python available
python scripts/dev/run_backend.py`}</code>
      </pre>
      <p>
        The backend launchers all call the same Python implementation, so
        command parsing and argument forwarding remain consistent across
        shells. They start the FastAPI API server; standalone simulation
        examples are launched separately via <code>python examples/&lt;name&gt;/run.py</code>.
        Other repository scripts are POSIX shell scripts unless a
        platform-specific wrapper is present; on Windows, use Git Bash or WSL
        for those scripts until a native wrapper is added.
      </p>

      <h2>Filesystem and path rules</h2>
      <ul>
        <li>
          Program-generated artifacts stay under <code>local_cache/</code>,{" "}
          <code>temp_imports/</code>, <code>temp_runs/</code>, and{" "}
          <code>simulation_capsules/</code>.
        </li>
        <li>
          Python code should use <code>pathlib.Path</code> and avoid hard-coded
          path separators.
        </li>
        <li>
          TypeScript/Node tooling should use URL/path utilities rather than
          literal Unix-only paths when constructing filesystem paths.
        </li>
        <li>
          Exports may target user-selected locations, but ordinary runtime
          artifacts must remain inside the workbench-controlled roots.
        </li>
      </ul>

      <h2>Known platform-sensitive areas</h2>
      <ul>
        <li>
          <strong>Sandboxing:</strong> live gVisor/runsc checks require a
          Linux-capable runtime lane.
        </li>
        <li>
          <strong>Database security probes:</strong> Postgres role tests require
          a configured test database URL.
        </li>
        <li>
          <strong>WORM anchors:</strong> live anchor probes require a configured
          compatible object-store provider.
        </li>
        <li>
          <strong>Compiled and GPU backends:</strong> kernel builds depend on
          local compiler, driver, SDK, and accelerator availability.
        </li>
        <li>
          <strong>HPC orchestration:</strong> Slurm and external simulator
          scripts target environments where those schedulers or simulators
          exist.
        </li>
      </ul>

      <h2>Maintenance requirement</h2>
      <p>
        Update this page whenever a change adds, removes, or materially changes
        platform support, shell wrappers, filesystem behavior, path handling,
        compiler/runtime prerequisites, sandbox requirements, or deployment
        probe assumptions. Platform compatibility is user-facing behavior, not
        implementation trivia.
      </p>
    </article>
  );
}
