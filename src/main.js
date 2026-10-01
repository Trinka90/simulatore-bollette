import * as pdfjs from "pdfjs-dist";
import { analizza, bozzaOfferta, testoPdf } from "./cte.js";
import { riepilogo, simula, MESI, totale } from "./simulazione.js";
import { pdfConfronto, pdfBollette } from "./esporta.js";
import { DATI_URL } from "./config.js";
import datiInclusi from "../data/dati.json";

pdfjs.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.mjs";

// ------------------------------------------------------------------ stato
const LS = {
  get(k, d) { try { const v = localStorage.getItem("sb_" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("sb_" + k, JSON.stringify(v)); } catch { /* spazio pieno */ } },
};
const oggi = new Date();
const meseCorrente = `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, "0")}`;

const UTENZA_DEF = {
  inizio: null,
  luce: { attiva: true, consumoAnnuoKwh: 3175, potenzaKw: 6, residente: true, canoneRai: true,
    ripartizione: { F1: 0.33, F2: 0.31, F3: 0.36 }, profilo: null },
  gas: { attiva: true, consumoAnnuoSmc: 39, riscaldamento: false,
    profilo: { 1: 4, 2: 3, 3: 4, 4: 4, 5: 2, 6: 3, 7: 2, 8: 3, 9: 3, 10: 3, 11: 4, 12: 4 } },
};
const OFFERTE_ESEMPIO = [
  { id: "es1", esempio: true, incluso: true, fornitura: "LUCE", fornitore: "Enel Energia", nome: "Enel Flex Control Luce (esempio)",
    fonte: "CTE Enel, adesioni entro 15/09/2026", tipoPrezzo: "indicizzato", prezzi: { F0: 0.02226 }, perdite: "indice",
    prezzoMax: 0.174, cdispd: "arera", altriKwh: 0, quotaFissaAnnua: 180,
    note: ["Esempio: PUN + 0,02226 €/kWh con tetto 0,174 €/kWh. Perdite interpretate come PUN × 1,10 + spread."] },
  { id: "es2", esempio: true, incluso: true, fornitura: "GAS", fornitore: "Estra Energie", nome: "Scelta Dinamica Gas (esempio)",
    fonte: "Bolletta Estra 07/2026", tipoPrezzo: "indicizzato", prezzoSmc: 0.025, altriSmc: 0.0507541, quotaFissaAnnua: 30,
    note: ["Esempio: PSV + 0,025 €/Smc + CCR/PCS/QVD 0,0508 €/Smc, quota fissa 2,50 €/mese."] },
];

const S = {
  tab: "confronto",
  utenza: LS.get("utenza", UTENZA_DEF),
  offerte: LS.get("offerte", OFFERTE_ESEMPIO),
  dati: LS.get("dati", datiInclusi),
  datiUrl: LS.get("datiUrl", DATI_URL),
};
if ((S.dati.versione || 0) < datiInclusi.versione || S.dati.aggiornato_al < datiInclusi.aggiornato_al) S.dati = datiInclusi;
const salva = () => { LS.set("utenza", S.utenza); LS.set("offerte", S.offerte); LS.set("dati", S.dati); LS.set("datiUrl", S.datiUrl); };
const inizio = () => S.utenza.inizio || meseCorrente;

// ------------------------------------------------------------------ util
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const eur = (v, d = 2) => (v ?? 0).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d }) + " €";
const nf = (v, d = 6) => (v == null ? "" : Number(v).toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: d }));
const pnum = (s) => {
  if (s == null) return null;
  s = String(s).trim().replace(/\s/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "");
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
};
const badge = (t) => `<span class="b ${t.toLowerCase()}">${t}</span>`;
const uid = () => Math.random().toString(36).slice(2, 10);
function toast(msg, ms = 2600) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), ms);
}
const T = () => S.dati.tariffe, I = () => S.dati.indici;
const descrPrezzo = (o) => {
  if (o.fornitura === "GAS") return `${o.tipoPrezzo === "indicizzato" ? "PSV + " : ""}${nf(o.prezzoSmc)} €/Smc`;
  const p = Object.entries(o.prezzi || {}).map(([k, v]) => (k === "F0" ? nf(v) : `${k} ${nf(v)}`)).join(" · ");
  return `${o.tipoPrezzo === "indicizzato" ? "PUN + " : ""}${p} €/kWh`;
};

