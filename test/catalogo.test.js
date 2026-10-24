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

test("STG: bolletta Hera STG luglio-agosto 2026 = 41,01 € con il nuovo motore", async () => {
  const { offertaSTG, calcolaBolletta } = await import("../src/bolletta.js");
  const { Periodo } = await import("../src/motore.js");
  const u = { comune: { regione: "09", provincia: "051" }, residente: true, ingresso: "2026-07", bollettaWeb: false, domiciliazione: false,
    luce: { potenzaKw: 6, canoneRai: true } };
  // parametri di luglio e agosto 2026 (CDISPD mensile STG, CPSTGD del III trimestre), come in bolletta
  const mese = (cdispd) => ({ ...ctx, E: { ...ctx.E, cdispd, csed: 0.00056, cpstgd: 0.00208 } });
  const off = offertaSTG({ gamma: -73.5737, csed: 0.00056, cpstgd: 0.00208 });
  const lug = calcolaBolletta(off, Periodo.mese(2026, 7), 0, { F1: 0.093, F2: 0.352, F3: 10.137 }, u, 3175.22, mese(0.0384637)).risultato;
  const ago = calcolaBolletta(off, Periodo.mese(2026, 8), 1, { F1: 0.526, F2: 1.276, F3: 7.436 }, u, 3175.22, mese(0.018468)).risultato;
  vicino(lug.totale + ago.totale, 41.01, 0.06, "totale STG");
});

test("sconti a mesi: 'dal quarto al sesto mese' e 'dodicesimo mese' valgono solo in quei mesi", async () => {
  const { finestraMesi } = await import("../src/bolletta.js");
  assert.deepEqual(finestraMesi("Sconto dal quarto al sesto mese"), [4, 6]);
  assert.deepEqual(finestraMesi("Sconto dodicesimo mese"), [12, 12]);
  assert.equal(finestraMesi("Sconto 24 mesi"), null);
  const off = { id: "x", forn: "LUCE", tipo: "fisso", fasce: "01", perditeIncluse: true, idx: [], disp: [], reg: [], cond: [],
    comp: [{ n: "Prezzo", m: "04", p: [{ f: "01", pr: 0.3, u: "03" }] }],
    sc: [{ n: "Sconto dal quarto al sesto mese", val: "02", iva: true, dur: 3, cond: "00", p: [{ u: "03", pr: 0.1 }] },
      { n: "Sconto dodicesimo mese", val: "02", iva: true, cond: "00", p: [{ u: "03", pr: 0.2 }] }] };
  const u = { ...milano, luce: { potenzaKw: 3, annuo: 1200, mesi: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 100])), canoneRai: false } };
  const mesi = simulaOfferta(off, u, ctx);
  const sconto = (i) => -mesi[i].risultato.voci.filter((v) => v.descrizione.startsWith("Sconto")).reduce((s, v) => s + v.importo, 0);
  assert.deepEqual(mesi.map((_, i) => Math.round(sconto(i)) + 0), [0, 0, 0, 10, 10, 10, 0, 0, 0, 0, 0, 20]);
});

test("confronto con il motore indipendente (verificato sul Portale): offerte del campione entro 1 € o 1%", () => {
  const R = JSON.parse(readFileSync(new URL("./fixtures/riferimento.json", import.meta.url)));
  // differenze note e motivate: il riferimento conta due volte i prezzi Peak/OffPeak; Sprint ha sconti
  // che l'app applica solo nei mesi indicati; gli sconti in % l'app li applica a indice + spread
  const motivate = (o) => o.fasce === "07" || /Sprint/.test(o.nome) || o.sc.some((s) => s.p.some((p) => p.u === "06"));
  const D2 = JSON.parse(readFileSync(new URL("../data/dati.json", import.meta.url)));
  const pun = R.pun_stima / 1.1;
  for (let i = 0; i < 12; i++) {
    const k = new Date(Date.UTC(2026, 9 + i, 1)).toISOString().slice(0, 7);
    D2.indici.pun.mesi[k] = { F0: pun, F1: pun, F2: pun, F3: pun, F23: pun };
    D2.indici.psv.mesi[k] = R.psv_stima;
  }
  const c2 = contesto(D2);
  const u = { ...milano, luce: { potenzaKw: 3, annuo: 2700, mesi: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 225])),
    ripartizione: { F1: 891 / 2700, F2: 837 / 2700, F3: 972 / 2700 }, canoneRai: false }, gas: { annuo: 1400, mesi: perGiorni(1400), uso: "entrambi", zona: "E" } };
  let n = 0;
  const fuori = [];
  for (const o of [...E, ...G]) {
    const atteso = R.offerte[o.id];
    if (atteso == null || motivate(o)) continue;
    const t = totaleMesi(simulaOfferta(o, u, c2));
    n++;
    if (Math.abs(t - atteso) > Math.max(1, 0.01 * atteso)) fuori.push(`${o.nome}: ${t.toFixed(2)} invece di ${atteso}`);
  }
  assert.ok(n > 400, `offerte confrontate: ${n}`);
  assert.deepEqual(fuori, []);
});
