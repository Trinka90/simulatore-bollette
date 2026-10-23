// Export PDF (jsPDF + autotable). Su Android salva nella cache e apre la condivisione.
import { jsPDF } from "jspdf";
import { applyPlugin } from "jspdf-autotable";
applyPlugin(jsPDF);
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { eur, nf, descrizionePrezzo, descrUtenza, durata, meseIt, dataIt, TIPI } from "./testi.js";
import { eVariabile, totaleMesi } from "./bolletta.js";

const PRI = [15, 76, 92], SIM = [163, 90, 0], OK = [29, 122, 70], MUT = [93, 104, 117];
const oggi = () => new Date().toLocaleDateString("it-IT");
const GRUPPI = [["vendita", "Spesa per la materia energia"], ["rete", "Trasporto e gestione del contatore"], ["oneri", "Oneri di sistema"],
  ["imposte", "Imposte"], ["iva", "IVA"], ["altro", "Altre partite (fuori campo IVA)"]];
// jsPDF con i font standard non ha "€" in tutte le posizioni: si normalizzano i caratteri speciali
const t = (s) => String(s ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/–|—/g, "-").replace(/…/g, "...");

function nuovo(titolo, sotto) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...PRI);
  doc.text(t(titolo), 14, 18);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...MUT);
  doc.text(doc.splitTextToSize(t(sotto), 182), 14, 24);
  return doc;
}

function avvisoSimulazione(doc, y) {
  doc.setFillColor(253, 240, 220); doc.setDrawColor(240, 201, 138);
  const testo = doc.splitTextToSize("SIMULAZIONE - non sono fatture reali. Reti, oneri, accise e IVA sono i valori ufficiali ARERA; " +
    "i valori marcati SIMULATO (indici PUN/PSV futuri, tariffe dei trimestri non ancora pubblicati) sono stime: per ognuno sono indicate la cifra applicata e l'origine.", 176);
  const hgt = testo.length * 4 + 6;
  doc.roundedRect(14, y, 182, hgt, 2, 2, "FD");
  doc.setTextColor(60, 40, 0); doc.setFontSize(8.5); doc.text(testo, 17, y + 5);
  return y + hgt + 4;
}

function pie(doc) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(...MUT);
    doc.text(`Simulatore Bollette · generato il ${oggi()} · pagina ${i}/${n}`, 14, 290);
  }
}

const stileTab = { styles: { fontSize: 8, cellPadding: 1.4, textColor: [22, 32, 42] }, headStyles: { fillColor: PRI, textColor: 255, fontSize: 7.5 },
  margin: { left: 14, right: 14 }, theme: "grid" };
const coloraTipo = (data) => {
  if (data.section !== "body") return;
  const v = String(data.cell.raw);
  if (v === "SIMULATO") { data.cell.styles.textColor = SIM; data.cell.styles.fontStyle = "bold"; }
  if (v === "REALE") { data.cell.styles.textColor = OK; data.cell.styles.fontStyle = "bold"; }
};

function metodo(doc, dati, y) {
  const met = dati.indici.metodo_simulazione;
  doc.autoTable({ ...stileTab, startY: y, head: [["Valore", "Origine"]],
    body: [["Offerte", "Open data del Portale Offerte ARERA (licenza CC-BY)"],
      ["Reti, oneri, dispacciamento, accisa luce, IVA", "Parametri ARERA pubblicati dal Portale Offerte; trimestri futuri: ultimi valori mantenuti (SIMULATO)"],
      ["Accisa e addizionale gas", "Aliquote 2026 per regione"],
      ["PUN", t(met.pun)], ["PSV", t(met.psv)],
      ["Scenari (offerte variabili)", `basso = simulati x ${met.scenari.basso}; alto = simulati x ${met.scenari.alto}. I mesi reali non cambiano.`]],
    columnStyles: { 0: { cellWidth: 55, fontStyle: "bold" } } });
  return doc.lastAutoTable.finalY + 6;
}

