import * as pdfjs from "pdfjs-dist";
import { analizza, bozzaOfferta, testoPdf } from "./cte.js";
import { contesto, simulaOfferta, totaleMesi, riepilogoOfferta, bollettaPersonalizzata, consumiMensili, daCte, eVariabile, offertaSTG, scontiEPenali } from "./bolletta.js";
import { aggiornaCatalogo, filtra, classifica, classificaDual, scadenza, SITUAZIONI } from "./catalogo.js";
import { scaricaTesto, salvaCatalogo, caricaCatalogo, catalogoIniziale, nativo } from "./archivio.js";
import { isoGiorno } from "./opendata.js";
import { pdfConfronto, pdfBollette } from "./esporta.js";
import { eur, nf, dataIt, meseIt, MESI_NOMI, descrizionePrezzo, TIPI, CANALI, PAGAMENTI, ATTIVAZIONI, CONDIZIONI,
  VALIDITA_SCONTO, NOMI_REGOLATE, CONDIZIONI_SCONTO, durata, descrUtenza } from "./testi.js";
import { DATI_URL } from "./config.js";
import { condizioniParticolari, richiedeInternet } from "./condizioni.js";
import { costoInternet, costoUscita, classificaInternet, offertaMia, migliore as miglioreNet, incerta, descriviFasi, analizzaSintesi, TECNO } from "./internet.js";
import catalogoInternet from "../data/internet.json";
import { categoria, nomeFornitore, ETICHETTE, recensioni } from "./fornitori.js";
import { confermaAvvio, controllaAggiornamento, VERSIONE_WEB } from "./aggiorna-app.js";
import { analizzaBolletta, consumiDaBollette } from "./bolletta-pdf.js";
import { leggiConsumiCsv, ultimi12 } from "./consumi-csv.js";
import { areaSTG, curva, soglie, fraseSoglie, restare, GRIGLIA, FINE_STG } from "./stg.js";
import datiInclusi from "../data/dati.json";
import comuniDb from "../data/comuni.json";

pdfjs.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.mjs";

// ------------------------------------------------------------------ stato
const LS = {
  get(k, d) { try { const v = localStorage.getItem("sb_" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("sb_" + k, JSON.stringify(v)); } catch { /* spazio pieno */ } },
};
const oggi = () => new Date();
const oggiIso = () => isoGiorno(oggi());
const ymDi = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const ingressoTipico = () => { const d = oggi(); return ymDi(new Date(d.getFullYear(), d.getMonth() + 2, 1)); };
const COMUNI = comuniDb.comuni.map(([istat, nome, sigla, provincia, regione]) => ({ istat, nome, sigla, provincia, regione }));
const trovaComune = (istat) => COMUNI.find((c) => c.istat === istat);

const UTENZA_DEF = {
  versione: 3, comune: trovaComune("051026"), residente: true, situazione: "01", ingresso: null,
  bollettaWeb: true, domiciliazione: true,
  luce: { attiva: true, potenzaKw: 6, annuo: 3175, mesi: null, ripartizione: { F1: 0.33, F2: 0.31, F3: 0.36 }, canoneRai: true, stg: true, stgQuota: null },
  gas: { attiva: true, annuo: 39, mesi: { 1: 4, 2: 3, 3: 4, 4: 4, 5: 2, 6: 3, 7: 2, 8: 3, 9: 3, 10: 3, 11: 4, 12: 4 }, uso: "cottura", zona: "D" },
};
function migraUtenza(v) {
  if (!v) return structuredClone(UTENZA_DEF);
  if (v.versione === 3) { if (v.luce.stgQuota === undefined) v.luce.stgQuota = null; v.luce.stg = true; return v; }
  const n = structuredClone(UTENZA_DEF);
  if (v.luce) Object.assign(n.luce, { attiva: v.luce.attiva, potenzaKw: v.luce.potenzaKw, annuo: v.luce.consumoAnnuoKwh, mesi: v.luce.profilo,
    ripartizione: v.luce.ripartizione || n.luce.ripartizione, canoneRai: v.luce.canoneRai });
  if (v.luce) n.residente = v.luce.residente;
  if (v.gas) Object.assign(n.gas, { attiva: v.gas.attiva, annuo: v.gas.consumoAnnuoSmc, mesi: v.gas.profilo, uso: v.gas.riscaldamento ? "entrambi" : "cottura" });
  return n;
}

const S = {
  tab: "offerte", forn: "LUCE", mostraScadute: false, filtri: LS.get("filtri", {}), filtroTipo: "tutte", cerca: "", quante: 25,
  utenza: migraUtenza(LS.get("utenza", null)),
  cte: LS.get("cte", LS.get("offerte", [])),
  bollette: LS.get("bollette", []), attuale: LS.get("attuale", {}),
  seguite: LS.get("seguite", []), storico: LS.get("storico", []), notifiche: LS.get("notifiche", []), avvisi: LS.get("avvisi", { attivi: true, soglia: 50 }),
  dati: LS.get("dati", datiInclusi),
  auto: LS.get("auto", "giorno"),
  catalogo: null, aggiornando: false, avanzamento: "",
};
if ((S.dati.versione || 0) < datiInclusi.versione || S.dati.aggiornato_al < datiInclusi.aggiornato_al) S.dati = datiInclusi;
const salva = () => { LS.set("seguite", S.seguite); LS.set("storico", S.storico); LS.set("notifiche", S.notifiche); LS.set("avvisi", S.avvisi); LS.set("bollette", S.bollette); LS.set("attuale", S.attuale); LS.set("utenza", S.utenza); LS.set("cte", S.cte); LS.set("dati", S.dati); LS.set("auto", S.auto); };
const U = () => ({ ...S.utenza, ingresso: S.utenza.ingresso && S.utenza.ingresso >= ymDi(oggi()) ? S.utenza.ingresso : ingressoTipico() });
const CTX = () => contesto(S.dati, S.catalogo?.parametri);

// ------------------------------------------------------------------ util
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pnum = (s) => {
  if (s == null) return null;
  s = String(s).trim().replace(/\s/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "");
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
};
const nv = (v, d = 6) => (v == null || Number.isNaN(v) ? "" : nf(v, d));
const badge = (t, cls = t.toLowerCase()) => `<span class="b ${cls}">${t}</span>`;
const uid = () => Math.random().toString(36).slice(2, 10);
function toast(msg, ms = 2600) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), ms);
}
const attendi = () => new Promise((r) => setTimeout(r, 30));

