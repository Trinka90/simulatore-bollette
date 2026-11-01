import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analizzaDettaglio, offertaDaDettaglio, righeDettaglio } from "../src/bolletta-dettaglio.js";
import { analizzaBolletta } from "../src/bolletta-pdf.js";

const T = readFileSync(new URL("./fixtures/bollette/enel-dettaglio-luce.txt", import.meta.url), "utf8");

test("righe del dettaglio importi: tutte lette, con sezione", () => {
  const r = righeDettaglio(T);
  assert.equal(r.length, 28);
  const somma = (s) => Math.round(r.filter((x) => x.sezione === s).reduce((a, x) => a + x.totale, 0) * 100) / 100;
  assert.equal(somma("vendita"), 50.54);
  assert.equal(somma("rete"), 18.93);
  assert.equal(somma("oneri"), 7.26);
  assert.ok(r.some((x) => /DISPbt, parte fissa/.test(x.descr)));
});

test("analisi: prezzi dell'offerta, fissi, costo medio", () => {
  const d = analizzaDettaglio(T);
  assert.equal(d.forn, "LUCE");
  assert.equal(d.consumo, 219);
  assert.equal(d.mesi, 2);
  assert.deepEqual(d.periodo, { dal: "2026-07-01", al: "2026-08-31" });
  assert.deepEqual(d.offerta.prezzi, { F0: 0.10818 });
  assert.equal(d.offerta.quotaVenditaMese, 9);
  assert.equal(d.offerta.perditeSeparate, true);
  assert.equal(d.totali.oneri, 7.26);
  assert.equal(d.totali.bolletta, 84.4);
  assert.equal(d.canone, 18);
  assert.match(d.tipoPrezzo, /fisso/);
  assert.ok(Math.abs(d.fissiMese - 16.94) < 0.02);
  assert.ok(Math.abs(d.prezzoMedio - 0.385) < 0.001);
});

test("offerta ricostruita e dati della bolletta", () => {
  const o = offertaDaDettaglio(analizzaDettaglio(T), "Enel Energia");
  assert.equal(o.quotaFissaAnnua, 108);
  assert.equal(o.perdite, "tutto");
  assert.ok(Math.abs(o.altriKwh - 0.0037) < 0.0001);
  const a = analizzaBolletta(T, []);
  assert.equal(a.campi.potenza.valore, 3);
  assert.equal(a.campi.consumoPeriodo.valore, 219);
  assert.equal(a.campi.venditore.valore, "Enel Energia");
});