// ------------------------------------------------------------------ navigazione
const TITOLI = { confronto: "Confronto", offerte: "Offerte", consumi: "Consumi", dati: "Dati di mercato" };
function vai(tab, render = true) {
  S.tab = tab;
  $$(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  $("#titolo").textContent = TITOLI[tab] || "";
  if (render) VISTE[tab]();
  window.scrollTo(0, 0);
}
$$(".tabs button").forEach((b) => b.addEventListener("click", () => vai(b.dataset.tab)));
function statoDati() {
  $("#statoDati").textContent = `Dati al ${S.dati.aggiornato_al.split("-").reverse().join("/")}`;
}

// ------------------------------------------------------------------ CONFRONTO
let cacheRiepiloghi = null;
function calcolaTutto() {
  const out = { LUCE: [], GAS: [] };
  for (const o of S.offerte.filter((x) => x.incluso !== false && offertaValida(x))) {
    if (o.fornitura === "LUCE" && !S.utenza.luce.attiva) continue;
    if (o.fornitura === "GAS" && !S.utenza.gas.attiva) continue;
    try { out[o.fornitura].push(riepilogo(o, S.utenza, T(), I(), inizio())); } catch (e) { console.error(e); }
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.centrale - b.centrale);
  cacheRiepiloghi = out;
  return out;
}

function vistaConfronto() {
  const R = calcolaTutto();
  const v = $("#vista");
  const n = R.LUCE.length + R.GAS.length;
  if (!n) {
    v.innerHTML = `<div class="empty"><p><b>Nessuna offerta da confrontare.</b></p>
      <p>Allega una CTE in PDF o inserisci un'offerta a mano.</p>
      <button class="btn" id="goOff">Aggiungi offerte</button></div>`;
    $("#goOff").onclick = () => vai("offerte");
    return;
  }
  const [a, m] = inizio().split("-").map(Number);
  let html = `<div class="mut small">12 bollette da ${MESI[m - 1]} ${a} · tocca un'offerta per il dettaglio mese per mese</div>`;
  for (const [tipo, lista] of Object.entries(R)) {
    if (!lista.length) continue;
    const u = tipo === "LUCE" ? S.utenza.luce : S.utenza.gas;
    const cons = tipo === "LUCE" ? `${nf(u.consumoAnnuoKwh, 0)} kWh/anno · ${nf(u.potenzaKw)} kW` : `${nf(u.consumoAnnuoSmc, 0)} Smc/anno`;
    const best = lista[0].centrale;
    const max = Math.max(...lista.map((r) => r.alto));
    html += `<h2>${tipo === "LUCE" ? "Luce" : "Gas"} <span class="mut small">· ${cons}</span></h2>`;
    lista.forEach((r, i) => {
      const o = r.offerta, indic = o.tipoPrezzo === "indicizzato";
      const diff = r.centrale - best;
      html += `<div class="card" data-det="${o.id}" role="button">
        <div class="rank"><div class="pos ${i === 0 ? "p1" : ""}">${i + 1}</div>
          <div><b>${h(o.fornitore)}</b><div class="small">${h(o.nome)}</div>
            <div class="small mut">${h(descrPrezzo(o))} · fisso ${eur(o.quotaFissaAnnua || 0, 0)}/anno</div></div>
          <div class="r"><div class="tot">${eur(r.centrale, 0)}</div>
            <div class="small mut">${eur(r.centrale / 12)}/mese</div></div></div>
        <div class="barbox"><div class="bar" style="width:${(r.centrale / max) * 100}%"></div>
          ${indic ? `<div class="rng" style="left:${(r.basso / max) * 100}%;width:${((r.alto - r.basso) / max) * 100}%"></div>` : ""}</div>
        <div class="row small" style="margin-top:6px">
          <span>${indic ? `<span class="b var">VARIABILE</span> ${eur(r.basso, 0)} – ${eur(r.alto, 0)}` : '<span class="b reale">PREZZO FISSO</span>'}</span>
          <span class="r">${i === 0 ? '<span class="b best">PIÙ CONVENIENTE</span>' : `+${eur(diff, 0)}/anno`}</span></div>
        <div class="small mut" style="margin-top:4px">${nf(r.costoMedio, 3)} €/${tipo === "LUCE" ? "kWh" : "Smc"} tutto incluso · ${r.mesiSimulati} mesi con valori simulati</div>
      </div>`;
    });
  }
  html += `<div class="warn small"><b>Simulazione, non fatture reali.</b> I mesi futuri usano valori ${badge("SIMULATO")}
    (PUN, PSV, dispacciamento, tariffe non ancora pubblicate). Per le offerte variabili la barra arancione mostra
    l'intervallo tra scenario basso (×${I().metodo_simulazione.scenari.basso}) e alto (×${I().metodo_simulazione.scenari.alto}).</div>
    <button class="btn full" id="pdfConf">Esporta confronto in PDF</button>`;
  v.innerHTML = html;
  $$("[data-det]").forEach((c) => c.addEventListener("click", () => vistaDettaglio(c.dataset.det)));
  $("#pdfConf").onclick = () => esegui(() => pdfConfronto(R, S.utenza, S.dati, inizio()), "Confronto");
}

// ------------------------------------------------------------------ DETTAGLIO
const GRUPPI = [["vendita", "Spesa per la vendita"], ["rete", "Spesa per la rete"], ["oneri", "Oneri generali di sistema"],
  ["imposte", "Accise e addizionali"], ["iva", "IVA"], ["altro", "Altre partite (fuori campo IVA)"]];

function tabellaVoci(r) {
  let t = `<table><tr><th>Voce</th><th class="r">Quantità</th><th class="r">Prezzo</th><th class="r">Importo</th></tr>`;
  for (const [g, tit] of GRUPPI) {
    const voci = r.voci.filter((x) => x.gruppo === g);
    if (!voci.length) continue;
    t += `<tr class="g"><td colspan="3">${tit}</td><td class="r num">${eur(r.gruppo(g))}</td></tr>`;
    for (const x of voci) {
      const q = g === "iva" ? `su ${eur(x.quantita)}` : `${nf(x.quantita, 3)} ${h(x.unita)}`;
      const p = g === "iva" ? `${Math.round(x.prezzo * 100)}%` : nf(x.prezzo, 6);
      t += `<tr><td>${h(x.descrizione)}</td><td class="r num">${q}</td><td class="r num">${p}</td><td class="r num">${eur(x.importo)}</td></tr>`;
    }
  }
  return t + `<tr class="t"><td colspan="3">TOTALE BOLLETTA</td><td class="r num">${eur(r.totale)}</td></tr></table>`;
}
function tabellaApplicati(app) {
  return `<p class="small" style="margin:12px 0 4px"><b>Valori applicati</b></p><table>` + app.map((a) =>
    `<tr><td>${h(a.nome)}<div class="frase">${h(a.nota)}</div></td><td>${badge(a.tipo)}</td>
     <td class="r num">${a.valore == null ? "—" : nf(a.valore, 6) + " " + h(a.unita)}</td></tr>`).join("") + "</table>";
}

function vistaDettaglio(id, scenario = "centrale") {
  const o = S.offerte.find((x) => x.id === id);
  const ris = simula(o, S.utenza, T(), I(), inizio());
  const mesi = ris[scenario];
  const unita = o.fornitura === "LUCE" ? "kWh" : "Smc";
  const cons = mesi.reduce((a, m) => a + m.consumo, 0);
  const tot = totale(mesi), altro = mesi.reduce((a, m) => a + m.risultato.gruppo("altro"), 0);
  $("#titolo").textContent = "Dettaglio";
  let html = `<button class="btn sec" id="indietro">‹ Confronto</button>
    <h2>${h(o.fornitore)} — ${h(o.nome)}</h2><div class="small mut">${h(descrPrezzo(o))} · quota fissa ${eur(o.quotaFissaAnnua || 0)}/anno</div>`;
  if (Object.keys(ris).length > 1) {
    html += `<div class="seg" style="margin:12px 0">${Object.keys(ris).map((s) =>
      `<button data-sc="${s}" class="${s === scenario ? "on" : ""}">${s} ${eur(totale(ris[s]), 0)}</button>`).join("")}</div>`;
  }
  html += `<div class="kpi"><div><span class="small mut">Totale 12 mesi</span><b>${eur(tot)}</b></div>
    <div><span class="small mut">Media mensile</span><b>${eur(tot / 12)}</b></div>
    <div><span class="small mut">Costo medio</span><b>${nf((tot - altro) / cons, 4)} €/${unita}</b></div></div>`;
  if (o.note?.length) html += `<div class="card small"><b>Note sull'offerta</b><ul>${o.note.map((x) => `<li>${h(x)}</li>`).join("")}</ul></div>`;
  html += mesi.map((m, i) => `<details class="m" ${i === 0 ? "open" : ""}><summary><span>${m.etichetta} ${badge(m.simulato ? "SIMULATO" : "REALE")}</span>
      <span class="num">${eur(m.risultato.totale)}</span></summary><div>
      <div class="small mut" style="margin-bottom:6px">Consumo ${nf(m.consumo, 1)} ${unita} · ${m.periodo.giorni} giorni</div>
      ${tabellaVoci(m.risultato)}${tabellaApplicati(m.applicati)}
      ${m.risultato.avvisi.length ? `<ul class="small mut">${m.risultato.avvisi.map((a) => `<li>${h(a)}</li>`).join("")}</ul>` : ""}
    </div></details>`).join("");
  html += `<button class="btn full" id="pdfBoll" style="margin-top:12px">Esporta queste 12 bollette in PDF</button>`;
  $("#vista").innerHTML = html;
  window.scrollTo(0, 0);
  $("#indietro").onclick = () => vai("confronto");
  $$("[data-sc]").forEach((b) => (b.onclick = () => vistaDettaglio(id, b.dataset.sc)));
  $("#pdfBoll").onclick = () => esegui(() => pdfBollette(o, ris, scenario, S.utenza, S.dati, inizio()), "Bollette");
}

async function esegui(fn, nome) {
  try { toast(`Preparo il PDF ${nome}…`); await fn(); } catch (e) { console.error(e); toast("Errore nell'esportazione: " + e.message, 4000); }
}

// ------------------------------------------------------------------ OFFERTE
function offertaValida(o) {
  const ok = (v) => typeof v === "number" && Number.isFinite(v);
  if (!ok(o.quotaFissaAnnua)) return false;
  if (o.fornitura === "LUCE") return Object.keys(o.prezzi || {}).length > 0 && Object.values(o.prezzi).every(ok);
  return ok(o.prezzoSmc);
}

function vistaOfferte() {
  const v = $("#vista");
  let html = `<div class="row"><button class="btn" id="addPdf">📄 Allega CTE (PDF)</button>
    <button class="btn sec" id="addMan">Inserisci a mano</button></div>
    <p class="small mut">Puoi selezionare più PDF insieme. Ogni CTE viene letta sul telefono, senza inviare nulla.</p>`;
  for (const tipo of ["LUCE", "GAS"]) {
    const lista = S.offerte.filter((o) => o.fornitura === tipo);
    html += `<h2>${tipo === "LUCE" ? "Luce" : "Gas"} (${lista.length})</h2>`;
    if (!lista.length) html += `<div class="small mut">Nessuna offerta.</div>`;
    for (const o of lista) {
      const valida = offertaValida(o);
      html += `<div class="card"><div class="row sp"><div class="grow"><b>${h(o.fornitore || "—")}</b> ${o.esempio ? '<span class="b var">ESEMPIO</span>' : ""}
          <div class="small">${h(o.nome)}</div><div class="small mut">${h(descrPrezzo(o))}</div>
          ${valida ? "" : '<div class="small" style="color:var(--bad)">Dati incompleti: aprila per completarla</div>'}</div>
          <label class="sw" style="margin:0"><input type="checkbox" data-inc="${o.id}" ${o.incluso !== false ? "checked" : ""}></label></div>
        <div class="row" style="margin-top:6px"><button class="btn sec" data-mod="${o.id}">Modifica</button>
          <button class="btn del" data-del="${o.id}">Elimina</button></div></div>`;
    }
  }
  v.innerHTML = html;
  $("#addPdf").onclick = () => $("#filePdf").click();
  $("#addMan").onclick = () => editor(nuovaOfferta("LUCE"));
  $$("[data-inc]").forEach((c) => (c.onchange = () => {
    S.offerte.find((o) => o.id === c.dataset.inc).incluso = c.checked; salva();
  }));
  $$("[data-mod]").forEach((b) => (b.onclick = () => editor(structuredClone(S.offerte.find((o) => o.id === b.dataset.mod)))));
  $$("[data-del]").forEach((b) => (b.onclick = () => {
    const o = S.offerte.find((x) => x.id === b.dataset.del);
    if (confirm(`Eliminare "${o.nome}"?`)) { S.offerte = S.offerte.filter((x) => x.id !== o.id); salva(); vistaOfferte(); }
  }));
}

function nuovaOfferta(fornitura) {
  return fornitura === "LUCE"
    ? { id: uid(), incluso: true, fornitura, fornitore: "", nome: "", fonte: "", tipoPrezzo: "fisso", prezzi: { F0: null },
      perdite: "nessuna", prezzoMax: null, cdispd: "arera", altriKwh: 0, quotaFissaAnnua: null, note: [] }
    : { id: uid(), incluso: true, fornitura, fornitore: "", nome: "", fonte: "", tipoPrezzo: "fisso", prezzoSmc: null,
      altriSmc: 0, quotaFissaAnnua: null, note: [] };
}

// ------------------------------------------------------------------ IMPORT CTE (automatico)
// L'app legge la CTE e salva l'offerta da sola. Chiede solo i numeri indispensabili che nel PDF non ci sono.
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
      S.offerte.push(off);
      esitiImport.push({ file: f.name, id: off.id });
    } catch (err) {
      console.error(err);
      esitiImport.push({ file: f.name, illeggibile: true });
    }
  }
  salva();
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
    const o = S.offerte.find((x) => x.id === es.id);
    if (!o) continue;
    const manca = cosaManca(o);
    const tipo = o.tipoPrezzo === "indicizzato" ? '<span class="b var">VARIABILE</span>' : '<span class="b reale">PREZZO FISSO</span>';
    html += `<div class="card"><div class="row sp"><b class="grow">${manca.length ? "⚠" : "✓"} ${h(o.fornitore || "Fornitore non indicato")}</b>
      <span>${o.fornitura === "LUCE" ? "Luce" : "Gas"} ${tipo}</span></div><div class="small">${h(o.nome)}</div>`;
    if (!manca.length) {
      html += `<div class="small mut">${h(descrPrezzo(o))} · costo fisso ${eur(o.quotaFissaAnnua, 0)}/anno</div>`;
    } else {
      html += `<div class="small" style="margin-top:6px">Nella CTE non ho trovato ${manca.length === 1 ? "questo dato" : "questi dati"}:</div>`;
      html += manca.map((m) => `<label>${h(m.domanda)}</label><input inputmode="decimal" data-manca="${o.id}|${m.campo}"><div class="frase">${h(m.aiuto)}</div>`).join("");
    }
    html += `</div>`;
  }
  const daCompletare = esitiImport.some((es) => !es.illeggibile && cosaManca(S.offerte.find((x) => x.id === es.id) || {}).length);
  html += `<button class="btn full" id="impFine">${daCompletare ? "Salva e vai al confronto" : "Vai al confronto"}</button>
    ${daCompletare ? '<p class="small mut">Le offerte con dati mancanti restano escluse dal confronto finché non li inserisci.</p>' : ""}`;
  $("#vista").innerHTML = html;
  window.scrollTo(0, 0);
  $("#impFine").onclick = () => {
    for (const i of $$("[data-manca]")) {
      const v = pnum(i.value);
      if (v == null || Number.isNaN(v)) continue;
      const [id, campo] = i.dataset.manca.split("|");
      const o = S.offerte.find((x) => x.id === id);
      if (campo === "quota") o.quotaFissaAnnua = v;
      else if (campo === "gas") o.prezzoSmc = v;
      else o.prezzi[campo.slice(2)] = v;
    }
    salva();
    vai("confronto");
  };
}

