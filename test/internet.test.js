import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { costoInternet, costoUscita, classificaInternet, analizzaSintesi, offertaMia } from "../src/internet.js";
import { richiedeInternet } from "../src/condizioni.js";

const cat = JSON.parse(readFileSync(new URL("../data/internet.json", import.meta.url)));
const off = (id) => cat.offerte.find((o) => o.id === id);
const vicino = (a, b) => assert.ok(Math.abs(a - b) < 0.005, `${a} ≠ ${b}`);

test("catalogo internet: campi obbligatori, fonte e data per ogni offerta", () => {
  const ids = new Set();
  for (const o of cat.offerte) {
    assert.ok(o.id && !ids.has(o.id), o.id); ids.add(o.id);
    assert.ok(o.operatore && o.nome && o.sito, o.id);
    assert.ok(o.canone > 0 || o.promo?.canone > 0, o.id);
    assert.ok(/^https:\/\//.test(o.fonte), o.id);
    assert.match(o.verificato, /^\d{4}-\d{2}-\d{2}$/, o.id);
    assert.ok(o.tecnologie.length, o.id);
  }
});

test("promo e prezzo pieno mese per mese (WINDTRE 24,99 per 12 mesi, poi 29,99)", () => {
  const r = costoInternet(off("windtre-super-fibra"), {}, 24);
  vicino(r.totale, 24.99 * 12 + 29.99 * 12);
  vicino(r.mesi[11], 24.99); vicino(r.mesi[12], 29.99);
});

test("sconto mobile solo se hai la SIM dello stesso operatore; attivazione al primo mese", () => {
  const o = off("iliadbox");
  vicino(costoInternet(o, {}, 24).totale, 26.99 * 24 + 39.99);
  vicino(costoInternet(o, { mobile: "Iliad" }, 24).totale, 22.99 * 24 + 39.99);
  vicino(costoInternet(o, { mobile: "TIM" }, 24).totale, 26.99 * 24 + 39.99);
});

test("prezzo riservato ai clienti luce/gas (Plenitude Fibra)", () => {
  const o = off("plenitude-fibra");
  vicino(costoInternet(o, {}, 36).totale, 25.9 * 36 + 39);
  vicino(costoInternet(o, { energia: ["eniplenitude.com"] }, 36).totale, 19.9 * 36 + 39);
});

test("uscita anticipata: rate residue del modem nel canone (WINDTRE 48 rate)", () => {
  const u = costoUscita(off("windtre-super-fibra"), 12);
  vicino(u.importo, 36 * 5.99);
  assert.equal(costoUscita(off("iliadbox"), 30).importo, 0);
  vicino(costoUscita(off("iliadbox"), 12).importo, 25.99);
});

test("filtri: tecnologia, telefono, offerte che richiedono luce/gas", () => {
  const fwa = classificaInternet(cat.offerte, { tecnologia: "FWA" }, 24);
  assert.ok(fwa.length && fwa.every((r) => r.offerta.tecnologie.includes("FWA")));
  const voce = classificaInternet(cat.offerte, { voce: true }, 24);
  assert.ok(voce.every((r) => !/assenti/.test(r.offerta.chiamate || "")));
  const senza = classificaInternet(cat.offerte, { cambioEnergia: false }, 24);
  assert.ok(!senza.some((r) => r.offerta.id === "iren-stay-connettivita"));
  const lista = classificaInternet(cat.offerte, {}, 24);
  for (let i = 1; i < lista.length; i++) assert.ok(lista[i].totale >= lista[i - 1].totale);
});

test("abbonamento attuale: promo residua e poi prezzo pieno", () => {
  const o = offertaMia({ operatore: "TIM", canone: 24.9, promoMesi: 6, dopo: 32.9 });
  vicino(costoInternet(o, {}, 12).totale, 24.9 * 6 + 32.9 * 6);
});

test("lettura della sintesi contrattuale", () => {
  const t = `SINTESI CONTRATTUALE Vodafone Italia S.p.A. Nome dell'offerta: Casa Pro Fibra
    Tecnologia FTTH velocità fino a 2,5 Gbit/s
    Prezzo: canone mensile 29,95 € al mese per i primi 12 mesi, poi 33,95 € al mese.
    Costo di attivazione: 19,99 € una tantum. Costi di disattivazione: 29,90 €.`;
  const r = analizzaSintesi(t);
  assert.equal(r.operatore, "Vodafone");
  assert.equal(r.canone, 29.95);
  assert.equal(r.promoMesi, 12);
  assert.equal(r.dopo, 33.95);
  assert.equal(r.attivazione, 19.99);
  assert.equal(r.recesso, 29.9);
  assert.equal(r.down, 2500);
  assert.equal(r.tecnologia, "FTTH");
});

test("offerte luce/gas abbinate alla fibra riconosciute nel catalogo ARERA", () => {
  const c = JSON.parse(readFileSync(new URL("../www/catalogo-iniziale.json", import.meta.url)));
  const f = c.offerte.filter(richiedeInternet).map((o) => o.nome);
  assert.ok(f.includes("Fixa Time 24 Fibra Luce") && f.includes("Enel Luce e Giga") && f.some((n) => /CONNETTIVIT/.test(n)), f.join());
  assert.ok(f.length < 20);
});
