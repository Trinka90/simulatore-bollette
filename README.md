# Simulatore Bollette (Android)

App Android che confronta **tutte le offerte luce e gas del mercato libero** (grandi e piccoli venditori)
e mostra per ognuna 12 bollette mensili complete, voce per voce, sui tuoi consumi.

## Installare l'app
1. Dal telefono apri la pagina **Releases** di questo repository.
2. Scarica l'ultimo file `SimulatoreBollette-x.y.z.apk` e aprilo.
3. La prima volta Android chiede di consentire l'installazione da questa fonte: conferma.

Gli aggiornamenti si installano sopra la versione precedente: profilo e CTE restano.

## Da dove vengono le offerte
Dal **Portale Offerte** di ARERA e Acquirente Unico, dove per legge ogni venditore deve pubblicare tutte
le sue offerte. Il Portale pubblica ogni giorno gli open data (licenza CC-BY):
- `PO_Offerte_E_MLIBERO_AAAAMMGG.xml` e `PO_Offerte_G_…`: offerte luce e gas, con prezzi, quote fisse,
  sconti e condizioni, dispacciamento, componenti regolate, zone, scadenza di sottoscrizione;
- `PO_Parametri_Mercato_Libero_E/G_AAAAMMGG.csv`: reti, oneri di sistema, dispacciamento, accisa luce, IVA.

Il Portale **rifiuta le connessioni dai server cloud** (anche da GitHub), quindi il download lo fa il
telefono: ogni giorno alla prima apertura, oppure dal pulsante *Scarica le offerte di oggi* (scheda Info).
L'app contiene un elenco iniziale (06/10/2026) che viene sostituito dal primo aggiornamento.

## Come si usa
- **Offerte**: scegli Luce o Gas. In alto c'è la più conveniente per te (con il risparmio rispetto alle Tutele Graduali o alla tua offerta),
  sotto la classifica completa. Cerchi un fornitore per nome e filtri con un tocco: prezzo fisso o variabile, fornitori conosciuti,
  senza penali, senza deposito.
- **Dettaglio**: totale annuo, «In breve» con sconti, prezzi promozionali, penali, deposito e vincoli in parole semplici,
  chi è il fornitore con i link alle recensioni (Trustpilot e Google), poi prezzi, condizioni, bolletta su misura e le 12 bollette.
- **Luce + Gas**: i pacchetti dual dello stesso fornitore (file `PO_Offerte_D` del Portale) confrontati con la miglior luce + il miglior gas separati.
- **La mia offerta**: carica le **bollette in PDF** (formato Bolletta 2.0): consumi, potenza, comune, residenza, canone e codice offerta.
  Dal codice ritrovo la tua offerta nel catalogo ARERA e la metto in classifica come «la tua offerta attuale», con il risparmio vero.
  Più bollette ricostruiscono i consumi mese per mese. Si possono caricare anche CTE o inserire i prezzi a mano.
- **Consumi**: oltre ai dati a mano, import del file CSV del **Portale Consumi ARERA** (o e-distribuzione / distributore gas):
  valori ogni 15 minuti, orari, giornalieri, mensili o letture del contatore; dai dati quartorari calcola la ripartizione F1/F2/F3 reale.
- **Avvisi**: soglia di risparmio, offerte seguite (prezzo cambiato, scadenza vicina, uscita dal mercato), andamento della migliore offerta.
  Il controllo avviene all'apertura dell'app, quando si scaricano le offerte del giorno.
- **Consumi**: comune, data di passaggio, consumi annui o mese per mese, bolletta online e domiciliazione (decidono quali sconti valgono).

## Internet casa (fibra, FTTC, FWA)
- **Scheda Internet**: offerte dei principali operatori (TIM, Fastweb, Vodafone, WINDTRE, Iliad, Sky, Tiscali, EOLO, Linkem) e dei
  fornitori di energia che vendono la fibra (Plenitude, Enel, Iren, Edison). Classifica per **costo totale in 12, 24 o 36 mesi**:
  canone promozionale e poi pieno, attivazione, rate del modem, sconti se hai già il mobile o la luce/gas dello stesso operatore.
