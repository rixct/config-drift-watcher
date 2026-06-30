import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  // The plugin ships as a single main.js with no node_modules beside it, so npm
  // deps (ssh2, diff) must be bundled in. Only keep external: Obsidian/Electron,
  // Node built-ins (available in Electron), and ssh2's OPTIONAL native dep
  // cpu-features — ssh2 try/catches its absence and falls back to pure JS.
  external: [
    "obsidian",
    "electron",
    "cpu-features",
    ...builtins,
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
