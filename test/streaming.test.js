import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { combinazioneMigliore, costoPiano, costoPacchetto, pianoCopre } from "../src/streaming.js";

const cat = JSON.parse(readFileSync(new URL("../data/streaming.json", import.meta.url)));
const vicino = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≠ ${b}`);
const PREF = { pubblicita: true, impegno: true, hoTim: false };

test("catalogo streaming: prezzi, fonti e date", () => {
  for (const s of cat.servizi) { assert.ok(s.piani.length && /^https:/.test(s.fonte) && s.verificato, s.id); for (const p of s.piani) assert.ok(p.mensile > 0, s.id + p.id); }
  for (const k of cat.pacchetti) { assert.ok(k.include.every(([s]) => cat.servizi.some((x) => x.id === s)), k.id); assert.ok(/^https:/.test(k.fonte), k.id); }
});

test("costo di 12 mesi: sceglie annuale o vincolo se conviene e se accetti l'impegno", () => {
  const disney = cat.servizi.find((s) => s.id === "disney").piani.find((p) => p.id === "standard");
  vicino(costoPiano(disney, true).totale, 109.9);
  vicino(costoPiano(disney, false).totale, 10.99 * 12);
  const dazn = cat.servizi.find((s) => s.id === "dazn").piani.find((p) => p.id === "full");
  vicino(costoPiano(dazn, true).totale, 379);
});

test("pacchetti: promo poi prezzo pieno; piani DAZN che si coprono", () => {
  vicino(costoPacchetto(cat.pacchetti.find((k) => k.id === "sky-netflix")), 14.99 * 12);
  vicino(costoPacchetto(cat.pacchetti.find((k) => k.id === "tv-s")), 8 * 12);
  assert.ok(pianoCopre("dazn", "full", "goal", true) && !pianoCopre("dazn", "goal", "full", true));
  assert.ok(!pianoCopre("netflix", "ads", "standard", false));
});

test("Netflix + Disney+ + Prime: con internet TIM conviene TIMVISION L, senza no", () => {
  const voluti = { netflix: "ads", disney: "ads", prime: "ads" };
  const conTim = combinazioneMigliore(cat, voluti, { ...PREF, hoTim: true }, "2026-10-31");
  assert.deepEqual(conTim.migliore.pacchetti.map((x) => x.k.id), ["tv-l"]);
  vicino(conTim.migliore.totale, 14 * 12);
  const senza = combinazioneMigliore(cat, voluti, PREF, "2026-10-31");
  assert.ok(!senza.migliore.pacchetti.some((x) => x.k.richiede === "tim"));
  vicino(senza.singoli.totale, 6.99 * 12 + 6.99 * 12 + 49.9);
  assert.ok(senza.migliore.totale <= senza.singoli.totale);
});

test("senza pubblicità i pacchetti con piani 'con pubblicità' non valgono", () => {
  const r = combinazioneMigliore(cat, { netflix: "standard" }, { ...PREF, pubblicita: false, hoTim: true }, "2026-10-31");
  assert.equal(r.migliore.pacchetti.length, 0);
  vicino(r.migliore.totale, 13.99 * 12);
});
