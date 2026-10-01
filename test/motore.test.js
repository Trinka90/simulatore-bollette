// Stessi test della versione Python, sulle bollette reali Hera ed Estra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calcolaLuce, calcolaGas, Periodo, data, progressivo } from "../src/motore.js";
import { simula, punMese, psvMese } from "../src/simulazione.js";

const D = JSON.parse(readFileSync(new URL("../data/dati.json", import.meta.url)));
const T = D.tariffe, I = D.indici;
const vicino = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol + 1e-9, `${msg}: ${a} vs ${b}`);
const media = (...r) => r.reduce((s, [k, p]) => s + k * p, 0) / r.reduce((s, [k]) => s + k, 0);

test("bolletta Hera STG luglio-agosto 2026 = 41,01 €", () => {
  const consumi = { F1: 0.093 + 0.526, F2: 0.352 + 1.276, F3: 10.137 + 7.436 };
  const o = {
    prezzi: { F1: media([0.093, 0.1696211], [0.526, 0.1919676]), F2: media([0.352, 0.1863224], [1.276, 0.2247883]),
      F3: media([10.137, 0.1674816], [7.436, 0.1888876]) },
    quotaFissaMese: -6.1311, altriKwh: media([10.582, 0.0384637], [9.238, 0.0184679]) + 0.00056 + 0.00208,
  };
  const r = calcolaLuce(o, consumi, { potenzaKw: 6, residente: true, consumoAnnuoKwh: 3175.22, canoneRai: true },
    new Periodo(data(2026, 7, 1), data(2026, 8, 31)), T);
  for (const [g, v] of Object.entries({ vendita: -8.05, rete: 27.86, oneri: 0.66, imposte: 0.45, iva: 2.09, altro: 18 }))
    vicino(r.gruppo(g), v, 0.02, g);
  vicino(r.totale, 41.01, 0.05, "totale");
});

test("bolletta Estra gas luglio 2026 = 10,32 €", () => {
  const o = { indicizzata: true, indice: 0.606612, prezzoSmc: 0.025, altriSmc: 0.03206802 + 0.01074012 + 0.007946, quotaFissaMese: 2.5 };
  const r = calcolaGas(o, 2.01, { coeffC: 1 }, new Periodo(data(2026, 7, 1), data(2026, 7, 31)), T);
  vicino(r.gruppo("vendita"), 3.87, 0.02, "vendita");
  vicino(r.gruppo("rete"), 4.63, 0.02, "rete");
  vicino(r.gruppo("imposte"), 0.13, 0.01, "imposte");
  vicino(r.totale, 10.32, 0.03, "totale");
});

test("esenzione accisa 3 kW e niente esenzione sopra 2640 kWh", () => {
  const per = new Periodo(data(2026, 7, 1), data(2026, 8, 31));
  const a = calcolaLuce({ prezzi: { F0: 0.15 } }, { F0: 250 }, { potenzaKw: 3, residente: true, consumoAnnuoKwh: 1500 }, per, T);
  vicino(a.gruppo("imposte"), 0, 0.001, "esente");
  const b = calcolaLuce({ prezzi: { F0: 0.15 } }, { F0: 500 }, { potenzaKw: 3, residente: true, consumoAnnuoKwh: 3000 }, per, T);
  vicino(b.gruppo("imposte"), 500 * 0.0227, 0.01, "non esente");
});

test("scaglioni riproporzionati", () => {
  const sc = [[120, 1], [480, 2], [null, 3]];
  vicino(progressivo(200, sc, 1), 120 + 80 * 2, 1e-9, "anno");
  vicino(progressivo(100, sc, 1 / 12), 10 + 60 + 180, 1e-9, "mese");
});

test("PUN reale coincide con bolletta Hera; mesi futuri simulati", () => {
  vicino(punMese(I, 2026, 8, "centrale").F3.valore * 1.1, 0.1888876, 1e-6, "CELD");
  const c = punMese(I, 2027, 1, "centrale").F0, a = punMese(I, 2027, 1, "alto").F0;
  assert.equal(c.tipo, "SIMULATO");
  vicino(a.valore, c.valore * 1.25, 1e-12, "alto");
  vicino(psvMese(I, 2027, 1, "basso").valore, 0.77 * 0.75, 1e-12, "psv");
});

test("simulazione 12 mesi: consumo totale, scenari, prezzo massimo", () => {
  const U = { luce: { potenzaKw: 6, residente: true, consumoAnnuoKwh: 3175, canoneRai: true }, gas: { consumoAnnuoSmc: 39 } };
  const fisso = simula({ fornitura: "LUCE", tipoPrezzo: "fisso", prezzi: { F0: 0.12 }, quotaFissaAnnua: 96 }, U, T, I, "2026-10");
  assert.deepEqual(Object.keys(fisso), ["centrale"]);
  vicino(fisso.centrale.reduce((s, m) => s + m.consumo, 0), 3175, 1e-6, "consumo");
  const cap = simula({ fornitura: "LUCE", tipoPrezzo: "indicizzato", prezzi: { F0: 0.02 }, perdite: "indice", prezzoMax: 0.15 }, U, T, I, "2026-10");
  const e = cap.alto[0].risultato.voci.find((v) => v.descrizione === "Energia F0");
  vicino(e.prezzo, 0.15, 1e-12, "tetto");
});

test("parità con la versione Python (report Enel/Estra)", () => {
  const U = { luce: { potenzaKw: 6, residente: true, consumoAnnuoKwh: 3175, canoneRai: true, ripartizione: { F1: 0.33, F2: 0.31, F3: 0.36 } },
    gas: { consumoAnnuoSmc: 39, profilo: { 1: 4, 2: 3, 3: 4, 4: 4, 5: 2, 6: 3, 7: 2, 8: 3, 9: 3, 10: 3, 11: 4, 12: 4 } } };
  const enel = simula({ fornitura: "LUCE", tipoPrezzo: "indicizzato", prezzi: { F0: 0.02226 }, perdite: "indice", prezzoMax: 0.174, quotaFissaAnnua: 180 }, U, T, I, "2026-10");
  vicino(enel.centrale.reduce((s, m) => s + m.risultato.totale, 0), 1409.59, 0.005, "enel");
  const estra = simula({ fornitura: "GAS", tipoPrezzo: "indicizzato", prezzoSmc: 0.025, altriSmc: 0.0507541, quotaFissaAnnua: 30 }, U, T, I, "2026-10");
  vicino(estra.alto.reduce((s, m) => s + m.risultato.totale, 0), 153.78, 0.005, "estra alto");
});