// ------------------------------------------------------------------ navigazione
const TITOLI = { internet: "Internet casa", offerte: "Offerte luce e gas", cte: "La mia offerta", profilo: "I miei consumi", dati: "Info e aggiornamenti" };
function vai(tab) {
  S.tab = tab;
  $$(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  $("#titolo").textContent = TITOLI[tab] || "";
  VISTE[tab]();
  window.scrollTo(0, 0);
}
$$(".tabs button").forEach((b) => b.addEventListener("click", () => vai(b.dataset.tab)));
function statoChip() {
  const c = S.catalogo;
  $("#statoDati").innerHTML = S.aggiornando ? `<span class="spin sm"></span> aggiorno` : c ? `Offerte al ${dataIt(c.data)}` : "";
}

// ------------------------------------------------------------------ catalogo
function arricchisci(cat) {
  if (cat) for (const o of cat.offerte) { o.venditore = nomeFornitore(o.sito, o.venditore); o.cat = categoria(o.sito); }
  return cat;
}
async function avviaCatalogo() {
  S.catalogo = await caricaCatalogo();
  if (!S.catalogo) { try { S.catalogo = await catalogoIniziale(); } catch (e) { console.error(e); } }
  arricchisci(S.catalogo);
  if (S.catalogo && !S.storico.some((x) => x.data === S.catalogo.data)) setTimeout(() => { try { registraGiorno(); } catch (e) { console.error(e); } }, 1500);
  statoChip();
  VISTE[S.tab]();
}
function scaricaSeServe() {
  const giaProvato = LS.get("tentativo", "") === oggiIso();
  if (S.auto === "giorno" && nativo() && S.catalogo?.data < oggiIso() && !giaProvato) aggiorna(false);
}

async function aggiorna(manuale) {
  if (S.aggiornando) return;
  if (!nativo() && !manuale) return;
  S.aggiornando = true; LS.set("tentativo", oggiIso()); statoChip();
  const prog = (m) => { S.avanzamento = m; const el = $("#avanz"); if (el) el.textContent = m; };
  try {
    const nuovo = await aggiornaCatalogo(scaricaTesto, prog);
    S.catalogo = arricchisci(nuovo); cache.clear();
    await salvaCatalogo(nuovo);
    try { registraGiorno(); } catch (e) { console.error(e); }
    toast(`Offerte aggiornate: ${nuovo.offerte.length} offerte del ${dataIt(nuovo.data)}`, 3500);
  } catch (e) {
    console.error(e);
    if (manuale || S.tab === "dati") toast("Aggiornamento non riuscito: " + e.message + ". Restano le offerte salvate.", 5000);
  } finally {
    S.aggiornando = false; S.avanzamento = ""; statoChip();
    if (["offerte", "dati", "cte"].includes(S.tab)) VISTE[S.tab]();
  }
  aggiornaIndici();
}

/** Indici PUN/PSV e tariffe: file dati.json del repository (aggiornato a mano quando escono i valori mensili). */
async function aggiornaIndici() {
  try {
    const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(DATI_URL + "?t=" + Date.now(), { signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) return;
    const n = await r.json();
    if (!n?.regolate || !n?.indici?.pun) return;
    if ((n.versione || 0) < (S.dati.versione || 0) || n.aggiornato_al <= S.dati.aggiornato_al) return;
    S.dati = n; salva(); cache.clear();
  } catch { /* senza rete restano i dati inclusi */ }
}

// ------------------------------------------------------------------ classifica (con cache)
const cache = new Map();
function chiave(forn) { return JSON.stringify([forn, S.attuale[forn], S.mostraScadute, S.catalogo?.scaricato, U(), S.catalogo?.data, S.catalogo?.offerte.length, S.dati.aggiornato_al, S.cte.length, S.cte.map((c) => c.id + c.incluso)]); }
function offerteCte(forn) {
  return S.cte.filter((o) => o.fornitura === forn && o.incluso !== false && cteCompleta(o)).map(daCte);
}
function stgUtente(ctx) {
  const o = offertaSTG(ctx.E, S.utenza.luce.stgQuota);
  const a = areaSTG(S.utenza.comune?.sigla);
  if (a) { o.venditore = a.venditore; o.nome = `Servizio Tutele Graduali D - Area ${a.area} Domestici`; }
  return o;
}
function calcolaClassifica(forn) {
  const k = chiave(forn);
  if (cache.has(k)) return cache.get(k);
  const u = U(), ctx = CTX();
  const f = filtra(S.catalogo?.offerte || [], u, S.dati.regolate, oggiIso(), { scadute: S.mostraScadute });
  const att = offertaAttuale(forn);
  const rif = [...(forn === "LUCE" && !att?.stg ? [stgUtente(ctx)] : []), ...(att ? [att] : [])];
  const lista = classifica([...f[forn], ...offerteCte(forn).filter((o) => !(S.attuale[forn]?.tipo === "cte" && S.attuale[forn].id === o.id)), ...rif], u, ctx);
  for (const r of lista) r.cp = condizioniParticolari(r.offerta, u);
  const conInternet = lista.filter((r) => !r.offerta.mia && richiedeInternet(r.offerta));
  const out = { lista: lista.filter((r) => r.offerta.mia || !richiedeInternet(r.offerta)), conInternet, escluse: f.escluse[forn], nValide: f[forn].length, scaduteDopo: f.scaduteDopo[forn].filter((o) => o.al >= S.catalogo.data) };
  cache.set(k, out);
  return out;
}

// ------------------------------------------------------------------ STG
// Aste STG 2024 (ARERA, determina 62/2024): province delle 7 aree assegnate a Hera Comm.
const STG_HERA = new Set("CR GE SP LO LU MS AL AT CN NO PV BG SO UD AN PD PU VE AP BO FM FE MC RO AR CE PG RI TR VT CH FC AQ PE RA RN TE".split(" "));
const gestoreSTG = (u = S.utenza) => (STG_HERA.has(u.comune?.sigla) ? "Hera Comm" : "il gestore STG della tua area");
/** Risultato STG luce in classifica (sempre presente). */
const rifSTG = () => calcolaClassifica("LUCE").lista.find((x) => x.offerta.stg) || null;
const vsSTG = (tot, stg) => (stg ? (tot <= stg.centrale ? `<b class="ok">−${eur(stg.centrale - tot, 0)} vs STG</b>` : `<b class="bad">+${eur(tot - stg.centrale, 0)} vs STG</b>`) : "");

// ------------------------------------------------------------------ STG O MERCATO LIBERO
async function vistaSTG() {
  const v = $("#vista"), u = U(), ctx = CTX();
  $("#titolo").textContent = "STG o mercato libero";
  v.innerHTML = `<div class="empty"><span class="spin"></span><p>Confronto l'STG con il mercato libero a vari consumi…</p></div>`;
  window.scrollTo(0, 0);
  await attendi();
  const R = calcolaClassifica("LUCE");
  const stgR = R.lista.find((x) => x.offerta.stg);
  if (!stgR) { vai("offerte"); return; }
  const stg = stgR.offerta, libere = R.lista.filter((x) => !x.offerta.mia);
  const stgSc = riepilogoOfferta(stg, u, ctx, true);
  const meno = libere.filter((x) => x.centrale < stgR.centrale);
  const best = libere[0], bestFisso = libere.find((x) => !eVariabile(x.offerta)), bestVar = libere.find((x) => eVariabile(x.offerta));
  const bestNoto = libere.find((x) => x.offerta.cat === "grande" || x.offerta.cat === "nazionale");
  // restare davvero: STG fino a marzo 2027, poi l'offerta più economica del venditore STG
  const area = areaSTG(u.comune?.sigla);
  const dopoR = area ? libere.find((x) => x.offerta.sito === area.sito) : null;
  const rest = restare(stg, dopoR?.offerta, u, ctx);
  // soglie di consumo per le offerte principali
  const cand = [];
  const add = (r, perche) => { if (r && !cand.some((c) => c.r.offerta.id === r.offerta.id)) cand.push({ r, perche }); };
  add(best, "la più economica"); add(bestFisso, "la migliore a prezzo fisso"); add(bestVar, "la migliore a prezzo variabile");
  add(bestNoto, "il miglior grande gruppo o marchio nazionale");
  for (const r of R.lista.filter((x) => x.offerta.attuale || (x.offerta.mia && !x.offerta.stg))) add(r, r.offerta.attuale ? "la tua offerta attuale" : "la tua CTE");
  for (const r of libere.slice(1, 8)) add(r, "");
  const cs = new Map();
  for (const c of cand) { c.curva = curva(c.r.offerta, stg, u, ctx, GRIGLIA, cs); c.soglie = soglie(c.curva); }
  const tuo = Math.round(u.luce.annuo);
  const cls = (d) => (d < 0 ? "ok" : "bad");
  const delta = (d) => (d < 0 ? "−" + eur(-d, 0) : "+" + eur(d, 0));
  const COL = [1500, 2500, 3500, 5000];
  let html = `<button class="btn ghost" id="indietro">‹ Indietro</button>
    <section class="hero"><div class="vend">${h(stg.venditore)} · servizio ARERA</div><h2>${h(stg.nome)}</h2>
      <div class="big-tot">${eur(stgR.centrale, 0)}<span> all'anno con ${nf(tuo, 0)} kWh · ${eur(stgR.centrale / 12, 0)} al mese</span></div>
      <div class="small mut">Prezzo variabile: PUN del mese + perdite, dispacciamento e quota fissa fissati da ARERA (${nf(stg.comp[0].p[0].pr, 2)} €/anno). Mercato in calo ${eur(stgSc.basso, 0)}, in rialzo ${eur(stgSc.alto, 0)}.</div>
      <div class="conf"><span>offerte del mercato libero che costano meno</span><b>${meno.length} su ${libere.length}</b></div>
      ${best ? `<div class="conf"><span>la più economica (${h(best.offerta.venditore)})</span><b class="${cls(best.centrale - stgR.centrale)}">${delta(best.centrale - stgR.centrale)}/anno</b></div>` : ""}
      ${bestFisso ? `<div class="conf"><span>la migliore a prezzo fisso (${h(bestFisso.offerta.venditore)})</span><b class="${cls(bestFisso.centrale - stgR.centrale)}">${delta(bestFisso.centrale - stgR.centrale)}/anno</b></div>` : ""}
      ${bestNoto ? `<div class="conf"><span>il miglior grande marchio (${h(bestNoto.offerta.venditore)})</span><b class="${cls(bestNoto.centrale - stgR.centrale)}">${delta(bestNoto.centrale - stgR.centrale)}/anno</b></div>` : ""}
    </section>
    <section class="sez"><h3>Tutte le STG sono uguali?</h3>
      <p class="small">L'STG è un servizio unico per area, non un'offerta tra tante: le condizioni le fissa ARERA, il venditore (qui ${h(stg.venditore)}) l'ha vinto all'asta. Il prezzo dell'energia è lo stesso per tutti (PUN + perdite), cambia solo la quota fissa. Nella tua bolletta Hera la quota è ${nf(stg.comp[0].p[0].pr / 12, 4)} € al mese: l'app la usa ed è verificata al centesimo.</p></section>
    <section class="sez"><h3>⚠ L'STG finisce il 31 marzo 2027</h3>
      <p class="small">Se resti senza scegliere, dal 1° aprile 2027 passi in automatico all'offerta di mercato libero più economica che ${h(stg.venditore)} avrà a dicembre 2026 (prezzo garantito almeno 12 mesi, senza penali). Chi esce dall’STG di fatto non può rientrarci: dopo marzo 2027 resta solo come servizio di ultima istanza per chi resta senza venditore.</p>
      ${rest.dopo ? `<table class="lista"><tr><td>STG da ${meseIt(u.ingresso)} a marzo 2027 (${rest.mesiStg} mesi)</td><td class="r num"></td></tr>
        <tr><td>poi ${h(rest.dopo.venditore)} — ${h(rest.dopo.nome)} <span class="mut">(stima: la loro più economica oggi)</span> per ${rest.mesiDopo} mesi</td><td class="r num"></td></tr>
        <tr class="t"><td>«Restare» nei prossimi 12 mesi</td><td class="r num">${eur(rest.totale, 0)}</td></tr>
        ${best ? `<tr><td>Passare subito a ${h(best.offerta.venditore)} — ${h(best.offerta.nome)}</td><td class="r num ${cls(best.centrale - rest.totale)}">${eur(best.centrale, 0)} (${delta(best.centrale - rest.totale)})</td></tr>` : ""}</table>` : ""}
    </section>
    <section class="sez"><h3>Fino a quanti kWh conviene?</h3>
      <p class="small mut">Differenza all'anno rispetto all'STG con consumi diversi (verde = l'offerta costa meno). Il tuo consumo: <b>${nf(tuo, 0)} kWh</b>.</p>
      <table class="lista"><tr><th>Offerta</th><th class="r">con ${nf(tuo, 0)} kWh</th></tr>
      ${cand.map((c) => { const o = c.r.offerta, d0 = c.r.centrale - stgR.centrale;
        return `<tr data-det="${h(o.id)}" role="button"><td><b>${h(o.venditore)}</b> — ${h(o.nome)}<div class="frase">${c.perche ? h(c.perche) + " · " : ""}${eVariabile(o) ? "variabile" : "fisso"} · ${h(fraseSoglie(c.soglie))}</div></td>
          <td class="r num ${cls(d0)}"><b>${delta(d0)}</b><div class="frase">${COL.map((k) => { const p = c.curva.find((x) => x.kwh === k); return `${k / 1000}k: <span class="${cls(p.diff)}">${delta(p.diff)}</span>`; }).join("<br>")}</div></td></tr>`; }).join("")}</table>
      ${graficoSTG(cand.slice(0, 3), tuo)}
      <p class="small mut">Calcolo completo per ogni consumo: 12 bollette con quote fisse, sconti, oneri, imposte e IVA. Le quote fisse pesano di più con consumi bassi, il prezzo dell'energia con consumi alti: per questo un'offerta può convenire solo sopra o sotto una certa soglia.</p></section>
    <section class="sez"><h3>In sintesi</h3><ul class="small">
      ${best && best.centrale < stgR.centrale ? `<li>Con ${nf(tuo, 0)} kWh il mercato libero conviene: ${meno.length} offerte costano meno dell'STG, la migliore ti fa risparmiare <b>${eur(stgR.centrale - best.centrale, 0)} all'anno</b>.</li>` : `<li>Con ${nf(tuo, 0)} kWh nessuna offerta costa meno dell'STG: restare è la scelta più economica fino a marzo 2027.</li>`}
      ${bestFisso && bestFisso.centrale < stgR.centrale ? `<li>Anche a prezzo fisso risparmi ${eur(stgR.centrale - bestFisso.centrale, 0)} all'anno, senza il rischio di rialzi del PUN (con l'STG, in caso di rialzo, spenderesti ${eur(stgSc.alto, 0)}).</li>` : ""}
      <li>Restando, ad aprile 2027 l'STG finisce comunque e passi a un'offerta ${h(stg.venditore)} che oggi non si conosce: scegliere ora significa sapere già quanto paghi.</li>
      <li>Prima di firmare guarda nel dettaglio dell'offerta penali, durata del prezzo e recensioni del fornitore.</li></ul></section>`;
  v.innerHTML = html;
  $("#indietro").onclick = () => vai("offerte");
  $$("[data-det]").forEach((c) => c.addEventListener("click", () => vistaDettaglio(c.dataset.det)));
}

/** Grafico semplice: differenza annua rispetto all'STG al variare del consumo. */
function graficoSTG(cand, tuo) {
  if (!cand.length) return "";
  const W = 340, H = 180, L = 46, B = 24, T = 10, Rr = 10;
  const xs = GRIGLIA, all = cand.flatMap((c) => c.curva.map((p) => p.diff)).concat([0]);
  const min = Math.min(...all), max = Math.max(...all);
  const x = (k) => L + (k - xs[0]) / (xs.at(-1) - xs[0]) * (W - L - Rr);
  const y = (d) => T + (max - d) / ((max - min) || 1) * (H - T - B);
  const colori = ["#2e8b57", "#2a6f97", "#8a5cb8"];
  const linee = cand.map((c, i) => `<polyline fill="none" stroke="${colori[i]}" stroke-width="2.2" points="${c.curva.map((p) => `${x(p.kwh).toFixed(1)},${y(p.diff).toFixed(1)}`).join(" ")}"/>`).join("");
  const assiX = [1000, 3000, 5000, 7000].map((k) => `<text x="${x(k)}" y="${H - 6}" font-size="10" text-anchor="middle" fill="#667385">${k / 1000}k</text>`).join("");
  const assiY = [min, 0, max].map((d) => `<text x="${L - 4}" y="${y(d) + 3}" font-size="10" text-anchor="end" fill="#667385">${Math.round(d)}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:520px;margin-top:10px" role="img" aria-label="Differenza rispetto all'STG per consumo">
    <line x1="${L}" x2="${W - Rr}" y1="${y(0)}" y2="${y(0)}" stroke="#1c2733" stroke-dasharray="4 3"/>
    <text x="${W - Rr}" y="${y(0) - 4}" font-size="10" text-anchor="end" fill="#1c2733">STG</text>
    <line x1="${x(tuo)}" x2="${x(tuo)}" y1="${T}" y2="${H - B}" stroke="#b7791f" stroke-dasharray="2 3"/>
    <text x="${x(tuo) + 3}" y="${T + 9}" font-size="10" fill="#b7791f">tu</text>${linee}${assiX}${assiY}</svg>
    <div class="small">${cand.map((c, i) => `<span style="color:${colori[i]};font-weight:700">━</span> ${h(c.r.offerta.venditore)}`).join(" &nbsp; ")} <span class="mut">· sotto la linea tratteggiata = costa meno dell'STG (€/anno)</span></div>`;
}

// ------------------------------------------------------------------ OFFERTE
function venditoriPrincipali(lista) {
  const v = [...new Set(lista.map((o) => o.venditore))];
  const pesi = (x) => ({ grande: 0, nazionale: 1 }[lista.find((o) => o.venditore === x)?.cat] ?? 2);
  return v.sort((a, b) => pesi(a) - pesi(b)).slice(0, 6).join(", ");
}
const FILTRI = [
  ["fisso", "Prezzo fisso"], ["variabile", "Prezzo variabile"], ["grandi", "Grandi gruppi e marchi nazionali"],
  ["nopenali", "Senza penali"], ["nodeposito", "Senza deposito"],
];
function passaFiltri(r) {
  const o = r.offerta, f = S.filtri, cp = r.cp || [];
  if (o.mia) return true;
  if (f.fisso && !f.variabile && eVariabile(o)) return false;
  if (f.variabile && !f.fisso && !eVariabile(o)) return false;
  if (f.grandi && o.cat !== "grande" && o.cat !== "nazionale") return false;
  if (f.nopenali && cp.some((c) => /Penale|pluriennale/.test(c.breve))) return false;
  if (f.nodeposito && cp.some((c) => c.tipo === "attenzione" && /Deposito/.test(c.breve))) return false;
  return true;
}
function badgeFornitore(o) {
  if (o.attuale) return badge("LA TUA OFFERTA ATTUALE", "mia");
  if (o.mia) return o.stg ? badge("SERVIZIO ARERA", "mia") : badge("LA TUA CTE", "mia");
  return `<span class="forn ${o.cat}">${ETICHETTE[o.cat || "piccolo"].breve}</span>`;
}
/** Pillole: al massimo 3, prima i vantaggi inclusi, poi le attenzioni. */
function pillole(r, max = 3) {
  const cp = r.cp || [], out = [];
  const inclusi = r.sp?.totApplicati > 0.005 ? [`<span class="pill save">✓ Sconti inclusi −${eur(r.sp.totApplicati, 0)}</span>`] : [];
  const att = cp.filter((c) => c.tipo === "attenzione").map((c) => `<span class="pill ${/Penale|pluriennale/.test(c.breve) ? "bad" : "att"}">${/Penale/.test(c.breve) ? "⚠ " : ""}${h(c.breve)}</span>`);
  const info = cp.filter((c) => c.tipo === "info" && /Solo|Servizi/.test(c.breve)).map((c) => `<span class="pill neutral">${h(c.breve)}</span>`);
  out.push(...inclusi, ...new Set(att), ...new Set(info));
  const resto = out.length - max;
  return out.length ? `<div class="pills">${out.slice(0, max).join("")}${resto > 0 ? `<span class="pill neutral">+${resto}</span>` : ""}</div>` : "";
}

const segForn = (u) => `<div class="seg big" id="sForn"><button data-v="LUCE" class="${S.forn === "LUCE" ? "on" : ""}" ${u.luce.attiva ? "" : "disabled"}>💡 Luce</button>
      <button data-v="GAS" class="${S.forn === "GAS" ? "on" : ""}" ${u.gas.attiva ? "" : "disabled"}>🔥 Gas</button>
      <button data-v="DUAL" class="${S.forn === "DUAL" ? "on" : ""}" ${u.luce.attiva && u.gas.attiva ? "" : "disabled"}>Luce + Gas</button></div>`;

function calcolaDual() {
  const k = "DUAL" + chiave("LUCE") + chiave("GAS");
  if (cache.has(k)) return cache.get(k);
  const u = U(), ctx = CTX();
  const r = classificaDual(S.catalogo.offerte, u, ctx, oggiIso());
  const L = calcolaClassifica("LUCE").lista.find((x) => !x.offerta.mia), G = calcolaClassifica("GAS").lista.find((x) => !x.offerta.mia);
  for (const x of r.lista) x.cp = condizioniParticolari(x.luce.offerta, u).concat(condizioniParticolari(x.gas.offerta, u));
  const out = { ...r, separati: L && G ? { luce: L, gas: G, centrale: L.centrale + G.centrale } : null };
  cache.set(k, out);
  return out;
}

async function vistaDual() {
  const v = $("#vista"), u = U();
  if (!cache.has("DUAL" + chiave("LUCE") + chiave("GAS"))) { v.innerHTML = `<div class="empty"><span class="spin"></span><p>Calcolo luce e gas insieme…</p></div>`; await attendi(); }
  const R = calcolaDual(), sep = R.separati;
  const stgD = sep && rifSTG() ? rifSTG().centrale + sep.gas.centrale : null;
  let html = `<div class="intest">${segForn(u)}
    <button class="profilo-btn" id="vaiProfilo"><span>${h(u.comune?.nome || "Comune?")} · ${nf(u.luce.annuo, 0)} kWh + ${nf(u.gas.annuo, 0)} Smc · da ${meseIt(u.ingresso)}</span><b>Modifica</b></button></div>`;
  if (sep) html += `<section class="best"><div class="best-l">Separati: la miglior luce + il miglior gas</div>
      <div class="row sp"><div class="min0 small"><div>💡 <b>${h(sep.luce.offerta.venditore)}</b> — ${h(sep.luce.offerta.nome)} · ${eur(sep.luce.centrale, 0)}</div>
        <div>🔥 <b>${h(sep.gas.offerta.venditore)}</b> — ${h(sep.gas.offerta.nome)} · ${eur(sep.gas.centrale, 0)}</div></div>
        <div class="price"><div class="tot">${eur(sep.centrale, 0)}</div><div class="sub">all'anno</div></div></div>
      ${R.lista[0] ? `<div class="conf"><span>rispetto al miglior pacchetto luce+gas</span><b class="${R.lista[0].centrale > sep.centrale ? "ok" : ""}">${R.lista[0].centrale > sep.centrale ? "risparmi " + eur(R.lista[0].centrale - sep.centrale, 0) : "costa " + eur(sep.centrale - R.lista[0].centrale, 0) + " in più"}</b></div>` : ""}
      ${stgD ? `<div class="conf"><span>rispetto a STG ${h(gestoreSTG())} + il miglior gas (${eur(stgD, 0)})</span><b class="${sep.centrale < stgD ? "ok" : "bad"}">${sep.centrale < stgD ? "risparmi " + eur(stgD - sep.centrale, 0) : "costa " + eur(sep.centrale - stgD, 0) + " in più"}</b></div>` : ""}
      <div class="small mut" style="margin-top:6px">Due contratti e due bollette, anche con fornitori diversi.</div></section>`;
  html += `<div class="small mut conta">${R.lista.length} pacchetti luce+gas dello stesso fornitore · totale di 12 bollette luce + 12 gas</div>`;
  for (const [i, x] of R.lista.entries()) {
    html += `<article class="offer">
      <div class="row sp testa"><div class="min0"><div class="vend">${h(x.dual.venditore)} ${badgeFornitore(x.dual)}</div><div class="nome">${h(x.dual.nome)}</div></div>
        <div class="price"><div class="tot">${eur(x.centrale, 0)}</div><div class="sub">${sep ? (x.centrale >= sep.centrale ? "+" + eur(x.centrale - sep.centrale, 0) : "−" + eur(sep.centrale - x.centrale, 0)) + " vs separati" : ""}</div></div></div>
      <div class="riga small mut">${stgD ? vsSTG(x.centrale, { centrale: stgD }) + " (STG + miglior gas) · " : ""}💡 ${eur(x.luce.centrale, 0)} + 🔥 ${eur(x.gas.centrale, 0)}${x.sconto ? ` − sconto pacchetto ${eur(x.sconto, 0)}` : ""} · ${i + 1}° posto</div>
      ${pillole(x)}
      <div class="row" style="margin-top:8px"><button class="btn sec mini" data-det="${h(x.luce.offerta.id)}">Dettaglio luce</button><button class="btn sec mini" data-det="${h(x.gas.offerta.id)}">Dettaglio gas</button></div></article>`;
  }
  if (!R.lista.length) html += `<div class="empty">Nessun pacchetto luce+gas disponibile per te.</div>`;
  v.innerHTML = html;
  $("#vaiProfilo").onclick = () => vai("profilo");
  $$("#sForn button").forEach((b) => (b.onclick = () => { S.forn = b.dataset.v; S.quante = 25; vistaOfferte(); }));
  $$("[data-det]").forEach((c) => c.addEventListener("click", () => vistaDettaglio(c.dataset.det)));
}

async function vistaOfferte() {
  const v = $("#vista"), u = U();
  if (!S.catalogo) { v.innerHTML = `<div class="empty"><span class="spin"></span><p>Carico le offerte…</p></div>`; return; }
  if (S.forn === "DUAL") { if (u.luce.attiva && u.gas.attiva) return vistaDual(); S.forn = "LUCE"; }
  if (!(S.forn === "LUCE" ? u.luce.attiva : u.gas.attiva) && (u.luce.attiva || u.gas.attiva)) S.forn = u.luce.attiva ? "LUCE" : "GAS";
  if (!cache.has(chiave(S.forn))) { v.innerHTML = `<div class="empty"><span class="spin"></span><p>Calcolo le bollette di ogni offerta…</p></div>`; await attendi(); }
  const R = calcolaClassifica(S.forn);
  const unita = S.forn === "LUCE" ? "kWh" : "Smc";
  const consumo = S.forn === "LUCE" ? `${nf(u.luce.annuo, 0)} kWh` : `${nf(u.gas.annuo, 0)} Smc`;
  let lista = R.lista.filter(passaFiltri);
  if (S.cerca) { const q = S.cerca.toLowerCase(); lista = lista.filter((r) => `${r.offerta.venditore} ${r.offerta.nome}`.toLowerCase().includes(q)); }
  const migliore = lista.find((r) => !r.offerta.mia) || lista[0];
  const rif = R.lista.filter((r) => r.offerta.mia);
  const vecchio = S.catalogo.data < isoGiorno(new Date(Date.now() - 2 * 86400000));

  let html = `<div class="intest">${segForn(u)}
    <button class="profilo-btn" id="vaiProfilo"><span>${h(u.comune?.nome || "Comune?")} · ${consumo}/anno · da ${meseIt(u.ingresso)}</span><b>Modifica</b></button></div>`;
  html += bannerNotifiche();
  if (vecchio) html += `<div class="avviso small">Offerte del ${dataIt(S.catalogo.data)}. ${S.aggiornando ? `<span id="avanz">${h(S.avanzamento || "Aggiorno…")}</span>` : `<button class="btn mini" id="aggOra">Scarica quelle di oggi</button>`}</div>`;

  // la migliore
  if (migliore && !S.cerca) {
    const o = migliore.offerta;
    const conf = rif.map((r) => `<div class="conf"><span>${r.offerta.attuale ? "rispetto alla tua offerta attuale" : `rispetto a ${h(r.offerta.stg ? "STG " + gestoreSTG() : r.offerta.nome)}`}</span><b class="${r.centrale > migliore.centrale ? "ok" : ""}">${r.centrale > migliore.centrale ? "risparmi " + eur(r.centrale - migliore.centrale, 0) + "/anno" : "costa " + eur(migliore.centrale - r.centrale, 0) + " in più"}</b></div>`).join("");
    html += `<section class="best" data-det="${h(o.id)}" role="button"><div class="best-l">La più conveniente per te</div>
      <div class="row sp"><div class="min0"><div class="vend">${h(o.venditore)} ${badgeFornitore(o)}</div><div class="nome">${h(o.nome)}</div></div>
        <div class="price"><div class="tot">${eur(migliore.centrale, 0)}</div><div class="sub">all'anno · ${eur(migliore.centrale / 12, 0)}/mese</div></div></div>
      ${pillole(migliore, 4)}${conf}<div class="vedi">Vedi bollette, sconti e condizioni ›</div></section>`;
  }

  // ricerca e filtri
  html += `<div class="cerca"><input id="cerca" type="search" placeholder="🔍 Cerca un fornitore (es. Enel, Octopus)" value="${h(S.cerca)}"></div>
    <div class="chips-f">${FILTRI.map(([k, t]) => `<button data-f="${k}" class="${S.filtri[k] ? "on" : ""}">${t}</button>`).join("")}</div>
    <div class="small mut conta">${lista.length} offerte · ordinate dalla più economica · totale di 12 bollette con tutte le voci</div>`;

  const best = migliore?.centrale ?? 0;
  const stgR = S.forn === "LUCE" ? R.lista.find((x) => x.offerta.stg) : null;
  if (stgR && !S.cerca) html += `<div class="riga-stg" id="vaiStg" role="button"><b>Resto nelle Tutele Graduali o passo al mercato libero?</b>
      <div class="small">STG ${h(gestoreSTG())}: ${eur(stgR.centrale, 0)}/anno · ${R.lista.filter((x) => !x.offerta.mia && x.centrale < stgR.centrale).length} offerte su ${R.lista.filter((x) => !x.offerta.mia).length} costano meno · fino a quanti kWh conviene ›</div></div>`;
  if (S.forn === "GAS") html += `<div class="small mut">Per il gas non esiste un servizio a tutele graduali: dal 2024 i clienti non vulnerabili sono tutti sul mercato libero.</div>`;
  for (const r of lista.slice(0, S.quante)) {
    const o = r.offerta, pos = R.lista.indexOf(r) + 1, sc = scadenza(o, oggiIso());
    if (r === migliore && !S.cerca) continue;
    html += `<article class="offer ${o.mia ? "mia" : ""}" data-det="${h(o.id)}" role="button">
      <div class="row sp testa"><div class="min0"><div class="vend">${h(o.venditore)} ${badgeFornitore(o)}</div><div class="nome">${h(o.nome)}</div></div>
        <div class="price"><div class="tot">${eur(r.centrale, 0)}</div><div class="sub">${r.centrale >= best ? "+" + eur(r.centrale - best, 0) : "−" + eur(best - r.centrale, 0)} vs migliore</div></div></div>
      <div class="riga small mut">${S.forn === "LUCE" && !o.stg && stgR ? vsSTG(r.centrale, stgR) + " · " : ""}${eVariabile(o) ? "Variabile" : "Fisso"} · ${nf(r.costoMedio, 3)} €/${unita} tutto compreso · ${pos}° posto${sc ? (sc.giorni < 0 ? ` · <b class="bad">scaduta</b>` : sc.giorni <= 7 ? ` · <b class="bad">firma entro ${dataIt(sc.al)}</b>` : "") : ""}</div>
      ${pillole(r)}</article>`;
  }
  if (lista.length > S.quante) html += `<button class="btn sec full" id="altre">Mostra altre offerte</button>`;
  if (!lista.length) html += `<div class="empty">Nessuna offerta con questi filtri.</div>`;
  if (R.scaduteDopo.length) html += `<div class="avviso small">${R.scaduteDopo.length} offerte, tra cui ${h(venditoriPrincipali(R.scaduteDopo))}, sono scadute dopo il ${dataIt(S.catalogo.data)}.
      I grandi fornitori rinnovano le offerte ogni 2 settimane: scarica quelle di oggi dalla scheda Info.
      <label class="sw"><span>Mostrale comunque</span><input type="checkbox" id="mScad" ${S.mostraScadute ? "checked" : ""}></label></div>`;
  if (R.conInternet.length) html += `<div class="avviso small">${R.conInternet.length} offerte (${h(venditoriPrincipali(R.conInternet.map((r) => r.offerta)))}) richiedono di attivare anche internet con lo stesso fornitore: non sono in classifica perché il loro prezzo non comprende la fibra.
      <button class="btn mini" id="vaiNet">Confrontale con internet incluso</button></div>`;
  html += `<button class="btn ghost full" id="pdfConf">Esporta la classifica in PDF</button>`;
  v.innerHTML = html;

  $("#vaiNet") && ($("#vaiNet").onclick = () => vai("internet"));
  $("#vaiStg") && ($("#vaiStg").onclick = () => vistaSTG());
  $("#vaiProfilo").onclick = () => vai("profilo");
  $$("#sForn button").forEach((b) => (b.onclick = () => { S.forn = b.dataset.v; S.quante = 25; vistaOfferte(); }));
  $$("[data-f]").forEach((b) => (b.onclick = () => { S.filtri[b.dataset.f] = !S.filtri[b.dataset.f]; LS.set("filtri", S.filtri); S.quante = 25; vistaOfferte(); }));
  $("#cerca").oninput = (e) => { clearTimeout(vistaOfferte._t); vistaOfferte._t = setTimeout(() => { S.cerca = e.target.value.trim(); S.quante = 25; vistaOfferte().then(() => { const c = $("#cerca"); c.focus(); c.setSelectionRange(c.value.length, c.value.length); }); }, 350); };
  $("#altre") && ($("#altre").onclick = () => { S.quante += 25; vistaOfferte(); });
  $("#aggOra") && ($("#aggOra").onclick = () => aggiorna(true));
  $("#notLette") && ($("#notLette").onclick = (e) => { e.stopPropagation(); S.notifiche.forEach((x) => (x.letta = true)); salva(); vistaOfferte(); });
  $("#mScad") && ($("#mScad").onchange = (e) => { S.mostraScadute = e.target.checked; vistaOfferte(); });
  $$("[data-det]").forEach((c) => c.addEventListener("click", () => vistaDettaglio(c.dataset.det)));
  $("#pdfConf").onclick = () => esegui(() => pdfConfronto(lista.slice(0, 30), S.forn, u, S.dati, S.catalogo), "classifica");
}

// ------------------------------------------------------------------ DETTAGLIO
const GRUPPI = [["vendita", "Spesa per la materia energia"], ["rete", "Spesa per il trasporto e la gestione del contatore"], ["oneri", "Spesa per oneri di sistema"],
  ["imposte", "Imposte (accisa e addizionali)"], ["iva", "IVA"], ["altro", "Altre partite (fuori campo IVA)"]];

function tabellaVoci(r) {
  let t = `<table><tr><th>Voce</th><th class="r">Quantità</th><th class="r">Prezzo</th><th class="r">Importo</th></tr>`;
  for (const [g, tit] of GRUPPI) {
    const voci = r.voci.filter((x) => x.gruppo === g);
    if (!voci.length) continue;
    t += `<tr class="g"><td colspan="3">${tit}</td><td class="r num">${eur(r.gruppo(g))}</td></tr>`;
    for (const x of voci) {
      const q = g === "iva" ? `su ${eur(x.quantita)}` : x.unita ? `${nf(x.quantita, 3)} ${h(x.unita)}` : "";
      const p = g === "iva" ? `${Math.round(x.prezzo * 100)}%` : x.unita ? nf(x.prezzo, 6) : "";
      t += `<tr><td>${h(x.descrizione)}</td><td class="r num">${q}</td><td class="r num">${p}</td><td class="r num">${eur(x.importo)}</td></tr>`;
    }
  }
  return t + `<tr class="t"><td colspan="3">TOTALE BOLLETTA</td><td class="r num">${eur(r.totale)}</td></tr></table>`;
}
function tabellaApplicati(app) {
  return `<p class="small" style="margin:12px 0 4px"><b>Valori applicati e loro origine</b></p><table>` + app.map((a) =>
    `<tr><td>${h(a.nome)}<div class="frase">${h(a.nota)}</div></td><td>${badge(a.tipo)}</td>
     <td class="r num">${a.valore == null ? "" : nf(a.valore, 6) + " " + h(a.unita)}</td></tr>`).join("") + "</table>";
}
const trovaOfferta = (id) => id.startsWith("ATTUALE-") ? offertaAttuale(id.slice(8)) : id === "STG" ? stgUtente(CTX()) : (S.catalogo?.offerte || []).find((o) => o.id === id) || offerteCte("LUCE").concat(offerteCte("GAS")).find((o) => o.id === id);

function sezioneScontiPenali(o, sp) {
  let html = `<section class="sez" id="s-sconti"><h3>Sconti e penali</h3>`;
  html += `<div class="sub-h ok">Sconti inclusi nel totale</div>`;
  html += sp.applicati.length ? `<table class="lista">${sp.applicati.map((x) => `<tr><td>${h(x.nome)}<div class="frase">${x.mesi === 1 ? "una volta" : `in ${x.mesi} bollette`}${x.iva ? ", prima dell'IVA" : ", fuori campo IVA"}</div></td>
      <td class="r num ok">−${eur(x.totale)}</td></tr>`).join("")}<tr class="t"><td>Totale sconti in 12 mesi</td><td class="r num ok">−${eur(sp.totApplicati)}</td></tr></table>`
    : `<p class="small mut">Nessuno sconto incluso.</p>`;
  if (sp.esclusi.length) {
    html += `<div class="sub-h">Sconti non inclusi</div><table class="lista">${sp.esclusi.map((x) => `<tr><td>${h(x.nome)}<div class="frase">${h(x.motivo)}${x.comeOttenerlo ? ` — <a href="#" class="vaiProf">${h(x.comeOttenerlo)}</a>` : ""}</div></td>
      <td class="r num mut">${h(x.valore)}</td></tr>`).join("")}</table>`;
  }
  html += `<div class="sub-h bad">Penali e vincoli</div>`;
  const righe = [];
  for (const p of sp.penali) righe.push(`<li><b>Recesso anticipato:</b> ${h(p.testo)}${p.limitante ? " " + badge("LIMITANTE", "urg") : ""}</li>`);
  for (const v of sp.vincoli) righe.push(`<li><b>${CONDIZIONI[v.tipo] || "Condizione"}:</b> ${h(v.testo || "vedi le condizioni del venditore")}${v.limitante ? " " + badge("LIMITANTE", "urg") : ""}</li>`);
  if (sp.deposito) righe.push(`<li><b>Garanzie e deposito:</b> ${h(sp.deposito)}</li>`);
  html += righe.length ? `<ul class="small">${righe.join("")}</ul>` : `<p class="small mut">${o.mia ? "Controlla penali e vincoli sulla tua CTE." : "Nessuna penale o condizione limitante dichiarata al Portale."}</p>`;
  return html + `</section>`;
}

function schedaOfferta(o) {
  const sc = scadenza(o, oggiIso());
  const righe = [];
  if (!o.mia) {
    righe.push(["Durata", durata(o)]);
    righe.push(["Sottoscrivibile", `${o.dal ? "dal " + dataIt(o.dal) + " " : ""}${sc ? `fino al <b>${dataIt(sc.al)}</b> (${sc.giorni < 0 ? "scaduta" : sc.giorni === 0 ? "ultimo giorno" : "tra " + sc.giorni + " giorni"})` : "senza scadenza indicata"}`]);
    if (o.att.length) righe.push(["Vale per", o.att.map((x) => ATTIVAZIONI[x] || x).join(", ")]);
    if (o.canali.length) righe.push(["Si attiva", o.canali.map((x) => CANALI[x] || x).join(", ")]);
    if (o.pag.length) righe.push(["Pagamento", o.pag.map((x) => PAGAMENTI[x] || x).join(", ")]);
    if (o.zone) righe.push(["Zone", "limitata ad alcune zone (compresa la tua)"]);
    if (o.serv.length) righe.push(["Servizi inclusi", h(o.serv.join(", "))]);
  }
  righe.push(["Fonte", h(o.fonte)]);
  // prezzi
  const U_ = { "01": "€/anno", "02": "€/kW anno", "03": "€/kWh", "04": "€/Smc", "05": "€ una tantum" };
  const FA = { "01": "F1", "02": "F2", "03": "F3", "91": "F2+F3", "07": "Peak", "08": "OffPeak" };
  const comp = o.comp.map((c) => `<tr><td>${h(c.n)}${c.opz && c.m === "06" ? `<div class="frase">opzione facoltativa, non conteggiata</div>` : ""}</td><td class="r num">${c.p.map((p) =>
    `${p.f && o.fasce !== "01" ? (FA[p.f] || p.f) + " " : ""}${nf(p.pr)} ${U_[p.u] || ""}${p.dur ? ` per ${p.dur} mesi` : ""}${p.fino ? ` fino a ${p.fino}` : ""}${p.da != null || p.a ? ` (consumi ${nf(p.da || 0, 0)}–${p.a ? nf(p.a, 0) : "∞"})` : ""}`).join("<br>")}</td></tr>`);
  if (eVariabile(o)) comp.unshift(`<tr><td>Indice</td><td class="r">${o.forn === "LUCE" ? "PUN del mese + 10% perdite" : "PSV del mese"}${o.idx[0]?.k && o.idx[0].k !== 1 ? ` × ${o.idx[0].k}` : ""}${o.tetto ? `<br>max ${nf(o.tetto)} €/kWh` : ""}</td></tr>`);
  if (o.disp.length) comp.push(`<tr><td>Dispacciamento</td><td class="r">${o.disp.map((d) => (d.v > 0 ? `${nf(d.v)} €/kWh` : "valori ARERA")).join(", ")}</td></tr>`);
  if (o.reg.length) comp.push(`<tr><td>Componenti regolate</td><td class="r">${o.reg.map((x) => NOMI_REGOLATE[x] || x).join(", ")} (ARERA)</td></tr>`);
  return `<section class="sez" id="s-prezzi"><h3>Prezzi dell'offerta</h3><table class="lista">${comp.join("")}</table>
      <p class="small mut">Trasporto, oneri di sistema e imposte non dipendono dal venditore: sono uguali per tutti e calcolati con i valori ARERA.</p></section>
    <section class="sez" id="s-info"><h3>Condizioni e contatti</h3><table class="kv">${righe.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>
      ${o.descr ? `<p class="small mut">${h(o.descr)}</p>` : ""}
      <div class="row">${o.url ? `<a class="btn sec" href="${h(o.url)}" target="_blank" rel="noopener">Pagina dell'offerta</a>` : ""}${o.tel ? `<a class="btn sec" href="tel:${h(o.tel)}">Chiama</a>` : ""}</div></section>`;
}

function vistaDettaglio(id, scenario = "centrale") {
  const o = trovaOfferta(id);
  if (!o) { toast("Offerta non trovata"); return; }
  const u = U(), ctx = CTX();
  const scen = eVariabile(o) ? ["basso", "centrale", "alto"] : ["centrale"];
  const ris = Object.fromEntries(scen.map((s) => [s, simulaOfferta(o, u, ctx, s)]));
  const mesi = ris[scenario];
  const unita = o.forn === "LUCE" ? "kWh" : "Smc";
  const cons = mesi.reduce((a, m) => a + m.consumo, 0);
  const tot = totaleMesi(mesi), altro = mesi.reduce((a, m) => a + m.risultato.gruppo("altro"), 0);
  const sp = scontiEPenali(o, mesi, u);
  const avvisi = [...new Set(mesi.flatMap((m) => m.risultato.avvisi))].filter((x) => !/^Sconto/.test(x));
  $("#titolo").textContent = "Dettaglio offerta";
  const cp = condizioniParticolari(o, u);
  const R = calcolaClassifica(o.forn), pos = R.lista.findIndex((r) => r.offerta.id === o.id), best = R.lista.find((r) => !r.offerta.mia);
  const rec = recensioni(o);
  const icona = { piu: "✓", attenzione: "⚠", info: "ℹ" };
  let html = `<button class="btn ghost" id="indietro">‹ Indietro</button>
    <section class="hero"><div class="vend">${h(o.venditore)} ${badgeFornitore(o)}</div><h2>${h(o.nome)}</h2>
      <div class="big-tot">${eur(tot, 0)}<span> all'anno · ${eur(tot / 12, 0)} al mese</span></div>
      <div class="small mut">${eVariabile(o) ? "Prezzo variabile" : "Prezzo fisso"} · ${nf((tot - altro) / cons, 3)} €/${unita} tutto compreso${pos >= 0 ? ` · ${pos + 1}° su ${R.lista.length}` : ""}${best && pos > 0 && !o.mia ? ` · +${eur(R.lista[pos].centrale - best.centrale, 0)} rispetto alla migliore` : ""}</div>
      ${o.forn === "LUCE" && !o.stg && rifSTG() ? (() => { const st = rifSTG(); const sg = soglie(curva(o, st.offerta, u, ctx)); return `<div class="conf"><span>rispetto a STG ${h(gestoreSTG())} (${eur(st.centrale, 0)}/anno)</span><b class="${tot < st.centrale ? "ok" : "bad"}">${tot < st.centrale ? "risparmi " + eur(st.centrale - tot, 0) + "/anno" : "costa " + eur(tot - st.centrale, 0) + " in più"}</b></div>
        <div class="small mut">Rispetto all'STG ${h(fraseSoglie(sg))} all'anno.</div>`; })() : ""}
      ${scen.length > 1 ? `<div class="seg" style="margin:12px 0 4px">${scen.map((s) => `<button data-sc="${s}" class="${s === scenario ? "on" : ""}">${{ basso: "Mercato in calo", centrale: "Prezzi stabili", alto: "Mercato in rialzo" }[s]}<br><b>${eur(totaleMesi(ris[s]), 0)}</b></button>`).join("")}</div>
        <div class="small mut">Con il prezzo variabile la spesa dipende dal mercato: ecco tre ipotesi.</div>` : ""}
      ${o.attuale ? (() => { const b = [...S.bollette].filter((x) => x.forn === o.forn && x.spesaAnnua).sort((x, y) => (x.al || "").localeCompare(y.al || "")).at(-1);
        return b ? `<div class="conf"><span>La bolletta del ${dataIt(b.al)} dice: speso negli ultimi 12 mesi</span><b>${eur(b.spesaAnnua, 0)}</b></div>
          <div class="small mut">Se è molto diverso dalla stima, controlla i consumi nel profilo: la bolletta riguarda consumi e prezzi passati.</div>` : ""; })() : ""}
    </section>
    <section class="sez"><h3>In breve</h3>
      ${cp.length ? `<ul class="breve">${cp.map((c) => `<li class="${c.tipo}"><span class="ic">${icona[c.tipo]}</span><div><b>${h(c.breve)}</b><div class="small">${h(c.testo)}</div></div></li>`).join("")}</ul>`
        : `<p class="small mut">${o.mia ? "Per la tua CTE controlla sconti e penali sul documento." : "Nessuno sconto, vincolo o condizione particolare dichiarati al Portale."}</p>`}
      ${sp.totApplicati > 0.005 ? `<div class="tot-sconti">Sconti già inclusi nel totale: <b>−${eur(sp.totApplicati)}</b></div>` : ""}
    </section>
    ${richiedeInternet(o) ? boxInternetEnergia(o, tot) : ""}
    ${o.stg ? "" : `<section class="sez"><h3>Chi è il fornitore</h3>
      <p class="small">${o.mia ? "Offerta inserita da te." : h(ETICHETTE[o.cat || "piccolo"].testo)}</p>
      ${o.mia ? "" : `<div class="row"><a class="btn sec" href="${rec.trustpilot}" target="_blank" rel="noopener">★ Recensioni Trustpilot</a><a class="btn sec" href="${rec.google}" target="_blank" rel="noopener">Recensioni Google</a></div>
      <details class="small"><summary>Perché potrei scegliere un fornitore poco conosciuto?</summary>
        <p>Cambiando venditore non cambiano contatore, rete e qualità della corrente: li gestisce sempre il distributore della tua zona.
        Hai 14 giorni per ripensarci dopo la firma. Se un venditore smette di operare, la fornitura non si interrompe: passi in automatico a un servizio di ultima istanza finché non scegli un altro fornitore.</p>
        <p>Quello che cambia è il servizio: assistenza, puntualità e chiarezza delle bollette, gestione dei conguagli e delle nuove condizioni a scadenza. Per questo conviene leggere le recensioni recenti, verificare che il venditore abbia un numero e una sede raggiungibili, e conservare la CTE firmata.</p></details>`}
    </section>`}
    ${o.mia ? "" : `<button class="btn ${S.seguite.some((x) => x.id === o.id) ? "" : "sec"} full" id="segui">${S.seguite.some((x) => x.id === o.id) ? "★ Segui questa offerta (attivo)" : "☆ Segui questa offerta: avvisami se cambia"}</button>`}
    <nav class="jump"><a href="#s-sconti">Sconti e penali</a><a href="#s-prezzi">Prezzi</a><a href="#s-info">Condizioni</a><a href="#s-calc">Bolletta su misura</a><a href="#s-mesi">12 bollette</a></nav>`;
  if (avvisi.length) html += `<div class="warn small"><b>Da sapere</b><ul>${avvisi.map((x) => `<li>${h(x)}</li>`).join("")}</ul></div>`;
  html += sezioneScontiPenali(o, sp);
  html += schedaOfferta(o);
  const L = o.forn === "LUCE";
  html += `<section class="sez" id="s-calc"><h3>Bolletta su misura</h3>
    <div class="small mut">Periodo e consumo di una tua bolletta: calcolo tutte le voci con questa offerta.</div>
    <div class="row"><div><label>Dal</label><input type="date" id="bDal" value="${u.ingresso}-01"></div><div><label>Al</label><input type="date" id="bAl"></div></div>
    <label>Consumo totale (${unita})</label><input inputmode="decimal" id="bQ" placeholder="es. ${L ? "800" : "120"}">
    ${L ? `<details><summary class="small">Consumo per fascia (facoltativo)</summary><div class="row">${["F1", "F2", "F3"].map((f) => `<div><label>${f} kWh</label><input inputmode="decimal" data-bf="${f}"></div>`).join("")}</div></details>` : ""}
    <button class="btn full" id="bCalc" style="margin-top:10px">Calcola la bolletta</button><div id="bRis"></div></section>
    <section class="sez" id="s-mesi"><h3>Le 12 bollette mese per mese</h3>`;
  html += mesi.map((m, i) => `<details class="m" ${i === 0 ? "open" : ""}><summary><span>${m.etichetta} ${badge(m.simulato ? "SIMULATO" : "REALE")}</span>
      <span class="num">${eur(m.risultato.totale)}</span></summary><div>
      <div class="small mut" style="margin-bottom:6px">Consumo ${nf(m.consumo, 1)} ${unita} · ${m.periodo.giorni} giorni · ${i === 0 ? "prima bolletta" : `mese ${i + 1} di fornitura`}</div>
      ${tabellaVoci(m.risultato)}${tabellaApplicati(m.applicati)}
    </div></details>`).join("");
  html += `<button class="btn full" id="pdfBoll" style="margin-top:12px">Esporta le 12 bollette in PDF</button></section>`;
  $("#vista").innerHTML = html;
  window.scrollTo(0, 0);
  const d = new Date(`${u.ingresso}-01T00:00:00Z`); const f = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  $("#bAl").value = f.toISOString().slice(0, 10);
  $("#segui") && ($("#segui").onclick = () => { segui(o); toast(S.seguite.some((x) => x.id === o.id) ? "Ti avviso se cambia prezzo o scade" : "Non segui più questa offerta"); vistaDettaglio(id, scenario); });
  $("#indietro").onclick = () => vai(o.mia && !o.stg ? "cte" : S.daInternet ? "internet" : "offerte");
  S.daInternet = false;
  $("#boxNet") && ($("#boxNet").onclick = () => vai("internet"));
  $$("[data-net]").forEach((b) => (b.onclick = () => vistaDettaglioInternet(b.dataset.net)));
  $$(".jump a").forEach((a) => (a.onclick = (e) => { e.preventDefault(); $(a.getAttribute("href")).scrollIntoView({ behavior: "smooth", block: "start" }); }));
  $$(".vaiProf").forEach((a) => (a.onclick = (e) => { e.preventDefault(); vai("profilo"); }));
  $$("[data-sc]").forEach((b) => (b.onclick = () => vistaDettaglio(id, b.dataset.sc)));
  $("#pdfBoll").onclick = () => esegui(() => pdfBollette(o, ris, scenario, u, S.dati), "bollette");
  $("#bCalc").onclick = () => {
    const dal = $("#bDal").value, al = $("#bAl").value;
    let q = pnum($("#bQ").value);
    let fasce = null;
    if (L) {
      const fv = Object.fromEntries($$("[data-bf]").map((i) => [i.dataset.bf, pnum(i.value)]));
      if (["F1", "F2", "F3"].every((k) => fv[k] != null && !Number.isNaN(fv[k]))) { fasce = fv; q = fv.F1 + fv.F2 + fv.F3; }
    }
    if (!dal || !al || al < dal) { toast("Controlla le date"); return; }
    if (q == null || Number.isNaN(q) || q < 0) { toast("Scrivi il consumo"); return; }
    const b = bollettaPersonalizzata(o, u, ctx, L ? { dal, al, kwh: q, fasce } : { dal, al, smc: q }, scenario);
    $("#bRis").innerHTML = `<div class="small mut" style="margin:10px 0 6px">${b.periodo.giorni} giorni · ${nf(q, 1)} ${unita} · costo vero ${nf((b.risultato.totale - b.risultato.gruppo("altro")) / (q || 1), 4)} €/${unita}</div>
      ${tabellaVoci(b.risultato)}${tabellaApplicati(b.applicati)}`;
  };
}

async function esegui(fn, nome) {
  try { toast(`Preparo il PDF ${nome}…`); await fn(); } catch (e) { console.error(e); toast("Errore nell'esportazione: " + e.message, 4000); }
}

// ------------------------------------------------------------------ AVVISI E STORICO
// Dopo ogni aggiornamento delle offerte: registra la migliore del giorno e controlla soglia di risparmio,
// offerte seguite (prezzo cambiato, scadenza vicina, non più in vendita).
function notifica(testo, tipo = "info", rif = null) {
  S.notifiche.unshift({ id: uid(), data: oggiIso(), testo, tipo, rif, letta: false });
  S.notifiche = S.notifiche.slice(0, 40);
}
function registraGiorno() {
  if (!S.catalogo) return;
  const giorno = S.catalogo.data, u = U(), voce = { data: giorno };
  for (const forn of ["LUCE", "GAS"]) {
    if (!(forn === "LUCE" ? u.luce.attiva : u.gas.attiva)) continue;
    const R = calcolaClassifica(forn);
    const best = R.lista.find((x) => !x.offerta.mia);
    const rif = R.lista.find((x) => x.offerta.attuale) || R.lista.find((x) => x.offerta.stg);
    if (!best) continue;
    voce[forn] = { tot: Math.round(best.centrale), id: best.offerta.id, nome: best.offerta.nome, venditore: best.offerta.venditore,
      rif: rif ? Math.round(rif.centrale) : null };
    // soglia di risparmio
    const prec = S.storico.filter((x) => x.data < giorno).at(-1)?.[forn];
    if (S.avvisi.attivi && rif && rif.centrale - best.centrale >= S.avvisi.soglia &&
      (!prec || prec.id !== best.offerta.id || (prec.rif ?? 0) - prec.tot + 20 <= rif.centrale - best.centrale)) {
      notifica(`${forn === "LUCE" ? "Luce" : "Gas"}: ${best.offerta.venditore} — ${best.offerta.nome} ti fa risparmiare ${eur(rif.centrale - best.centrale, 0)} all'anno rispetto ${rif.offerta.attuale ? "alla tua offerta attuale" : "alle Tutele Graduali"}.`, "risparmio", best.offerta.id);
    }
  }
  // offerte seguite
  const perId = new Map(S.catalogo.offerte.map((o) => [o.id, o]));
  for (const f of S.seguite) {
    const o = perId.get(f.id);
    if (!o) { if (!f.sparita) { notifica(`«${f.nome}» di ${f.venditore} non è più in vendita.`, "attenzione"); f.sparita = true; } continue; }
    f.sparita = false;
    const prezzo = descrizionePrezzo(o);
    let tot = null;
    try { tot = Math.round(totaleMesi(simulaOfferta(o, u, CTX()))); } catch { /* offerta non calcolabile */ }
    if (f.prezzo && prezzo !== f.prezzo) notifica(`«${f.nome}» ha cambiato prezzo: prima ${f.prezzo}, ora ${prezzo}${tot && f.tot ? ` (12 bollette: da ${eur(f.tot, 0)} a ${eur(tot, 0)})` : ""}.`, "attenzione", o.id);
    const sc = scadenza(o, oggiIso());
    if (sc && sc.giorni >= 0 && sc.giorni <= 3 && f.avvisoScadenza !== o.al) { notifica(`«${f.nome}» si può sottoscrivere solo fino al ${dataIt(o.al)}.`, "attenzione", o.id); f.avvisoScadenza = o.al; }
    Object.assign(f, { prezzo, tot: tot ?? f.tot, storico: [...(f.storico || []).filter((x) => x.data !== giorno), { data: giorno, tot }].slice(-90) });
  }
  S.storico = [...S.storico.filter((x) => x.data !== giorno), voce].sort((a, b) => a.data.localeCompare(b.data)).slice(-180);
  salva();
}
function segui(o) {
  if (S.seguite.some((x) => x.id === o.id)) S.seguite = S.seguite.filter((x) => x.id !== o.id);
  else {
    let tot = null;
    try { tot = Math.round(totaleMesi(simulaOfferta(o, U(), CTX()))); } catch { /* */ }
    S.seguite.push({ id: o.id, forn: o.forn, nome: o.nome, venditore: o.venditore, prezzo: descrizionePrezzo(o), tot, storico: [{ data: S.catalogo.data, tot }] });
  }
  salva();
}
function bannerNotifiche() {
  const n = S.notifiche.filter((x) => !x.letta);
  if (!n.length) return "";
  return `<section class="notif"><div class="row sp"><b>🔔 ${n.length} avvis${n.length > 1 ? "i" : "o"}</b><button class="btn ghost mini" id="notLette">Segna come letti</button></div>
    ${n.slice(0, 5).map((x) => `<div class="nrow ${x.tipo}" ${x.rif ? `data-det="${h(x.rif)}" role="button"` : ""}>${h(x.testo)}<span class="mut"> · ${dataIt(x.data)}</span></div>`).join("")}</section>`;
}
/** Barre semplici: andamento di una serie [{data, valore}]. */
function andamento(serie, un = "€") {
  const v = serie.filter((x) => x.valore != null);
  if (v.length < 2) return `<p class="small mut">Serve almeno un altro giorno di dati: si riempie a ogni aggiornamento delle offerte.</p>`;
  const max = Math.max(...v.map((x) => x.valore)), min = Math.min(...v.map((x) => x.valore));
  return `<div class="spark">${v.map((x) => `<div title="${dataIt(x.data)}: ${eur(x.valore, 0)}" style="height:${12 + 48 * (max === min ? 0.5 : (x.valore - min) / (max - min))}px"></div>`).join("")}</div>
    <div class="row sp small mut"><span>${dataIt(v[0].data)}: ${eur(v[0].valore, 0)}</span><span>${dataIt(v.at(-1).data)}: ${eur(v.at(-1).valore, 0)}</span></div>`;
}
function sezioneAvvisi() {
  const st = S.storico;
  let html = `<h2>Avvisi</h2><div class="card small">
    <label class="sw"><span>Avvisami quando un'offerta mi fa risparmiare almeno</span><input type="checkbox" id="avAtt" ${S.avvisi.attivi ? "checked" : ""}></label>
    <div class="row"><input inputmode="numeric" id="avSoglia" value="${S.avvisi.soglia}" style="max-width:110px"><span>€ all'anno rispetto alla mia offerta attuale (o alle Tutele Graduali, per la luce)</span></div>
    <p class="mut">Il controllo avviene ogni giorno quando apri l'app e si scaricano le offerte. Per seguire un'offerta tocca ★ nel suo dettaglio: ti avviso se cambia prezzo, se sta per scadere o se esce dal mercato.</p>
    ${S.seguite.length ? `<div class="sub-h">Offerte che segui</div>${S.seguite.map((f) => `<div class="row sp" style="margin:4px 0"><span>${h(f.venditore)} — ${h(f.nome)}${f.sparita ? " <b class=\"bad\">(non più in vendita)</b>" : ""}</span><span class="num">${f.tot ? eur(f.tot, 0) : ""}</span></div>`).join("")}` : ""}
  </div>`;
  if (st.length) {
    html += `<h2>Andamento della migliore offerta</h2><div class="card small">`;
    for (const forn of ["LUCE", "GAS"]) {
      const serie = st.map((x) => ({ data: x.data, valore: x[forn]?.tot }));
      if (!serie.some((x) => x.valore != null)) continue;
      html += `<div class="sub-h">${forn === "LUCE" ? "Luce" : "Gas"} — totale 12 bollette</div>${andamento(serie)}`;
    }
    html += `</div>`;
  }
  return html;
}
function eventiAvvisi() {
  $("#avAtt") && ($("#avAtt").onchange = (e) => { S.avvisi.attivi = e.target.checked; salva(); });
  $("#avSoglia") && ($("#avSoglia").onchange = (e) => { const v = pnum(e.target.value); if (v > 0) { S.avvisi.soglia = v; salva(); } });
}

// ------------------------------------------------------------------ LA TUA BOLLETTA
const FORN_NOME = { LUCE: "Luce", GAS: "Gas" };
/** Offerta attuale dell'utente (dalla bolletta): oggetto offerta pronto per il motore, o null. */
function offertaAttuale(forn) {
  const a = S.attuale[forn];
  if (!a) return null;
  let o = null;
  if (a.tipo === "stg") o = stgUtente(CTX());
  else if (a.tipo === "catalogo") o = a.offerta;
  else if (a.tipo === "cte") { const c = S.cte.find((x) => x.id === a.id); o = c && cteCompleta(c) ? daCte(c) : null; }
  return o ? { ...o, id: "ATTUALE-" + forn, mia: true, attuale: true } : null;
}
function cercaOffertaDaBolletta(b) {
  const tutte = S.catalogo?.offerte || [];
  if (b.codice) { const o = tutte.find((x) => x.id.toUpperCase() === b.codice); if (o) return { tipo: "catalogo", offerta: o, come: "codice offerta" }; }
  if (b.forn === "LUCE" && b.stg) return { tipo: "stg", come: "bolletta del Servizio a Tutele Graduali" };
  if (b.nomeOfferta) {
    const q = b.nomeOfferta.toLowerCase();
    const o = tutte.find((x) => x.forn === b.forn && x.nome.toLowerCase() === q);
    if (o) return { tipo: "catalogo", offerta: o, come: "nome dell'offerta" };
  }
  return null;
}

let esitiBollette = [];
$("#fileBolletta").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length) return;
  $("#titolo").textContent = "Lettura bollette";
  $("#vista").innerHTML = `<div class="empty"><span class="spin"></span><p>Leggo ${files.length} bollett${files.length > 1 ? "e" : "a"}…</p></div>`;
  esitiBollette = [];
  for (const f of files) {
    try {
      const testo = await testoPdf(f, pdfjs);
      const an = analizzaBolletta(testo, COMUNI);
      if (!an.tipo) { esitiBollette.push({ file: f.name, illeggibile: true, avvisi: an.avvisi }); continue; }
      const c = an.campi, v = (k) => c[k]?.valore;
      const b = { id: uid(), file: f.name, forn: an.tipo, dal: v("periodo")?.dal, al: v("periodo")?.al, consumo: v("consumoPeriodo"),
        fasce: an.tipo === "LUCE" && v("F1") != null ? { F1: v("F1"), F2: v("F2") || 0, F3: v("F3") || 0 } : null,
        annuo: v("consumoAnnuo"), potenza: v("potenza"), residente: v("residente"), comune: v("comune"), canone: v("canoneRai") != null,
        uso: v("uso"), totale: v("totale"), spesaAnnua: v("spesaAnnua"), codice: v("codiceOfferta"), nomeOfferta: v("nomeOfferta"), pod: v("pod"),
        stg: /tutel[ae]\s+graduali|\bSTG\b/i.test(testo) };
      esitiBollette.push({ file: f.name, b, campi: c, avvisi: an.avvisi, offerta: cercaOffertaDaBolletta(b) });
    } catch (err) { console.error(err); esitiBollette.push({ file: f.name, illeggibile: true, avvisi: [err.message] }); }
  }
  vistaBolletteLette();
});