function editor(o, an = null, file = "", restanti = 0) {
  $("#titolo").textContent = "Offerta";
  const fr = () => "";
  const luce = o.fornitura === "LUCE";
  const strutt = luce ? ("F0" in o.prezzi ? "F0" : "F23" in o.prezzi ? "F23" : "F123") : "";
  const indic = o.tipoPrezzo === "indicizzato";
  const fasce = { F0: ["F0"], F23: ["F1", "F23"], F123: ["F1", "F2", "F3"] }[strutt] || [];
  const campoPrezzo = (k) => `<label>${indic ? "Maggiorazione sul PUN" : "Prezzo"}${k === "F0" ? "" : " fascia " + k} (€/kWh)</label>
    <input inputmode="decimal" data-p="${k}" value="${h(nf(o.prezzi[k]))}">${fr(k === "F0" && !an?.campi?.F0 ? "spread" : k)}`;
  const altre = () => `<label>Note</label><textarea id="fNote" rows="3">${h((o.note || []).join("\n"))}</textarea>
      <label>Fonte</label><input id="fFonte" value="${h(o.fonte)}"></details>`;
  let html = "";
  html += `<div class="card">
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
      <label>Costo fisso (€ all'anno)</label><input inputmode="decimal" id="fQuota" value="${h(nf(o.quotaFissaAnnua))}">
      <details style="margin-top:14px"><summary class="small"><b>Opzioni avanzate</b> — di solito non serve toccarle</summary>
      <label>Perdite di rete</label><select id="fPerdite">
        <option value="nessuna" ${o.perdite === "nessuna" ? "selected" : ""}>Già comprese nel prezzo</option>
        <option value="indice" ${o.perdite === "indice" ? "selected" : ""}>Solo il PUN maggiorato del 10% (PUN × 1,10 + spread)</option>
        <option value="tutto" ${o.perdite === "tutto" ? "selected" : ""}>Tutto il prezzo applicato ai kWh + 10%</option></select>
      <label>Prezzo massimo €/kWh (se previsto)</label><input inputmode="decimal" id="fMax" value="${h(nf(o.prezzoMax))}">${fr("prezzoMax")}
      <div class="sw"><span>Dispacciamento CDISPD stabilito da ARERA</span><input type="checkbox" id="fCd" ${o.cdispd === "arera" ? "checked" : ""}></div>
      <div id="fCdVal" ${o.cdispd === "arera" ? "hidden" : ""}><label>Dispacciamento €/kWh</label><input inputmode="decimal" id="fCdv" value="${o.cdispd === "arera" ? "" : h(nf(o.cdispd))}"></div>
      <label>Altri corrispettivi €/kWh (opzionale)</label><input inputmode="decimal" id="fAltri" value="${h(nf(o.altriKwh))}">`;
    html += altre();
  } else {
    html += `<label>${indic ? "Maggiorazione sul PSV" : "Prezzo gas"} (€/Smc)</label><input inputmode="decimal" id="fPrezzoSmc" value="${h(nf(o.prezzoSmc))}">
      <label>Costo fisso (€ all'anno)</label><input inputmode="decimal" id="fQuota" value="${h(nf(o.quotaFissaAnnua))}">
      <details style="margin-top:14px"><summary class="small"><b>Opzioni avanzate</b> — di solito non serve toccarle</summary>
      <label>Altri corrispettivi €/Smc (opzionale)</label><input inputmode="decimal" id="fAltri" value="${h(nf(o.altriSmc))}">`;
    html += altre();
  }
  html += `</div>
    <div class="row"><button class="btn" id="fSalva">${an ? "Conferma e salva" : "Salva"}</button>
    <button class="btn sec" id="fAnnulla">${an ? "Scarta" : "Annulla"}</button></div>`;
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
    } else {
      o.prezzoSmc = pnum($("#fPrezzoSmc").value); o.altriSmc = pnum($("#fAltri").value) || 0;
    }
  };
  const ridisegna = () => { leggi(); editor(o, an, file, restanti); };
  $$("#fForn button").forEach((b) => (b.onclick = () => {
    leggi();
    if (b.dataset.v !== o.fornitura) {
      const base = nuovaOfferta(b.dataset.v);
      Object.assign(o, { ...base, id: o.id, fornitore: o.fornitore, nome: o.nome, fonte: o.fonte, note: o.note, quotaFissaAnnua: o.quotaFissaAnnua, tipoPrezzo: o.tipoPrezzo });
      if (o.prezzi) delete o.prezzoSmc; else delete o.prezzi;
    }
    editor(o, an, file, restanti);
  }));
  $$("#fTipo button").forEach((b) => (b.onclick = () => { leggi(); o.tipoPrezzo = b.dataset.v; if (luce && o.tipoPrezzo === "indicizzato" && o.perdite === "nessuna") o.perdite = "indice"; editor(o, an, file, restanti); }));
  $$("#fStr button").forEach((b) => (b.onclick = () => {
    leggi();
    const vecchi = o.prezzi;
    o.prezzi = Object.fromEntries({ F0: ["F0"], F23: ["F1", "F23"], F123: ["F1", "F2", "F3"] }[b.dataset.v].map((k) => [k, vecchi[k] ?? null]));
    editor(o, an, file, restanti);
  }));
  if (luce) $("#fCd").onchange = (e) => ($("#fCdVal").hidden = e.target.checked);
  $("#fAnnulla").onclick = () => vai("offerte");
  $("#fSalva").onclick = () => {
    leggi();
    $$("input.err").forEach((i) => i.classList.remove("err"));
    const errati = [];
    const chk = (sel, v, opz = false) => { if ((v == null && !opz) || Number.isNaN(v)) { errati.push(sel); } };
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
    const i = S.offerte.findIndex((x) => x.id === o.id);
    delete o.esempio;
    if (i >= 0) S.offerte[i] = o; else S.offerte.push(o);
    salva();
    toast("Offerta salvata");
    vai("offerte");
  };
}

