// Bollette mensili di un'offerta del Portale Offerte (formato normalizzato di opendata.js).
// Ogni voce viene da una fonte ufficiale: l'offerta (XML del venditore), i parametri giornalieri
// del Portale (reti, oneri, dispacciamento, accisa luce, IVA), le aliquote gas per regione e gli
// indici PUN/PSV. Le regole sono quelle del Portale ("Regole per il calcolo della spesa" v4.0),
// applicate mese per mese invece che sull'anno.
import { Periodo, Risultato, voce, progressivo, daIso } from "./motore.js";
import { punMese, psvMese, mesiDa, MESI } from "./simulazione.js";

export const FASCIA = { "01": "F1", "02": "F2", "03": "F3", "07": "F1", "08": "F23", "91": "F23", "92": "F13", "93": "F12" };
const NOMI_DISP = {
  "01": "Dispacciamento TIDE", "02": "Dispacciamento PD", "03": "Corrispettivo MSD", "04": "Modulazione eolico",
  "05": "Unità essenziali", "06": "Funzionamento Terna", "07": "Capacità produttiva", "08": "Interrompibilità",
  "09": "Capacità di mercato", "10": "Capacità di mercato MT", "11": "Reintegrazione salvaguardia",
  "12": "Reintegrazione tutele graduali", "13": "Dispacciamento DISPbt (quota fissa)", "14": "Dispacciamento CDISPD", "99": "Dispacciamento",
};
const PAR_DISP = {
  "01": ["msd", "modeol", "uniess", "terna", "interr", "capprod"], "03": ["msd"], "04": ["modeol"], "05": ["uniess"],
  "06": ["terna"], "07": ["capprod"], "08": ["interr"], "10": ["cpty_mrkt_mt"], "11": ["rst"], "12": ["rstg"], "14": ["cdispd"],
};
export const NOMI_REGOLATE = { "01": "PCV", "02": "PPE", "03": "CCR", "04": "CPR", "05": "GRAD", "06": "QTint", "07": "QTpsv", "09": "QVD quota fissa", "10": "QVD quota variabile" };
export const CONDIZIONI_SCONTO = { "00": "nessuna condizione", "01": "bolletta elettronica", "02": "gestione online", "03": "bolletta elettronica + domiciliazione", "99": "altra condizione" };
const ap = (nome, valore, unita, tipo, nota = "") => ({ nome, valore, unita, tipo, nota });
const ym = (a, m) => `${a}-${String(m).padStart(2, "0")}`;
const trimestre = (a, m) => `${a}-Q${Math.floor((m - 1) / 3) + 1}`;

// ------------------------------------------------------------------ contesto
/** Riunisce i dati regolati: parametri scaricati (o di riserva), aliquote, indici. */
export function contesto(dati, scaricati = {}) {
  const R = dati.regolate;
  const pe = scaricati.E || R.parametri.E, pg = scaricati.G || R.parametri.G;
  return { R, E: pe.valori, G: pg.valori, dataE: pe.data, dataG: pg.data, fonteE: pe.fonte, fonteG: pg.fonte, indici: dati.indici };
}
/** Parametro pubblicato per il trimestre del mese simulato? Altrimenti è mantenuto (SIMULATO). */
function statoParametri(ctx, fornitura, a, m) {
  const d = fornitura === "LUCE" ? ctx.dataE : ctx.dataG;
  const [pa, pm] = d.split("-").map(Number);
  const reale = trimestre(a, m) === trimestre(pa, pm) || (a * 12 + m) < (pa * 12 + pm);
  const fonte = fornitura === "LUCE" ? ctx.fonteE : ctx.fonteG;
  return reale ? ["REALE", fonte] : ["SIMULATO", `parametri del ${d.split("-").reverse().join("/")} mantenuti: quelli del trimestre ${trimestre(a, m)} non sono ancora pubblicati`];
}

// ------------------------------------------------------------------ consumi
const normalizza = (p) => {
  const t = Object.values(p).reduce((a, b) => a + Number(b || 0), 0);
  return Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, t ? Number(p[i + 1] ?? p[String(i + 1)] ?? 0) / t : 1 / 12]));
};
export function profiloGas(uso, zona, R) {
  const P = R.profili_gas, c1 = normalizza(P.C1[zona] || P.C1.D), c2 = normalizza(P.C2);
  if (uso === "cottura") return c2;
  if (uso === "riscaldamento") return c1;
  const q = P.quota_riscaldamento_misto;
  return Object.fromEntries(Object.keys(c1).map((m) => [m, q * c1[m] + (1 - q) * c2[m]]));
}
/** Consumo di ogni mese solare (1..12). Se l'utente ha scritto i mesi, valgono quelli. */
export function consumiMensili(u, fornitura, R) {
  const s = fornitura === "LUCE" ? u.luce : u.gas;
  if (s.mesi && Object.values(s.mesi).some((x) => x > 0)) return Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, Number(s.mesi[i + 1] || 0)]));
  const p = fornitura === "LUCE" ? normalizza(R.profilo_luce.mesi) : profiloGas(s.uso, s.zona, R);
  return Object.fromEntries(Object.entries(p).map(([m, q]) => [Number(m), s.annuo * q]));
}
export const consumoAnnuo = (u, f, R) => Object.values(consumiMensili(u, f, R)).reduce((a, b) => a + b, 0);