const ETICH_CAMPI = { consumoAnnuo: "Consumo annuo", periodo: "Periodo", consumoPeriodo: "Consumo nel periodo", F1: "F1", F2: "F2", F3: "F3",
  potenza: "Potenza impegnata", residente: "Residenza", comune: "Comune di fornitura", canoneRai: "Canone RAI", uso: "Uso del gas",
  totale: "Totale bolletta", spesaAnnua: "Spesa degli ultimi 12 mesi", codiceOfferta: "Codice offerta", nomeOfferta: "Offerta", pod: "POD / PDR" };
function valoreCampo(k, v, forn) {
  const un = forn === "LUCE" ? "kWh" : "Smc";
  if (k === "periodo") return `${dataIt(v.dal)} – ${dataIt(v.al)}`;
  if (k === "comune") return `${v.nome} (${v.sigla})`;
  if (k === "residente") return v ? "residente" : "non residente";
  if (k === "canoneRai") return v === true ? "presente" : eur(v);
  if (["totale", "spesaAnnua"].includes(k)) return eur(v);
  if (["consumoAnnuo", "consumoPeriodo", "F1", "F2", "F3"].includes(k)) return `${nf(v, 2)} ${un}`;
  if (k === "potenza") return `${nf(v)} kW`;
  if (k === "uso") return { cottura: "cucina e acqua calda", riscaldamento: "riscaldamento", entrambi: "riscaldamento, cucina e acqua calda" }[v];
  return String(v);
}