// ------------------------------------------------------------------ CONSUMI
function vistaConsumi() {
  const u = S.utenza, L = u.luce, G = u.gas;
  const prof = (p, pref) => `<div class="grid12">${MESI.map((m, i) =>
    `<div><label>${m.slice(0, 3)}</label><input inputmode="decimal" data-${pref}="${i + 1}" value="${p ? h(nf(p[i + 1])) : ""}"></div>`).join("")}</div>`;
  $("#vista").innerHTML = `
  <div class="card"><label style="margin-top:0">Primo mese della simulazione</label>
    <input type="month" id="cInizio" value="${u.inizio || meseCorrente}"></div>
  <div class="card"><div class="sw"><h3 style="margin:0">Luce</h3><input type="checkbox" id="lAtt" ${L.attiva ? "checked" : ""}></div>
    <label>Consumo annuo (kWh)</label><input inputmode="decimal" id="lKwh" value="${nf(L.consumoAnnuoKwh)}">
    <div class="small mut">Lo trovi in bolletta: "consumo annuo".</div>
    <label>Potenza impegnata (kW)</label><select id="lKw">${[1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 9, 10, 15].map((k) => `<option ${k === L.potenzaKw ? "selected" : ""}>${String(k).replace(".", ",")}</option>`).join("")}</select>
    <div class="sw"><span>Abitazione di residenza</span><input type="checkbox" id="lRes" ${L.residente ? "checked" : ""}></div>
    <div class="sw"><span>Canone RAI in bolletta</span><input type="checkbox" id="lRai" ${L.canoneRai ? "checked" : ""}></div>
    <details style="margin-top:10px"><summary class="small"><b>Dettagli facoltativi</b> — fasce orarie e consumi mese per mese</summary>
    <label>Ripartizione per fascia (%) — dalla bolletta, se la conosci</label>
    <div class="row">${["F1", "F2", "F3"].map((f) => `<div><label style="margin:0">${f}</label><input inputmode="decimal" data-rip="${f}" value="${nf(L.ripartizione[f] * 100, 1)}"></div>`).join("")}</div>
    <label>Consumi mese per mese — ${L.profilo ? "personalizzati" : "vuoto = profilo standard"}</label>
${prof(L.profilo, "pl")}</details>
  </div>
  <div class="card"><div class="sw"><h3 style="margin:0">Gas</h3><input type="checkbox" id="gAtt" ${G.attiva ? "checked" : ""}></div>
    <label>Consumo annuo (Smc)</label><input inputmode="decimal" id="gSmc" value="${nf(G.consumoAnnuoSmc)}">
    <label>Uso</label><div class="seg" id="gUso"><button data-v="1" class="${G.riscaldamento ? "on" : ""}">Riscaldamento + cucina</button>
      <button data-v="0" class="${!G.riscaldamento ? "on" : ""}">Solo cucina / acqua calda</button></div>
    <details style="margin-top:10px"><summary class="small"><b>Consumi mese per mese (opzionale)</b> — ${G.profilo ? "personalizzati" : "profilo standard"}</summary>
      <div class="small mut">Smc di ogni mese. Vuoto = profilo standard per l'uso scelto.</div>${prof(G.profilo, "pg")}</details>
  </div>
  <button class="btn full" id="cSalva">Salva consumi</button>`;
  $$("#gUso button").forEach((b) => (b.onclick = () => { $$("#gUso button").forEach((x) => x.classList.toggle("on", x === b)); }));
  $("#cSalva").onclick = () => {
    const err = [];
    const v = (sel, min = 0) => { const x = pnum($(sel).value); if (x == null || Number.isNaN(x) || x < min) err.push(sel); return x; };
    const profilo = (pref) => {
      const vals = $$(`[data-${pref}]`).map((i) => pnum(i.value));
      if (vals.every((x) => x == null)) return null;
      if (vals.some((x) => x == null || Number.isNaN(x) || x < 0)) { err.push(`[data-${pref}]`); return null; }
      return Object.fromEntries(vals.map((x, i) => [i + 1, x]));
    };
    const rip = Object.fromEntries(["F1", "F2", "F3"].map((f) => [f, pnum($(`[data-rip="${f}"]`).value)]));
    const sr = rip.F1 + rip.F2 + rip.F3;
    if (!(sr > 0)) err.push("[data-rip]");
    const n = {
      inizio: $("#cInizio").value || null,
      luce: { attiva: $("#lAtt").checked, consumoAnnuoKwh: v("#lKwh", 1), potenzaKw: pnum($("#lKw").value), residente: $("#lRes").checked,
        canoneRai: $("#lRai").checked, ripartizione: { F1: rip.F1 / sr, F2: rip.F2 / sr, F3: rip.F3 / sr }, profilo: profilo("pl") },
      gas: { attiva: $("#gAtt").checked, consumoAnnuoSmc: v("#gSmc", 1), riscaldamento: $("#gUso .on").dataset.v === "1", profilo: profilo("pg") },
    };
    $$(".err").forEach((i) => i.classList.remove("err"));
    if (err.length) { err.forEach((s) => $$(s).forEach((i) => i.classList.add("err"))); toast("Controlla i campi evidenziati"); return; }
    // se il profilo mensile e dato, il consumo annuo e la sua somma
    if (n.luce.profilo) n.luce.consumoAnnuoKwh = Object.values(n.luce.profilo).reduce((a, b) => a + b, 0);
    if (n.gas.profilo) n.gas.consumoAnnuoSmc = Object.values(n.gas.profilo).reduce((a, b) => a + b, 0);
    S.utenza = n; salva(); toast("Consumi salvati"); vai("confronto");
  };
}