// ------------------------------------------------------------------ validità di prezzi e sconti
const fino = (s) => { const m = /^(\d{1,2})\/(\d{4})$/.exec(s || ""); return m ? Number(m[2]) * 12 + Number(m[1]) : null; };
/** k = mesi trascorsi dall'attivazione (0 = prima bolletta). */
function valeNelMese(x, k, a, m) {
  if (x.dur && k >= x.dur) return false;
  const f = fino(x.fino);
  if (f && a * 12 + m > f) return false;
  if (x.mese && x.mese !== m) return false;
  return true;
}
// Molti venditori marcano come "opzionali" anche le voci principali e il Portale le conta comunque:
// si escludono solo le opzioni di energia verde facoltative.
const facoltativa = (c) => c.opz && c.m === "06";
const haPeriodo = (x) => !!(x.dur || x.fino || x.mese);
const nelloScaglione = (x, annuo) => (x.da == null || annuo >= x.da) && (!x.a || annuo <= x.a);

/** Intervalli di prezzo validi nel mese, uno per fascia (regole del Portale: scaglione del consumo annuo, prezzo unico). */
function prezziComponente(c, k, a, m, annuo) {
  const perFascia = new Map();
  for (const p of c.p) {
    const f = p.f || "01";
    if (!perFascia.has(f)) perFascia.set(f, []);
    perFascia.get(f).push(p);
  }
  const out = [];
  for (const lista of perFascia.values()) {
    const sc = lista.filter((p) => nelloScaglione(p, annuo));
    const cand = sc.length ? sc : lista;
    const conPeriodo = cand.filter((p) => haPeriodo(p) && valeNelMese(p, k, a, m));
    const scelto = conPeriodo[0] || cand.find((p) => !haPeriodo(p));
    if (scelto) out.push(scelto);
  }
  return out;
}

// ------------------------------------------------------------------ indici
const coeff = (off) => { const k = off.idx.find((i) => i.k != null)?.k; return k == null ? 1 : k; };
function indiceLuce(ctx, a, m, scenario, fascia) {
  const pun = punMese(ctx.indici, a, m, scenario);
  if (fascia === "F0") return pun.F0;
  if (pun[fascia]) return pun[fascia];
  if (fascia === "F23") return pun.F23 || pun.F0;
  return pun.F0;
}

// ------------------------------------------------------------------ calcolo di una bolletta
/**
 * off: offerta normalizzata; per: Periodo; k: mesi dall'attivazione; cons: luce {F1,F2,F3} kWh, gas Smc;
 * u: utenza; annuo: consumo annuo (per gli scaglioni dell'offerta).
 */
export function calcolaBolletta(off, per, k, cons, u, annuo, ctx, scenario = "centrale") {
  return off.forn === "LUCE" ? bollettaLuce(off, per, k, cons, u, annuo, ctx, scenario) : bollettaGas(off, per, k, cons, u, annuo, ctx, scenario);
}

/** Lo sconto entra nel calcolo per questo utente? {applicato, motivo, comeOttenerlo} */
export function statoSconto(s, u) {
  const cond = s.cond || "00";
  if (s.val === "03") return { applicato: false, motivo: "vale solo dopo i primi 12 mesi" };
  if (cond === "00") return { applicato: true };
  if ((cond === "01" || cond === "02") && u.bollettaWeb) return { applicato: true, condizione: CONDIZIONI_SCONTO[cond] };
  if (cond === "03" && u.bollettaWeb && u.domiciliazione) return { applicato: true, condizione: CONDIZIONI_SCONTO[cond] };
  if (cond === "99") return { applicato: false, motivo: `richiede ${s.condD || "una condizione particolare indicata dal venditore"}`, altro: true };
  return { applicato: false, motivo: `richiede ${CONDIZIONI_SCONTO[cond]}`,
    comeOttenerlo: cond === "03" ? "attiva bolletta online e domiciliazione nel profilo" : "attiva la bolletta online nel profilo" };
}