function vistaBolletteLette() {
  $("#titolo").textContent = "Bollette lette";
  let html = `<p class="small mut" style="margin-top:0">Controlla i dati letti: accanto a ognuno c'è la frase della bolletta da cui l'ho preso.</p>`;
  for (const [i, es] of esitiBollette.entries()) {
    if (es.illeggibile) { html += `<div class="card"><b>✕ ${h(es.file)}</b><div class="small mut">${h(es.avvisi?.[0] || "Non riesco a leggere questo PDF.")}</div></div>`; continue; }
    const b = es.b;
    html += `<section class="sez"><h3>${FORN_NOME[b.forn]} · ${h(es.file)}</h3><table class="lista">${Object.keys(ETICH_CAMPI).filter((k) => es.campi[k]).map((k) =>
      `<tr><td>${ETICH_CAMPI[k]}<div class="frase">${h(es.campi[k].frase)}</div></td><td class="r num">${h(valoreCampo(k, es.campi[k].valore, b.forn))}</td></tr>`).join("")}</table>
      ${es.avvisi.length ? `<div class="warn small"><ul>${es.avvisi.map((a) => `<li>${h(a)}</li>`).join("")}</ul></div>` : ""}
      <div class="sub-h">La tua offerta attuale</div>
      ${es.offerta ? `<p class="small">✓ Trovata (${h(es.offerta.come)}): <b>${h(es.offerta.tipo === "stg" ? "Servizio a Tutele Graduali" : `${es.offerta.offerta.venditore} — ${es.offerta.offerta.nome}`)}</b>. La metto in classifica come «la tua offerta».</p>`
        : `<p class="small">Non la trovo nel catalogo di oggi${b.codice ? ` (codice ${h(b.codice)})` : ""}: probabilmente non è più in vendita. Per confrontarla carica la sua CTE o inserisci prezzo e quota fissa.</p>
          <button class="btn sec mini" data-cte-att="${i}">Inserisci i prezzi della tua offerta</button>`}
    </section>`;
  }
  const valide = esitiBollette.filter((x) => !x.illeggibile);
  if (valide.length) html += `<label class="sw card"><span><b>Aggiorna il mio profilo</b> con consumi, potenza, comune e residenza letti</span><input type="checkbox" id="bApplica" checked></label>`;
  html += `<button class="btn full" id="bFine">Salva e confronta</button>`;
  $("#vista").innerHTML = html;
  window.scrollTo(0, 0);
  const salvaTutto = () => {
    for (const es of valide) {
      S.bollette = S.bollette.filter((x) => !(x.forn === es.b.forn && x.dal === es.b.dal && x.al === es.b.al));
      S.bollette.push(es.b);
      if (es.offerta) S.attuale[es.b.forn] = es.offerta.tipo === "stg" ? { tipo: "stg" } : { tipo: "catalogo", offerta: es.offerta.offerta, codice: es.b.codice };
    }
    if ($("#bApplica")?.checked) applicaBolletteAlProfilo();
    salva(); cache.clear();
  };
  $$("[data-cte-att]").forEach((btn) => (btn.onclick = () => {
    salvaTutto();
    const es = esitiBollette[Number(btn.dataset.cteAtt)];
    const o = nuovaCte(es.b.forn);
    Object.assign(o, { nome: es.b.nomeOfferta || "La mia offerta attuale", fonte: `bolletta ${es.file}`, attuale: true });
    editor(o);
  }));
  $("#bFine").onclick = () => { salvaTutto(); toast("Bollette salvate"); vai("offerte"); };
}