- Per ogni offerta: vincolo, costo di uscita dopo 12 e 24 mesi (rate residue del modem comprese), chiamate, fonte e data di verifica,
  link alla mappa di copertura AGCOM e alle recensioni. I dati non pubblicati dalla fonte sono segnalati, non inventati.
- **Il tuo abbonamento**: a mano o dal PDF della sintesi contrattuale; il risparmio è calcolato sullo stesso orizzonte.
- **Luce/gas + internet**: le offerte energia riservate a chi attiva anche la fibra (Plenitude «Fibra», Enel «Luce e Giga»,
  Iren/SEV «Connettività», Newtec) escono dalla classifica luce/gas, perché il loro prezzo non comprende internet, e vengono
  confrontate qui come pacchetto completo contro la miglior energia + il miglior internet presi separatamente.
- Non esiste un open data delle offerte telefoniche: il catalogo `data/internet.json` è raccolto a mano (pagine degli operatori,
  sintesi contrattuali, comparatori) e va aggiornato; l'app lo riceve con gli aggiornamenti automatici.

## Fornitori e recensioni
Tutti i venditori sul Portale sono autorizzati, ma la qualità del servizio cambia. L'app indica se un fornitore è un grande
operatore nazionale, una multiutility locale o un piccolo fornitore (classificazione fatta a mano sui principali marchi,
`src/fornitori.js`) e apre le recensioni aggiornate su Trustpilot e Google. ARERA pubblica i reclami per venditore solo in forma
anonima, quindi non esiste una valutazione ufficiale per nome.

## Come calcola
Le regole sono quelle del Portale Offerte (*Regole per il calcolo della spesa*, v4.0 del 16/02/2026),
applicate bolletta per bolletta:
- **Vendita**: componenti del venditore (anche a fasce, a scaglioni di consumo, con prezzi a tempo),
  indice PUN/PSV del mese per le variabili (PUN + perdite di rete 10%), dispacciamento, PCV, PPE, CCR, QVD;
- **Rete e oneri**: parametri ARERA del giorno; gas per ambito tariffario della regione, a scaglioni;
- **Imposte**: accisa luce (esenzione residenti fino a 3 kW), accisa e addizionale gas per regione;
- **Sconti**: solo quelli senza condizioni, oppure legati a bolletta online / domiciliazione se li scegli;
- **IVA** 10% luce; gas 10% fino a 480 Smc/anno e 22% oltre e sulle quote fisse; **canone RAI** opzionale.

Verifiche (`npm test`): due offerte calcolate dal Portale (luce 1.274,92 €, gas 1.732,03 €) riprodotte entro
pochi centesimi; tre bollette reali (Hera, Estra, Enel) al centesimo; 528 offerte confrontate con il motore indipendente
PO_ENGIE_T1 (verificato sul Portale) entro 1 € o 1%. Su tutte le 3.518 offerte del 06/10/2026: luce 98-99% entro 1 €,
gas 99,8% entro l'1%; le differenze restanti sono motivate (Peak/OffPeak contati due volte dal riferimento, sconti a tempo, sconti %).

## Dati di mercato (`data/dati.json`)
PUN e PSV mensili, metodo di simulazione dei mesi futuri, aliquote gas per regione, CCR/PPE e la copia di
riserva dei parametri ARERA. Per aggiungere il mese chiuso: modifica il file su GitHub e aggiungi il valore in
`indici.pun.mesi` e `indici.psv.mesi`; l'app lo scarica alla prima apertura.

## Sviluppo
```
npm ci
npm test          # motore e lettura del tracciato XML
npm run build     # crea www/app.js
npx cap sync android
node scripts/catalogo-iniziale.mjs <cartella xml> AAAA-MM-GG   # rigenera l'elenco iniziale
```
Ogni push su `main` compila l'APK con GitHub Actions e lo pubblica in Releases.
La chiave di firma `android/app/firma-app.keystore` è nel repository: va bene per un'app personale, non per il Play Store.
