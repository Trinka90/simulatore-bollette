import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { costoInternet, costoUscita, classificaInternet, analizzaSintesi, offertaMia } from "../src/internet.js";
import { richiedeInternet } from "../src/condizioni.js";

const cat = JSON.parse(readFileSync(new URL("../data/internet.json", import.meta.url)));
const off = (id) => cat.offerte.find((o) => o.id === id);
const vicino = (a, b) => assert.ok(Math.abs(a - b) < 0.005, `${a} ≠ ${b}`);

const P = { domiciliazione: true };
test("catalogo internet: campi obbligatori, fonte e data per ogni offerta", () => {
  const ids = new Set();
  for (const o of cat.offerte) {
    assert.ok(o.id && !ids.has(o.id), o.id); ids.add(o.id);
    assert.ok(o.operatore && o.nome && o.sito, o.id);
    assert.ok(o.listino > 0, o.id);
    assert.ok(/^https:\/\//.test(o.fonte), o.id);
    assert.ok(["ufficiale", "comparatore"].includes(o.fonteTipo), o.id);
    assert.match(o.verificato, /^\d{4}-\d{2}-\d{2}$/, o.id);
    assert.ok(o.tecnologie.length && Array.isArray(o.sconti) && Array.isArray(o.rate), o.id);
  }
  assert.ok(cat.offerte.filter((o) => o.fonteTipo === "ufficiale").length >= 20);
});

test("TIM WiFi Casa: sconti, rate di attivazione e modem, promo che scade", () => {
  const o = off("tim-wifi-casa");
  const r = costoInternet(o, P, 24, "2026-10-24");
  vicino(r.mesi[1], 27.90); vicino(r.totale, 27.90 * 24 + 39.90);
  vicino(costoInternet(o, P, 36, "2026-10-24").mesi[30], 27.90); // dal 25° mese finisce l'attivazione e inizia il modem
  vicino(costoInternet(o, P, 24, "2026-10-25").totale, 31.90 * 24 + 39.90);
  vicino(costoInternet(o, { domiciliazione: false }, 24, "2026-10-24").mesi[1], 32.90);
});

test("sconto mobile solo con la SIM dello stesso operatore; offerte riservate ai clienti mobile", () => {
  const o = off("iliadbox");
  vicino(costoInternet(o, P, 24).totale, 26.99 * 24 + 39.99);
  vicino(costoInternet(o, { mobile: "Iliad" }, 24).totale, 22.99 * 24 + 39.99);
  assert.ok(!classificaInternet(cat.offerte, P, 24).some((r) => r.offerta.soloPer === "mobile"));
  assert.ok(classificaInternet(cat.offerte, { mobile: "TIM" }, 24).some((r) => r.offerta.id === "tim-wifi-casa-mobile"));
});

test("sconti per chi ha luce/gas dello stesso fornitore (Plenitude, Enel, Edison)", () => {
  vicino(costoInternet(off("plenitude-fibra"), {}, 24).totale, 25.9 * 24 + 39);
  vicino(costoInternet(off("plenitude-fibra"), { energia: ["eniplenitude.com"] }, 24).totale, 17.9 * 24 + 39);
  vicino(costoInternet(off("enel-fibra-flash-trio"), { energia: ["enel.it"] }, 36).totale, 21.9 * 36 + 29.9);
  vicino(costoInternet(off("enel-fibra-flash-trio"), { energia: ["enel.it"], dueForniture: true }, 36).totale, 17.9 * 36 + 29.9);
  const e = off("edison-wifi");
  vicino(costoInternet(e, {}, 24).totale, 19.9 * 12 + 21.9 * 12);
  vicino(costoInternet(e, { energia: ["edisonenergia.it"], dueForniture: true }, 24).totale, 14.9 * 12 + 16.9 * 12);
});

test("uscita anticipata: disattivazione + rate residue", () => {
  vicino(costoUscita(off("windtre-super-fibra"), 12).importo, 84.59 + 36 * 5.99 + 12 * 1.99);
  vicino(costoUscita(off("eolo-fibra"), 12).importo, 24.9 + 12 * 8.7);
  assert.equal(costoUscita(off("fastweb-casa-pro"), 30).importo, 0);
  vicino(costoUscita(off("fastweb-casa-pro"), 12).importo, 29.95);
  assert.equal(costoUscita(off("iliad-5g-box"), 12).importo, null);
});

test("filtri: tecnologia, telefono, offerte che richiedono luce/gas, ordinamento", () => {
  const fwa = classificaInternet(cat.offerte, { tecnologia: "FWA" }, 24);
  assert.ok(fwa.length && fwa.every((r) => r.offerta.tecnologie.includes("FWA")));
  assert.ok(classificaInternet(cat.offerte, { voce: true }, 24).every((r) => r.offerta.voce));
  assert.ok(!classificaInternet(cat.offerte, { cambioEnergia: false }, 24).some((r) => r.offerta.id === "iren-stay-connettivita"));
  const lista = classificaInternet(cat.offerte, P, 24);
  for (let i = 1; i < lista.length; i++) assert.ok(lista[i].totale >= lista[i - 1].totale);
});

test("abbonamento attuale: prezzo attuale per i mesi indicati e poi prezzo pieno", () => {
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
