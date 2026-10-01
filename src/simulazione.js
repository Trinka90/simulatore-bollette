// Simulazione 12 bollette mensili: ogni valore usato e marcato REALE o SIMULATO.
import { Periodo, calcolaLuce, calcolaGas, daIso } from "./motore.js";

export const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio",
  "agosto", "settembre", "ottobre", "novembre", "dicembre"];

export const PROFILO_LUCE_STANDARD = { 1: 9.5, 2: 8.6, 3: 8.4, 4: 7.5, 5: 7.3, 6: 7.8, 7: 8.9, 8: 8.2, 9: 7.6, 10: 7.8, 11: 8.6, 12: 9.8 };
export const PROFILO_GAS_RISCALDAMENTO = { 1: 18, 2: 15, 3: 12, 4: 7, 5: 3, 6: 2, 7: 2, 8: 2, 9: 2, 10: 6, 11: 13, 12: 18 };
export const PROFILO_GAS_COTTURA = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1 };

const ym = (a, m) => `${a}-${String(m).padStart(2, "0")}`;
const ap = (nome, valore, unita, tipo, nota = "") => ({ nome, valore, unita, tipo, nota });

function normalizza(profilo) {
  const p = {};
  let tot = 0;
  for (let m = 1; m <= 12; m++) { p[m] = Number(profilo[m] ?? profilo[String(m)] ?? 0); tot += p[m]; }
  for (let m = 1; m <= 12; m++) p[m] = tot ? p[m] / tot : 1 / 12;
  return p;
}

export function mesiDa(inizio, n) {
  let [a, m] = inizio.split("-").map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push([a, m]);
    if (m === 12) { a++; m = 1; } else m++;
  }
  return out;
}

const ultimoReale = (serie) => {
  const k = Object.keys(serie).sort().at(-1);
  return [k, serie[k]];
};

export function punMese(indici, a, m, scenario) {
  const serie = indici.pun.mesi, k = ym(a, m);
  const fasce = (obj) => Object.entries(obj).filter(([f]) => !f.startsWith("_"));
  if (serie[k]) {
    const nota = serie[k]._nota || "media mensile GME";
    return Object.fromEntries(fasce(serie[k]).map(([f, v]) => [f, ap(`PUN ${f}`, v, "€/kWh", "REALE", nota)]));
  }
  const molt = indici.metodo_simulazione.scenari[scenario];
  const [rif, val] = ultimoReale(serie);
  const nota = `ultimo reale (${rif}) × ${molt} - scenario ${scenario}`;
  return Object.fromEntries(fasce(val).map(([f, v]) => [f, ap(`PUN ${f}`, v * molt, "€/kWh", "SIMULATO", nota)]));
}

export function psvMese(indici, a, m, scenario) {
  const serie = indici.psv.mesi, k = ym(a, m);
  if (serie[k] != null) return ap("PSV", serie[k], "€/Smc", "REALE", "media mensile");
  const met = indici.metodo_simulazione, molt = met.scenari[scenario];
  return ap("PSV", met.psv_centrale * molt, "€/Smc", "SIMULATO",
    `stima da futures TTF (${met.psv_centrale}) × ${molt} - scenario ${scenario}`);
}

export function cdispdMese(indici, a, m) {
  const serie = indici.cdispd.mesi, k = ym(a, m);
  if (serie[k] != null) return ap("CDISPD dispacciamento", serie[k], "€/kWh", "REALE", "valore ARERA del mese");
  const v = Object.values(serie);
  return ap("CDISPD dispacciamento", v.reduce((x, y) => x + y, 0) / v.length, "€/kWh", "SIMULATO",
    `media dei mesi noti (${Object.keys(serie).sort().join(", ")})`);
}

function tariffaApplicata(blocco, nome, periodo) {
  if (periodo.fine <= daIso(blocco.valido_al)) return ap(nome, null, "", "REALE", blocco.fonte || "");
  return ap(nome, null, "", "SIMULATO", `valori validi fino al ${blocco.valido_al} mantenuti invariati (non ancora pubblicati)`);
}

function meseRisultato(a, m, periodo, consumo, unita, risultato, applicati) {
  risultato.avvisi = risultato.avvisi.filter((x) => !x.includes("valori validi"));
  return { anno: a, mese: m, periodo, consumo, unita, risultato, applicati,
    etichetta: `${MESI[m - 1][0].toUpperCase()}${MESI[m - 1].slice(1)} ${a}`,
    simulato: applicati.some((x) => x.tipo === "SIMULATO") };
}

