// Motore di calcolo bollette luce/gas domestiche (porting di motore.py, stessi test).

export const FASCE = ["F1", "F2", "F3"];
const DAY = 86400000;

export function arrotonda(x) {
  const s = x < 0 ? -1 : 1;
  return (s * Math.round(Math.abs(x) * 100 + 1e-9)) / 100;
}

export function voce(gruppo, descrizione, quantita, unita, prezzo, importo, aliquotaIva) {
  return { gruppo, descrizione, quantita, unita, prezzo, importo: arrotonda(importo), aliquotaIva };
}

export class Risultato {
  constructor(quantita = 0, unita = "kWh") {
    this.voci = [];
    this.avvisi = [];
    this.quantita = quantita;
    this.unita = unita;
  }
  gruppo(nome) {
    return this.voci.filter((v) => v.gruppo === nome).reduce((a, v) => a + v.importo, 0);
  }
  get imponibile() {
    return this.voci.filter((v) => v.gruppo !== "iva" && v.gruppo !== "altro").reduce((a, v) => a + v.importo, 0);
  }
  get totale() {
    return this.voci.reduce((a, v) => a + v.importo, 0);
  }
  get costoUnitario() {
    return this.quantita ? (this.totale - this.gruppo("altro")) / this.quantita : null;
  }
}

// ---- date (UTC, senza fusi)
export const data = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
export const daIso = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return data(y, m, d);
};
export const giorniMese = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export class Periodo {
  constructor(inizio, fine) {
    if (fine < inizio) throw new Error("La data di fine precede la data di inizio");
    this.inizio = inizio;
    this.fine = fine;
  }
  get giorni() {
    return Math.round((this.fine - this.inizio) / DAY) + 1;
  }
  get mesi() {
    const i = this.inizio, f = this.fine;
    if (i.getUTCDate() === 1 && f.getUTCDate() === giorniMese(f.getUTCFullYear(), f.getUTCMonth() + 1)) {
      return (f.getUTCFullYear() - i.getUTCFullYear()) * 12 + f.getUTCMonth() - i.getUTCMonth() + 1;
    }
    return (this.giorni * 12) / 365;
  }
  get frazioneAnno() {
    return this.giorni / 365;
  }
  mesiSolari() {
    const out = [];
    let y = this.inizio.getUTCFullYear(), m = this.inizio.getUTCMonth() + 1;
    const fy = this.fine.getUTCFullYear(), fm = this.fine.getUTCMonth() + 1;
    while (y < fy || (y === fy && m <= fm)) {
      out.push([y, m]);
      if (m === 12) { y++; m = 1; } else m++;
    }
    return out;
  }
  static mese(y, m) {
    return new Periodo(data(y, m, 1), data(y, m, giorniMese(y, m)));
  }
}

const scaglioni = (raw) => raw.map(([u, r]) => [u === null ? Infinity : Number(u), Number(r)]);

export function progressivo(q, scaglioniAnnui, frazione) {
  let costo = 0, prec = 0;
  for (const [soglia, aliquota] of scaglioni(scaglioniAnnui)) {
    const sup = soglia === Infinity ? Infinity : soglia * frazione;
    const presa = Math.max(0, Math.min(q, sup) - prec);
    costo += presa * aliquota;
    prec = sup;
    if (q <= sup) break;
  }
  return costo;
}

const fmtData = (d) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

function controllaValidita(blocco, nome, periodo, avvisi) {
  const dal = daIso(blocco.valido_dal), al = daIso(blocco.valido_al);
  if (periodo.inizio < dal || periodo.fine > al) {
    avvisi.push(`${nome}: valori validi dal ${fmtData(dal)} al ${fmtData(al)}, il periodo simulato esce da questo intervallo.`);
  }
  if (!blocco.verificato) avvisi.push(`${nome}: valori NON ancora verificati su una bolletta reale.`);
}

function abbinaFasce(consumi, prezzi, rip, avvisi) {
  const tot = Object.values(consumi).reduce((a, b) => a + b, 0);
  let perFascia = Object.fromEntries(FASCE.map((k) => [k, consumi[k] || 0]));
  const haFasce = Object.values(perFascia).some((x) => x);
  if ("F0" in prezzi) return [["F0", tot, prezzi.F0]];
  if (!haFasce) {
    perFascia = Object.fromEntries(FASCE.map((k) => [k, tot * rip[k]]));
    avvisi.push("Offerta a fasce ma consumo non diviso per fascia: uso una ripartizione tipica F1/F2/F3.");
  }
  if ("F23" in prezzi) return [["F1", perFascia.F1, prezzi.F1], ["F23", perFascia.F2 + perFascia.F3, prezzi.F23]];
  return FASCE.map((k) => [k, perFascia[k], prezzi[k]]);
}

