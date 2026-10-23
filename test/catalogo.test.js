// Motore delle bollette sulle offerte del Portale Offerte: verifica sui casi calcolati dal Portale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leggiOfferte, leggiParametri } from "../src/opendata.js";
import { contesto, simulaOfferta, totaleMesi, riepilogoOfferta, bollettaPersonalizzata } from "../src/bolletta.js";

const D = JSON.parse(readFileSync(new URL("../data/dati.json", import.meta.url)));
const xml = (c) => readFileSync(new URL(`./fixtures/PO_Offerte_${c}_campione.xml`, import.meta.url), "utf8");
const E = leggiOfferte(xml("E"), "2026-10-06").offerte, G = leggiOfferte(xml("G"), "2026-10-06").offerte;
const ctx = contesto(D);
const vicino = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol + 1e-9, `${msg}: ${a.toFixed(4)} vs ${b}`);
const somma = (mesi, g) => mesi.reduce((s, x) => s + x.risultato.gruppo(g), 0);
const giorni = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();
// consumo proporzionale ai giorni: la somma dei 12 mesi equivale al calcolo annuo del Portale
const perGiorni = (annuo) => Object.fromEntries([10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => [m, annuo * giorni(m >= 10 ? 2026 : 2027, m) / 365]));
const milano = { comune: { istat: "015146", nome: "Milano", provincia: "015", regione: "03" }, residente: true, ingresso: "2026-10",
  bollettaWeb: false, domiciliazione: false };

test("catalogo: offerte lette dal tracciato XML", () => {
  assert.ok(E.length > 200 && G.length > 200);
  const o = E.find((x) => x.id === "039679ESFML00XXBasePF20240000000");
  assert.equal(o.tipo, "fisso"); assert.deepEqual(o.reg, ["01", "02"]); assert.equal(o.disp[0].c, "14");
  assert.equal(o.al, "2099-12-31"); assert.equal(o.perditeIncluse, true);
});

test("Portale: BasePF2024 luce Milano 2.700 kWh 3 kW = 1.274,92 €", () => {
  const u = { ...milano, luce: { potenzaKw: 3, annuo: 2700, mesi: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 225])), canoneRai: false } };
  const mesi = simulaOfferta(E.find((x) => x.nome === "BasePF2024"), u, ctx);
  vicino(somma(mesi, "vendita"), 913.75, 0.12, "vendita");
  vicino(somma(mesi, "rete"), 133.97, 0.05, "rete");
  vicino(somma(mesi, "oneri"), 89.51, 0.05, "oneri");
  vicino(somma(mesi, "imposte"), 21.79, 0.05, "imposte");
  vicino(totaleMesi(mesi), 1274.92, 0.1, "totale");
});

test("Portale: CHIARISSIMA FIX PERTE gas Milano 1.400 Smc = 1.732,03 €", () => {
  const u = { ...milano, gas: { annuo: 1400, mesi: perGiorni(1400), uso: "entrambi", zona: "E" } };
  const mesi = simulaOfferta(G.find((x) => x.id === "000453GSFML01XX47646CHIARISSITEC"), u, ctx);
  vicino(somma(mesi, "vendita"), 818 - 20, 0.15, "vendita meno sconto");
  vicino(somma(mesi, "rete"), 364.39, 0.2, "rete");
  vicino(somma(mesi, "oneri"), 74.57, 0.2, "oneri");
  vicino(somma(mesi, "imposte"), 224.68, 0.2, "imposte");
  vicino(totaleMesi(mesi), 1732.03, 0.3, "totale");
});

test("sconto condizionato: bolletta web conta solo se scelta", () => {
  const off = G.find((x) => x.id === "000453GSFML01XX47646CHIARISSITEC");
  const u = { ...milano, gas: { annuo: 1400, mesi: null, uso: "entrambi", zona: "E" } };
  const senza = totaleMesi(simulaOfferta(off, u, ctx)), con = totaleMesi(simulaOfferta(off, { ...u, bollettaWeb: true }, ctx));
  vicino(senza - con, 6 * 1.22, 0.05, "6 € + IVA 22%");
});

test("variabile: PUN × (1+λ) + spread, scenari ordinati", () => {
  const off = E.find((x) => x.id === "000453ESVML01XX47429SegnoXVXLSEV");
  const u = { ...milano, luce: { potenzaKw: 3, annuo: 2700, mesi: null, canoneRai: true } };
  const r = riepilogoOfferta(off, u, ctx);
  assert.ok(r.basso < r.centrale && r.centrale < r.alto);
  const v = r.mesi[0].risultato.voci.find((x) => x.descrizione.startsWith("PUN"));
  vicino(v.prezzo, D.indici.pun.mesi["2026-09"].F0 * 1.1, 1e-9, "PUN ottobre = ultimo reale × 1,1");
  assert.ok(r.mesi[0].risultato.voci.some((x) => x.descrizione === "Canone RAI"));
});

test("bolletta personalizzata: 800 kWh in due mesi", () => {
  const off = E.find((x) => x.nome === "BasePF2024");
  const u = { ...milano, luce: { potenzaKw: 3, annuo: 2700, mesi: null, canoneRai: false } };
  const b = bollettaPersonalizzata(off, u, ctx, { dal: "2026-11-01", al: "2026-12-31", kwh: 800 });
  assert.equal(b.periodo.giorni, 61);
  vicino(b.risultato.voci.find((x) => x.descrizione === "Prezzo energia").quantita, 800, 1e-9, "kWh");
  assert.ok(b.risultato.totale > 800 * 0.25);
});

test("tutte le offerte del campione si simulano senza errori", () => {
  const u = { ...milano, luce: { potenzaKw: 3, annuo: 2700, mesi: null, canoneRai: false }, gas: { annuo: 800, mesi: null, uso: "entrambi", zona: "E" } };
  for (const o of [...E, ...G]) {
    const t = totaleMesi(simulaOfferta(o, u, ctx));
    assert.ok(Number.isFinite(t) && t > 0, `${o.id} ${o.nome}: ${t}`);
  }
});