/** Sconti dell'offerta applicabili all'utente in questo mese. Restituisce [{nome, importo, gruppo, aliquota?}] e note. */
function sconti(off, k, a, m, mesi, q, perFascia, u, annuo, baseVendita, regolate, note) {
  const out = [];
  for (const s of off.sc) {
    const st = statoSconto(s, u);
    if (!st.applicato) { note.add(`Sconto «${s.n}» non conteggiato: ${st.motivo}.`); continue; }
    if (!valeNelMese(s, k, a, m)) continue;
    const primo = s.mese ? true : k === 0;
    for (const p of s.p) {
      let imp = 0, descr = s.n;
      const quota = (val) => {
        if (p.da == null && !p.a) return val;
        const lo = p.da || 0, hi = p.a || Infinity;
        return annuo > 0 ? val * Math.max(0, Math.min(annuo, hi) - lo) / annuo : 0;
      };
      switch (p.u) {
        case "01": imp = p.pr * mesi / 12; break;
        case "05": imp = primo ? p.pr : 0; descr += " (una tantum)"; break;
        case "02": imp = p.pr * (u.luce?.potenzaKw || 0) * mesi / 12; break;
        case "03": case "04": {
          const f = FASCIA[s.cod];
          const qta = f && perFascia ? (f === "F23" ? perFascia.F2 + perFascia.F3 : f === "F13" ? perFascia.F1 + perFascia.F3 : f === "F12" ? perFascia.F1 + perFascia.F2 : perFascia[f] ?? q) : q;
          imp = p.pr * quota(qta); break;
        }
        case "06": {
          const reg = regolate[NOMI_REGOLATE[s.cod]];
          imp = (p.pr / 100) * (reg != null ? reg : baseVendita); descr += ` (${p.pr}%)`; break;
        }
        default: note.add(`Sconto «${s.n}»: unità non riconosciuta, non conteggiato.`);
      }
      if (imp) out.push({ nome: descr, importo: -Math.abs(imp), iva: s.iva });
    }
  }
  return out;
}

