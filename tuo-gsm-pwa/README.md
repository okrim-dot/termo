# Termostato TUO GSM: controllo via SMS

App web installabile ([PWA](https://it.wikipedia.org/wiki/Progressive_web_app)) per comandare il cronotermostato Vemer TUO GSM (VE771800 / VE771900) con un'interfaccia chiara. Funziona su iPhone e Android, **non usa internet per comunicare col termostato**: prepara gli [SMS](https://it.wikipedia.org/wiki/Short_Message_Service) e interpreta le risposte.

## Come funziona

Una web app non può né inviare né leggere SMS da sola (iOS e Android non lo permettono ai browser). Il flusso è quindi:

1. Tocchi un pulsante (es. **Spegni**). Compare un pop-up con il testo esatto dell'SMS.
2. Premi **Conferma**: si apre l'app Messaggi con numero e testo già pronti. Premi Invio lì.
3. Quando il termostato risponde, copi il messaggio e nell'app premi **Incolla risposta**. L'interfaccia si aggiorna.

La richiesta di sola lettura (**Aggiorna** = `CRONO INFO TUTTO`) salta il pop-up: l'SMS comunque parte solo dopo il tuo Invio in Messaggi.

## Pubblicazione gratuita su GitHub Pages

1. Crea un repository **pubblico** su GitHub (le Pages gratuite lo richiedono) e carica tutti i file di questa cartella.
2. *Settings → Pages → Build and deployment → Deploy from a branch → main / (root) → Save*.
3. Dopo un minuto l'app è su `https://TUO-UTENTE.github.io/NOME-REPO/`.

**Non scrivere mai nel codice numeri di telefono o password.** Si inseriscono dall'interfaccia (*Impostazioni dell'app*) e restano solo nella memoria del telefono ([localStorage](https://it.wikipedia.org/wiki/Web_storage)). L'app non fa richieste di rete verso altri siti (lo impone anche una [Content Security Policy](https://it.wikipedia.org/wiki/Content_Security_Policy)).

In alternativa puoi servire la cartella dal tuo server Proxmox: serve però HTTPS valido e raggiungibile dall'esterno.

## Installazione sul telefono

- **iPhone (Safari)**: Condividi → *Aggiungi alla schermata Home*.
- **Android (Chrome)**: menu ⋮ → *Installa app* (o *Aggiungi a schermata Home*).

Alla prima apertura: *Impostazioni dell'app* → inserisci il numero della SIM del termostato → Salva. Se il tuo numero **non** è in rubrica nel termostato, spunta anche l'invio della password SMS (di fabbrica `1234`, meglio cambiarla).

## Rendere automatica la lettura delle risposte

### iPhone: app Comandi (Shortcuts)

*Automazione → Crea automazione personale → Messaggio*: mittente = numero del termostato. Azioni, a scelta:

- **Variante appunti (consigliata)**: azione *Copia negli appunti* con il testo del messaggio (*Input comando rapido*). Poi nell'app basta **Incolla risposta**.
- **Variante URL**: *Codifica URL* sul testo, poi *Apri URL* con `https://TUO-UTENTE.github.io/NOME-REPO/#r=` seguito dal testo codificato. L'app importa il testo dall'indirizzo e lo ripulisce.

Da verificare sul tuo iPhone: i nomi delle azioni cambiano tra versioni di iOS, e l'opzione *Esegui subito* (senza conferma) non è disponibile in tutte. Inoltre su iOS l'app aggiunta alla Home e Safari **di norma hanno dati separati**: la variante URL apre Safari, quindi i dati importati finiscono lì e non nell'app installata. Se usi la variante URL, usa il sito direttamente in Safari.

### Android

Senza un'app nativa non c'è lettura automatica: copia il messaggio (tocco lungo → *Copia*) e usa **Incolla risposta**. Se vuoi automatizzare, app gratuite come MacroDroid o Tasker possono reagire a un SMS in arrivo e aprire lo stesso indirizzo `#r=` della variante URL.

## Cosa si può modificare dall'app

Tutto ciò che il manuale permette via SMS: funzionamento (spento / manuale / automatico, con durata facoltativa), stagione (riscaldamento / condizionamento), Tm, T0 (antigelo), T1/T2/T3, rubrica, soglie di allarme minima e massima, destinatari degli allarmi (incluso mancanza corrente), inoltro dei messaggi non riconosciuti, password SMS, numero SIM, sincronizzazione orologio, contaore.

**Non modificabili via SMS** (il manuale non prevede comandi): i programmi orari P1–P7, la retroilluminazione, il differenziale e il tipo di regolazione. Si cambiano solo dal display del termostato.

## Cose da sapere / non verificate

- Il formato delle risposte è stato ricavato dai sei esempi reali forniti. Le risposte non ancora viste (modo automatico, `COUNTER`, allarmi) sono interpretate in modo tollerante; i valori che l'app non riconosce compaiono sotto *Altri valori ricevuti* e nel *Registro messaggi*, così si può correggere il parser.
- `CRONO INFO TUTTO` **non restituisce T1/T2/T3**: l'app mostra l'ultimo valore noto (da una risposta a un tuo comando) oppure "valore non noto".
- L'invio di più comandi in un solo SMS (T1/T2/T3 insieme) è previsto dal manuale (max 3) ma non è stato provato sul dispositivo: al primo uso prova con due valori.
- L'avviso di **mancanza corrente** del termostato arriva, nell'uso reale, solo al ritorno della corrente. L'app non può cambiarlo.
- Il termostato usa solo la rete 2G/GSM: se l'operatore la spegne nella zona, smette di funzionare (app inclusa).

## Struttura dei file

| File | Ruolo |
|---|---|
| `index.html`, `style.css`, `app.js` | interfaccia |
| `lib.js` | interpretazione risposte e costruzione/validazione comandi (nessuna dipendenza) |
| `sw.js`, `manifest.webmanifest`, `icons/` | installazione e uso offline |
| `test/test-lib.js` | test della libreria: `node test/test-lib.js` |

App non ufficiale, non affiliata a Vemer S.p.A.
