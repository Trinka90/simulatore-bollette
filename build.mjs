import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
mkdirSync("www/lib", { recursive: true });
cpSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "www/lib/pdf.worker.min.mjs");
await build({
  entryPoints: ["src/main.js"], bundle: true, format: "esm", outfile: "www/app.js",
  minify: true, sourcemap: false, target: ["chrome90"], loader: { ".json": "json" },
  logLevel: "info",
});
