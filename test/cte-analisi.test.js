import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analisiCompleta, frasi } from "../src/cte-analisi.js";

const testo = readFileSync(new URL("./fixtures/cte-esempio.txt", import.meta.url), "utf8");

test("CTE completa: tipo di offerta, ogni importo classificato, clausole a rischio", () => {
  const a = analisiCompleta(testo, []);
  assert.equal(a.forn, "LUCE");
  assert.equal(a.natura, "fisso");
  assert.equal(a.durataMesi, 24);
  assert.ok(a.poiIndice);
  assert.equal(a.codice, "000123ESFML01XXLUCESICURAWEB0001");
  assert.equal(a.statistiche.daLeggere, 0);
  const v = (k) => a.sezioni[k].voci.flatMap((x) => x.importi.map((i) => i.v));
  assert.deepEqual(v("quota"), [10]);
  assert.deepEqual(v("dispacciamento"), [0.011]);
  assert.deepEqual(v("servizi"), [2.9]);
  assert.deepEqual(v("bolletta"), [1.5]);
  assert.deepEqual(v("pagamento"), [2]);
  assert.deepEqual(v("deposito"), [11.5]);
  assert.deepEqual(v("penali"), [30]);
  assert.deepEqual(v("amministrativi"), [15]);
  assert.deepEqual(v("stime"), [512.3]);
  const titoli = a.avvisi.map((x) => x.titolo);
  for (const t of ["Rinnovo alla scadenza", "Lo sconto può decadere", "Servizio attivato automaticamente", "Deposito cauzionale", "Costi se lasci prima"]) assert.ok(titoli.includes(t), t);
  assert.deepEqual([a.attivazione.tipo, a.attivazione.mesi], ["mesi", 2]);
});

test("confronto con il Portale tramite codice offerta", () => {
  const off = { id: "000123ESFML01XXLUCESICURAWEB0001", venditore: "X", nome: "Y",
    comp: [{ n: "Energia", p: [{ pr: 0.119, u: "03" }] }, { n: "Commercializzazione", p: [{ pr: 120, u: "01" }] }, { n: "Altro", p: [{ pr: 0.05, u: "03" }] }] };
  const a = analisiCompleta(testo, [off]);
  assert.equal(a.portale.trovata, true);
  assert.deepEqual(a.portale.mancanti.map((d) => d.v), [0.05]); // 10 €/mese = 120 €/anno ritrovato
});

test("righe di tabella: il valore resta attaccato alla sua voce", () => {
  const f = frasi("Corrispettivo di commercializzazione\n10,00 €/mese\nPrezzo energia F1\n0,1234 €/kWh");
  assert.deepEqual(f, ["Corrispettivo di commercializzazione 10,00 €/mese", "Prezzo energia F1 0,1234 €/kWh"]);
});
