import * as pdfjs from "pdfjs-dist";
import { analizza, bozzaOfferta, testoPdf } from "./cte.js";
import { contesto, simulaOfferta, totaleMesi, riepilogoOfferta, bollettaPersonalizzata, consumiMensili, daCte, eVariabile } from "./bolletta.js";
import { aggiornaCatalogo, filtra, classifica, scadenza, SITUAZIONI } from "./catalogo.js";
import { scaricaTesto, salvaCatalogo, caricaCatalogo, catalogoIniziale, nativo } from "./archivio.js";
import { isoGiorno } from "./opendata.js";
import { pdfConfronto, pdfBollette } from "./esporta.js";
import { eur, nf, dataIt, meseIt, MESI_NOMI, descrizionePrezzo, TIPI, CANALI, PAGAMENTI, ATTIVAZIONI, CONDIZIONI,
  VALIDITA_SCONTO, NOMI_REGOLATE, CONDIZIONI_SCONTO, durata, descrUtenza } from "./testi.js";
import { DATI_URL } from "./config.js";
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
  luce: { attiva: true, potenzaKw: 6, annuo: 3175, mesi: null, ripartizione: { F1: 0.33, F2: 0.31, F3: 0.36 }, canoneRai: true },
  gas: { attiva: true, annuo: 39, mesi: { 1: 4, 2: 3, 3: 4, 4: 4, 5: 2, 6: 3, 7: 2, 8: 3, 9: 3, 10: 3, 11: 4, 12: 4 }, uso: "cottura", zona: "D" },
};
function migraUtenza(v) {
  if (!v) return structuredClone(UTENZA_DEF);
  if (v.versione === 3) return v;
  const n = structuredClone(UTENZA_DEF);
  if (v.luce) Object.assign(n.luce, { attiva: v.luce.attiva, potenzaKw: v.luce.potenzaKw, annuo: v.luce.consumoAnnuoKwh, mesi: v.luce.profilo,
    ripartizione: v.luce.ripartizione || n.luce.ripartizione, canoneRai: v.luce.canoneRai });
  if (v.luce) n.residente = v.luce.residente;
  if (v.gas) Object.assign(n.gas, { attiva: v.gas.attiva, annuo: v.gas.consumoAnnuoSmc, mesi: v.gas.profilo, uso: v.gas.riscaldamento ? "entrambi" : "cottura" });
  return n;
}