function bollettaLuce(off, per, k, cons, u, annuo, ctx, scenario) {
  const P = ctx.E, L = u.luce;
  const q = cons.F1 + cons.F2 + cons.F3;
  const r = new Risultato(q, "kWh");
  const app = [], note = new Set();
  const mesi = per.mesi, [a, m] = [per.inizio.getUTCFullYear(), per.inizio.getUTCMonth() + 1];
  const iva = P.iva_c ?? 0.1, lambda = P.lambda ?? 0.1;
  const add = (g, d, qt, un, pr, imp, al = iva) => r.voci.push(voce(g, d, qt, un, pr, imp, al));
  const mono = (off.fasce || "01") === "01";
  const qtaFascia = (f) => {
    if (mono || !f) return q;
    if (f === "F23") return cons.F2 + cons.F3;
    if (f === "F13") return cons.F1 + cons.F3;
    if (f === "F12") return cons.F1 + cons.F2;
    return cons[f] ?? q;
  };
  const variabile = off.tipo === "variabile" || (off.tipo === "mista" && off.idx.length > 0);
  let vendVol = 0;

  // indice (offerte variabili): PUN del mese per fascia × coefficiente, con perdite di rete
  if (variabile) {
    // Regole del Portale: sull'indice si applicano sempre le perdite di rete, lo spread le comprende già
    const kc = coeff(off), perd = 1 + lambda;
    const fasceIdx = mono ? ["F0"] : (off.fasce === "91" || off.fasce === "07") ? ["F1", "F23"] : ["F1", "F2", "F3"];
    for (const f of fasceIdx) {
      const ind = indiceLuce(ctx, a, m, scenario, f);
      const qf = f === "F0" ? q : qtaFascia(f);
      let prezzo = ind.valore * kc * perd;
      app.push(ind);
      if (off.tetto != null) {
        const spread = off.comp.flatMap((c) => c.p).find((p) => p.u === "03" && (FASCIA[p.f || "01"] === f || f === "F0"))?.pr || 0;
        if (prezzo + spread > off.tetto) { prezzo = off.tetto - spread; note.add(`Applicato il prezzo massimo dell'offerta (${off.tetto} €/kWh).`); }
      }
      add("vendita", `PUN ${f === "F0" ? "monorario" : f}${kc !== 1 ? ` × ${kc}` : ""} + perdite ${Math.round(lambda * 100)}%`, qf, "kWh", prezzo, qf * prezzo);
      vendVol += qf * prezzo;
    }
    if (off.idx.some((i) => i.c !== "01" && i.c !== "08" && i.c !== "12")) note.add("L'offerta usa un indice diverso dal PUN: per la simulazione uso il PUN, come il Portale Offerte.");
  }

  // componenti del venditore
  for (const c of off.comp) {
    if (facoltativa(c)) { note.add(`Opzione facoltativa non conteggiata: «${c.n}».`); continue; }
    for (const p of prezziComponente(c, k, a, m, annuo)) {
      const f = FASCIA[p.f || "01"];
      const etich = !mono && p.f && p.f !== "01" ? ` ${f}` : !mono && p.f === "01" ? " F1" : "";
      switch (p.u) {
        case "01": add("vendita", c.n, mesi, "mesi", p.pr / 12, p.pr * mesi / 12); break;
        case "02": add("vendita", `${c.n} (${L.potenzaKw} kW)`, L.potenzaKw * mesi, "kW·mese", p.pr / 12, p.pr * L.potenzaKw * mesi / 12); break;
        case "03": {
          const qf = qtaFascia(mono || !p.f ? null : f); // senza fascia: tutti i kWh
          // prezzo senza perdite (solo CTE che lo dichiarano): kWh fatturati + λ
          const k2 = !variabile && off.perditeIncluse === false ? 1 + lambda : 1;
          add("vendita", c.n + etich + (k2 > 1 ? ` (kWh + ${Math.round(lambda * 100)}% perdite)` : ""), qf * k2, "kWh", p.pr, qf * k2 * p.pr);
          vendVol += qf * k2 * p.pr; break;
        }
        case "05": if (k === 0) add("vendita", `${c.n} (una tantum)`, 1, "", p.pr, p.pr); break;
        default: note.add(`Componente «${c.n}»: unità non gestita, non conteggiata.`);
      }
    }
  }

  // dispacciamento dichiarato dall'offerta: valore dell'offerta o parametro del Portale
  const [stato, fonte] = statoParametri(ctx, "LUCE", a, m);
  for (const d of off.disp) {
    if (d.c === "13") { add("vendita", NOMI_DISP["13"], mesi, "mesi", P.dispbt_d / 12, P.dispbt_d * mesi / 12); continue; }
    let v = d.v > 0 ? d.v : null, orig = "valore dichiarato nell'offerta";
    if (v == null) {
      if (d.c === "09") v = ((P.cpty_mrkt_1 || 0) + (P.cpty_mrkt_2 || 0) + (P.cpty_mrkt_3 || 0)) / 3;
      else v = (PAR_DISP[d.c] || []).reduce((s, x) => s + (P[x] || 0), 0);
      orig = "parametro del Portale";
    }
    if (!v) continue;
    add("vendita", NOMI_DISP[d.c] || d.n || "Dispacciamento", q, "kWh", v, q * v);
    app.push(ap(NOMI_DISP[d.c] || "Dispacciamento", v, "€/kWh", orig.startsWith("valore") ? "REALE" : stato, orig.startsWith("valore") ? orig : fonte));
  }

  // componenti regolate dichiarate (PCV, PPE)
  const regolate = {};
  if (off.reg.includes("01")) { regolate.PCV = P.pcv_c * mesi / 12; add("vendita", "Commercializzazione PCV", mesi, "mesi", P.pcv_c / 12, regolate.PCV); }
  if (off.reg.includes("02")) {
    const ppe = ctx.R.ppe.valore;
    regolate.PPE = ppe * q; add("vendita", "Perequazione PPE", q, "kWh", ppe, regolate.PPE);
    app.push(ap("PPE", ppe, "€/kWh", per.fine <= daIso(ctx.R.ppe.valido_al) ? "REALE" : "SIMULATO", ctx.R.ppe.fonte));
  }

  // rete
  add("rete", "Quota fissa", mesi, "mesi", P.sigma1 / 12, P.sigma1 * mesi / 12);
  const pk = (P.sigma2 + P.uc6s_d) / 12;
  add("rete", `Quota potenza (${String(L.potenzaKw).replace(".", ",")} kW)`, L.potenzaKw * mesi, "kW·mese", pk, pk * L.potenzaKw * mesi);
  const ek = P.sigma3 + P.uc3 + P.uc6p_d;
  add("rete", "Quota energia", q, "kWh", ek, q * ek);

  // oneri di sistema
  if (u.residente) {
    add("oneri", "Componente ASOS", q, "kWh", P.asos_dr, q * P.asos_dr);
    add("oneri", "Componente ARIM", q, "kWh", P.arim_dr, q * P.arim_dr);
  } else {
    const fx = (P.asos_dnr_f + P.arim_dnr_f) / 12;
    add("oneri", "Oneri quota fissa (non residenti)", mesi, "mesi", fx, fx * mesi);
    add("oneri", "Componente ASOS", q, "kWh", P.asos_dnr_v, q * P.asos_dnr_v);
    add("oneri", "Componente ARIM", q, "kWh", P.arim_dnr_v, q * P.arim_dnr_v);
  }
  app.push(ap("Reti, oneri, accisa e dispacciamento (parametri ARERA)", null, "", stato, fonte));

  // accisa (regola del Portale: residenti fino a 3 kW con esenzione sui primi 150 kWh al mese)
  let tassati = q, aliq = P.acc_c_nr;
  if (u.residente) {
    if (L.potenzaKw > 3) aliq = P.acc_c_r_h;
    else {
      aliq = P.acc_c_r_l;
      const c = q / mesi;
      const t = c <= 150 ? 0 : c <= 220 ? c - 150 : c <= 370 ? 2 * c - 370 : c;
      tassati = t * mesi;
      if (q - tassati > 0.0001) add("imposte", "Accisa - quota esente residenti", q - tassati, "kWh", 0, 0);
    }
  }
  add("imposte", "Accisa", tassati, "kWh", aliq, tassati * aliq);

  // sconti
  const sc = sconti(off, k, a, m, mesi, q, cons, u, annuo, vendVol, regolate, note);
  for (const s of sc.filter((x) => x.iva)) add("vendita", `Sconto: ${s.nome}`, 1, "", s.importo, s.importo);

  const imponibile = r.voci.reduce((s, v) => s + v.importo, 0);
  add("iva", `IVA ${Math.round(iva * 100)}%`, imponibile, "€", iva, imponibile * iva, null);
  for (const s of sc.filter((x) => !x.iva)) add("altro", `Sconto non soggetto a IVA: ${s.nome}`, 1, "", s.importo, s.importo, null);

  if (L.canoneRai && ctx.R.canone_rai.mesi.length) {
    const rate = per.mesiSolari().filter(([, mm]) => ctx.R.canone_rai.mesi.includes(mm)).length;
    if (rate) add("altro", "Canone RAI", rate, "rate", ctx.R.canone_rai.importo_mese, rate * ctx.R.canone_rai.importo_mese, null);
  }
  r.avvisi = [...note];
  return { risultato: r, applicati: app };
}

