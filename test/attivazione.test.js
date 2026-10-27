import { test } from "node:test";
import assert from "node:assert/strict";
import { dataAttivazione, meseSimulazione, lavorativo } from "../src/attivazione.js";
const att = (f, fo, a = false) => dataAttivazione(f, fo, { anticipata: a }).attivazione;

test("gas e luce fino al 10/11/2026: richiesta entro il 10 → 1° del mese dopo, altrimenti quello successivo", () => {
  assert.equal(att("2026-10-05", "GAS", true), "2026-11-01");   // richiesta 7/10
  assert.equal(att("2026-10-01", "LUCE"), "2026-12-01");        // richiesta 17/10 (dopo il ripensamento)
  assert.equal(att("2026-10-27", "GAS"), "2027-01-01");         // richiesta 12/11
  assert.equal(att("2026-12-20", "GAS", true), "2027-02-01");   // scavalco d'anno
});

test("luce dal 1/12/2026: primo giorno lavorativo dopo la richiesta, non prima del 1/12", () => {
  assert.equal(att("2026-10-27", "LUCE"), "2026-12-01");        // richiesta 12/11
  assert.equal(att("2026-11-25", "LUCE"), "2026-12-14");        // richiesta ven 11/12 → lun 14/12
  assert.equal(att("2026-12-22", "LUCE", true), "2026-12-28");  // richiesta 24/12, salta Natale, S. Stefano e la domenica
});

test("festività e mese della simulazione", () => {
  assert.equal(lavorativo(new Date("2027-03-29T00:00:00Z")), false); // Pasquetta 2027
  assert.equal(meseSimulazione("2026-12-14"), "2026-12");
  assert.equal(meseSimulazione("2026-12-28"), "2027-01");
});

test("inizio fornitura letto dal testo della CTE o dell'offerta", async () => {
  const { attivazioneDaTesto, dataAttivazione } = await import("../src/attivazione.js");
  const a = attivazioneDaTesto("OFFERTA DECORRENTE DAL 01/12/2026. Il prezzo della componente energia…");
  assert.deepEqual([a.tipo, a.data], ["data", "2026-12-01"]);
  const b = attivazioneDaTesto("La fornitura avrà inizio dal primo giorno del secondo mese successivo alla conclusione del contratto.");
  assert.deepEqual([b.tipo, b.mesi], ["mesi", 2]);
  assert.equal(dataAttivazione("2026-10-27", "LUCE", { cte: b }).attivazione, "2026-12-01");
  assert.equal(dataAttivazione("2026-10-27", "GAS", { cte: a }).attivazione, "2026-12-01");
  const c = attivazioneDaTesto("Il fornitore si impegna a completare l'attivazione della fornitura entro 60 giorni dalla firma.");
  assert.deepEqual([c.tipo, c.testo], ["entro", "entro 60 giorni"]);
  assert.equal(attivazioneDaTesto("Prezzo fisso per 12 mesi dalla data di attivazione della fornitura."), null);
});

test("link delle offerte sempre assoluti", async () => {
  const { urlCompleto } = await import("../src/opendata.js");
  assert.equal(urlCompleto("www.ambiensenergia.it"), "https://www.ambiensenergia.it");
  assert.equal(urlCompleto("https://x.it/a"), "https://x.it/a");
  assert.equal(urlCompleto("sito.it/offerte?x=1"), "https://sito.it/offerte?x=1");
  assert.equal(urlCompleto("non è un link"), "");
});
