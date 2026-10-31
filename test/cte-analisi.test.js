// Analisi completa delle CTE: verificata su 5 CTE reali (testo estratto con pdf.js come nell'app).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analisiCompleta, completaDaAnalisi, serviziObbligatori } from "../src/cte-analisi.js";
import { analizza, bozzaOfferta } from "../src/cte.js";

const leggi = (f) => readFileSync(new URL(`./fixtures/cte-reali/${f}.txt`, import.meta.url), "utf8");
const valori = (a, k) => a.sezioni[k].voci.map((v) => v.v);
const offerta = (f) => { const t = leggi(f), a = analisiCompleta(t, []); return { a, o: completaDaAnalisi({ ...bozzaOfferta(analizza(t), f + ".pdf"), note: [] }, a) }; };

test("Poste Energia Luce: prezzo fisso 24 mesi, perdite incluse, nessun costo nascosto", () => {
  const { a, o } = offerta("poste-energia-luce");
  assert.equal(a.venditore, "Poste Energia (PostePay)");
  assert.equal(a.codice, "036327ESFML14XX261030REPENGXXXXX");
  assert.deepEqual([a.forn, a.natura, a.durataMesi, a.perdite], ["LUCE", "fisso", 24, "incluse nel prezzo"]);
  assert.deepEqual(a.validita, { dal: "30/10/2026", al: "16/11/2026" });
  assert.equal(a.statistiche.daLeggere, 0);
  assert.deepEqual(valori(a, "indennizzi"), [30]);
  assert.ok(a.assenze.includes("Nessuno sconto o bonus") && a.assenze.includes("Nessun servizio aggiuntivo"));
  assert.ok(a.avvisi.some((x) => x.titolo === "Le nuove condizioni valgono se non disdici"));
  assert.deepEqual([o.prezzi, o.quotaFissaAnnua, o.perdite], [{ F0: 0.189 }, 89, "nessuna"]);
});

test("Poste Energia Gas: clausola ETS2 sui costi delle quote di emissione", () => {
  const { a, o } = offerta("poste-energia-gas");
  assert.deepEqual([a.forn, a.natura, a.durataMesi], ["GAS", "fisso", 24]);
  assert.ok(a.avvisi.some((x) => /ETS2/.test(x.titolo)));
  assert.deepEqual([o.prezzoSmc, o.quotaFissaAnnua], [0.83, 89]);
});

test("Illumia Energia Lunga Luce: penali di recesso, deposito, servizi facoltativi, poi PUN + fee", () => {
  const { a, o } = offerta("illumia-energia-lunga-luce");
  assert.deepEqual([a.venditore, a.nome, a.natura, a.durataMesi], ["Illumia", "ENERGIA LUNGA LUCE", "fisso", 36]);
  assert.equal(a.dopo, "variabile (PUN Index GME + 0,01 €/kWh)");
  assert.ok(a.soloSdd);
  assert.deepEqual(valori(a, "penali"), [300, 200, 100]);
  assert.deepEqual(valori(a, "deposito"), [11.5, 15.5]);
  assert.deepEqual(valori(a, "pratiche"), [23]);
  assert.equal(serviziObbligatori(a).length, 0); // Caldaia Serena ed Energia Verde sono facoltativi
  assert.equal(a.statistiche.daLeggere, 0);
  assert.ok(a.avvisi.some((x) => x.titolo === "Onere se lasci prima della scadenza"));
  assert.deepEqual([o.prezzi, o.quotaFissaAnnua], [{ F0: 0.135 }, 84]);
});

test("MET FixWeb Leggera Luce: costo dell'app incluso, sconto 44 € che si perde, spese di mora", () => {
  const { a, o } = offerta("met-fixweb-leggera-luce");
  assert.deepEqual([a.venditore, a.nome, a.natura, a.durataMesi], ["MET Energia Italia", "FIXWEB LEGGERA LUCE 24 ONLINE", "fisso", 24]);
  assert.equal(a.dopo, "variabile (PUN Index GME + 0,0055 €/kWh)");
  assert.deepEqual(serviziObbligatori(a).map((x) => x.annuo), [12]);
  assert.deepEqual(valori(a, "mora"), [8, 20]);
  assert.ok(valori(a, "sconti").includes(44));
  assert.ok(a.assenze.includes("Nessun costo per cambiare fornitore") && a.assenze.includes("Nessun deposito o garanzia richiesti"));
  assert.ok(a.avvisi.some((x) => x.titolo === "Lo sconto si perde se lasci prima"));
  assert.ok(!a.avvisi.some((x) => /ETS2/.test(x.titolo))); // qui le quote CO2 sono già comprese nel prezzo
  assert.equal(a.statistiche.daLeggere, 0);
  assert.deepEqual([o.prezzi, o.quotaFissaAnnua], [{ F0: 0.1691 }, 132 + 12 - 22]);
});

test("MET FixWeb Leggera Gas: prezzo fisso e non lo spread del periodo successivo", () => {
  const { a, o } = offerta("met-fixweb-leggera-gas");
  assert.equal(a.dopo, "variabile (PSV Day Ahead + 0,052 €/Smc)");
  assert.deepEqual([o.prezzoSmc, o.quotaFissaAnnua], [0.719, 132 + 12 - 22]);
  assert.equal(a.statistiche.daLeggere, 0);
});

test("CTE di esempio: ogni importo classificato e codice confrontato col Portale", () => {
  const t = readFileSync(new URL("./fixtures/cte-esempio.txt", import.meta.url), "utf8");
  const off = { id: "000123ESFML01XXLUCESICURAWEB0001", venditore: "X", nome: "Y",
    comp: [{ n: "Energia", p: [{ pr: 0.119, u: "03" }] }, { n: "Commercializzazione", p: [{ pr: 120, u: "01" }] }, { n: "Altro", p: [{ pr: 0.05, u: "03" }] }] };
  const a = analisiCompleta(t, [off]);
  assert.equal(a.statistiche.daLeggere, 0);
  assert.deepEqual(valori(a, "deposito"), [11.5]);
  assert.deepEqual(valori(a, "penali"), [30]);
  assert.deepEqual(valori(a, "bolletta"), [1.5]);
  assert.deepEqual(valori(a, "pagamento"), [2]);
  assert.deepEqual(serviziObbligatori(a).map((x) => x.annuo), [34.8]);
  assert.equal(a.portale.trovata, true);
  assert.deepEqual(a.portale.mancanti.map((d) => d.v), [0.05]);
});
