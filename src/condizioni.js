// Condizioni particolari di un'offerta in parole semplici.
// tipo: "piu" (vantaggio), "attenzione" (vincolo o costo possibile), "info".
import { statoSconto } from "./bolletta.js";

const n = (v) => String(Math.round(v * 1e6) / 1e6).replace(".", ",");
const UNITA = { "01": "€/anno", "02": "€/kW all'anno", "03": "€/kWh", "04": "€/Smc", "05": "€", "06": "%" };
const COND = { "01": "con la bolletta online", "02": "con la gestione online", "03": "con bolletta online e domiciliazione bancaria" };
const vero = (c) => c.d && !/^Condizione [A-Z_a-z]+$/.test(c.d);

export function condizioniParticolari(o, u = {}) {
  const out = [];
  const add = (tipo, breve, testo) => out.push({ tipo, breve, testo });

  // sconti
  for (const s of o.sc || []) {
    const v = s.p.map((p) => `${n(p.pr)} ${UNITA[p.u] || ""}`).join(" + ");
    const quando = s.val === "01" ? "all'attivazione" : s.val === "03" ? "dal secondo anno" : "nel primo anno";
    const dur = s.dur ? ` per ${s.dur} mesi` : "";
    const st = statoSconto(s, u);
    if (s.val === "03") { add("info", `Sconto ${v} dal secondo anno`, `${s.n}: ${v} dal secondo anno${s.cond && s.cond !== "00" ? `, solo ${COND[s.cond] || "con una condizione"}` : ""}. Non è nel totale, che riguarda i primi 12 mesi.`); continue; }
    if (s.cond === "00" || !s.cond) add("piu", `Sconto ${v}`, `${s.n}: ${v} ${quando}${dur}, senza condizioni.`);
    else if (s.cond === "99") add("attenzione", `Sconto ${v} con condizione`, `${s.n}: ${v} ${quando}${dur}, solo se ${s.condD || "rispetti una condizione indicata dal venditore"}. Non è incluso nel totale.`);
    else add(st.applicato ? "piu" : "info", `Sconto ${v} ${COND[s.cond] || ""}`.trim(),
      `${s.n}: ${v} ${quando}${dur}, solo ${COND[s.cond] || "con una condizione"}. ${st.applicato ? "Incluso nel totale perché l'hai scelto nel profilo." : "Non incluso: attivalo nel profilo se ti va bene."}`);
  }
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