/** Porta nel profilo i dati delle bollette (le più recenti hanno la precedenza). */
function applicaBolletteAlProfilo() {
  const u = S.utenza;
  for (const forn of ["LUCE", "GAS"]) {
    const bb = S.bollette.filter((b) => b.forn === forn).sort((a, b) => (a.al || "").localeCompare(b.al || ""));
    if (!bb.length) continue;
    const ult = bb.at(-1), s = forn === "LUCE" ? u.luce : u.gas;
    s.attiva = true;
    const annuo = [...bb].reverse().find((b) => b.annuo > 0)?.annuo;
    if (annuo) s.annuo = annuo;
    const com = [...bb].reverse().find((b) => b.comune)?.comune;
    if (com) { u.comune = com; if (forn === "GAS" || !u.gas.zona) u.gas.zona = S.dati.regolate.regioni[com.regione]?.zona_climatica_capoluogo || u.gas.zona; }
    if (forn === "LUCE") {
      if (ult.potenza) s.potenzaKw = ult.potenza;
      if (ult.residente != null) u.residente = ult.residente;
      if (bb.some((b) => b.canone)) s.canoneRai = true;
      const conF = bb.filter((b) => b.fasce && b.fasce.F1 + b.fasce.F2 + b.fasce.F3 > 0);
      if (conF.length) {
        const t = conF.reduce((a, b) => ({ F1: a.F1 + b.fasce.F1, F2: a.F2 + b.fasce.F2, F3: a.F3 + b.fasce.F3 }), { F1: 0, F2: 0, F3: 0 });
        const tot = t.F1 + t.F2 + t.F3;
        s.ripartizione = { F1: t.F1 / tot, F2: t.F2 / tot, F3: t.F3 / tot };
      }
    } else if (ult.uso) s.uso = ult.uso;
    // consumi mese per mese: i mesi coperti dalle bollette, gli altri stimati e riproporzionati sul consumo annuo
    const r = consumiDaBollette(bb);
    if (r && r.coperti >= 3) {
      const stima = consumiMensili({ ...U(), luce: { ...u.luce, mesi: null }, gas: { ...u.gas, mesi: null } }, forn, S.dati.regolate);
      const mesi = {};
      for (let m = 1; m <= 12; m++) mesi[m] = r.mesi[m] ?? Math.round(stima[m] * 10) / 10;
      s.mesi = mesi;
      if (r.coperti === 12) s.annuo = Object.values(mesi).reduce((a, b) => a + b, 0);
    }
  }
}

function sezioneBollette() {
  const righe = [...S.bollette].sort((a, b) => (b.al || "").localeCompare(a.al || ""));
  let html = `<section class="sez"><h3>La tua bolletta</h3>
    <p class="small mut" style="margin-top:0">Carica una o più bollette in PDF: leggo consumi, potenza, comune e la tua offerta attuale, e ti dico quanto risparmi davvero cambiando.</p>
    <button class="btn full" id="addBoll">📄 Carica bollette (PDF)</button>`;
  for (const forn of ["LUCE", "GAS"]) {
    const a = S.attuale[forn], o = offertaAttuale(forn);
    if (!a) continue;
    html += `<div class="row sp small" style="margin-top:10px"><span>${FORN_NOME[forn]}: <b>${h(o ? (o.stg ? "Tutele Graduali (STG)" : `${o.venditore} — ${o.nome}`) : "offerta non più disponibile")}</b></span>
      <button class="btn ghost mini" data-via-att="${forn}">Togli</button></div>`;
  }
  if (righe.length) html += `<details class="small" style="margin-top:8px"><summary>${righe.length} bollett${righe.length > 1 ? "e" : "a"} salvat${righe.length > 1 ? "e" : "a"}</summary>
    <table class="lista">${righe.map((b) => `<tr><td>${FORN_NOME[b.forn]} ${b.dal ? `${dataIt(b.dal)} – ${dataIt(b.al)}` : h(b.file)}<div class="frase">${b.consumo != null ? nf(b.consumo, 1) + (b.forn === "LUCE" ? " kWh" : " Smc") : ""}${b.totale != null ? " · " + eur(b.totale) : ""}</div></td>
      <td class="r"><button class="btn del mini" data-del-boll="${b.id}">Elimina</button></td></tr>`).join("")}</table></details>`;
  return html + `</section>`;
}
function eventiBollette() {
  $("#addBoll").onclick = () => $("#fileBolletta").click();
  $$("[data-via-att]").forEach((b) => (b.onclick = () => { delete S.attuale[b.dataset.viaAtt]; salva(); cache.clear(); vistaCte(); }));
  $$("[data-del-boll]").forEach((b) => (b.onclick = () => { S.bollette = S.bollette.filter((x) => x.id !== b.dataset.delBoll); salva(); vistaCte(); }));
}

// ------------------------------------------------------------------ LE MIE CTE
function cteCompleta(o) {
  const ok = (v) => typeof v === "number" && Number.isFinite(v);
  if (!ok(o.quotaFissaAnnua)) return false;
  if (o.fornitura === "LUCE") return Object.keys(o.prezzi || {}).length > 0 && Object.values(o.prezzi).every(ok);
  return ok(o.prezzoSmc);
}
const descrCte = (o) => descrizionePrezzo(daCte(o));

function vistaCte() {
  const v = $("#vista");
  let html = sezioneBollette() + `<h2>Le CTE</h2><p class="small mut" style="margin-top:0">Hai una CTE che non trovi nell'elenco, o vuoi confrontare la tua offerta attuale?
    Caricala: la confronto con tutte le offerte del Portale, con le stesse regole e gli stessi consumi.</p>
    <div class="row"><button class="btn" id="addPdf">📄 Carica CTE (PDF)</button><button class="btn sec" id="addMan">Inserisci a mano</button></div>
    <p class="small mut">Puoi selezionare più PDF insieme. Il PDF viene letto sul telefono, senza inviarlo a nessuno.</p>`;
  for (const tipo of ["LUCE", "GAS"]) {
    const lista = S.cte.filter((o) => o.fornitura === tipo);
    if (!lista.length) continue;
    const R = S.catalogo ? calcolaClassifica(tipo) : null;
    html += `<h2>${tipo === "LUCE" ? "Luce" : "Gas"}</h2>`;
    for (const o of lista) {
      const ok = cteCompleta(o);
      const pos = R ? R.lista.findIndex((r) => r.offerta.id === o.id) : -1;
      const r = pos >= 0 ? R.lista[pos] : null;
      html += `<div class="card"><div class="row sp"><div class="grow"><b>${h(o.fornitore || "—")}</b>
          <div class="small">${h(o.nome)}</div><div class="small mut">${ok ? h(descrCte(o)) : '<span style="color:var(--bad)">Dati incompleti: aprila per completarla</span>'}</div></div>
          <label class="sw" style="margin:0"><input type="checkbox" data-inc="${o.id}" ${o.incluso !== false ? "checked" : ""}></label></div>
        ${r ? `<div class="small" style="margin-top:6px"><b>${eur(r.centrale, 0)}</b> in 12 mesi · <b>${pos + 1}ª</b> su ${R.lista.length}
          ${pos === 0 ? badge("PIÙ CONVENIENTE", "best") : `· la migliore costa ${eur(r.centrale - R.lista[0].centrale, 0)} in meno: <a href="#" data-det="${h(R.lista[0].offerta.id)}">${h(R.lista[0].offerta.venditore)} ${h(R.lista[0].offerta.nome)}</a>`}</div>` : ""}
        <div class="row" style="margin-top:6px">${r ? `<button class="btn sec" data-vedi="${o.id}">Bollette</button>` : ""}<button class="btn sec" data-mod="${o.id}">Modifica</button>
          <button class="btn del" data-del="${o.id}">Elimina</button></div></div>`;
    }
  }
  if (!S.cte.length) html += `<div class="empty">Nessuna CTE caricata.</div>`;
  v.innerHTML = html;
  eventiBollette();
  $("#addPdf").onclick = () => $("#filePdf").click();
  $("#addMan").onclick = () => editor(nuovaCte("LUCE"));
  $$("[data-inc]").forEach((c) => (c.onchange = () => { S.cte.find((o) => o.id === c.dataset.inc).incluso = c.checked; salva(); cache.clear(); vistaCte(); }));
  $$("[data-mod]").forEach((b) => (b.onclick = () => editor(structuredClone(S.cte.find((o) => o.id === b.dataset.mod)))));
  $$("[data-vedi]").forEach((b) => (b.onclick = () => vistaDettaglio(b.dataset.vedi)));
  $$("a[data-det]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); vistaDettaglio(a.dataset.det); }));
  $$("[data-del]").forEach((b) => (b.onclick = () => {
    const o = S.cte.find((x) => x.id === b.dataset.del);
    if (confirm(`Eliminare "${o.nome}"?`)) { S.cte = S.cte.filter((x) => x.id !== o.id); salva(); cache.clear(); vistaCte(); }
  }));
}

function nuovaCte(fornitura) {
  return fornitura === "LUCE"
    ? { id: uid(), incluso: true, fornitura, fornitore: "", nome: "", fonte: "", tipoPrezzo: "fisso", prezzi: { F0: null },
      perdite: "nessuna", prezzoMax: null, cdispd: "arera", altriKwh: 0, quotaFissaAnnua: null, note: [] }
    : { id: uid(), incluso: true, fornitura, fornitore: "", nome: "", fonte: "", tipoPrezzo: "fisso", prezzoSmc: null,
      altriSmc: 0, quotaFissaAnnua: null, note: [] };
}

function cosaManca(o) {
  const m = [];
  const indic = o.tipoPrezzo === "indicizzato";
  if (o.fornitura === "LUCE") {
    for (const [k, v] of Object.entries(o.prezzi || {})) {
      if (v == null || Number.isNaN(v)) m.push({ campo: "p:" + k,
        domanda: `${indic ? "Maggiorazione sul PUN" : "Prezzo dell'energia"}${k === "F0" ? "" : " in fascia " + k.replace("F23", "F2-F3")} (€/kWh)`,
        aiuto: indic ? "Nella CTE: il numero dopo «PUN +» (spread) alla voce «Costo per consumi»." : "Nella CTE: voce «Costo per consumi» o «Prezzo energia»." });
    }
  } else if (o.prezzoSmc == null || Number.isNaN(o.prezzoSmc)) {
    m.push({ campo: "gas", domanda: `${indic ? "Maggiorazione sul PSV" : "Prezzo del gas"} (€/Smc)`,
      aiuto: indic ? "Nella CTE: il numero dopo «PSV +» alla voce «Costo per consumi»." : "Nella CTE: voce «Costo per consumi» o «Prezzo gas»." });
  }
  if (o.quotaFissaAnnua == null || Number.isNaN(o.quotaFissaAnnua)) {
    m.push({ campo: "quota", domanda: "Costo fisso (€ all'anno)", aiuto: "Nella CTE: «Costo fisso anno» o «Quota fissa». Se è indicata al mese, moltiplicala per 12." });
  }
  return m;
}

let esitiImport = [];
$("#filePdf").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length) return;
  $("#titolo").textContent = "Lettura CTE";
  $("#vista").innerHTML = `<div class="empty"><span class="spin"></span><p>Leggo ${files.length} CTE…</p></div>`;
  esitiImport = [];
  for (const f of files) {
    try {
      const an = analizza(await testoPdf(f, pdfjs));
      if (!an.tipo) { esitiImport.push({ file: f.name, illeggibile: true }); continue; }
      const off = { id: uid(), incluso: true, ...bozzaOfferta(an, f.name) };
      if (!off.nome) off.nome = f.name.replace(/\.pdf$/i, "");
      S.cte.push(off);
      esitiImport.push({ file: f.name, id: off.id });
    } catch (err) {
      console.error(err);
      esitiImport.push({ file: f.name, illeggibile: true });
    }
  }
  salva(); cache.clear();
  vistaImport();
});

function vistaImport() {
  $("#titolo").textContent = "CTE lette";
  let html = "";
  for (const es of esitiImport) {
    if (es.illeggibile) {
      html += `<div class="card"><b>✕ ${h(es.file)}</b><div class="small mut">Non riesco a leggere questo PDF: probabilmente è una scansione (un'immagine) o non è una CTE.</div></div>`;
      continue;
    }
    const o = S.cte.find((x) => x.id === es.id);
    if (!o) continue;
    const manca = cosaManca(o);
    const tipo = o.tipoPrezzo === "indicizzato" ? badge("VARIABILE", "var") : badge("PREZZO FISSO", "reale");
    html += `<div class="card"><div class="row sp"><b class="grow">${manca.length ? "⚠" : "✓"} ${h(o.fornitore || "Fornitore non indicato")}</b>
      <span>${o.fornitura === "LUCE" ? "Luce" : "Gas"} ${tipo}</span></div><div class="small">${h(o.nome)}</div>`;
    if (!manca.length) html += `<div class="small mut">${h(descrCte(o))}</div>`;
    else {
      html += `<div class="small" style="margin-top:6px">Nella CTE non ho trovato ${manca.length === 1 ? "questo dato" : "questi dati"}:</div>`;
      html += manca.map((m) => `<label>${h(m.domanda)}</label><input inputmode="decimal" data-manca="${o.id}|${m.campo}"><div class="frase">${h(m.aiuto)}</div>`).join("");
    }
    html += `</div>`;
  }
  html += `<button class="btn full" id="impFine">Vai al confronto</button>`;
  $("#vista").innerHTML = html;
  window.scrollTo(0, 0);
  $("#impFine").onclick = () => {
    for (const i of $$("[data-manca]")) {
      const v = pnum(i.value);
      if (v == null || Number.isNaN(v)) continue;
      const [id, campo] = i.dataset.manca.split("|");
      const o = S.cte.find((x) => x.id === id);
      if (campo === "quota") o.quotaFissaAnnua = v;
      else if (campo === "gas") o.prezzoSmc = v;
      else o.prezzi[campo.slice(2)] = v;
    }
    salva(); cache.clear();
    vai("cte");
  };
}

function editor(o) {
  $("#titolo").textContent = "Offerta";
  const luce = o.fornitura === "LUCE";
  const strutt = luce ? ("F0" in o.prezzi ? "F0" : "F23" in o.prezzi ? "F23" : "F123") : "";
  const indic = o.tipoPrezzo === "indicizzato";
  const fasce = { F0: ["F0"], F23: ["F1", "F23"], F123: ["F1", "F2", "F3"] }[strutt] || [];
  const campoPrezzo = (k) => `<label>${indic ? "Maggiorazione sul PUN" : "Prezzo"}${k === "F0" ? "" : " fascia " + k} (€/kWh)</label>
    <input inputmode="decimal" data-p="${k}" value="${h(nv(o.prezzi[k]))}">`;
  const altre = `<label>Note</label><textarea id="fNote" rows="3">${h((o.note || []).join("\n"))}</textarea>
      <label>Fonte</label><input id="fFonte" value="${h(o.fonte)}"></details>`;
  let html = `<div class="card">
    <div class="seg" id="fForn"><button data-v="LUCE" class="${luce ? "on" : ""}">Luce</button><button data-v="GAS" class="${!luce ? "on" : ""}">Gas</button></div>
    <label>Fornitore</label><input id="fFornitore" value="${h(o.fornitore)}">
    <label>Nome offerta</label><input id="fNome" value="${h(o.nome)}">
    <label>Tipo di prezzo</label>
    <div class="seg" id="fTipo"><button data-v="fisso" class="${!indic ? "on" : ""}">Fisso</button><button data-v="indicizzato" class="${indic ? "on" : ""}">Variabile (${luce ? "PUN" : "PSV"} + spread)</button></div>`;
  if (luce) {
    html += `<label>Fasce orarie</label><div class="seg" id="fStr">
      <button data-v="F0" class="${strutt === "F0" ? "on" : ""}">Monoraria</button><button data-v="F23" class="${strutt === "F23" ? "on" : ""}">Bioraria</button>
      <button data-v="F123" class="${strutt === "F123" ? "on" : ""}">Trioraria</button></div>
      ${fasce.map(campoPrezzo).join("")}
      <label>Costo fisso (€ all'anno)</label><input inputmode="decimal" id="fQuota" value="${h(nv(o.quotaFissaAnnua))}">
      <details style="margin-top:14px"><summary class="small"><b>Opzioni avanzate</b> — di solito non serve toccarle</summary>
      <label>Perdite di rete</label><select id="fPerdite">
        <option value="nessuna" ${o.perdite !== "tutto" ? "selected" : ""}>Già comprese nel prezzo (come chiede ARERA)</option>
        <option value="tutto" ${o.perdite === "tutto" ? "selected" : ""}>Fatturate a parte: kWh consumati + 10%</option></select>
      <label>Prezzo massimo €/kWh (se previsto)</label><input inputmode="decimal" id="fMax" value="${h(nv(o.prezzoMax))}">
      <div class="sw"><span>Dispacciamento standard ARERA (CDISPD)</span><input type="checkbox" id="fCd" ${o.cdispd === "arera" ? "checked" : ""}></div>
      <div id="fCdVal" ${o.cdispd === "arera" ? "hidden" : ""}><label>Dispacciamento €/kWh</label><input inputmode="decimal" id="fCdv" value="${o.cdispd === "arera" ? "" : h(nf(o.cdispd))}"></div>
      <label>Altri corrispettivi €/kWh (opzionale)</label><input inputmode="decimal" id="fAltri" value="${h(nv(o.altriKwh))}">${altre}`;
  } else {
    html += `<label>${indic ? "Maggiorazione sul PSV" : "Prezzo gas"} (€/Smc)</label><input inputmode="decimal" id="fPrezzoSmc" value="${h(nv(o.prezzoSmc))}">
      <label>Costo fisso (€ all'anno)</label><input inputmode="decimal" id="fQuota" value="${h(nv(o.quotaFissaAnnua))}">
      <details style="margin-top:14px"><summary class="small"><b>Opzioni avanzate</b> — di solito non serve toccarle</summary>
      <label>Altri corrispettivi €/Smc (es. CCR, QVD se non compresi)</label><input inputmode="decimal" id="fAltri" value="${h(nv(o.altriSmc))}">${altre}`;
  }
  html += `</div><div class="row"><button class="btn" id="fSalva">Salva</button><button class="btn sec" id="fAnnulla">Annulla</button></div>`;
  $("#vista").innerHTML = html;
  window.scrollTo(0, 0);
  const leggi = () => {
    o.fornitore = $("#fFornitore").value.trim(); o.nome = $("#fNome").value.trim(); o.fonte = $("#fFonte").value.trim();
    o.quotaFissaAnnua = pnum($("#fQuota").value);
    o.note = $("#fNote").value.split("\n").map((x) => x.trim()).filter(Boolean);
    if (o.fornitura === "LUCE") {
      $$("[data-p]").forEach((i) => (o.prezzi[i.dataset.p] = pnum(i.value)));
      o.perdite = $("#fPerdite").value; o.prezzoMax = pnum($("#fMax").value);
      o.cdispd = $("#fCd").checked ? "arera" : pnum($("#fCdv").value);
      o.altriKwh = pnum($("#fAltri").value) || 0;
    } else { o.prezzoSmc = pnum($("#fPrezzoSmc").value); o.altriSmc = pnum($("#fAltri").value) || 0; }
  };
  $$("#fForn button").forEach((b) => (b.onclick = () => {
    leggi();
    if (b.dataset.v !== o.fornitura) {
      const base = nuovaCte(b.dataset.v);
      Object.assign(o, { ...base, id: o.id, fornitore: o.fornitore, nome: o.nome, fonte: o.fonte, note: o.note, quotaFissaAnnua: o.quotaFissaAnnua, tipoPrezzo: o.tipoPrezzo });
      if (o.prezzi) delete o.prezzoSmc; else delete o.prezzi;
    }
    editor(o);
  }));
  $$("#fTipo button").forEach((b) => (b.onclick = () => { leggi(); o.tipoPrezzo = b.dataset.v; editor(o); }));
  $$("#fStr button").forEach((b) => (b.onclick = () => {
    leggi();
    const vecchi = o.prezzi;
    o.prezzi = Object.fromEntries({ F0: ["F0"], F23: ["F1", "F23"], F123: ["F1", "F2", "F3"] }[b.dataset.v].map((k) => [k, vecchi[k] ?? null]));
    editor(o);
  }));
  if (luce) $("#fCd").onchange = (e) => ($("#fCdVal").hidden = e.target.checked);
  $("#fAnnulla").onclick = () => vai("cte");
  $("#fSalva").onclick = () => {
    leggi();
    $$("input.err").forEach((i) => i.classList.remove("err"));
    const errati = [];
    const chk = (sel, v, opz = false) => { if ((v == null && !opz) || Number.isNaN(v)) errati.push(sel); };
    chk("#fQuota", o.quotaFissaAnnua);
    if (o.fornitura === "LUCE") {
      Object.entries(o.prezzi).forEach(([k, v]) => chk(`[data-p="${k}"]`, v));
      chk("#fMax", o.prezzoMax, true);
      if (o.cdispd !== "arera") chk("#fCdv", o.cdispd);
    } else chk("#fPrezzoSmc", o.prezzoSmc);
    if (!o.nome) o.nome = o.fornitore || "Offerta senza nome";
    if (errati.length) {
      errati.forEach((s) => $(s)?.classList.add("err"));
      $(errati[0])?.scrollIntoView({ block: "center" });
      toast("Completa i campi evidenziati");
      return;
    }
    const i = S.cte.findIndex((x) => x.id === o.id);
    delete o.esempio;
    if (i >= 0) S.cte[i] = o; else S.cte.push(o);
    if (o.attuale) { S.attuale[o.fornitura] = { tipo: "cte", id: o.id }; delete o.attuale; }
    salva(); cache.clear();
    toast("Offerta salvata");
    vai("cte");
  };
}

