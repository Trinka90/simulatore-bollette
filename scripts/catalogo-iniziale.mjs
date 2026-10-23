// Crea www/catalogo-iniziale.json dai file XML del Portale Offerte (uso: node scripts/catalogo-iniziale.mjs cartella_xml data).
// Serve solo come punto di partenza: l'app lo sostituisce col primo aggiornamento dal telefono.
import { readFileSync, writeFileSync } from "node:fs";
import { leggiOfferte } from "../src/opendata.js";
const [dir, data] = process.argv.slice(2);
const g = data.replaceAll("-", "");
const offerte = ["E", "G"].flatMap((c) => leggiOfferte(readFileSync(`${dir}/PO_Offerte_${c}_MLIBERO_${g}.xml`, "utf8"), data, data).offerte);
const dati = JSON.parse(readFileSync("data/dati.json", "utf8"));
const cat = { scaricato: null, data, dataOfferte: { E: data, G: data }, parametri: dati.regolate.parametri, offerte, iniziale: true };
writeFileSync("www/catalogo-iniziale.json", JSON.stringify(cat));
console.log(offerte.length, "offerte", (JSON.stringify(cat).length / 1e6).toFixed(1), "MB");