function bollettaGas(off, per, k, smc, u, annuo, ctx, scenario) {
  const P = ctx.G, R = ctx.R, G = u.gas;
  const r = new Risultato(smc, "Smc");
  const app = [], note = new Set();
  const mesi = per.mesi, fr = per.frazioneAnno, [a, m] = [per.inizio.getUTCFullYear(), per.inizio.getUTCMonth() + 1];
  const reg = R.regioni[u.comune?.regione] || R.regioni["09"];
  const prov = R.province_speciali[u.comune?.provincia];
  const amb = reg.ambito_gas;
  const ir = P.iva_f1 ?? 0.1, io = P.iva_f3 ?? 0.22;
  const soglia = R.soglia_iva_gas_smc * fr, qRid = Math.min(smc, soglia);
  const push = (g, d, qt, un, pr, imp, al) => r.voci.push(voce(g, d, qt, un, pr, imp, al));
  // voce volumetrica a prezzo unico, divisa sulla soglia IVA
  const lineare = (g, nome, p) => {
    if (qRid > 0) push(g, nome, qRid, "Smc", p, qRid * p, ir);
    if (smc > qRid) push(g, `${nome} (oltre soglia IVA)`, smc - qRid, "Smc", p, (smc - qRid) * p, io);
    return smc * p;
  };
  // voce a scaglioni progressivi annui, riproporzionati sul periodo
  const scaglioni = (g, nome, sc) => {
    const tot = progressivo(smc, sc, fr), rid = progressivo(qRid, sc, fr);
    if (qRid > 0 && Math.abs(rid) > 1e-9) push(g, nome, qRid, "Smc", rid / qRid, rid, ir);
    if (smc > qRid && Math.abs(tot - rid) > 1e-9) push(g, `${nome} (oltre soglia IVA)`, smc - qRid, "Smc", (tot - rid) / (smc - qRid), tot - rid, io);
  };
  const fisso = (g, nome, annuoEur) => push(g, nome, mesi, "mesi", annuoEur / 12, annuoEur * mesi / 12, io);
  const variabile = off.tipo === "variabile" || (off.tipo === "mista" && off.idx.length > 0);
  let vendVol = 0;

  if (variabile) {
    const pv = psvMese(ctx.indici, a, m, scenario), kc = coeff(off);
    app.push(pv);
    vendVol += lineare("vendita", `PSV${kc !== 1 ? ` × ${kc}` : ""}`, pv.valore * kc);
  }
  for (const c of off.comp) {
    if (facoltativa(c)) { note.add(`Opzione facoltativa non conteggiata: «${c.n}».`); continue; }
    for (const p of prezziComponente(c, k, a, m, annuo)) {
      if (p.u === "01") fisso("vendita", c.n, p.pr);
      else if (p.u === "04" || p.u === "03") vendVol += lineare("vendita", c.n, p.pr);
      else if (p.u === "05") { if (k === 0) push("vendita", `${c.n} (una tantum)`, 1, "", p.pr, p.pr, io); }
      else note.add(`Componente «${c.n}»: unità non gestita, non conteggiata.`);
    }
  }
  const [stato, fonte] = statoParametri(ctx, "GAS", a, m);
  const regolate = {};
  if (off.reg.includes("09")) { regolate["QVD quota fissa"] = P.qvd_f_d * mesi / 12; fisso("vendita", "QVD quota fissa", P.qvd_f_d); }
  if (off.reg.includes("10")) regolate["QVD quota variabile"] = lineare("vendita", "QVD quota variabile", P.qvd_v_d);
  if (off.reg.includes("04") && P.cpr) lineare("vendita", "Componente CPR", P.cpr);
  if (off.reg.includes("05") && P.grad) lineare("vendita", "Componente GRAD", P.grad);
  if (off.reg.includes("03")) {
    const t = trimestre(a, m), ccr = R.ccr.trimestri[t];
    const v = ccr ?? Object.values(R.ccr.trimestri).at(-1);
    regolate.CCR = lineare("vendita", "Componente CCR", v);
    app.push(ap("CCR", v, "€/Smc", ccr != null ? "REALE" : "SIMULATO", ccr != null ? R.ccr.fonte : "ultimo trimestre noto mantenuto"));
  }

  // rete e oneri (contatore fino a G6, ambito tariffario della regione)
  const SG = R.scaglioni_gas_smc;
  const sc = (nome) => SG.map((lim, i) => [i === SG.length - 1 ? null : lim, P[nome(i + 1)] ?? 0]);
  fisso("rete", "Quota fissa distribuzione e misura", P[`tau1_cc1_a${amb}`] + P[`st_a${amb}`] + P[`vr_a${amb}`]);
  lineare("rete", "Trasporto e qualità (QT, RS, UG1)", P.qt + P.rs + P.ug1);
  scaglioni("rete", "Distribuzione (TAU3)", sc((i) => `tau3_f${i}_a${amb}`));
  fisso("oneri", "Oneri quota fissa (UG2)", P.ug2s);
  lineare("oneri", "Oneri variabili (RE, UG3)", P.re + P.ug3);
  scaglioni("oneri", "Oneri a scaglioni (UG2)", sc((i) => `ug2p_d_f${i}`));
  app.push(ap(`Rete e oneri gas, ambito ${["", "Nord-occidentale", "Nord-orientale", "Centrale", "Sud-orientale", "Sud-occidentale", "Meridionale"][amb]}`, null, "", stato, fonte));

  // imposte
  scaglioni("imposte", "Accisa", (prov || reg).accisa_gas);
  if ((prov || reg).addizionale_gas.some(([, x]) => x)) scaglioni("imposte", "Addizionale regionale", (prov || reg).addizionale_gas);
  app.push(ap(`Accisa e addizionale ${prov ? prov.nome : reg.nome}`, null, "", "REALE", "Aliquote 2026 rilevate dal Portale Offerte"));

  const scn = sconti(off, k, a, m, mesi, smc, null, u, annuo, vendVol, regolate, note);
  for (const s of scn.filter((x) => x.iva)) push("vendita", `Sconto: ${s.nome}`, 1, "", s.importo, s.importo, io);

  const perAliq = new Map();
  for (const v of r.voci) perAliq.set(v.aliquotaIva, (perAliq.get(v.aliquotaIva) || 0) + v.importo);
  for (const [al, base] of [...perAliq.entries()].sort((x, y) => x[0] - y[0])) push("iva", `IVA ${Math.round(al * 100)}%`, base, "€", al, base * al, null);
  for (const s of scn.filter((x) => !x.iva)) push("altro", `Sconto non soggetto a IVA: ${s.nome}`, 1, "", s.importo, s.importo, null);
  r.avvisi = [...note];
  return { risultato: r, applicati: app };
}