// ------------------------------------------------------------------ PROFILO
function vistaProfilo() {
  const u = structuredClone(S.utenza), R = S.dati.regolate;
  const ing = U().ingresso;
  const cl = consumiMensili(U(), "LUCE", R), cg = consumiMensili(U(), "GAS", R);
  const griglia = (vals, pref, mio) => `<div class="grid12">${MESI_NOMI.map((m, i) =>
    `<div><label>${m.slice(0, 3)}</label><input inputmode="decimal" data-${pref}="${i + 1}" value="${nf(vals[i + 1], 1)}" class="${mio ? "" : "tip"}"></div>`).join("")}</div>`;
  const mesiOpt = Array.from({ length: 13 }, (_, i) => { const d = new Date(oggi().getFullYear(), oggi().getMonth() + i, 1); return ymDi(d); });
  const zone = ["B", "C", "D", "E", "F"];
  $("#vista").innerHTML = `
  <section class="sez"><h3>I tuoi consumi reali</h3>
    <p class="small mut" style="margin-top:0">Il modo più preciso: scarica il file dei consumi dal <a href="https://www.consumienergia.it" target="_blank" rel="noopener">Portale Consumi ARERA</a>
      (accesso con SPID, sezione «I miei consumi» → scarica CSV) e caricalo qui. Con la luce a contatore elettronico ricavo anche la tua ripartizione F1/F2/F3 reale.
      Vanno bene anche i file di e-distribuzione e del distributore gas. Il file resta sul telefono.</p>
    <div class="row"><button class="btn sec" data-csv="LUCE">💡 File consumi luce</button><button class="btn sec" data-csv="GAS">🔥 File consumi gas</button></div>
    <div class="small mut" style="margin-top:6px">Oppure carica le bollette in «La mia offerta»: ricostruisco i consumi dai periodi fatturati.</div>
  </section>
  <div class="card"><h3>Dove e quando</h3>
    <label>Comune della fornitura</label><input id="pComune" value="${h(u.comune ? `${u.comune.nome} (${u.comune.sigla})` : "")}" autocomplete="off" placeholder="Scrivi il nome del comune">
    <div id="pSugg" class="sugg"></div>
    <div class="small mut">Serve per le offerte disponibili nella tua zona, le tariffe di rete del gas, l'addizionale regionale e la zona climatica.</div>
    <label>Passaggio al nuovo fornitore da</label><select id="pIng">${mesiOpt.map((m) => `<option value="${m}" ${m === ing ? "selected" : ""}>${meseIt(m)}</option>`).join("")}</select>
    <div class="small mut">Primo mese di fornitura con la nuova offerta. Di solito il cambio avviene dal primo giorno del mese successivo alla firma.</div>
    <label>Situazione</label><select id="pSit">${Object.entries(SITUAZIONI).map(([k, t]) => `<option value="${k}" ${u.situazione === k ? "selected" : ""}>${t}</option>`).join("")}</select>
    <div class="sw"><span>Abitazione di residenza</span><input type="checkbox" id="pRes" ${u.residente ? "checked" : ""}></div>
    <div class="sw"><span>Accetto la bolletta online / via email</span><input type="checkbox" id="pWeb" ${u.bollettaWeb ? "checked" : ""}></div>
    <div class="sw"><span>Pago con domiciliazione bancaria</span><input type="checkbox" id="pDom" ${u.domiciliazione ? "checked" : ""}></div>
    <div class="small mut">Molti sconti valgono solo con bolletta online o domiciliazione: se non li scegli, non li conto.</div></div>

  <div class="card"><div class="sw"><h3 style="margin:0">Luce</h3><input type="checkbox" id="lAtt" ${u.luce.attiva ? "checked" : ""}></div>
    <label>Consumo annuo (kWh)</label><input inputmode="decimal" id="lKwh" value="${nf(u.luce.annuo, 0)}">
    <div class="small mut">In bolletta: «consumo annuo». Se scrivi i mesi qui sotto, conta la loro somma.</div>
    <label>Potenza impegnata (kW)</label><select id="lKw">${[1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 9, 10, 15].map((k) => `<option value="${k}" ${k === u.luce.potenzaKw ? "selected" : ""}>${String(k).replace(".", ",")}</option>`).join("")}</select>
    <div class="sw"><span>Canone RAI in bolletta</span><input type="checkbox" id="lRai" ${u.luce.canoneRai ? "checked" : ""}></div>
    <div class="small mut" style="margin-top:8px">Ogni offerta luce è sempre confrontata con il Servizio a Tutele Graduali di ${h(gestoreSTG(u))}.</div>
    <label>Quota fissa STG (€ all'anno, facoltativa)</label><input inputmode="decimal" id="lStgQ" value="${h(nv(u.luce.stgQuota))}" placeholder="vuoto = ${nf(CTX().E.gamma, 2)} (valore ARERA in bolletta)">
    <div class="small mut">Lascia vuoto: il valore ARERA riproduce al centesimo la bolletta STG Hera. Cambialo solo se la tua bolletta STG riporta una quota fissa diversa (importo al mese × 12).</div>
    <label>Consumo per fascia (%)</label>
    <div class="row">${["F1", "F2", "F3"].map((f) => `<div><label style="margin:0">${f}</label><input inputmode="decimal" data-rip="${f}" value="${nf(u.luce.ripartizione[f] * 100, 1)}"></div>`).join("")}</div>
    <label>Consumi mese per mese (kWh) — ${u.luce.mesi ? "<b>i tuoi</b>" : "stimati dal consumo annuo"}</label>
    ${griglia(cl, "pl", !!u.luce.mesi)}
    <div class="row" style="margin-top:6px"><button class="btn sec mini" id="lReset">${u.luce.mesi ? "Torna alla stima dal consumo annuo" : "Modifica un mese e premi Salva"}</button></div></div>

  <div class="card"><div class="sw"><h3 style="margin:0">Gas</h3><input type="checkbox" id="gAtt" ${u.gas.attiva ? "checked" : ""}></div>
    <label>Consumo annuo (Smc)</label><input inputmode="decimal" id="gSmc" value="${nf(u.gas.annuo, 0)}">
    <label>Uso del gas</label><select id="gUso">
      <option value="cottura" ${u.gas.uso === "cottura" ? "selected" : ""}>Cucina e acqua calda</option>
      <option value="entrambi" ${u.gas.uso === "entrambi" ? "selected" : ""}>Riscaldamento, cucina e acqua calda</option>
      <option value="riscaldamento" ${u.gas.uso === "riscaldamento" ? "selected" : ""}>Solo riscaldamento</option></select>
    <label>Zona climatica</label><select id="gZona">${zone.map((z) => `<option ${z === u.gas.zona ? "selected" : ""}>${z}</option>`).join("")}</select>
    <div class="small mut">Decide come si distribuisce il riscaldamento nei mesi (profili ufficiali ARERA). Proposta in automatico dal comune.</div>
    <label>Consumi mese per mese (Smc) — ${u.gas.mesi ? "<b>i tuoi</b>" : "stimati dal consumo annuo"}</label>
    ${griglia(cg, "pg", !!u.gas.mesi)}
    <div class="row" style="margin-top:6px"><button class="btn sec mini" id="gReset">${u.gas.mesi ? "Torna alla stima dal consumo annuo" : "Modifica un mese e premi Salva"}</button></div></div>
  <button class="btn full" id="pSalva">Salva e ricalcola</button>`;

  $$("[data-csv]").forEach((b) => (b.onclick = () => { $("#fileCsv").dataset.forn = b.dataset.csv; $("#fileCsv").click(); }));
  let comune = u.comune;
  const sugg = $("#pSugg");
  $("#pComune").oninput = (e) => {
    const q = e.target.value.trim().toLowerCase().replace(/\s*\(.*$/, "");
    if (q.length < 2) { sugg.innerHTML = ""; return; }
    const r = COMUNI.filter((c) => c.nome.toLowerCase().startsWith(q)).slice(0, 8);
    sugg.innerHTML = r.map((c) => `<button data-istat="${c.istat}">${h(c.nome)} <span class="mut">(${c.sigla})</span></button>`).join("");
    $$("button", sugg).forEach((b) => (b.onclick = () => {
      comune = trovaComune(b.dataset.istat);
      $("#pComune").value = `${comune.nome} (${comune.sigla})`;
      $("#gZona").value = R.regioni[comune.regione]?.zona_climatica_capoluogo || "D";
      sugg.innerHTML = "";
    }));
  };
  const modificati = { pl: false, pg: false };
  $$("[data-pl]").forEach((i) => (i.oninput = () => { modificati.pl = true; i.classList.remove("tip"); }));
  $$("[data-pg]").forEach((i) => (i.oninput = () => { modificati.pg = true; i.classList.remove("tip"); }));
  $("#lReset").onclick = () => { if (S.utenza.luce.mesi) { S.utenza.luce.mesi = null; salva(); cache.clear(); vistaProfilo(); } };
  $("#gReset").onclick = () => { if (S.utenza.gas.mesi) { S.utenza.gas.mesi = null; salva(); cache.clear(); vistaProfilo(); } };
  $("#pSalva").onclick = () => {
    const err = [];
    const v = (sel, min = 0) => { const x = pnum($(sel).value); if (x == null || Number.isNaN(x) || x < min) err.push(sel); return x; };
    const mesi = (pref, gia) => {
      if (!modificati[pref] && !gia) return null;
      const vals = $$(`[data-${pref}]`).map((i) => pnum(i.value));
      if (vals.some((x) => x == null || Number.isNaN(x) || x < 0)) { err.push(`[data-${pref}]`); return null; }
      return Object.fromEntries(vals.map((x, i) => [i + 1, x]));
    };
    const rip = Object.fromEntries(["F1", "F2", "F3"].map((f) => [f, pnum($(`[data-rip="${f}"]`).value)]));
    const sr = rip.F1 + rip.F2 + rip.F3;
    if (!(sr > 0)) err.push("[data-rip]");
    if (!comune) err.push("#pComune");
    const n = {
      versione: 3, comune, residente: $("#pRes").checked, situazione: $("#pSit").value, ingresso: $("#pIng").value,
      bollettaWeb: $("#pWeb").checked, domiciliazione: $("#pDom").checked,
      luce: { attiva: $("#lAtt").checked, annuo: v("#lKwh", 1), potenzaKw: Number($("#lKw").value), canoneRai: $("#lRai").checked,
        stg: true, stgQuota: (() => { const x = pnum($("#lStgQ").value); return x == null || Number.isNaN(x) ? null : x; })(),
        ripartizione: { F1: rip.F1 / sr, F2: rip.F2 / sr, F3: rip.F3 / sr }, mesi: mesi("pl", !!u.luce.mesi) },
      gas: { attiva: $("#gAtt").checked, annuo: v("#gSmc", 0), uso: $("#gUso").value, zona: $("#gZona").value, mesi: mesi("pg", !!u.gas.mesi) },
    };
    $$(".err").forEach((i) => i.classList.remove("err"));
    if (err.length) { err.forEach((s) => $$(s).forEach((i) => i.classList.add("err"))); toast("Controlla i campi evidenziati"); return; }
    if (n.luce.mesi) n.luce.annuo = Object.values(n.luce.mesi).reduce((a, b) => a + b, 0);
    if (n.gas.mesi) n.gas.annuo = Object.values(n.gas.mesi).reduce((a, b) => a + b, 0);
    S.utenza = n; salva(); cache.clear(); toast("Profilo salvato"); vai("offerte");
  };
}

$("#fileCsv").addEventListener("change", async (e) => {
  const f = e.target.files[0], forn = e.target.dataset.forn || "LUCE";
  e.target.value = "";
  if (!f) return;
  let r;
  try { r = leggiConsumiCsv(await f.text(), forn); } catch (err) { r = { errore: err.message }; }
  const un = forn === "LUCE" ? "kWh" : "Smc";
  if (r.errore) {
    $("#vista").innerHTML = `<section class="sez"><h3>Non riesco a leggere il file</h3><p class="small">${h(r.errore)}</p>
      <p class="small mut">Se è il file del Portale Consumi, mandami le prime righe (senza il POD) e adatto il lettore.</p><button class="btn full" id="csvOk">Torna ai consumi</button></section>`;
    $("#csvOk").onclick = () => vai("profilo");
    return;
  }
  const x = ultimi12(r);
  const TIPI_CSV = { quartorario: "valori ogni 15 minuti", orario: "valori orari", giornaliero: "consumi giornalieri", mensile: "consumi mensili", letture: "letture del contatore" };
  $("#titolo").textContent = "Consumi letti";
  $("#vista").innerHTML = `<section class="sez"><h3>${forn === "LUCE" ? "💡 Luce" : "🔥 Gas"} · ${h(f.name)}</h3>
    <p class="small">Letti ${nf(r.righe, 0)} righe di ${TIPI_CSV[r.tipo]}, dal ${dataIt(r.dal)} al ${dataIt(r.al)}.</p>
    <table class="lista">${Object.entries(x.mesi).map(([m, v]) => `<tr><td>${MESI_NOMI[m - 1]}</td><td class="r num">${nf(v, 1)} ${un}</td></tr>`).join("")}
      <tr class="t"><td>Ultimi 12 mesi${x.mancanti.length ? ` (mancano ${x.mancanti.length})` : ""}</td><td class="r num">${nf(x.annuo, 0)} ${un}</td></tr></table>
    ${x.ripartizione ? `<p class="small">Ripartizione reale: F1 ${nf(x.ripartizione.F1 * 100, 1)}% · F2 ${nf(x.ripartizione.F2 * 100, 1)}% · F3 ${nf(x.ripartizione.F3 * 100, 1)}%</p>` : ""}
    ${x.mancanti.length ? `<p class="small mut">I mesi mancanti li stimo dal profilo tipico.</p>` : ""}
    <button class="btn full" id="csvUsa">Usa questi consumi</button><button class="btn ghost full" id="csvNo">Annulla</button></section>`;
  $("#csvNo").onclick = () => vai("profilo");
  $("#csvUsa").onclick = () => {
    const s = forn === "LUCE" ? S.utenza.luce : S.utenza.gas;
    const stima = consumiMensili({ ...U(), luce: { ...S.utenza.luce, mesi: null }, gas: { ...S.utenza.gas, mesi: null } }, forn, S.dati.regolate);
    s.mesi = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, x.mesi[i + 1] ?? Math.round(stima[i + 1] * 10) / 10]));
    s.annuo = Object.values(s.mesi).reduce((a, b) => a + b, 0);
    s.attiva = true;
    if (forn === "LUCE" && x.ripartizione) s.ripartizione = x.ripartizione;
    salva(); cache.clear(); toast("Consumi aggiornati"); vai("offerte");
  };
});