/**
 * offerta: {prezzi, indicizzata, indice (numero o {F0,F1,F2,F3,F23}), quotaFissaMese,
 *           altriKwh, perdite (0.10 su tutto), perditeIndice (0.10 solo su PUN), prezzoMax}
 * utenza:  {potenzaKw, residente, consumoAnnuoKwh, canoneRai}
 */
export function calcolaLuce(offerta, consumi, utenza, periodo, tariffe) {
  const t = tariffe.luce, rete = t.rete, oneri = t.oneri, imp = t.imposte;
  const iva = imp.iva_domestico;
  const q = Object.values(consumi).reduce((a, b) => a + b, 0);
  const r = new Risultato(q, "kWh");
  controllaValidita(rete, "Rete luce", periodo, r.avvisi);
  controllaValidita(oneri, "Oneri luce", periodo, r.avvisi);
  controllaValidita(imp, "Imposte luce", periodo, r.avvisi);
  const mesi = periodo.mesi;
  const add = (...a) => r.voci.push(voce(...a));

  const kPerd = 1 + (offerta.perdite || 0);
  const indiceDi = (f) => (typeof offerta.indice === "object" && offerta.indice !== null
    ? (offerta.indice[f] ?? offerta.indice.F0 ?? 0) : offerta.indice || 0);
  for (const [fascia, kwh, p] of abbinaFasce(consumi, offerta.prezzi, t.ripartizione_fasce_tipica, r.avvisi)) {
    let prezzo = offerta.indicizzata ? indiceDi(fascia) * (1 + (offerta.perditeIndice || 0)) + p : p;
    if (offerta.prezzoMax != null && prezzo > offerta.prezzoMax) {
      prezzo = offerta.prezzoMax;
      r.avvisi.push(`Energia ${fascia}: applicato il prezzo massimo dell'offerta (${offerta.prezzoMax} €/kWh).`);
    }
    add("vendita", `Energia ${fascia}`, kwh * kPerd, "kWh", prezzo, kwh * kPerd * prezzo, iva);
  }
  if (offerta.dispacciamentoKwh) add("vendita", "Dispacciamento (CDISPD)", q, "kWh", offerta.dispacciamentoKwh, q * offerta.dispacciamentoKwh, iva);
  if (offerta.sbilanciamentoKwh) add("vendita", "Corrispettivo di sbilanciamento", q, "kWh", offerta.sbilanciamentoKwh, q * offerta.sbilanciamentoKwh, iva);
  if (offerta.altriKwh) add("vendita", "Dispacciamento e altri corrispettivi", q, "kWh", offerta.altriKwh, q * offerta.altriKwh, iva);
  add("vendita", "Quota fissa venditore", mesi, "mesi", offerta.quotaFissaMese || 0, mesi * (offerta.quotaFissaMese || 0), iva);
  if (offerta.dispbtMese) add("vendita", "Dispacciamento quota fissa (DISPbt)", mesi, "mesi", offerta.dispbtMese, mesi * offerta.dispbtMese, iva);

  add("rete", "Quota fissa rete", mesi, "mesi", rete.quota_fissa_mese, mesi * rete.quota_fissa_mese, iva);
  const kwm = utenza.potenzaKw * mesi;
  add("rete", `Quota potenza (${utenza.potenzaKw} kW)`, kwm, "kW·mese", rete.quota_potenza_kw_mese, kwm * rete.quota_potenza_kw_mese, iva);
  add("rete", "Quota energia rete", q, "kWh", rete.quota_energia_kwh, q * rete.quota_energia_kwh, iva);

  add("oneri", "Componente ASOS", q, "kWh", oneri.asos_kwh, q * oneri.asos_kwh, iva);
  add("oneri", "Componente ARIM", q, "kWh", oneri.arim_kwh, q * oneri.arim_kwh, iva);

  let esente = 0;
  if (utenza.residente && utenza.potenzaKw <= imp.esenzione_potenza_max_kw) {
    const annuo = utenza.consumoAnnuoKwh;
    const massimo = imp.esenzione_kwh_mese * mesi;
    if (annuo == null) {
      esente = Math.min(q, massimo);
      r.avvisi.push("Consumo annuo non indicato: applico l'esenzione accisa piena (può essere una sottostima).");
    } else if (annuo <= imp.esenzione_annuo_pieno_kwh) {
      esente = Math.min(q, massimo);
    } else if (annuo <= imp.esenzione_annuo_max_kwh) {
      esente = Math.min(q, massimo);
      const rischio = esente * imp.accisa_kwh * (1 + iva);
      r.avvisi.push(`Consumo annuo tra ${imp.esenzione_annuo_pieno_kwh} e ${imp.esenzione_annuo_max_kwh} kWh: l'esenzione viene recuperata in parte. Possibile sottostima fino a ${rischio.toFixed(2)} €.`);
    }
  }
  const tassabile = q - esente;
  if (esente) add("imposte", "Accisa - quota esente residenti", esente, "kWh", 0, 0, iva);
  add("imposte", "Accisa", tassabile, "kWh", imp.accisa_kwh, tassabile * imp.accisa_kwh, iva);

  const imponibile = r.voci.reduce((a, v) => a + v.importo, 0);
  add("iva", `IVA ${Math.round(iva * 100)}%`, imponibile, "€", iva, imponibile * iva, null);

  if (utenza.canoneRai) {
    const rate = periodo.mesiSolari().filter(([, m]) => t.canone_rai_mesi.includes(m)).length;
    if (rate) add("altro", "Canone RAI", rate, "rate", t.canone_rai_mese, rate * t.canone_rai_mese, null);
  }
  return r;
}