// ------------------------------------------------------------------ 12 mesi
/** u.ingresso = "AAAA-MM": primo mese con il nuovo fornitore. */
export function simulaOfferta(off, u, ctx, scenario = "centrale", nMesi = 12) {
  const consumi = consumiMensili(u, off.forn, ctx.R);
  const annuo = Object.values(consumi).reduce((a, b) => a + b, 0);
  const rip = u.luce?.ripartizione || ctx.R.profilo_luce.ripartizione_fasce;
  return mesiDa(u.ingresso, nMesi).map(([a, m], k) => {
    const per = Periodo.mese(a, m);
    const q = consumi[m];
    const cons = off.forn === "LUCE" ? { F1: q * rip.F1, F2: q * rip.F2, F3: q * rip.F3 } : q;
    const { risultato, applicati } = calcolaBolletta(off, per, k, cons, u, annuo, ctx, scenario);
    return { anno: a, mese: m, periodo: per, consumo: q, unita: off.forn === "LUCE" ? "kWh" : "Smc", risultato, applicati,
      etichetta: `${MESI[m - 1][0].toUpperCase()}${MESI[m - 1].slice(1)} ${a}`, simulato: applicati.some((x) => x.tipo === "SIMULATO") };
  });
}

export const totaleMesi = (mesi) => mesi.reduce((s, x) => s + x.risultato.totale, 0);
export const eVariabile = (off) => off.tipo === "variabile" || (off.tipo === "mista" && off.idx.length > 0);

