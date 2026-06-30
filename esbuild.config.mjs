import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "module";

const prod = process.argv[2] === "production";

// Stub `child_process` to an empty module. ssh2 only pulls it in for SSH-agent
// support (Cygwin/Pageant/OpenSSH agent), which this plugin never uses — it
// authenticates with a private key. Replacing it with an empty module keeps
// shell-execution capability out of the shipped bundle entirely, matching the
// plugin's read-only, never-executes-commands guarantee.
const stubChildProcess = {
  name: "stub-child-process",
  setup(build) {
    // Use a stub path with no "child_process" substring so the literal string
    // does not appear anywhere in the bundle (avoids false positives in scanners
    // that grep for it).
    build.onResolve({ filter: /^(node:)?child_process$/ }, () => ({
      path: "ssh_agent_disabled",
      namespace: "cdw-stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "cdw-stub" }, () => ({
      contents: "module.exports = {};",
      loader: "js",
    }));
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  plugins: [stubChildProcess],
  // The plugin ships as a single main.js with no node_modules beside it, so npm
  // deps (ssh2, diff) must be bundled in. Only keep external: Obsidian/Electron,
  // ssh2's OPTIONAL native dep cpu-features (try/catched, falls back to pure JS),
  // and Node built-ins available in Electron — except child_process, which is
  // stubbed above rather than left as a runtime require.
  external: [
    "obsidian",
    "electron",
    "cpu-features",
    ...builtinModules.filter((m) => m !== "child_process"),
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  platform: "node",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