// ------------------------------------------------------------------ DATI
function vistaDati() {
  const d = S.dati, ind = d.indici, c = S.catalogo, ctx = CTX();
  const pun = Object.entries(ind.pun.mesi).sort().slice(-6);
  const psv = Object.entries(ind.psv.mesi).sort().slice(-6);
  const met = ind.metodo_simulazione;
  const nE = c ? c.offerte.filter((o) => o.forn === "LUCE").length : 0, nG = c ? c.offerte.length - nE : 0;
  $("#vista").innerHTML = `
  <div class="card"><b>Offerte del Portale Offerte ARERA</b>
    <table class="kv small"><tr><td>Offerte luce</td><td>${nE} (file del ${dataIt(c?.dataOfferte?.E)})</td></tr>
      <tr><td>Offerte gas</td><td>${nG} (file del ${dataIt(c?.dataOfferte?.G)})</td></tr>
      <tr><td>Parametri ARERA</td><td>luce ${dataIt(ctx.dataE)} · gas ${dataIt(ctx.dataG)}</td></tr>
      <tr><td>Ultimo download</td><td>${c?.scaricato ? new Date(c.scaricato).toLocaleString("it-IT") : "mai (elenco iniziale incluso nell'app)"}</td></tr></table>
    ${S.aggiornando ? `<div class="small" style="margin-top:8px"><span class="spin sm"></span> <span id="avanz">${h(S.avanzamento)}</span></div>`
      : `<button class="btn full" id="dAgg" style="margin-top:10px">Scarica le offerte di oggi</button>`}
    <label>Aggiornamento automatico</label>
    <div class="seg" id="dAuto"><button data-v="giorno" class="${S.auto === "giorno" ? "on" : ""}">Ogni giorno</button><button data-v="mai" class="${S.auto === "mai" ? "on" : ""}">Solo a mano</button></div>
    <div class="small mut" style="margin-top:6px">Ogni giorno, alla prima apertura, il telefono scarica dal Portale le offerte di tutti i venditori (circa 10 MB) e i parametri ARERA.
      Il Portale non accetta richieste dai server cloud: per questo il download lo fa il telefono.${nativo() ? "" : " Nel browser il download non è possibile: funziona nell'app Android."}</div></div>
  <div class="card small"><b>Versione dell'app: ${h(VERSIONE_WEB)}</b>
    <div class="mut">Si aggiorna da sola: all'apertura controlla se c'è una versione nuova e la installa in pochi secondi.</div>
    ${LS.get("errAgg", null) ? `<div class="avviso">Ultimo aggiornamento non riuscito (${new Date(LS.get("errAgg").data).toLocaleString("it-IT")}): ${h(LS.get("errAgg").msg)}</div>` : ""}
    ${apkNuovo ? `<div class="avviso">Questa volta serve installare il programma completo. <a class="btn mini" href="${h(apkNuovo)}">Scarica l'APK</a></div>` : ""}
    <button class="btn sec full" id="dVer" style="margin-top:8px">Controlla aggiornamenti</button></div>
  ${sezioneAvvisi()}
  <h2>PUN ultimi mesi <span class="mut small">€/kWh</span></h2><div class="card"><table><tr><th>Mese</th><th class="r">F0</th><th class="r">F1</th><th class="r">F2</th><th class="r">F3</th></tr>
    ${pun.map(([k, v]) => `<tr><td>${k}</td>${["F0", "F1", "F2", "F3"].map((f) => `<td class="r num">${nf(v[f], 4)}</td>`).join("")}</tr>`).join("")}</table></div>
  <h2>PSV ultimi mesi <span class="mut small">€/Smc</span></h2><div class="card"><table>
    ${psv.map(([k, v]) => `<tr><td>${k}</td><td class="r num">${nf(v, 4)}</td></tr>`).join("")}</table></div>
  <h2>Quanto sono affidabili i calcoli</h2><div class="card small"><ul style="padding-left:18px;margin:0">
    <li><b>Bollette vere</b>: l'app riproduce al centesimo tre bollette reali (Hera STG, Estra gas, Enel mercato libero).</li>
    <li><b>Tutte le offerte</b>: confrontata con un motore di calcolo indipendente, a sua volta verificato sul Portale Offerte, su 3.518 offerte:
      il 98-99% delle offerte luce coincide entro 1 € all'anno, quasi tutte le gas entro l'1%. Il confronto si ripete a ogni aggiornamento dell'app.</li>
    <li><b>Dove può sbagliare</b>: quando il venditore scrive male i dati sul Portale, o li scrive in modo ambiguo (sconti a tempo, sconti in percentuale):
      in quei casi l'app lo segnala in «Da sapere». Per le offerte variabili il futuro è una stima: guarda i tre scenari.</li>
    <li><b>Prima di firmare</b>: confronta prezzo e quota fissa con la CTE del venditore. Se i numeri della CTE sono diversi, conta la CTE.</li></ul></div>
  <h2>Da dove vengono i numeri</h2><div class="card small"><ul style="padding-left:18px;margin:0">
    <li><b>Offerte</b>: open data del Portale Offerte (ARERA e Acquirente Unico, licenza CC-BY), dove ogni venditore deve pubblicare tutte le sue offerte.</li>
    <li><b>Trasporto, oneri di sistema, dispacciamento, accisa luce, IVA</b>: parametri ARERA pubblicati ogni giorno dal Portale Offerte. Nei trimestri non ancora pubblicati restano gli ultimi valori ${badge("SIMULATO")}.</li>
    <li><b>Accisa e addizionale gas</b>: aliquote 2026 per regione. <b>CCR e PPE</b>: ${h(d.regolate.ccr.fonte)}.</li>
    <li><b>Regole di calcolo</b>: quelle del Portale Offerte (v4.0, 16/02/2026), applicate bolletta per bolletta. Verificate al centesimo su due offerte calcolate dal Portale e sulle tue bollette Hera, Estra ed Enel.</li>
    <li><b>PUN</b>: ${h(met.pun)}</li><li><b>PSV</b>: ${h(met.psv)}</li>
    <li><b>Scenari</b> delle offerte variabili: basso ×${met.scenari.basso}, alto ×${met.scenari.alto} sui soli valori simulati.</li></ul></div>`;
  $("#dAgg") && ($("#dAgg").onclick = () => { if (!nativo()) { toast("Il download funziona nell'app Android"); return; } aggiorna(true); vistaDati(); });
  $("#dVer") && ($("#dVer").onclick = () => aggiornaApp(true));
  eventiAvvisi();
  $$("#dAuto button").forEach((b) => (b.onclick = () => { S.auto = b.dataset.v; salva(); vistaDati(); }));
}

// ------------------------------------------------------------------ INTERNET CASA
// Catalogo curato a mano (data/internet.json, con fonte e data per offerta): non esiste un open data delle offerte telefoniche.
const NET_DEF = { tecnologia: "FTTH", mobile: "", energia: null, voce: false, cambioEnergia: true, minDown: 0, orizzonte: 24, mia: null };
S.net = { ...NET_DEF, ...LS.get("net", {}) };
const salvaNet = () => LS.set("net", S.net);
const OPERATORI_MOBILE = ["TIM", "Vodafone", "WINDTRE", "Iliad", "Fastweb"];
const FORN_ENERGIA_NET = [["eniplenitude.com", "Plenitude"], ["enel.it", "Enel"], ["irenlucegas.it", "Iren"], ["edisonenergia.it", "Edison"]];
const URL_COPERTURA = "https://www.agcom.it/mappatura-delle-reti-di-accesso-ad-internet";
const offerteNet = () => catalogoInternet.offerte;
/** Siti dei fornitori luce/gas che hai: dal profilo internet, altrimenti dalla tua offerta attuale. */
function sitiEnergia() {
  if (S.net.energia) return S.net.energia;
  return [...new Set(["LUCE", "GAS"].map((f) => offertaAttuale(f)?.sito).filter(Boolean))];
}
const profiloNet = (extra = {}) => ({ ...S.net, energia: sitiEnergia(), dueForniture: S.utenza.luce.attiva && S.utenza.gas.attiva, domiciliazione: S.utenza.domiciliazione !== false, ...extra });
const vel = (m) => (m == null ? "?" : m >= 1000 ? `${nf(m / 1000, m % 1000 ? 1 : 0)} Gbit/s` : `${m} Mbit/s`);
const tecnoTxt = (o) => o.tecnologie.map((t) => TECNO[t]?.breve || t).join(" / ");

function classificaNet() {
  const p = profiloNet(), N = S.net.orizzonte;
  const lista = classificaInternet(offerteNet(), p, N, oggiIso());
  let mia = null;
  if (S.net.mia?.canone > 0) { const o = offertaMia(S.net.mia); mia = { offerta: o, ...costoInternet(o, p, N, oggiIso()) }; }
  return { lista, mia, p, N };
}

/** Pacchetti luce/gas + internet dello stesso fornitore, contro la miglior energia + il miglior internet presi separatamente. */
function pacchettiEnergiaInternet(N) {
  if (!S.catalogo) return [];
  const u = U(), forn = ["LUCE", "GAS"].filter((f) => (f === "LUCE" ? u.luce.attiva : u.gas.attiva));
  const R = Object.fromEntries(forn.map((f) => [f, calcolaClassifica(f)]));
  const bestSep = Object.fromEntries(forn.map((f) => [f, R[f].lista.find((r) => !r.offerta.mia)]));
  const netSep = miglioreNet(classificaInternet(offerteNet(), profiloNet({ cambioEnergia: false }), N, oggiIso()));
  const out = [];
  for (const [sito, nome] of FORN_ENERGIA_NET) {
    const ener = {};
    const dedicate = offerteNet().some((o) => o.sito === sito && o.energia?.dedicate);
    for (const f of forn) {
      const cand = (dedicate ? R[f].conInternet : [...R[f].lista, ...R[f].conInternet]).filter((r) => r.offerta.sito === sito && !r.offerta.mia);
      ener[f] = cand.sort((a, b) => a.centrale - b.centrale)[0] || null;
    }
    if (!forn.some((f) => ener[f])) continue;
    const pi = profiloNet({ energia: [...new Set([...sitiEnergia(), sito])], cambioEnergia: true, dueForniture: forn.length === 2 && !!ener.LUCE && !!ener.GAS });
    const nets = classificaInternet(offerteNet().filter((o) => o.sito === sito), pi, N, oggiIso());
    const net = nets[0];
    if (!net) continue;
    // per le forniture che il fornitore non copre, resta la migliore separata
    const annuoPacchetto = forn.reduce((a, f) => a + ((ener[f] || bestSep[f])?.centrale || 0), 0);
    const annuoSep = forn.reduce((a, f) => a + (bestSep[f]?.centrale || 0), 0);
    const pacchetto = annuoPacchetto * N / 12 + net.totale;
    const separati = annuoSep * N / 12 + (netSep?.totale || 0);
    out.push({ sito, nome, ener, net, bestSep, netSep, pacchetto, separati, diff: pacchetto - separati, forn });
  }
  return out.sort((a, b) => a.diff - b.diff);
}

function cardNet(r, best, extra = "") {
  const o = r.offerta;
  const pills = [];
  if (r.fasi.length > 1) pills.push(`<span class="pill att">${h(descriviFasi(r.fasi))}</span>`);
  for (const x of r.applicati.filter((x) => x.richiede === "mobile" || x.richiede === "energia" || x.richiede === "energia2")) pills.push(`<span class="pill save">✓ −${eur(x.importo, 0)} ${x.richiede === "mobile" ? "col mobile" : "con luce/gas"}</span>`);
  if (o.energia?.obbligatoria) pills.push(`<span class="pill att">Richiede luce/gas ${h(o.operatore)}</span>`);
  if (o.vincolo > 0) pills.push(`<span class="pill bad">Vincolo ${o.vincolo} mesi</span>`);
  if ((o.rate || []).some((x) => x.a > 24)) pills.push(`<span class="pill bad">Rate fino a ${Math.max(...o.rate.map((x) => x.a))} mesi</span>`);
  if (o.fonteTipo === "comparatore") pills.push(`<span class="pill neutral">Fonte non ufficiale</span>`);
  if (r.scaduta) pills.push(`<span class="pill bad">Scaduta il ${dataIt(o.scade)}</span>`);
  else if (o.scade) pills.push(`<span class="pill neutral">Fino al ${dataIt(o.scade)}</span>`);
  return `<article class="offer ${o.mia ? "mia" : ""}" data-net="${h(o.id)}" role="button">
    <div class="row sp testa"><div class="min0"><div class="vend">${h(o.operatore)} ${o.mia ? badge("IL TUO ABBONAMENTO", "mia") : ""}</div><div class="nome">${h(o.nome)}</div></div>
      <div class="price"><div class="tot">${eur(r.medio, 2)}</div><div class="sub">al mese in media · ${eur(r.totale, 0)} in ${S.net.orizzonte} mesi</div></div></div>
    <div class="riga small mut">${tecnoTxt(o)} · ${vel(o.down)} · ${o.chiamate ? h(o.chiamate.replace(/\s*\(.*\)/, "")) : "chiamate: non indicato"}${best != null && !o.mia ? ` · ${r.totale > best ? "+" + eur(r.totale - best, 0) : "la più economica"}` : ""}</div>
    ${pills.length ? `<div class="pills">${pills.slice(0, 5).join("")}</div>` : ""}${extra}</article>`;
}

function vistaInternet() {
  const v = $("#vista");
  const { lista, mia, N } = classificaNet();
  const best = miglioreNet(lista);
  const pk = pacchettiEnergiaInternet(N);
  const T = S.net.tecnologia;
  let html = `<div class="intest"><div class="seg big" id="nTec">${Object.keys(TECNO).map((t) => `<button data-v="${t}" class="${T === t ? "on" : ""}">${t === "FTTH" ? "Fibra FTTH" : t === "FTTC" ? "Fibra FTTC" : "FWA (radio)"}</button>`).join("")}</div>
    <div class="small mut">Quale tecnologia arriva a casa tua? <a href="${URL_COPERTURA}" target="_blank" rel="noopener">Controlla l'indirizzo sulla mappa AGCOM</a> o sul sito dell'operatore.</div></div>`;
  html += `<div class="seg" id="nOr">${[12, 24, 36].map((n) => `<button data-v="${n}" class="${N === n ? "on" : ""}">${n} mesi</button>`).join("")}</div>`;

  if (best) {
    const o = best.offerta;
    html += `<section class="best" data-net="${h(o.id)}" role="button"><div class="best-l">La più conveniente in ${N} mesi</div>
      <div class="row sp"><div class="min0"><div class="vend">${h(o.operatore)}</div><div class="nome">${h(o.nome)}</div></div>
        <div class="price"><div class="tot">${eur(best.medio, 2)}</div><div class="sub">al mese in media · ${eur(best.totale, 0)} totali</div></div></div>
      <div class="small mut" style="margin-top:6px">${tecnoTxt(o)} · ${vel(o.down)} · ${h(o.chiamate || "chiamate: non indicato")}</div>
      ${mia ? `<div class="conf"><span>rispetto al tuo abbonamento</span><b class="${mia.totale > best.totale ? "ok" : ""}">${mia.totale > best.totale ? `risparmi ${eur(mia.totale - best.totale, 0)} in ${N} mesi` : `il tuo costa ${eur(best.totale - mia.totale, 0)} in meno`}</b></div>` : ""}
      <div class="vedi">Vedi costi mese per mese, vincoli e uscita ›</div></section>`;
  }

  // filtri
  html += `<div class="chips-f">
    <button data-nf="voce" class="${S.net.voce ? "on" : ""}">Con telefono fisso</button>
    <button data-nf="giga" class="${S.net.minDown >= 1000 ? "on" : ""}">Almeno 1 Giga</button>
    <button data-nf="cambio" class="${S.net.cambioEnergia ? "on" : ""}">Anche abbinate a luce/gas</button></div>`;

  // profilo: mobile ed energia
  const en = sitiEnergia();
  html += `<details class="card small" ${S.net.aperto ? "open" : ""} id="nProf"><summary><b>Sconti che puoi avere</b> <span class="mut">· mobile: ${h(S.net.mobile || "nessuno")} · luce/gas: ${h(en.map((x) => FORN_ENERGIA_NET.find((f) => f[0] === x)?.[1] || nomeFornitore(x, x)).join(", ") || "altro fornitore")}</span></summary>
    <label>Hai una SIM con</label><select id="nMob"><option value="">nessuno di questi</option>${OPERATORI_MOBILE.map((x) => `<option ${S.net.mobile === x ? "selected" : ""}>${x}</option>`).join("")}</select>
    <label>Hai luce o gas con</label><div class="chips-f" style="flex-wrap:wrap">${FORN_ENERGIA_NET.map(([s_, n]) => `<button data-en="${s_}" class="${en.includes(s_) ? "on" : ""}">${n}</button>`).join("")}</div>
    <div class="mut" style="margin-top:6px">Alcuni operatori fanno un prezzo più basso a chi ha già il loro mobile o la loro luce/gas: lo applico solo se lo hai.</div></details>`;

  // il mio abbonamento
  const m = S.net.mia;
  html += `<section class="sez"><h3>Il tuo abbonamento attuale</h3>
    ${m?.canone ? `${cardNet(mia, null)}<div class="row"><button class="btn sec" id="nMiaMod">Modifica</button><button class="btn del" id="nMiaDel">Elimina</button></div>`
      : `<p class="small mut">Inseriscilo per vedere quanto risparmi davvero. Puoi caricare la sintesi contrattuale (il riepilogo che ogni operatore deve darti prima della firma) o una bolletta in PDF.</p>
      <div class="row"><button class="btn sec" id="nSint">Carica PDF</button><button class="btn sec" id="nMiaMod">Scrivi i dati</button></div>`}
    <div id="nForm"></div></section>`;

  // pacchetti energia + internet
  if (pk.length) {
    html += `<section class="sez"><h3>Luce/gas + internet dallo stesso fornitore: conviene?</h3>
      <p class="small mut">Totale di ${N} mesi: la miglior offerta luce${pk[0].forn.length > 1 ? " e gas" : ""} del fornitore + la sua fibra, contro la miglior energia in assoluto + il miglior internet presi separatamente.</p>
      <table class="lista">${pk.map((x) => `<tr data-pk="${h(x.sito)}" role="button"><td><b>${h(x.nome)}</b><div class="frase">${x.forn.map((f) => x.ener[f] ? `${f === "LUCE" ? "Luce" : "Gas"}: ${h(x.ener[f].offerta.nome)} ${eur(x.ener[f].centrale, 0)}/anno` : `${f === "LUCE" ? "Luce" : "Gas"}: nessuna offerta`).join(" · ")}<br>Internet: ${h(x.net.offerta.nome)} ${eur(x.net.medio, 2)}/mese</div></td>
        <td class="r num"><b>${eur(x.pacchetto, 0)}</b><div class="frase ${x.diff <= 0 ? "ok" : "bad"}">${x.diff <= 0 ? "risparmi " + eur(-x.diff, 0) : "+" + eur(x.diff, 0)}</div></td></tr>`).join("")}
        <tr class="t"><td>Separati: ${pk[0].forn.map((f) => h(pk[0].bestSep[f]?.offerta.venditore || "")).join(" + ")} + ${h(pk[0].netSep?.offerta.operatore || "")}</td><td class="r num">${eur(pk[0].separati, 0)}</td></tr></table>
      <p class="small mut">L'energia è calcolata sui tuoi consumi con le regole ARERA (12 bollette, ripetute per ${N} mesi: oltre il primo anno è una stima). Tocca una riga per i dettagli.</p></section>`;
  }

  const incerte = lista.filter((r) => incerta(r) && !r.scaduta);
  if (incerte.length) html += `<div class="avviso small">${incerte.map((r) => h(r.offerta.nome)).join(", ")}: dati presi da un comparatore perché il documento ufficiale non era leggibile. Restano in classifica ma non in testa.</div>`;
  html += `<div class="small mut conta">${lista.length} offerte · ordinate per costo totale in ${N} mesi (canoni, sconti, attivazione, rate) · fonti: sintesi contrattuali e pagine ufficiali</div>`;
  for (const r of lista) if (r !== best) html += cardNet(r, best?.totale);
  if (!lista.length) html += `<div class="empty">Nessuna offerta con questi filtri.</div>`;
  html += `<div class="card small"><b>Da dove vengono questi prezzi</b>
    <p class="mut">${h(catalogoInternet.nota)} Aggiornato al ${dataIt(catalogoInternet.aggiornato_al)}. Le promozioni cambiano spesso: prima di firmare chiedi la <b>sintesi contrattuale</b> e confronta canone, durata della promo, costi di attivazione e di uscita.</p></div>`;
  v.innerHTML = html;

  $$("#nTec button").forEach((b) => (b.onclick = () => { S.net.tecnologia = b.dataset.v; salvaNet(); vistaInternet(); }));
  $$("#nOr button").forEach((b) => (b.onclick = () => { S.net.orizzonte = +b.dataset.v; salvaNet(); vistaInternet(); }));
  $$("[data-nf]").forEach((b) => (b.onclick = () => {
    const k = b.dataset.nf;
    if (k === "voce") S.net.voce = !S.net.voce; else if (k === "giga") S.net.minDown = S.net.minDown >= 1000 ? 0 : 1000; else S.net.cambioEnergia = !S.net.cambioEnergia;
    salvaNet(); vistaInternet();
  }));
  $("#nProf").ontoggle = (e) => { S.net.aperto = e.target.open; salvaNet(); };
  $("#nMob").onchange = (e) => { S.net.mobile = e.target.value; S.net.aperto = true; salvaNet(); vistaInternet(); };
  $$("[data-en]").forEach((b) => (b.onclick = () => {
    const cur = new Set(sitiEnergia()); cur.has(b.dataset.en) ? cur.delete(b.dataset.en) : cur.add(b.dataset.en);
    S.net.energia = [...cur]; S.net.aperto = true; salvaNet(); vistaInternet();
  }));
  $$("[data-net]").forEach((c) => (c.onclick = () => vistaDettaglioInternet(c.dataset.net)));
  $$("[data-pk]").forEach((c) => (c.onclick = () => vistaPacchetto(c.dataset.pk)));
  $("#nSint") && ($("#nSint").onclick = () => $("#fileSintesi").click());
  $("#nMiaMod").onclick = () => formMia(S.net.mia || {});
  $("#nMiaDel") && ($("#nMiaDel").onclick = () => { S.net.mia = null; salvaNet(); vistaInternet(); });
}