/**
 * offerta: {prezzoSmc, indicizzata, indice, quotaFissaMese, altriSmc}
 * utenza:  {coeffC}
 */
export function calcolaGas(offerta, consumo, utenza, periodo, tariffe) {
  const t = tariffe.gas, ro = t.rete_oneri, imp = t.imposte;
  const smc = consumo * (utenza.coeffC ?? 1);
  const r = new Risultato(smc, "Smc");
  for (const [b, nome] of [[ro, "Rete/oneri gas"], [imp, "Imposte gas"]]) {
    controllaValidita(b, nome, periodo, r.avvisi);
    const lim = b.verificato_fino_smc_anno;
    if (lim && smc / periodo.frazioneAnno > lim) {
      r.avvisi.push(`${nome}: verificati su bolletta solo fino a ${lim} Smc/anno; il consumo simulato equivale a ${Math.round(smc / periodo.frazioneAnno)} Smc/anno, gli scaglioni superiori sono stime.`);
    }
  }
  const fr = periodo.frazioneAnno, mesi = periodo.mesi;
  const soglia = imp.soglia_iva_ridotta_smc_anno * fr;
  const qRid = Math.min(smc, soglia);
  const ir = imp.iva_ridotta, io = imp.iva_ordinaria;
  const push = (...a) => r.voci.push(voce(...a));

  const variabile = (nome, gruppo, sc) => {
    const tot = progressivo(smc, sc, fr), rid = progressivo(qRid, sc, fr);
    if (qRid) push(gruppo, nome, qRid, "Smc", rid / qRid, rid, ir);
    if (smc > qRid) push(gruppo, `${nome} (oltre soglia IVA)`, smc - qRid, "Smc", (tot - rid) / (smc - qRid), tot - rid, io);
  };
  const lineare = (nome, gruppo, p) => {
    if (qRid) push(gruppo, nome, qRid, "Smc", p, qRid * p, ir);
    if (smc > qRid) push(gruppo, `${nome} (oltre soglia IVA)`, smc - qRid, "Smc", p, (smc - qRid) * p, io);
  };

  const prezzo = offerta.indicizzata ? (offerta.indice || 0) + offerta.prezzoSmc : offerta.prezzoSmc;
  lineare("Materia gas", "vendita", prezzo);
  if (offerta.altriSmc) lineare("Altri corrispettivi vendita", "vendita", offerta.altriSmc);
  const ivf = imp.iva_quote_fisse;
  push("vendita", "Quota fissa venditore", mesi, "mesi", offerta.quotaFissaMese || 0, mesi * (offerta.quotaFissaMese || 0), ivf);
  push("rete", "Quota fissa rete", mesi, "mesi", ro.quota_fissa_annua / 12, (mesi * ro.quota_fissa_annua) / 12, ivf);
  variabile("Rete e oneri variabili", "rete", ro.scaglioni_variabili_annui);
  variabile("Accisa", "imposte", imp.accisa_scaglioni_annui);
  if (imp.addizionale_regionale_scaglioni_annui.some(([, a]) => a)) {
    variabile("Addizionale regionale", "imposte", imp.addizionale_regionale_scaglioni_annui);
  } else {
    r.avvisi.push("Addizionale regionale gas a zero nei dati: verificala.");
  }
  const perAliq = new Map();
  for (const v of r.voci) perAliq.set(v.aliquotaIva, (perAliq.get(v.aliquotaIva) || 0) + v.importo);
  for (const [aliq, base] of [...perAliq.entries()].sort((a, b) => a[0] - b[0])) {
    push("iva", `IVA ${Math.round(aliq * 100)}%`, base, "€", aliq, base * aliq, null);
  }
  return r;
}