/** Totali per la classifica (scenari solo per le variabili). */
export function riepilogoOfferta(off, u, ctx, conScenari = true) {
  const centrale = simulaOfferta(off, u, ctx, "centrale");
  const tot = totaleMesi(centrale);
  const out = { offerta: off, mesi: centrale, centrale: tot, basso: tot, alto: tot };
  if (conScenari && eVariabile(off)) {
    out.basso = totaleMesi(simulaOfferta(off, u, ctx, "basso"));
    out.alto = totaleMesi(simulaOfferta(off, u, ctx, "alto"));
  }
  const cons = centrale.reduce((s, x) => s + x.consumo, 0);
  const altro = centrale.reduce((s, x) => s + x.risultato.gruppo("altro"), 0);
  out.consumo = cons;
  out.costoMedio = cons ? (tot - altro) / cons : 0;
  out.mesiSimulati = centrale.filter((x) => x.simulato).length;
  out.avvisi = [...new Set(centrale.flatMap((x) => x.risultato.avvisi))];
  out.sp = scontiEPenali(off, centrale, u);
  return out;
}

/** Una bolletta qualsiasi: periodo e consumi scelti dall'utente (es. "800 kWh in due mesi"). */
export function bollettaPersonalizzata(off, u, ctx, { dal, al, kwh, fasce, smc }, scenario = "centrale") {
  const per = new Periodo(daIso(dal), daIso(al));
  const [ia, im] = u.ingresso.split("-").map(Number);
  const k = Math.max(0, per.inizio.getUTCFullYear() * 12 + per.inizio.getUTCMonth() + 1 - (ia * 12 + im));
  const rip = u.luce?.ripartizione || ctx.R.profilo_luce.ripartizione_fasce;
  const cons = off.forn === "LUCE" ? (fasce || { F1: kwh * rip.F1, F2: kwh * rip.F2, F3: kwh * rip.F3 }) : smc;
  const annuo = consumoAnnuo(u, off.forn, ctx.R);
  return { periodo: per, ...calcolaBolletta(off, per, k, cons, u, annuo, ctx, scenario) };
}

export { ym };

/** Converte un'offerta inserita a mano o letta da una CTE (formato semplice) nel formato del catalogo. */
export function daCte(o) {
  const luce = o.fornitura === "LUCE", variab = o.tipoPrezzo === "indicizzato";
  const comp = [{ n: "Quota fissa di vendita", m: "01", opz: false, p: [{ f: null, pr: o.quotaFissaAnnua || 0, u: "01" }] }];
  let fasce = "01";
  if (luce) {
    const pr = o.prezzi || {};
    const cod = { F0: "01", F1: "01", F2: "02", F3: "03", F23: "91" };
    fasce = "F0" in pr ? "01" : "F23" in pr ? "91" : "03";
    comp.push({ n: variab ? "Spread sul PUN" : "Prezzo energia", m: "04", opz: false,
      p: Object.entries(pr).map(([k, v]) => ({ f: cod[k], pr: v ?? 0, u: "03" })) });
    if (o.altriKwh) comp.push({ n: "Altri corrispettivi", m: "02", opz: false, p: [{ f: null, pr: o.altriKwh, u: "03" }] });
  } else {
    comp.push({ n: variab ? "Spread sul PSV" : "Prezzo gas", m: "04", opz: false, p: [{ f: null, pr: o.prezzoSmc ?? 0, u: "04" }] });
    if (o.altriSmc) comp.push({ n: "Altri corrispettivi", m: "02", opz: false, p: [{ f: null, pr: o.altriSmc, u: "04" }] });
  }
  const disp = luce ? (o.cdispd === "arera" || o.cdispd == null ? [{ c: "14", v: null }] : [{ c: "99", v: Number(o.cdispd) }]) : [];
  return {
    id: o.id, mia: true, venditore: o.fornitore || "Fornitore non indicato", nome: o.nome || "La mia offerta", forn: o.fornitura,
    tipo: variab ? "variabile" : "fisso", fasce, perditeIncluse: o.perdite !== "tutto", tetto: o.prezzoMax ?? null,
    idx: variab ? [{ c: luce ? "12" : "14", k: null }] : [], disp, reg: [], comp, sc: [], cond: [], serv: [], att: [], canali: [], pag: [],
    singola: true, res: "T", zone: null, cons: null, pot: null, durata: null, dal: null, al: null,
    descr: (o.note || []).join(" "), note: o.note || [], fonte: o.fonte || "inserita da te", url: "", tel: "",
  };
}