export function simulaLuce(off, utenza, tariffe, indici, inizio, nMesi = 12, scenario = "centrale") {
  const u = utenza.luce;
  const profilo = normalizza(u.profilo || PROFILO_LUCE_STANDARD);
  const rip = u.ripartizione || tariffe.luce.ripartizione_fasce_tipica;
  const ut = { potenzaKw: u.potenzaKw, residente: u.residente, consumoAnnuoKwh: u.consumoAnnuoKwh, canoneRai: u.canoneRai };
  const indic = off.tipoPrezzo === "indicizzato";
  return mesiDa(inizio, nMesi).map(([a, m]) => {
    const per = Periodo.mese(a, m);
    const kwh = u.consumoAnnuoKwh * profilo[m];
    const consumi = { F1: kwh * rip.F1, F2: kwh * rip.F2, F3: kwh * rip.F3 };
    const app = [];
    let indice = 0;
    if (indic) {
      const pun = punMese(indici, a, m, scenario);
      let usate = ["F0", "F1", "F2", "F3", "F23"].filter((f) => f in off.prezzi);
      if (usate.includes("F0")) usate = ["F0"];
      else if (usate.includes("F23")) usate = ["F1", "F23"];
      usate.forEach((f) => app.push(pun[f]));
      indice = Object.fromEntries(Object.entries(pun).map(([f, x]) => [f, x.valore]));
    }
    const cd = off.cdispd ?? "arera";
    const cdv = cd === "arera" ? cdispdMese(indici, a, m)
      : ap("CDISPD dispacciamento", Number(cd), "€/kWh", "REALE", "valore indicato nella CTE");
    app.push(cdv);
    app.push(tariffaApplicata(tariffe.luce.oneri, "Oneri di sistema ASOS/ARIM", per));
    app.push(tariffaApplicata(tariffe.luce.rete, "Tariffe di rete", per));
    const o = {
      prezzi: off.prezzi, indicizzata: indic, indice,
      quotaFissaMese: (off.quotaFissaAnnua || 0) / 12,
      altriKwh: cdv.valore + (off.altriKwh || 0),
      perdite: off.perdite === "tutto" ? 0.1 : 0,
      perditeIndice: off.perdite === "indice" ? 0.1 : 0,
      prezzoMax: off.prezzoMax ?? null,
    };
    return meseRisultato(a, m, per, kwh, "kWh", calcolaLuce(o, consumi, ut, per, tariffe), app);
  });
}

export function simulaGas(off, utenza, tariffe, indici, inizio, nMesi = 12, scenario = "centrale") {
  const u = utenza.gas;
  const profilo = normalizza(u.profilo || (u.riscaldamento ? PROFILO_GAS_RISCALDAMENTO : PROFILO_GAS_COTTURA));
  const indic = off.tipoPrezzo === "indicizzato";
  return mesiDa(inizio, nMesi).map(([a, m]) => {
    const per = Periodo.mese(a, m);
    const smc = u.consumoAnnuoSmc * profilo[m];
    const app = [];
    let psv = 0;
    if (indic) {
      const pv = psvMese(indici, a, m, scenario);
      app.push(pv);
      psv = pv.valore;
    }
    app.push(tariffaApplicata(tariffe.gas.rete_oneri, "Rete e oneri gas", per));
    const o = { prezzoSmc: off.prezzoSmc, indicizzata: indic, indice: psv,
      quotaFissaMese: (off.quotaFissaAnnua || 0) / 12, altriSmc: off.altriSmc || 0 };
    return meseRisultato(a, m, per, smc, "Smc", calcolaGas(o, smc, { coeffC: 1 }, per, tariffe), app);
  });
}

/** {scenario: [mesi]}; per offerte a prezzo fisso solo "centrale". */
export function simula(off, utenza, tariffe, indici, inizio, nMesi = 12) {
  const f = off.fornitura === "LUCE" ? simulaLuce : simulaGas;
  const scen = off.tipoPrezzo === "indicizzato" ? ["basso", "centrale", "alto"] : ["centrale"];
  return Object.fromEntries(scen.map((s) => [s, f(off, utenza, tariffe, indici, inizio, nMesi, s)]));
}

export const totale = (mesi) => mesi.reduce((a, m) => a + m.risultato.totale, 0);

/** Riepilogo per il confronto. */
export function riepilogo(off, utenza, tariffe, indici, inizio, nMesi = 12) {
  const ris = simula(off, utenza, tariffe, indici, inizio, nMesi);
  const cen = ris.centrale;
  const tot = Object.fromEntries(Object.entries(ris).map(([s, v]) => [s, totale(v)]));
  const consumo = cen.reduce((a, m) => a + m.consumo, 0);
  const altro = cen.reduce((a, m) => a + m.risultato.gruppo("altro"), 0);
  return { offerta: off, ris, tot, centrale: tot.centrale, basso: tot.basso ?? tot.centrale,
    alto: tot.alto ?? tot.centrale, consumo, costoMedio: consumo ? (tot.centrale - altro) / consumo : 0,
    mesiSimulati: cen.filter((m) => m.simulato).length };
}
