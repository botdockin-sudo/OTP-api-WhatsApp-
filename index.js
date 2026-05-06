import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason, 
    Browsers, 
    delay, 
    fetchLatestBaileysVersion 
} from "@whiskeysockets/baileys";
import express from "express";
import pino from "pino";

const app = express();
const port = process.env.PORT || 10000;

let sock;
let isConnected = false;
const verificationStore = new Map(); 

async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        auth: state,
        version: version,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu("Chrome"),
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid.replace(/[^0-9]/g, '');
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (text && text.startsWith("VERIFY-")) {
            const receivedCode = text.split("-")[1];
            const storedData = verificationStore.get(sender);

            if (storedData && storedData.code === receivedCode) {
                verificationStore.set(sender, { ...storedData, verified: true });
                await sock.sendMessage(msg.key.remoteJid, { 
                    text: "✅ Verification Successful!" 
                });
            }
        }
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            isConnected = false;
            // Agar logout nahi hua hai toh reconnect karein
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                setTimeout(startWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            isConnected = true;
            console.log("✅ WhatsApp Connected!");
        }
    });
}

app.get("/pair", async (req, res) => {
    let num = req.query.number;
    if (!num) return res.send("Number missing? ?number=91...");
    num = num.replace(/[^0-9]/g, '');
    try {
        await delay(3000); 
        const code = await sock.requestPairingCode(num);
        res.send(`<body style='font-family:sans-serif;text-align:center;'><h1>Code: ${code}</h1></body>`);
    } catch (err) { res.send(err.message); }
});

app.get("/get-link", (req, res) => {
    const { number } = req.query;
    if (!number) return res.json({ error: "Number missing" });
    const cleanNumber = number.replace(/[^0-9]/g, '');
    const randomCode = Math.floor(100000 + Math.random() * 900000).toString();
    verificationStore.set(cleanNumber, { code: randomCode, verified: false });
    const waLink = `https://wa.me/919693521763?text=VERIFY-${randomCode}`;
    res.json({ link: waLink });
});

app.get("/status", (req, res) => {
    const { number } = req.query;
    const cleanNumber = number.replace(/[^0-9]/g, '');
    const data = verificationStore.get(cleanNumber);
    res.json({ verified: data?.verified || false });
});

app.get("/", (req, res) => {
    res.send(isConnected ? "Connected ✅" : "Not Connected ❌ /pair use karein");
});

app.listen(port, () => {
    console.log(`Server on port ${port}`);
    startWhatsApp();
});