/**
 * Servizio a Tutele Graduali (STG, ex maggior tutela per i domestici non vulnerabili).
 * Prezzo: PUN di fascia del mese × (1+λ) + CDISPD + CSED + CPSTGD, più la quota fissa dell'asta della tua area
 * (parametro "gamma", per €/POD/anno; il Portale pubblica la media nazionale). Verificato sulla bolletta Hera STG lug-ago 2026.
 */
export function offertaSTG(P, quotaAnnua = null) {
  const q = quotaAnnua ?? P.gamma ?? 0;
  return {
    id: "STG", stg: true, mia: true, venditore: "Tutele Graduali", nome: "Servizio a Tutele Graduali (STG)", forn: "LUCE",
    tipo: "variabile", fasce: "03", perditeIncluse: true, tetto: null, idx: [{ c: "12", k: null }], disp: [{ c: "14", v: null }], reg: [],
    comp: [
      { n: quotaAnnua != null ? "Quota fissa STG della tua area" : "Quota fissa STG (media nazionale delle aste)", m: "01", opz: false, p: [{ f: null, pr: q, u: "01" }] },
      { n: "Corrispettivi STG (CSED + CPSTGD)", m: "02", opz: false, p: [{ f: null, pr: (P.csed || 0) + (P.cpstgd || 0), u: "03" }] },
    ],
    sc: [], cond: [], serv: [], att: [], canali: [], pag: [], singola: true, res: "T", zone: null, cons: null, pot: null, durata: null, dal: null, al: null,
    descr: "Prezzo dell'energia = PUN di fascia del mese + 10% di perdite di rete, come nelle bollette STG. Vale per i clienti domestici non vulnerabili passati dalla maggior tutela; i clienti vulnerabili hanno il servizio di vulnerabilità, con prezzi diversi.",
    note: [], fonte: "Regole ARERA del Servizio a Tutele Graduali; parametri CDISPD, CSED, CPSTGD e gamma dal Portale Offerte", url: "https://www.arera.it", tel: "",
  };
}

/** Riepilogo sconti e penali di un'offerta sui 12 mesi simulati (importi IVA esclusa, segno positivo = risparmio). */
export function scontiEPenali(off, mesi, u) {
  const applicati = new Map();
  for (const m of mesi) for (const v of m.risultato.voci) {
    if (!/^Sconto/.test(v.descrizione)) continue;
    const nome = v.descrizione.replace(/^Sconto( non soggetto a IVA)?: /, "");
    const x = applicati.get(nome) || { nome, totale: 0, mesi: 0, iva: v.gruppo !== "altro" };
    x.totale -= v.importo; x.mesi++;
    applicati.set(nome, x);
  }
  const esclusi = off.sc.map((s) => ({ s, st: statoSconto(s, u) })).filter((x) => !x.st.applicato)
    .map(({ s, st }) => ({ nome: s.n, motivo: st.motivo, comeOttenerlo: st.comeOttenerlo,
      valore: s.p.map((p) => `${String(p.pr).replace(".", ",")} ${{ "01": "€/anno", "02": "€/kW", "03": "€/kWh", "04": "€/Smc", "05": "€", "06": "%" }[p.u] || ""}`).join(" + ") }));
  const vero = (c) => c.d && !/^Condizione [A-Z_a-z]+$/.test(c.d);
  const penali = off.cond.filter((c) => c.t === "05").map((c) => ({ testo: vero(c) ? c.d : "L'offerta prevede oneri in caso di recesso anticipato: dettagli nelle condizioni del venditore.", limitante: c.lim }));
  const vincoli = off.cond.filter((c) => c.t !== "05" && (c.lim || c.t === "04")).map((c) => ({ tipo: c.t, testo: vero(c) ? c.d : "", limitante: c.lim }));
  const g = (off.garanzie || "").trim();
  // deposito: citato e non negato ("nessun deposito", "non è richiesto", "senza deposito")
  const negato = /nessun\w*\s+(?:deposito|garanzia|cauzion)|non\s+(?:è\s+|e'\s+|viene\s+)?(?:richiest|previst|prevede|richiede|dovut|applicat)|senza\s+(?:alcun\s+)?deposito|^\s*(?:no|nessun\w*|non previst\w*)\W*$/i.test(g);
  const deposito = g && /deposit|cauzion|fideiuss/i.test(g) && !negato ? g : null;
  const totApplicati = [...applicati.values()].reduce((a, x) => a + x.totale, 0);
  const depositoSoloSenzaDom = !!deposito && /domicili|addebito diretto|sdd|rid\b/i.test(deposito);
  return { applicati: [...applicati.values()], totApplicati, esclusi, penali, vincoli, deposito, depositoSoloSenzaDom };
}
