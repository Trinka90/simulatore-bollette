// Lettura delle bollette: testi nel formato Bolletta 2.0 (come escono da pdf.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analizzaBolletta, consumoPerMese, consumiDaBollette } from "../src/bolletta-pdf.js";

const db = JSON.parse(readFileSync(new URL("../data/comuni.json", import.meta.url)));
const COMUNI = db.comuni.map(([istat, nome, sigla, provincia, regione]) => ({ istat, nome, sigla, provincia, regione }));

const LUCE = `Hera Comm S.p.A.  Bolletta n. 412345678 del 05/09/2026  Periodo di fatturazione: 01/07/2026 - 31/08/2026
Intestatario MARIO ROSSI  Indirizzo di fornitura VIA ROMA 10 52025 MONTEVARCHI (AR)
Codice POD IT001E12345678  Tipologia cliente: Uso domestico residente  Potenza impegnata 6 kW  Potenza disponibile 6,6 kW
Offerta: Servizio a Tutele Graduali  Codice offerta 000123ESVML01XXSTGDOMESTICO00001
Consumo annuo 3.175 kWh (dal 01/09/2025 al 31/08/2026)
Consumi fatturati nel periodo 19,82 kWh  F1 0,62 kWh  F2 1,63 kWh  F3 17,57 kWh
Energia F1 0,1696211 €/kWh  Energia F3 0,1888876 €/kWh
Spesa per la materia energia -8,05 €  Spesa per il trasporto 27,86 €  Canone di abbonamento alla televisione 18,00 €
TOTALE DA PAGARE 41,01 €  Spesa annua sostenuta negli ultimi 12 mesi 812,40 €`;

const GAS = `Estra Energie S.r.l.  Fattura del 10/08/2026  Periodo: dal 01/07/2026 al 31/07/2026
Punto di fornitura: VIA ROMA 10, 52025 Montevarchi AR  PDR 01234567890123  Categoria d'uso: C2 cottura cibi e/o acqua calda
Nome offerta: Scelta Dinamica Gas  Codice offerta: 000456GSVML01XXSCELTADINAMICA001
Coefficiente C 1,0156  Consumo annuo 39 Smc  Consumo fatturato 2,01 Smc
Totale bolletta € 10,32`;

test("bolletta luce: tutti i dati principali", () => {
  const b = analizzaBolletta(LUCE, COMUNI), c = b.campi;
  assert.equal(b.tipo, "LUCE");
  assert.equal(c.pod.valore, "IT001E12345678");
  assert.equal(c.codiceOfferta.valore, "000123ESVML01XXSTGDOMESTICO00001");
  assert.equal(c.consumoAnnuo.valore, 3175);
  assert.equal(c.potenza.valore, 6);
  assert.deepEqual(c.periodo.valore, { dal: "2026-07-01", al: "2026-08-31" });
  assert.equal(c.consumoPeriodo.valore, 19.82);
  assert.deepEqual([c.F1.valore, c.F2.valore, c.F3.valore], [0.62, 1.63, 17.57]);
  assert.equal(c.residente.valore, true);
  assert.equal(c.comune.valore.nome, "Montevarchi");
  assert.equal(c.totale.valore, 41.01);
  assert.equal(c.spesaAnnua.valore, 812.4);
  assert.equal(c.canoneRai.valore, 18);
});

test("bolletta gas: PDR, uso, consumi", () => {
  const b = analizzaBolletta(GAS, COMUNI), c = b.campi;
  assert.equal(b.tipo, "GAS");
  assert.equal(c.pod.valore, "01234567890123");
  assert.equal(c.uso.valore, "cottura");
  assert.equal(c.consumoAnnuo.valore, 39);
  assert.equal(c.consumoPeriodo.valore, 2.01);
  assert.equal(c.codiceOfferta.valore, "000456GSVML01XXSCELTADINAMICA001");
  assert.equal(c.nomeOfferta.valore, "Scelta Dinamica Gas");
  assert.equal(c.comune.valore.nome, "Montevarchi");
  assert.equal(c.totale.valore, 10.32);
});

test("consumi mensili ricostruiti dalle bollette", () => {
  const m = consumoPerMese("2026-07-01", "2026-08-31", 62);
  assert.ok(Math.abs(m["2026-07"] - 31) < 1e-9 && Math.abs(m["2026-08"] - 31) < 1e-9);
  const r = consumiDaBollette([{ dal: "2026-01-01", al: "2026-02-28", consumo: 590 }, { dal: "2026-03-01", al: "2026-03-31", consumo: 250 }]);
  assert.equal(r.coperti, 3);
  assert.equal(r.mesi[3], 250);
});

test("storico dei consumi e consumo medio dalla bolletta", async () => {
  const { analizzaBolletta, storicoConsumi, consumiDaBollette } = await import("../src/bolletta-pdf.js");
  const t = `POD IT001E12345678 Periodo di fatturazione: 01/07/2026 - 31/08/2026 Consumo fatturato 19,82 kWh
    Consumo medio giornaliero 0,32 kWh
    Storico dei consumi: Set 2025 310 kWh Ott 2025 295 kWh Nov 2025 330 kWh Dic 2025 380 kWh Gen 2026 400 kWh Feb 2026 350 kWh
    Mar 2026 320 kWh Apr 2026 280 kWh Mag 2026 260 kWh Giu 2026 240 kWh Lug 2026 10 kWh Ago 2026 9,82 kWh`;
  const st = storicoConsumi(t);
  assert.equal(st.length, 12);
  assert.deepEqual(st[0], { dal: "2025-09-01", al: "2025-09-30", consumo: 310 });
  const a = analizzaBolletta(t, []);
  assert.equal(a.campi.consumoMedio.valore.q, 0.32);
  assert.equal(a.campi.consumoAnnuo.valore, 3185); // somma dello storico (senza la voce «consumo annuo»)
  // una sola bolletta di 2 mesi + storico: i mesi della bolletta vincono, gli altri dallo storico
  const r = consumiDaBollette([{ dal: "2026-07-01", al: "2026-08-31", consumo: 19.82, storico: st }]);
  assert.equal(r.coperti, 12);
  assert.equal(r.mesi[1], 400);
});
