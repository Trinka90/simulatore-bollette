import { test } from "node:test";
import assert from "node:assert/strict";
import { analizza, bozzaOfferta } from "../src/cte.js";

test("scheda sintetica luce indicizzata", () => {
  const t = `SCHEDA SINTETICA Enel Energia Nome offerta: Enel Flex Control Luce Codice offerta 123
  Costo per consumi Indice PUN Index GME + 0,02226 €/kWh. Prezzo massimo: il Prezzo Luce fatturato sarà al massimo pari a 0,174 €/kWh.
  Costo fisso anno 180,00 €/anno. Il Prezzo Luce è comprensivo delle perdite di rete. Offerta luce e gas. Durata 12 mesi.`;
  const a = analizza(t);
  assert.equal(a.tipo, "LUCE"); assert.equal(a.indicizzata, true);
  const o = bozzaOfferta(a, "enel.pdf");
  assert.equal(o.fornitore, "Enel Energia");
  assert.equal(o.nome, "Enel Flex Control Luce");
  assert.equal(o.prezzi.F0, 0.02226); assert.equal(o.quotaFissaAnnua, 180); assert.equal(o.prezzoMax, 0.174);
});

test("luce fissa trioraria", () => {
  const a = analizza(`Offerta a prezzo fisso bloccato 24 mesi. F1 0,1450 €/kWh F2 0,1380 €/kWh F3 0,1210 €/kWh. Quota fissa 8,50 €/POD/mese`);
  const o = bozzaOfferta(a);
  assert.deepEqual(o.prezzi, { F1: 0.145, F2: 0.138, F3: 0.121 });
  assert.equal(o.tipoPrezzo, "fisso"); assert.equal(o.quotaFissaAnnua, 102);
});

test("gas fisso, anche se cita la luce", () => {
  const a = analizza(`Enel Fix Web Gas. Prezzo Gas di 0,6901 €/Smc bloccato 12 mesi. Quota fissa 144 €/PDR/anno. Disponibile anche luce a 0,1 €/kWh`);
  const o = bozzaOfferta(a);
  assert.equal(o.fornitura, "GAS"); assert.equal(o.prezzoSmc, 0.6901); assert.equal(o.quotaFissaAnnua, 144);
});

test("PDF scansione: niente valori inventati", () => {
  const a = analizza("pagina vuota");
  assert.equal(a.tipo, null); assert.equal(Object.keys(a.campi).length, 0);
});

test("perdite di rete dedotte dal testo", () => {
  assert.equal(analizza("Prezzo fisso F0 0,12 €/kWh applicato all'energia prelevata comprensiva delle perdite di rete. Costo fisso anno 60 €").perdite, "tutto");
  assert.equal(analizza("PUN + 0,01 €/kWh spread. Al PUN si applicano le perdite di rete del 10%").perdite, "indice");
  assert.equal(analizza("PUN Index + 0,02 €/kWh spread. Il Prezzo Luce è comprensivo delle perdite di rete").perdite, "nessuna");
});