// ------------------------------------------------------------------ DATI
function vistaDati() {
  const d = S.dati, ind = d.indici;
  const pun = Object.entries(ind.pun.mesi).sort().slice(-6);
  const psv = Object.entries(ind.psv.mesi).sort().slice(-6);
  const met = ind.metodo_simulazione;
  $("#vista").innerHTML = `
  <div class="card"><b>Dati aggiornati al ${d.aggiornato_al.split("-").reverse().join("/")}</b>
    <div class="small mut">Tariffe ARERA, PUN, PSV e dispacciamento. L'app li scarica quando c'è rete; senza rete usa questi.</div>
    <button class="btn full" id="dAgg" style="margin-top:10px">Aggiorna ora</button>
    <details style="margin-top:8px"><summary class="small">Indirizzo dei dati</summary><input id="dUrl" value="${h(S.datiUrl)}" style="margin-top:6px"></details></div>
  <h2>PUN ultimi mesi <span class="mut small">€/kWh</span></h2><div class="card"><table><tr><th>Mese</th><th class="r">F0</th><th class="r">F1</th><th class="r">F2</th><th class="r">F3</th><th></th></tr>
    ${pun.map(([k, v]) => `<tr><td>${k}</td>${["F0", "F1", "F2", "F3"].map((f) => `<td class="r num">${nf(v[f], 4)}</td>`).join("")}<td>${badge("REALE")}</td></tr>`).join("")}</table></div>
  <h2>PSV ultimi mesi <span class="mut small">€/Smc</span></h2><div class="card"><table>
    ${psv.map(([k, v]) => `<tr><td>${k}</td><td class="r num">${nf(v, 4)}</td><td>${badge("REALE")}</td></tr>`).join("")}</table></div>
  <h2>Come simulo i mesi futuri</h2><div class="card small"><ul style="padding-left:18px;margin:0">
    <li><b>PUN</b>: ${h(met.pun)}</li><li><b>PSV</b>: ${h(met.psv)}</li><li><b>Dispacciamento</b>: ${h(met.cdispd)}</li>
    <li><b>Scenari</b>: basso ×${met.scenari.basso}, alto ×${met.scenari.alto} sui soli valori simulati.</li>
    <li><b>Tariffe ARERA</b> non ancora pubblicate: ultimi valori noti mantenuti.</li></ul></div>
  <p class="small mut">Fonti: ${h(ind.pun.fonte)} · ${h(ind.psv.fonte)} · ${h(ind.cdispd.fonte)}</p>`;
  $("#dAgg").onclick = async () => {
    S.datiUrl = $("#dUrl").value.trim(); salva();
    const r = await aggiornaDati(true);
    if (r) vistaDati();
  };
}

