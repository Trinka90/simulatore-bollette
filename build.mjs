import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
// Versione del codice web (aggiornamento automatico) e versione della parte nativa (serve un nuovo APK solo se cambia).
const VERSIONE_WEB = process.env.VERSIONE_WEB || "dev";
const VERSIONE_NATIVA = JSON.parse(readFileSync("package.json", "utf8")).versioneNativa;
mkdirSync("www/lib", { recursive: true });
cpSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "www/lib/pdf.worker.min.mjs");
await build({
  entryPoints: ["src/main.js"], bundle: true, format: "esm", outfile: "www/app.js",
  minify: true, sourcemap: false, target: ["chrome90"], loader: { ".json": "json" },
  define: { __VERSIONE_WEB__: JSON.stringify(VERSIONE_WEB), __VERSIONE_NATIVA__: String(VERSIONE_NATIVA) },
  logLevel: "info",
});