/** PDF della classifica. */
export async function pdfConfronto(lista, forn, u, dati, catalogo) {
  const unita = forn === "LUCE" ? "kWh" : "Smc";
  const doc = nuovo(`Classifica offerte ${forn === "LUCE" ? "luce" : "gas"}`,
    `12 bollette da ${meseIt(u.ingresso)} · ${descrUtenza(u, forn)} · offerte del Portale Offerte al ${dataIt(catalogo?.data)}`);
  const y = avvisoSimulazione(doc, 34);
  const best = lista[0]?.centrale || 0;
  doc.autoTable({ ...stileTab, startY: y,
    head: [["#", "Offerta", "Prezzo", "Tipo", "Firma entro", "Totale 12 mesi", "Media/mese", `€/${unita} tutto compreso`, "Differenza"]],
    body: lista.map((r, i) => [i + 1, t(`${r.offerta.venditore}\n${r.offerta.nome}${r.offerta.mia ? " (tua CTE)" : ""}`), t(descrizionePrezzo(r.offerta)),
      `${TIPI[r.offerta.tipo] || ""}${eVariabile(r.offerta) && r.alto > r.basso ? `\n${eur(r.basso, 0)} - ${eur(r.alto, 0)}` : ""}`,
      r.offerta.al && r.offerta.al < "2090" ? dataIt(r.offerta.al) : "-", eur(r.centrale), eur(r.centrale / 12), nf(r.costoMedio, 4),
      i === 0 ? "migliore" : "+" + eur(r.centrale - best, 0)]),
    columnStyles: { 0: { cellWidth: 6 }, 1: { cellWidth: 42 }, 5: { fontStyle: "bold", halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" } },
    didParseCell: (d) => { if (d.section === "body" && d.row.index === 0) d.cell.styles.fillColor = [227, 243, 234]; } });
  metodo(doc, dati, doc.lastAutoTable.finalY + 6);
  pie(doc);
  await salva(doc, `classifica_${forn.toLowerCase()}_${u.ingresso}.pdf`);
}

/** PDF delle 12 bollette dettagliate di un'offerta. */
export async function pdfBollette(o, ris, scenario, u, dati) {
  const mesi = ris[scenario];
  const unita = o.forn === "LUCE" ? "kWh" : "Smc";
  const doc = nuovo(`${o.venditore} - ${o.nome}`, `${o.forn === "LUCE" ? "Energia elettrica" : "Gas naturale"} · ${descrizionePrezzo(o)} · ${durata(o)} · ` +
    `scenario ${scenario} · ${descrUtenza(u, o.forn)} · ${o.fonte}`);
  let y = avvisoSimulazione(doc, 38);
  doc.autoTable({ ...stileTab, startY: y, head: [["Mese", `Consumo ${unita}`, ...Object.keys(ris).map((s) => `Totale ${s}`), "Valori"]],
    body: mesi.map((m, i) => [m.etichetta, nf(m.consumo, 1), ...Object.keys(ris).map((s) => eur(ris[s][i].risultato.totale)), m.simulato ? "SIMULATO" : "REALE"]),
    foot: [["Totale", nf(mesi.reduce((s, m) => s + m.consumo, 0), 0), ...Object.keys(ris).map((s) => eur(totaleMesi(ris[s]))), ""]],
    footStyles: { fillColor: PRI, textColor: 255 }, didParseCell: coloraTipo });
  y = metodo(doc, dati, doc.lastAutoTable.finalY + 6);
  const avvisi = [...new Set(mesi.flatMap((m) => m.risultato.avvisi))];
  if (avvisi.length) doc.autoTable({ ...stileTab, startY: y, head: [["Da sapere"]], body: avvisi.map((x) => [t(x)]) });
  for (const m of mesi) {
    doc.addPage();
    const r = m.risultato;
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...PRI);
    doc.text(`Bolletta simulata - ${m.etichetta}`, 14, 16);
    doc.setFontSize(9); doc.setTextColor(...(m.simulato ? SIM : OK));
    doc.text(m.simulato ? "CONTIENE VALORI SIMULATI" : "VALORI REALI", 196, 16, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setTextColor(...MUT);
    doc.text(t(`${o.venditore} · ${o.nome} · ${m.periodo.giorni} giorni · consumo ${nf(m.consumo, 3)} ${unita} · scenario ${scenario}`).slice(0, 130), 14, 22);
    const body = [];
    for (const [g, tit] of GRUPPI) {
      const voci = r.voci.filter((x) => x.gruppo === g);
      if (!voci.length) continue;
      body.push([{ content: tit, colSpan: 3, styles: { fontStyle: "bold", fillColor: [227, 239, 242] } },
        { content: eur(r.gruppo(g)), styles: { fontStyle: "bold", halign: "right", fillColor: [227, 239, 242] } }]);
      for (const x of voci) {
        body.push([t(x.descrizione), g === "iva" ? `su ${eur(x.quantita)}` : x.unita ? `${nf(x.quantita, 3)} ${x.unita}` : "",
          g === "iva" ? `${Math.round(x.prezzo * 100)}%` : x.unita ? nf(x.prezzo, 6) : "", eur(x.importo)]);
      }
    }
    doc.autoTable({ ...stileTab, startY: 26, head: [["Voce", "Quantità", "Prezzo unitario", "Importo"]], body,
      foot: [[{ content: "TOTALE BOLLETTA", colSpan: 3 }, { content: eur(r.totale), styles: { halign: "right" } }]],
      footStyles: { fillColor: PRI, textColor: 255, fontSize: 10 },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } } });
    doc.autoTable({ ...stileTab, startY: doc.lastAutoTable.finalY + 5, head: [["Valore applicato", "Tipo", "Cifra", "Origine"]],
      body: m.applicati.map((a) => [t(a.nome), a.tipo, a.valore == null ? "" : `${nf(a.valore, 6)} ${a.unita}`, t(a.nota)]),
      columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 20 }, 2: { cellWidth: 30, halign: "right" } }, didParseCell: coloraTipo });
  }
  pie(doc);
  const slug = (o.nome || "offerta").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
  await salva(doc, `bollette_${slug}_${scenario}.pdf`);
}

async function salva(doc, nome) {
  if (Capacitor.isNativePlatform()) {
    const base64 = doc.output("datauristring").split(",")[1];
    const w = await Filesystem.writeFile({ path: nome, data: base64, directory: Directory.Cache });
    await Share.share({ title: nome, url: w.uri, dialogTitle: "Salva o invia il PDF" });
  } else {
    doc.save(nome);
  }
}