async function aggiornaDati(manuale = false) {
  if (!S.datiUrl || S.datiUrl.includes("UTENTE/REPO")) { if (manuale) toast("Indirizzo dei dati non configurato"); return false; }
  try {
    const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(S.datiUrl + (S.datiUrl.includes("?") ? "&" : "?") + "t=" + Date.now(), { signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const nuovi = await r.json();
    if (!nuovi?.tariffe?.luce || !nuovi?.indici?.pun) throw new Error("file dati non valido");
    const cambiato = nuovi.aggiornato_al !== S.dati.aggiornato_al;
    S.dati = nuovi; salva(); statoDati();
    if (manuale) toast(cambiato ? `Dati aggiornati al ${nuovi.aggiornato_al}` : "Dati già aggiornati");
    else if (cambiato) { toast(`Dati aggiornati al ${nuovi.aggiornato_al}`); VISTE[S.tab]?.(); }
    return true;
  } catch (e) {
    if (manuale) toast("Aggiornamento non riuscito (" + e.message + "). Uso i dati salvati.", 4000);
    return false;
  }
}

const VISTE = { confronto: vistaConfronto, offerte: vistaOfferte, consumi: vistaConsumi, dati: vistaDati };
statoDati();
vai("confronto");
aggiornaDati(false);
