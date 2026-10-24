// Import consumi da CSV: le forme più comuni dei file di Portale Consumi, e-distribuzione e distributori gas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { leggiConsumiCsv, ultimi12, fasciaDi } from "../src/consumi-csv.js";

const vicino = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const giorni = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

test("fasce orarie ARERA: feriale, sabato, domenica, festivo", () => {
  assert.equal(fasciaDi(2026, 10, 21, 10), "F1");   // mercoledì
  assert.equal(fasciaDi(2026, 10, 21, 7), "F2");
  assert.equal(fasciaDi(2026, 10, 21, 23), "F3");
  assert.equal(fasciaDi(2026, 10, 24, 10), "F2");   // sabato
  assert.equal(fasciaDi(2026, 10, 25, 10), "F3");   // domenica
  assert.equal(fasciaDi(2026, 12, 8, 10), "F3");    // Immacolata
  assert.equal(fasciaDi(2026, 4, 6, 10), "F3");     // Pasquetta 2026
});

test("quartorario in colonne (una riga per giorno, Wh)", () => {
  const head = "POD;Data;" + Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`).join(";");
  const righe = [head];
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= giorni(2025, m); d++)
    righe.push(`IT001E00000000;${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/2025;` + Array.from({ length: 96 }, () => "100").join(";"));
  const r = leggiConsumiCsv(righe.join("\n"));
  assert.equal(r.tipo, "quartorario");
  const u = ultimi12(r);
  vicino(u.annuo, 365 * 96 * 0.1, 0.5, "annuo kWh");
  vicino(u.mesi[2], 28 * 9.6, 0.1, "febbraio");
  assert.ok(u.ripartizione.F1 > 0.25 && u.ripartizione.F1 < 0.35);
});

test("quartorario in righe (data ora valore kWh)", () => {
  const righe = ["Data;Ora;Prelievo attiva (kWh)"];
  for (let d = 1; d <= 31; d++) for (let q = 0; q < 96; q++) righe.push(`2026-07-${String(d).padStart(2, "0")};${String(Math.floor(q / 4)).padStart(2, "0")}:${String((q % 4) * 15).padStart(2, "0")};0,05`);
  const r = leggiConsumiCsv(righe.join("\n"));
  assert.equal(r.tipo, "quartorario");
  vicino(r.perMese["2026-07"], 31 * 96 * 0.05, 0.01, "luglio");
});

test("mensile per fascia", () => {
  const csv = "Mese;Fascia;Consumo (kWh)\n07/2026;F1;80\n07/2026;F2;70\n07/2026;F3;100\n08/2026;F1;60\n08/2026;F2;60\n08/2026;F3;90";
  const r = leggiConsumiCsv(csv);
  assert.equal(r.tipo, "mensile");
  assert.equal(r.perMese["2026-07"], 250);
  assert.deepEqual(r.fasce, { F1: 140, F2: 130, F3: 190 });
});

test("gas: letture progressive del contatore", () => {
  const csv = "Data lettura;Lettura (Smc);Tipo\n01/01/2026;1000;Effettiva\n01/03/2026;1059;Stimata\n01/05/2026;1100;Effettiva";
  const r = leggiConsumiCsv(csv, "GAS");
  assert.equal(r.tipo, "letture");
  vicino(r.perMese["2026-01"] + r.perMese["2026-02"], 59, 1e-9, "gen+feb");
  vicino(Object.values(r.perMese).reduce((a, b) => a + b, 0), 100, 1e-9, "totale");
});
