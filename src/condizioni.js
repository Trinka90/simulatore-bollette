// Condizioni particolari di un'offerta in parole semplici.
// tipo: "piu" (vantaggio), "attenzione" (vincolo o costo possibile), "info".
import { statoSconto, finestraMesi, eVariabile } from "./bolletta.js";

const n = (v) => String(Math.round(v * 1e6) / 1e6).replace(".", ",");
const UNITA = { "01": "€/anno", "02": "€/kW all'anno", "03": "€/kWh", "04": "€/Smc", "05": "€", "06": "%" };
const COND = { "01": "con la bolletta online", "02": "con la gestione online", "03": "con bolletta online e domiciliazione bancaria" };
const vero = (c) => c.d && !/^Condizione [A-Z_a-z]+$/.test(c.d);

export function condizioniParticolari(o, u = {}) {
  const out = [];
  const add = (tipo, breve, testo) => out.push({ tipo, breve, testo });

  // sconti
  for (const s of o.sc || []) {
    const v = valoreSconto(s), vBreve = s.p.length > 1 ? "a scaglioni" : v;
    const quando = quandoSconto(s), dur = "";
    const st = statoSconto(s, u);
    if (s.val === "03") { add("info", `Sconto ${vBreve} dal secondo anno`, `${s.n}: ${v} dal secondo anno${s.cond && s.cond !== "00" ? `, solo ${COND[s.cond] || "con una condizione"}` : ""}. Non è nel totale, che riguarda i primi 12 mesi.`); continue; }
    if (s.cond === "00" || !s.cond) add("piu", `Sconto ${vBreve}`, `${s.n}: ${v} ${quando}${dur}, senza condizioni.`);
    else if (s.cond === "99") add("attenzione", `Sconto ${vBreve} con condizione`, `${s.n}: ${v} ${quando}${dur}, solo se ${s.condD || "rispetti una condizione indicata dal venditore"}. Non è incluso nel totale.`);
    else add(st.applicato ? "piu" : "info", `Sconto ${vBreve} ${COND[s.cond] || ""}`.trim(),
      `${s.n}: ${v} ${quando}${dur}, solo ${COND[s.cond] || "con una condizione"}. ${st.applicato ? "Incluso nel totale perché l'hai scelto nel profilo." : "Non incluso: attivalo nel profilo se ti va bene."}`);
  }
  // prezzo del venditore mese per mese quando gli sconti a consumo cambiano nel tempo
  const scansione = andamentoMensile(o, u);
  if (scansione) add("attenzione", "Prezzo che cambia nei mesi", scansione);
  // prezzi che cambiano nel tempo
  for (const c of o.comp || []) {
    const conPeriodo = c.p.filter((p) => p.dur || p.fino);
    const dopo = c.p.find((p) => !p.dur && !p.fino && !p.mese);
    for (const p of conPeriodo) {
      const per = p.dur ? `per i primi ${p.dur} mesi` : `fino a ${p.fino}`;
      add("attenzione", "Prezzo promozionale", `${c.n}: ${n(p.pr)} ${UNITA[p.u] || ""} ${per}${dopo ? `, poi ${n(dopo.pr)} ${UNITA[dopo.u] || ""}` : ""}. Nel totale è già considerato mese per mese.`);
    }
    if (c.opz && c.m === "06") add("info", "Energia verde a pagamento", `Opzione facoltativa «${c.n}»: non inclusa nel totale.`);
  }
  // durata del prezzo
  if (o.tipo === "fisso" && o.durata) add("info", `Prezzo fisso ${o.durata} mesi`, `Il prezzo resta bloccato per ${o.durata} mesi, poi il venditore comunica le nuove condizioni.`);
  // offerte abbinate a internet
  if (richiedeInternet(o)) add("attenzione", "Richiede anche internet", `Offerta riservata a chi ha o attiva anche la connessione internet di ${o.venditore || "questo fornitore"}. Il costo di internet non è nel totale: il confronto completo è nella scheda Internet.`);
  else if (sitoInternet(o)) add("info", "Il fornitore vende anche internet", "Lo stesso fornitore offre la fibra con uno sconto per chi ha luce o gas: vedi la scheda Internet.");
  // modalità
  if (o.canali?.length === 1 && o.canali[0] === "01") add("info", "Solo online", "Si attiva solo sul sito del venditore.");
  if (o.pag?.length && o.pag.every((x) => x === "01" || x === "02")) add("attenzione", "Solo domiciliazione", "Si paga solo con addebito sul conto (bancario o postale).");
  if (o.serv?.length) add("info", "Servizi inclusi", `Comprende anche: ${o.serv.join(", ")}.`);
  if (/nuovi clienti|solo per chi non è (?:già )?cliente/i.test(o.descr || "")) add("info", "Solo nuovi clienti", "Riservata a chi non è già cliente del venditore.");
  // contratto
  for (const c of o.cond || []) {
    if (c.t === "05") add("attenzione", "Penale di recesso", vero(c) ? c.d : "Sono previsti oneri se lasci l'offerta prima della scadenza: dettagli nelle condizioni del venditore.");
    else if (c.t === "04") add("attenzione", "Contratto pluriennale", vero(c) ? c.d : "Offerta con durata di più anni.");
    else if (c.lim) add("attenzione", "Condizione limitante", vero(c) ? c.d : "Il venditore indica una condizione limitante: leggi le condizioni prima di firmare.");
  }
  const g = (o.garanzie || "").trim();
  const negato = /nessun\w*\s+(?:deposito|garanzia|cauzion)|non\s+(?:è\s+|e'\s+|viene\s+)?(?:richiest|previst|prevede|richiede|dovut|applicat)|senza\s+(?:alcun\s+)?deposito|^\s*(?:no|nessun\w*|non previst\w*)\W*$/i.test(g);
  if (g && /deposit|cauzion|fideiuss/i.test(g) && !negato) {
    const soloSenzaDom = /domicili|addebito diretto|sdd|rid\b/i.test(g);
    add(soloSenzaDom && u.domiciliazione ? "info" : "attenzione", soloSenzaDom ? "Deposito senza domiciliazione" : "Deposito cauzionale", g);
  }
  return out;
}

/** "mese 1: PUN + 0,07 · mesi 2-3: …": solo se gli sconti in €/kWh o €/Smc non valgono tutto l'anno. */
function andamentoMensile(o, u) {
  const cod = o.forn === "LUCE" ? "03" : "04", un = o.forn === "LUCE" ? "kWh" : "Smc";
  const sc = (o.sc || []).filter((s) => s.p.some((p) => p.u === cod) && statoSconto(s, u).applicato);
  const aTempo = sc.filter((s) => finestraMesi(s.n) || s.dur || s.mese || s.fino);
  if (!aTempo.length) return null;
  const base = (o.comp || []).filter((c) => !(c.opz && c.m === "06")).flatMap((c) => {
    const ps = c.p.filter((p) => p.u === cod && (!p.f || p.f === "01"));
    return ps.length ? [ps.find((p) => !p.dur && !p.fino) || ps[0]] : [];
  }).reduce((a, p) => a + p.pr, 0);
  const vals = [];
  for (let k = 0; k < 12; k++) {
    let d = 0;
    for (const s of sc) {
      const f = finestraMesi(s.n);
      const vale = f ? k + 1 >= f[0] && k + 1 <= f[1] : s.dur ? k < s.dur : true;
      if (!vale) continue;
      d += scontoUnitario(s, cod, annuoDi(o, u));
    }
    vals.push(Math.round((base - d) * 10000) / 10000);
  }
  const gruppi = [];
  vals.forEach((v, i) => { const g = gruppi.at(-1); if (g && g.v === v) g.a = i + 1; else gruppi.push({ da: i + 1, a: i + 1, v }); });
  if (gruppi.length < 2) return null;
  const pre = eVariabile(o) ? (o.forn === "LUCE" ? "PUN + " : "PSV + ") : "";
  return "Prezzo del venditore al netto degli sconti: " + gruppi.map((g) => `${g.da === g.a ? `mese ${g.da}` : `mesi ${g.da}-${g.a}`} ${pre}${n(g.v)} €/${un}`).join(" · ") + ". Il totale tiene conto di ogni mese.";
}

const annuoDi = (o, u) => (o.forn === "LUCE" ? u.luce?.annuo : u.gas?.annuo) || 0;
/** Sconto medio per unità con gli scaglioni sul consumo annuo (come nel calcolo delle bollette). */
function scontoUnitario(s, cod, annuo) {
  let d = 0;
  for (const p of s.p.filter((x) => x.u === cod)) {
    if (p.da == null && !p.a) d += p.pr;
    else if (annuo > 0) d += p.pr * Math.max(0, Math.min(annuo, p.a || Infinity) - (p.da || 0)) / annuo;
  }
  return d;
}
function quandoSconto(s) {
  const f = finestraMesi(s.n);
  if (f) return f[0] === f[1] ? `solo nel ${f[0]}° mese` : `dal ${f[0]}° al ${f[1]}° mese`;
  const base = s.val === "01" ? "all'attivazione" : s.val === "03" ? "dal secondo anno" : "nel primo anno";
  return s.dur ? `${base}, per ${s.dur === 1 ? "un mese" : s.dur + " mesi"}` : base;
}
function valoreSconto(s) {
  const tiers = s.p.filter((p) => p.da != null || p.a);
  if (tiers.length > 1) return s.p.map((p) => `${n(p.pr)} ${UNITA[p.u] || ""}${p.da != null || p.a ? ` (consumi ${p.da || 0}-${p.a || "oltre"})` : ""}`).join(", ");
  return s.p.map((p) => `${n(p.pr)} ${UNITA[p.u] || ""}`).join(" + ");
}

/** Offerta luce/gas riservata a chi compra anche la connessione internet dello stesso venditore. */
export function richiedeInternet(o) {
  if (/fibra|connettivit|\bgiga\b|\+\s*conn\b/i.test(o.nome || "")) return true;
  return /(contestualmente|congiuntamente|contratto attivo di)[^.]{0,140}(fibra|connettivit|internet)/i.test(o.descr || "");
}
const SITI_INTERNET = ["eniplenitude.com", "enel.it", "irenlucegas.it", "edisonenergia.it"];
export const sitoInternet = (o) => SITI_INTERNET.includes(o.sito);