const S = {
  tab: "offerte", forn: "LUCE", filtroTipo: "tutte", cerca: "", quante: 30,
  utenza: migraUtenza(LS.get("utenza", null)),
  cte: LS.get("cte", LS.get("offerte", [])),
  dati: LS.get("dati", datiInclusi),
  auto: LS.get("auto", "giorno"),
  catalogo: null, aggiornando: false, avanzamento: "",
};
if ((S.dati.versione || 0) < datiInclusi.versione || S.dati.aggiornato_al < datiInclusi.aggiornato_al) S.dati = datiInclusi;
const salva = () => { LS.set("utenza", S.utenza); LS.set("cte", S.cte); LS.set("dati", S.dati); LS.set("auto", S.auto); };
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
const TITOLI = { offerte: "Offerte", cte: "Le mie CTE", profilo: "Profilo e consumi", dati: "Dati" };
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
async function avviaCatalogo() {
  S.catalogo = await caricaCatalogo();
  if (!S.catalogo) { try { S.catalogo = await catalogoIniziale(); } catch (e) { console.error(e); } }
  statoChip();
  VISTE[S.tab]();
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
    S.catalogo = nuovo; cache.clear();
    await salvaCatalogo(nuovo);
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
function chiave(forn) { return JSON.stringify([forn, U(), S.catalogo?.data, S.catalogo?.offerte.length, S.dati.aggiornato_al, S.cte.length, S.cte.map((c) => c.id + c.incluso)]); }
function offerteCte(forn) {
  return S.cte.filter((o) => o.fornitura === forn && o.incluso !== false && cteCompleta(o)).map(daCte);
}
function calcolaClassifica(forn) {
  const k = chiave(forn);
  if (cache.has(k)) return cache.get(k);
  const u = U(), ctx = CTX();
  const f = filtra(S.catalogo?.offerte || [], u, S.dati.regolate, oggiIso());
  const lista = classifica([...f[forn], ...offerteCte(forn)], u, ctx);
  const out = { lista, escluse: f.escluse[forn], nValide: f[forn].length };
  cache.set(k, out);
  return out;
}

// ------------------------------------------------------------------ OFFERTE
async function vistaOfferte() {
  const v = $("#vista"), u = U();
  if (!S.catalogo) { v.innerHTML = `<div class="empty"><span class="spin"></span><p>Carico le offerte…</p></div>`; return; }
  const att = S.forn === "LUCE" ? u.luce.attiva : u.gas.attiva;
  if (!att && (u.luce.attiva || u.gas.attiva)) S.forn = u.luce.attiva ? "LUCE" : "GAS";
  const k = chiave(S.forn);
  if (!cache.has(k)) {
    v.innerHTML = `<div class="empty"><span class="spin"></span><p>Calcolo 12 bollette per ogni offerta…</p></div>`;
    await attendi();
  }
  const R = calcolaClassifica(S.forn);
  const vecchio = S.catalogo.data < isoGiorno(new Date(Date.now() - 2 * 86400000));
  let lista = R.lista;
  if (S.filtroTipo !== "tutte") lista = lista.filter((r) => (S.filtroTipo === "fisso" ? !eVariabile(r.offerta) : eVariabile(r.offerta)));
  if (S.cerca) { const q = S.cerca.toLowerCase(); lista = lista.filter((r) => `${r.offerta.venditore} ${r.offerta.nome}`.toLowerCase().includes(q)); }
  const best = R.lista[0]?.centrale ?? 0;
  const mie = R.lista.filter((r) => r.offerta.mia);

  let html = `<div class="card small prof" id="vaiProfilo" role="button">
      <div><b>${h(u.comune?.nome || "Comune?")}</b> · ${u.residente ? "residente" : "non residente"} · passaggio da <b>${meseIt(u.ingresso)}</b></div>
      <div class="mut">${h(descrUtenza(u, S.forn))}</div><div class="link">Modifica profilo e consumi ›</div></div>
    <div class="seg" id="sForn"><button data-v="LUCE" class="${S.forn === "LUCE" ? "on" : ""}" ${u.luce.attiva ? "" : "disabled"}>Luce</button>
      <button data-v="GAS" class="${S.forn === "GAS" ? "on" : ""}" ${u.gas.attiva ? "" : "disabled"}>Gas</button></div>
    <div class="small mut" style="margin:8px 2px">${R.nValide} offerte disponibili per te tra quelle pubblicate sul Portale Offerte ARERA il ${dataIt(S.catalogo.data)}${S.catalogo.iniziale ? " (elenco iniziale incluso nell'app)" : ""}.</div>
    ${vecchio ? `<div class="warn small">Le offerte sono del ${dataIt(S.catalogo.data)}. ${S.aggiornando ? `<span id="avanz">${h(S.avanzamento)}</span>` : `<button class="btn sec mini" id="aggOra">Aggiorna ora</button>`}</div>` : ""}
    <div class="row filtri"><div class="seg" id="sTipo">${["tutte", "fisso", "variabile"].map((t) => `<button data-v="${t}" class="${S.filtroTipo === t ? "on" : ""}">${t === "tutte" ? "Tutte" : t === "fisso" ? "Fisse" : "Variabili"}</button>`).join("")}</div></div>
    <input id="cerca" placeholder="Cerca fornitore o offerta" value="${h(S.cerca)}" style="margin-top:8px">`;
  if (mie.length) {
    html += `<div class="card small"><b>Le tue CTE in classifica</b>${mie.map((r) => `<div class="row sp" style="margin-top:4px"><span>${h(r.offerta.nome)}</span>
      <span class="r"><b>${R.lista.indexOf(r) + 1}ª</b> su ${R.lista.length} · ${r === R.lista[0] ? "la più conveniente" : "+" + eur(r.centrale - best, 0) + "/anno"}</span></div>`).join("")}</div>`;
  }
  if (!lista.length) html += `<div class="empty">Nessuna offerta con questi filtri.</div>`;
  const max = Math.max(...lista.slice(0, S.quante).map((r) => r.alto));
  lista.slice(0, S.quante).forEach((r) => {
    const o = r.offerta, pos = R.lista.indexOf(r) + 1, sc = scadenza(o, oggiIso()), variab = eVariabile(o);
    html += `<div class="card ${o.mia ? "mia" : ""}" data-det="${h(o.id)}" role="button">
      <div class="rank"><div class="pos ${pos === 1 ? "p1" : ""}">${pos}</div>
        <div class="min0"><b>${h(o.venditore)}</b><div class="small">${h(o.nome)}</div>
          <div class="small mut">${h(descrizionePrezzo(o))}</div></div>
        <div class="r"><div class="tot">${eur(r.centrale, 0)}</div><div class="small mut">${eur(r.centrale / 12)}/mese</div></div></div>
      <div class="barbox"><div class="bar" style="width:${(r.centrale / max) * 100}%"></div>
        ${variab && r.alto > r.basso ? `<div class="rng" style="left:${(r.basso / max) * 100}%;width:${((r.alto - r.basso) / max) * 100}%"></div>` : ""}</div>
      <div class="row small tags">${o.mia ? badge("LA TUA CTE", "mia") : ""}${badge(TIPI[o.tipo] || "FISSO", variab ? "var" : "reale")}
        ${sc ? `<span class="b ${sc.giorni <= 7 ? "urg" : "sc"}">firma entro ${dataIt(sc.al)}</span>` : ""}
        <span class="r grow">${pos === 1 ? badge("PIÙ CONVENIENTE", "best") : `+${eur(r.centrale - best, 0)}/anno`}</span></div>
      <div class="small mut" style="margin-top:4px">${nf(r.costoMedio, 3)} €/${S.forn === "LUCE" ? "kWh" : "Smc"} tutto compreso${variab && r.alto > r.basso ? ` · scenari ${eur(r.basso, 0)}–${eur(r.alto, 0)}` : ""}</div>
    </div>`;
  });
  if (lista.length > S.quante) html += `<button class="btn sec full" id="altre">Mostra altre ${Math.min(30, lista.length - S.quante)} (di ${lista.length})</button>`;
  const esc = Object.entries(R.escluse || {});
  if (esc.length) html += `<details class="card small"><summary><b>${esc.reduce((s, [, n]) => s + n, 0)} offerte escluse</b> perché non valgono per te</summary>
    <ul>${esc.sort((a, b) => b[1] - a[1]).map(([m, n]) => `<li>${n} — ${h(m)}</li>`).join("")}</ul></details>`;
  html += `<div class="warn small"><b>Come leggere i totali.</b> Ogni totale è la somma di 12 bollette da ${meseIt(u.ingresso)}, con tutte le voci:
    materia energia, dispacciamento, trasporto, oneri, accise, IVA${S.forn === "LUCE" && u.luce.canoneRai ? ", canone RAI" : ""} e sconti senza condizioni${u.bollettaWeb ? " o legati alla bolletta online" : ""}.
    Reti, oneri e accise sono i valori ufficiali ARERA. Per le offerte variabili i mesi futuri usano un indice ${badge("SIMULATO")}.</div>
    <button class="btn sec full" id="pdfConf">Esporta la classifica in PDF</button>`;
  v.innerHTML = html;
  $("#vaiProfilo").onclick = () => vai("profilo");
  $$("#sForn button").forEach((b) => (b.onclick = () => { S.forn = b.dataset.v; S.quante = 30; vistaOfferte(); }));
  $$("#sTipo button").forEach((b) => (b.onclick = () => { S.filtroTipo = b.dataset.v; S.quante = 30; vistaOfferte(); }));
  $("#cerca").oninput = (e) => { clearTimeout(vistaOfferte._t); vistaOfferte._t = setTimeout(() => { S.cerca = e.target.value.trim(); S.quante = 30; vistaOfferte().then(() => { const c = $("#cerca"); c.focus(); c.setSelectionRange(c.value.length, c.value.length); }); }, 300); };
  $("#altre") && ($("#altre").onclick = () => { S.quante += 30; vistaOfferte(); });
  $("#aggOra") && ($("#aggOra").onclick = () => aggiorna(true));
  $$("[data-det]").forEach((c) => c.addEventListener("click", () => vistaDettaglio(c.dataset.det)));
  $("#pdfConf").onclick = () => esegui(() => pdfConfronto(R.lista.slice(0, 30), S.forn, u, S.dati, S.catalogo), "classifica");
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
const trovaOfferta = (id) => (S.catalogo?.offerte || []).find((o) => o.id === id) || offerteCte("LUCE").concat(offerteCte("GAS")).find((o) => o.id === id);

function schedaOfferta(o) {
  const sc = scadenza(o, oggiIso());
  const righe = [];
  if (!o.mia) {
    righe.push(["Durata", durata(o)]);
    righe.push(["Sottoscrivibile", `${o.dal ? "dal " + dataIt(o.dal) : ""} ${sc ? `fino al <b>${dataIt(sc.al)}</b> (${sc.giorni <= 0 ? "ultimo giorno" : "tra " + sc.giorni + " giorni"})` : "senza scadenza indicata"}`]);
    if (o.att.length) righe.push(["Vale per", o.att.map((x) => ATTIVAZIONI[x] || x).join(", ")]);
    if (o.canali.length) righe.push(["Si attiva", o.canali.map((x) => CANALI[x] || x).join(", ")]);
    if (o.pag.length) righe.push(["Pagamento", o.pag.map((x) => PAGAMENTI[x] || x).join(", ")]);
    if (o.zone) righe.push(["Zone", "offerta limitata ad alcune zone (comprende la tua)"]);
    if (o.garanzie) righe.push(["Garanzie", h(o.garanzie)]);
    if (o.serv.length) righe.push(["Servizi inclusi", h(o.serv.join(", "))]);
  }
  righe.push(["Fonte", h(o.fonte)]);
  let html = `<div class="card small"><table class="kv">${righe.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>
    ${o.descr ? `<p class="mut">${h(o.descr)}</p>` : ""}
    <div class="row">${o.url ? `<a class="btn sec" href="${h(o.url)}" target="_blank" rel="noopener">Pagina dell'offerta</a>` : ""}${o.tel ? `<a class="btn sec" href="tel:${h(o.tel)}">Chiama ${h(o.tel)}</a>` : ""}</div></div>`;
  // cosa si paga al venditore
  const comp = o.comp.map((c) => `<li><b>${h(c.n)}</b>${c.opz ? ` <span class="mut">(dichiarata facoltativa${c.m === "06" ? ": non conteggiata" : ""})</span>` : ""}: ${c.p.map((p) =>
    `${p.f && o.fasce !== "01" ? ({ "01": "F1", "02": "F2", "03": "F3", "91": "F2+F3", "07": "Peak", "08": "OffPeak" }[p.f] || p.f) + " " : ""}${nf(p.pr)} ${{ "01": "€/anno", "02": "€/kW anno", "03": "€/kWh", "04": "€/Smc", "05": "€ una tantum" }[p.u] || ""}${p.dur ? ` per ${p.dur} mesi` : ""}${p.fino ? ` fino a ${p.fino}` : ""}${p.da != null || p.a ? ` (consumi ${nf(p.da || 0, 0)}–${p.a ? nf(p.a, 0) : "∞"})` : ""}`).join("; ")}</li>`);
  const disp = o.disp.length ? `<li><b>Dispacciamento</b>: ${o.disp.map((d) => d.v > 0 ? `${nf(d.v)} €/kWh` : "valori ARERA").join(", ")}</li>` : "";
  const reg = o.reg.length ? `<li><b>Componenti regolate</b>: ${o.reg.map((x) => NOMI_REGOLATE[x] || x).join(", ")} (valori ARERA)</li>` : "";
  const idx = eVariabile(o) ? `<li><b>Indice</b>: ${o.forn === "LUCE" ? "PUN" : "PSV"} del mese${o.forn === "LUCE" ? " + perdite di rete 10%" : ""}${o.idx[0]?.k && o.idx[0].k !== 1 ? ` × ${o.idx[0].k}` : ""}${o.tetto ? `, con prezzo massimo ${nf(o.tetto)} €/kWh` : ""}</li>` : "";
  const sconti = o.sc.map((s) => `<li><b>${h(s.n)}</b>: ${s.p.map((p) => `${nf(p.pr)} ${{ "01": "€/anno", "02": "€/kW", "03": "€/kWh", "04": "€/Smc", "05": "€", "06": "%" }[p.u] || ""}`).join(", ")}
    — ${VALIDITA_SCONTO[s.val] || ""}${s.dur ? `, per ${s.dur} mesi` : ""}; condizione: ${s.cond === "99" ? h(s.condD || "altra condizione") : CONDIZIONI_SCONTO[s.cond] || "nessuna"}${s.iva ? "" : "; non soggetto a IVA"}</li>`);
  html += `<div class="card small"><b>Cosa paghi al venditore</b><ul>${idx}${comp.join("")}${disp}${reg}</ul>
    ${sconti.length ? `<b>Sconti</b><ul>${sconti.join("")}</ul>` : ""}</div>`;
  if (o.cond?.length) {
    const lim = o.cond.filter((c) => c.lim), altre = o.cond.filter((c) => !c.lim);
    html += `<details class="card small"><summary><b>Condizioni contrattuali</b>${lim.length ? ` — ${lim.length} limitant${lim.length > 1 ? "i" : "e"}` : ""}</summary>
      <ul>${[...lim, ...altre].map((c) => `<li>${c.lim ? badge("LIMITANTE", "urg") + " " : ""}<b>${CONDIZIONI[c.t] || "Altro"}</b>: ${h(c.d)}</li>`).join("")}</ul></details>`;
  }
  return html;
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
  const avvisi = [...new Set(mesi.flatMap((m) => m.risultato.avvisi))];
  $("#titolo").textContent = "Dettaglio offerta";
  let html = `<button class="btn sec" id="indietro">‹ Indietro</button>
    <h2>${h(o.venditore)} — ${h(o.nome)}</h2>
    <div class="row small tags">${o.mia ? badge("LA TUA CTE", "mia") : ""}${badge(TIPI[o.tipo] || "FISSO", eVariabile(o) ? "var" : "reale")}<span class="mut grow">${h(descrizionePrezzo(o))}</span></div>`;
  if (scen.length > 1) {
    html += `<div class="seg" style="margin:12px 0">${scen.map((s) => `<button data-sc="${s}" class="${s === scenario ? "on" : ""}">${s} ${eur(totaleMesi(ris[s]), 0)}</button>`).join("")}</div>`;
  }
  html += `<div class="kpi"><div><span class="small mut">12 bollette</span><b>${eur(tot)}</b></div>
    <div><span class="small mut">Media al mese</span><b>${eur(tot / 12)}</b></div>
    <div><span class="small mut">Costo vero</span><b>${nf((tot - altro) / cons, 4)} €/${unita}</b><span class="small mut">tutto compreso</span></div></div>`;
  if (avvisi.length) html += `<div class="warn small"><b>Da sapere</b><ul>${avvisi.map((x) => `<li>${h(x)}</li>`).join("")}</ul></div>`;
  html += schedaOfferta(o);
  // bolletta su misura
  const L = o.forn === "LUCE";
  html += `<div class="card"><b>Quanto pagherei per una bolletta precisa?</b>
    <div class="small mut">Scrivi il periodo e il consumo di una tua bolletta: calcolo tutte le voci con questa offerta.</div>
    <div class="row"><div><label>Dal</label><input type="date" id="bDal" value="${u.ingresso}-01"></div><div><label>Al</label><input type="date" id="bAl"></div></div>
    <label>Consumo totale (${unita})</label><input inputmode="decimal" id="bQ" placeholder="es. ${L ? "800" : "120"}">
    ${L ? `<details><summary class="small">Consumo per fascia (facoltativo)</summary><div class="row">${["F1", "F2", "F3"].map((f) => `<div><label>${f} kWh</label><input inputmode="decimal" data-bf="${f}"></div>`).join("")}</div></details>` : ""}
    <button class="btn full" id="bCalc" style="margin-top:10px">Calcola la bolletta</button><div id="bRis"></div></div>`;
  html += `<h2>Le 12 bollette mese per mese</h2>`;
  html += mesi.map((m, i) => `<details class="m" ${i === 0 ? "open" : ""}><summary><span>${m.etichetta} ${badge(m.simulato ? "SIMULATO" : "REALE")}</span>
      <span class="num">${eur(m.risultato.totale)}</span></summary><div>
      <div class="small mut" style="margin-bottom:6px">Consumo ${nf(m.consumo, 1)} ${unita} · ${m.periodo.giorni} giorni · ${i === 0 ? "prima bolletta" : `mese ${i + 1} di fornitura`}</div>
      ${tabellaVoci(m.risultato)}${tabellaApplicati(m.applicati)}
    </div></details>`).join("");
  html += `<button class="btn full" id="pdfBoll" style="margin-top:12px">Esporta le 12 bollette in PDF</button>`;
  $("#vista").innerHTML = html;
  window.scrollTo(0, 0);
  // fine periodo di default: un mese (luce bimestrale non obbligatoria)
  const d = new Date(`${u.ingresso}-01T00:00:00Z`); const f = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  $("#bAl").value = f.toISOString().slice(0, 10);
  $("#indietro").onclick = () => vai(o.mia ? "cte" : "offerte");
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
  let html = `<p class="small mut" style="margin-top:0">Hai una CTE che non trovi nell'elenco, o vuoi confrontare la tua offerta attuale?
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
  <h2>PUN ultimi mesi <span class="mut small">€/kWh</span></h2><div class="card"><table><tr><th>Mese</th><th class="r">F0</th><th class="r">F1</th><th class="r">F2</th><th class="r">F3</th></tr>
    ${pun.map(([k, v]) => `<tr><td>${k}</td>${["F0", "F1", "F2", "F3"].map((f) => `<td class="r num">${nf(v[f], 4)}</td>`).join("")}</tr>`).join("")}</table></div>
  <h2>PSV ultimi mesi <span class="mut small">€/Smc</span></h2><div class="card"><table>
    ${psv.map(([k, v]) => `<tr><td>${k}</td><td class="r num">${nf(v, 4)}</td></tr>`).join("")}</table></div>
  <h2>Da dove vengono i numeri</h2><div class="card small"><ul style="padding-left:18px;margin:0">
    <li><b>Offerte</b>: open data del Portale Offerte (ARERA e Acquirente Unico, licenza CC-BY), dove ogni venditore deve pubblicare tutte le sue offerte.</li>
    <li><b>Trasporto, oneri di sistema, dispacciamento, accisa luce, IVA</b>: parametri ARERA pubblicati ogni giorno dal Portale Offerte. Nei trimestri non ancora pubblicati restano gli ultimi valori ${badge("SIMULATO")}.</li>
    <li><b>Accisa e addizionale gas</b>: aliquote 2026 per regione. <b>CCR e PPE</b>: ${h(d.regolate.ccr.fonte)}.</li>
    <li><b>Regole di calcolo</b>: quelle del Portale Offerte (v4.0, 16/02/2026), applicate bolletta per bolletta. Verificate al centesimo su due offerte calcolate dal Portale e sulle tue bollette Hera, Estra ed Enel.</li>
    <li><b>PUN</b>: ${h(met.pun)}</li><li><b>PSV</b>: ${h(met.psv)}</li>
    <li><b>Scenari</b> delle offerte variabili: basso ×${met.scenari.basso}, alto ×${met.scenari.alto} sui soli valori simulati.</li></ul></div>`;
  $("#dAgg") && ($("#dAgg").onclick = () => { if (!nativo()) { toast("Il download funziona nell'app Android"); return; } aggiorna(true); vistaDati(); });
  $$("#dAuto button").forEach((b) => (b.onclick = () => { S.auto = b.dataset.v; salva(); vistaDati(); }));
}

const VISTE = { offerte: vistaOfferte, cte: vistaCte, profilo: vistaProfilo, dati: vistaDati };
vai("offerte");
avviaCatalogo();