function formMia(m, letti = null) {
  const f = $("#nForm");
  const campo = (id, et, val, ph = "") => `<div><label>${et}</label><input id="${id}" inputmode="decimal" value="${val == null ? "" : h(nf(val, 2))}" placeholder="${ph}"></div>`;
  f.innerHTML = `${letti ? `<div class="avviso small">Dal PDF ho letto: ${Object.keys(letti).length ? h(Object.entries(letti).map(([k, v]) => `${k} ${v}`).join(", ")) : "nessun dato riconosciuto"}. Controlla e correggi.</div>` : ""}
    <div class="row"><div><label>Operatore</label><input id="mOp" value="${h(m.operatore || "")}" placeholder="es. TIM"></div><div><label>Nome offerta</label><input id="mNome" value="${h(m.nome || "")}"></div></div>
    <div class="row">${campo("mCan", "Canone attuale €/mese", m.canone, "es. 29,90")}${campo("mProm", "Mesi rimasti a questo prezzo", m.promoMesi, "vuoto = per sempre")}${campo("mDopo", "Poi €/mese", m.dopo)}</div>
    <div class="row">${campo("mModR", "Rata modem €/mese (se a parte)", m.modemRata)}${campo("mModM", "Rate modem rimaste", m.modemMesi)}</div>
    <div class="row"><div><label>Tecnologia</label><select id="mTec">${Object.keys(TECNO).map((t) => `<option ${m.tecnologia === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div><label>Velocità Mbit/s</label><input id="mDown" inputmode="numeric" value="${h(m.down ?? "")}"></div></div>
    <button class="btn full" id="mSalva" style="margin-top:10px">Salva il mio abbonamento</button>`;
  $("#mSalva").onclick = () => {
    const n = (id) => { const x = pnum($("#" + id).value); return x == null || Number.isNaN(x) ? null : x; };
    const can = n("mCan");
    if (!(can > 0)) { toast("Scrivi il canone mensile"); return; }
    S.net.mia = { operatore: $("#mOp").value.trim(), nome: $("#mNome").value.trim(), canone: can, promoMesi: n("mProm"), dopo: n("mDopo"),
      modemRata: n("mModR"), modemMesi: n("mModM"), tecnologia: $("#mTec").value, down: n("mDown") };
    salvaNet(); toast("Abbonamento salvato"); vistaInternet();
  };
  f.scrollIntoView({ behavior: "smooth", block: "start" });
}

$("#fileSintesi").addEventListener("change", async (e) => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  try {
    toast("Leggo il PDF…");
    const t = await testoPdf(file, pdfjs);
    const r = analizzaSintesi(t);
    const letti = {};
    if (r.operatore) letti.operatore = r.operatore;
    if (r.canone) letti.canone = eur(r.canone);
    if (r.promoMesi) letti["mesi promo"] = r.promoMesi;
    if (r.dopo) letti.poi = eur(r.dopo);
    if (r.attivazione != null) letti.attivazione = eur(r.attivazione);
    if (r.recesso) letti.disattivazione = eur(r.recesso);
    if (r.down) letti.velocità = vel(r.down);
    if (r.tecnologia) letti.tecnologia = r.tecnologia;
    formMia({ ...S.net.mia, ...r }, letti);
  } catch (err) { console.error(err); toast("Non riesco a leggere il PDF: " + err.message, 4000); }
});

function vistaDettaglioInternet(id) {
  const p = profiloNet(), N = S.net.orizzonte;
  const o = id === "MIA" ? offertaMia(S.net.mia) : offerteNet().find((x) => x.id === id);
  if (!o) { toast("Offerta non trovata"); return; }
  const r = costoInternet(o, p, N, oggiIso());
  const lista = classificaInternet(offerteNet(), p, N, oggiIso()), best = miglioreNet(lista);
  const mia = S.net.mia?.canone > 0 ? costoInternet(offertaMia(S.net.mia), p, N, oggiIso()) : null;
  $("#titolo").textContent = "Dettaglio internet";
  // mesi raggruppati per importo
  const gruppi = r.fasi;
  const COND = { mobile: `hai il mobile ${o.operatore}`, energia: `hai luce o gas ${o.operatore}`, energia2: `hai luce e gas ${o.operatore}`, domiciliazione: "paghi con domiciliazione", altro: "condizione particolare" };
  const usc = [6, 12, 24].map((m) => [m, costoUscita(o, m)]);
  let html = `<button class="btn ghost" id="indietro">‹ Indietro</button>
    <section class="hero"><div class="vend">${h(o.operatore)}</div><h2>${h(o.nome)}</h2>
      <div class="big-tot">${eur(r.totale, 0)}<span> in ${N} mesi · ${eur(r.medio, 2)} al mese in media</span></div>
      <div class="small mut">${tecnoTxt(o)} · fino a ${vel(o.down)} in download${o.up ? `, ${vel(o.up)} in upload` : ""}</div>
      ${best && best.offerta.id !== o.id ? `<div class="conf"><span>rispetto alla più conveniente (${h(best.offerta.nome)})</span><b>+${eur(r.totale - best.totale, 0)}</b></div>` : ""}
      ${mia && !o.mia ? `<div class="conf"><span>rispetto al tuo abbonamento</span><b class="${mia.totale > r.totale ? "ok" : ""}">${mia.totale > r.totale ? "risparmi " + eur(mia.totale - r.totale, 0) : "costa " + eur(r.totale - mia.totale, 0) + " in più"}</b></div>` : ""}
    </section>
    <section class="sez"><h3>In breve</h3><ul class="breve">
      <li class="info"><span class="ic">€</span><div><b>${h(descriviFasi(r.fasi))}</b>${r.unaTantum ? `<div class="small">più ${eur(r.unaTantum)} una tantum alla prima fattura</div>` : ""}</div></li>
      ${r.applicati.map((x) => `<li class="piu"><span class="ic">✓</span><div><b>−${eur(x.importo)} al mese${x.mesi ? ` per ${x.mesi} mesi` : ""}</b><div class="small">${h(x.condizione || "sconto")}${x.richiede ? ` — applicato perché ${COND[x.richiede]}` : ""}${x.scade ? ` · per chi attiva entro il ${dataIt(x.scade)}` : ""}</div></div></li>`).join("")}
      ${r.esclusi.map((x) => `<li class="attenzione"><span class="ic">✕</span><div><b>−${eur(x.importo)} al mese non applicato</b><div class="small">${h(x.condizione || "")}${x.scade && x.scade < oggiIso() ? ` · promo scaduta il ${dataIt(x.scade)}` : x.richiede ? ` — vale solo se ${COND[x.richiede]}` : ""}</div></div></li>`).join("")}
      ${(o.rate || []).map((x) => `<li class="attenzione"><span class="ic">⏱</span><div><b>${h(x.voce)}: ${eur(x.importo)} al mese dal ${x.da}° al ${x.a}° mese</b><div class="small">Già nel prezzo sopra. Se lasci prima, le rate rimaste vanno pagate.</div></div></li>`).join("")}
      ${o.energia?.obbligatoria ? `<li class="attenzione"><span class="ic">⚠</span><div><b>Si attiva solo con la luce o il gas ${h(o.operatore)}</b></div></li>` : ""}
      <li class="${o.vincolo > 0 ? "attenzione" : "info"}"><span class="ic">${o.vincolo > 0 ? "⚠" : "ℹ"}</span><div><b>${o.vincolo > 0 ? `Durata minima ${o.vincolo} mesi` : o.vincolo === 0 ? "Nessun vincolo di durata" : "Durata minima non indicata"}</b></div></li>
      ${o.penaleModem ? `<li class="attenzione"><span class="ic">⚠</span><div><b>Modem da restituire: ${eur(o.penaleModem)} se non lo riconsegni</b></div></li>` : ""}
      <li class="info"><span class="ic">☎</span><div><b>Chiamate: ${h(o.chiamate || "non indicato")}</b></div></li>
      ${(o.note || []).map((n) => `<li class="info"><span class="ic">ℹ</span><div><div class="small">${h(n)}</div></div></li>`).join("")}
      ${r.dubbi.map((n) => `<li class="attenzione"><span class="ic">?</span><div><b>Da verificare</b><div class="small">${h(n)}</div></div></li>`).join("")}
    </ul></section>
    <section class="sez"><h3>Quanto paghi in ${N} mesi</h3><table class="lista">${r.voci.map((x) => `<tr><td>${h(x.t)}</td><td class="r num">${eur(x.v)}</td></tr>`).join("")}
      <tr class="t"><td>Totale</td><td class="r num">${eur(r.totale)}</td></tr></table>
      <div class="sub-h">Mese per mese</div><table class="lista">${r.unaTantum ? `<tr><td>Prima fattura: una tantum</td><td class="r num">${eur(r.unaTantum)}</td></tr>` : ""}${gruppi.map((g) => `<tr><td>${g.da === g.a ? `Mese ${g.da}` : `Mesi ${g.da}–${g.a}`}</td><td class="r num">${eur(g.v)}${g.da !== g.a ? " al mese" : ""}</td></tr>`).join("")}</table></section>
    <section class="sez"><h3>Se vuoi cambiare prima</h3><table class="kv small">${usc.map(([m, u]) => `<tr><td>Dopo ${m} mesi</td><td>${u.importo != null ? `<b>${eur(u.importo)}</b> — ` : ""}${h(u.testo)}</td></tr>`).join("")}</table>
      <p class="small mut">Per legge puoi recedere in ogni momento con 30 giorni di preavviso: l'operatore può chiedere solo i costi di disattivazione e, se c'era una promozione o un vincolo, la restituzione degli sconti o le rate residue. Gli importi esatti sono nella sintesi contrattuale.</p></section>
    ${o.mia ? "" : `<section class="sez"><h3>Prima di firmare</h3>
      <div class="row"><a class="btn sec" href="${URL_COPERTURA}" target="_blank" rel="noopener">Copertura (AGCOM)</a><a class="btn sec" href="https://${h(o.sito)}" target="_blank" rel="noopener">Sito ${h(o.operatore)}</a></div>
      <div class="row" style="margin-top:8px"><a class="btn sec" href="https://it.trustpilot.com/search?query=${encodeURIComponent(o.sito)}" target="_blank" rel="noopener">★ Trustpilot</a><a class="btn sec" href="https://www.google.com/search?q=${encodeURIComponent(o.operatore + " fibra recensioni")}" target="_blank" rel="noopener">Recensioni Google</a></div>
      <table class="kv small" style="margin-top:8px"><tr><td>Fonte</td><td><a href="${h(o.fonte)}" target="_blank" rel="noopener">${h(o.fonte.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60))}</a></td></tr><tr><td>Tipo di fonte</td><td>${o.fonteTipo === "ufficiale" ? "documento o pagina ufficiale dell'operatore" : "comparatore (il documento ufficiale non era leggibile)"}</td></tr><tr><td>Verificato il</td><td>${dataIt(o.verificato)}</td></tr></table></section>`}`;
  $("#vista").innerHTML = html;
  window.scrollTo(0, 0);
  $("#indietro").onclick = () => vai("internet");
}

function vistaPacchetto(sito) {
  const N = S.net.orizzonte, x = pacchettiEnergiaInternet(N).find((y) => y.sito === sito);
  if (!x) return;
  $("#titolo").textContent = `${x.nome}: energia + internet`;
  const riga = (t, v, id, tipo) => `<tr ${id ? `data-${tipo}="${h(id)}" role="button"` : ""}><td>${t}</td><td class="r num">${eur(v, 0)}</td></tr>`;
  const blocco = (titolo, ener, net) => `<table class="lista"><tr class="g"><td colspan="2">${titolo}</td></tr>
    ${x.forn.map((f) => ener[f] ? riga(`${f === "LUCE" ? "Luce" : "Gas"}: ${h(ener[f].offerta.venditore)} — ${h(ener[f].offerta.nome)} <span class="mut">(${eur(ener[f].centrale, 0)}/anno × ${N / 12})</span>`, ener[f].centrale * N / 12, ener[f].offerta.id, "en") : "").join("")}
    ${net ? riga(`Internet: ${h(net.offerta.operatore)} — ${h(net.offerta.nome)}`, net.totale, net.offerta.id, "net") : ""}</table>`;
  const enerP = Object.fromEntries(x.forn.map((f) => [f, x.ener[f] || x.bestSep[f]]));
  $("#vista").innerHTML = `<button class="btn ghost" id="indietro">‹ Indietro</button>
    <section class="hero"><h2>${h(x.nome)}: tutto insieme</h2>
      <div class="big-tot">${eur(x.pacchetto, 0)}<span> in ${N} mesi</span></div>
      <div class="conf"><span>contro la scelta migliore separata (${eur(x.separati, 0)})</span><b class="${x.diff <= 0 ? "ok" : ""}">${x.diff <= 0 ? "risparmi " + eur(-x.diff, 0) : "spendi " + eur(x.diff, 0) + " in più"}</b></div></section>
    <section class="sez"><h3>Dettaglio</h3>${blocco("Con " + h(x.nome), enerP, x.net)}${blocco("Separati: i migliori per te", x.bestSep, x.netSep)}
      <p class="small mut">Tocca una riga per vedere bollette o costi mese per mese. ${x.forn.some((f) => !x.ener[f]) ? "Dove il fornitore non ha un'offerta per te uso la migliore separata. " : ""}
      L'energia oltre i 12 mesi ripete il primo anno: per le offerte a prezzo fisso il prezzo dopo la scadenza non è noto.</p></section>
    <section class="sez"><h3>Da sapere</h3><ul class="small">
      <li>Lo sconto sulla fibra di solito decade se chiudi la luce o il gas con lo stesso fornitore: cambiare uno dei due servizi può far salire l'altro.</li>
      <li>Le offerte luce/gas riservate a chi ha la fibra non sono nella classifica principale: le trovi qui.</li>
      <li>Conviene solo se entrambi i prezzi restano competitivi: confronta sempre con la riga «Separati».</li></ul></section>`;
  window.scrollTo(0, 0);
  $("#indietro").onclick = () => vai("internet");
  $$("[data-en]").forEach((c) => (c.onclick = () => { S.daInternet = true; vistaDettaglio(c.dataset.en); }));
  $$("[data-net]").forEach((c) => (c.onclick = () => vistaDettaglioInternet(c.dataset.net)));
}

/** Nel dettaglio di un'offerta luce/gas che richiede internet: quanto costa la fibra abbinata. */
function boxInternetEnergia(o, totAnnuo) {
  const N = S.net.orizzonte;
  const pi = profiloNet({ energia: [...new Set([...sitiEnergia(), o.sito])], cambioEnergia: true });
  const net = classificaInternet(offerteNet().filter((x) => x.sito === o.sito), pi, N, oggiIso())[0];
  if (!net) return `<section class="sez"><h3>Insieme a internet</h3><p class="small">Questa offerta richiede anche la connessione internet di ${h(o.venditore)}. Il prezzo della fibra di questo fornitore non è nel catalogo dell'app: chiedilo prima di firmare e aggiungilo al totale.</p></section>`;
  return `<section class="sez"><h3>Insieme a internet</h3>
    <p class="small">Questa offerta vale solo se attivi anche internet con ${h(o.venditore)}. Il totale sopra comprende solo l'energia.</p>
    <table class="lista"><tr><td>Energia (${N / 12 === 1 ? "12 mesi" : `12 mesi × ${N / 12}`})</td><td class="r num">${eur(totAnnuo * N / 12, 0)}</td></tr>
      <tr data-net="${h(net.offerta.id)}" role="button"><td>${h(net.offerta.nome)} <span class="mut">(${eur(net.medio, 2)}/mese)</span></td><td class="r num">${eur(net.totale, 0)}</td></tr>
      <tr class="t"><td>Totale in ${N} mesi</td><td class="r num">${eur(totAnnuo * N / 12 + net.totale, 0)}</td></tr></table>
    <button class="btn sec full" id="boxNet">Confronta con energia e internet separati</button></section>`;
}

const VISTE = { internet: vistaInternet, offerte: vistaOfferte, cte: vistaCte, profilo: vistaProfilo, dati: vistaDati };
vai("offerte");
// prima mostra le offerte salvate, poi aggiorna l'app (può ricaricarla), infine scarica le offerte del giorno
confermaAvvio().then(() => avviaCatalogo()).then(() => aggiornaApp(false)).then(() => scaricaSeServe());

let apkNuovo = null;
let ultimoControllo = 0;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - ultimoControllo > 10 * 60 * 1000) aggiornaApp(false);
});
async function aggiornaApp(manuale) {
  ultimoControllo = Date.now();
  try {
    const r = await controllaAggiornamento((m) => toast(m, 6000));
    if (r?.apk) { apkNuovo = r.apk; toast("C'è una versione nuova da installare: vai in Info", 5000); if (S.tab === "dati") vistaDati(); }
    else if (manuale) toast("L'app è già aggiornata");
    LS.set("errAgg", null);
  } catch (e) {
    console.error(e); LS.set("errAgg", { data: new Date().toISOString(), msg: String(e?.message || e) });
    toast("Aggiornamento non riuscito: " + (e?.message || e), 5000);
  }
}
