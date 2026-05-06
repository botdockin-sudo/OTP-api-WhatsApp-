const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    Browsers, 
    delay, 
    fetchLatestBaileysVersion 
} = require("@whiskeysockets/baileys");
const express = require("express");
const pino = require("pino");

const app = express();
const port = process.env.PORT || 10000;

let sock;
let isConnected = false;

// ---------------------------------------------------------
// MEMORY STORAGE: Bina database ke data yahan save hoga
// ---------------------------------------------------------
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

    // MESSAGE RECEIVE LOGIC
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid.replace(/[^0-9]/g, '');
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (text && text.startsWith("VERIFY-")) {
            const receivedCode = text.split("-")[1];

            // Check if this number has a pending code in Memory
            const storedData = verificationStore.get(sender);

            if (storedData && storedData.code === receivedCode) {
                // Mark as verified in Memory
                verificationStore.set(sender, { ...storedData, verified: true });
                
                await sock.sendMessage(msg.key.remoteJid, { 
                    text: "✅ Verification Successful! Aapka number verify ho gaya hai." 
                });
                console.log(`Number ${sender} verified!`);
            }
        }
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            isConnected = false;
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                setTimeout(startWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            isConnected = true;
            console.log("✅ WhatsApp Connected!");
        }
    });
}

// 1. Pairing Code Route (Connect hone ke liye)
app.get("/pair", async (req, res) => {
    let num = req.query.number;
    if (!num) return res.send("Number please? ?number=91...");
    num = num.replace(/[^0-9]/g, '');
    try {
        await delay(3000); 
        const code = await sock.requestPairingCode(num);
        res.send(`<body style='font-family:sans-serif;text-align:center;padding-top:50px;'>
                    <h1>Pairing Code: <span style='color:#25D366'>${code}</span></h1>
                    <p>Is code ko WhatsApp mein dalein.</p>
                  </body>`);
    } catch (err) { res.send(err.message); }
});

// 2. Link Generator (Website ke liye)
app.get("/get-link", (req, res) => {
    const { number } = req.query;
    if (!number) return res.json({ error: "Number missing" });

    const cleanNumber = number.replace(/[^0-9]/g, '');
    const randomCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Memory (Map) mein save karein
    verificationStore.set(cleanNumber, { 
        code: randomCode, 
        verified: false, 
        timestamp: Date.now() 
    });

    // Aapka Bot Number yahan dalein
    const botNumber = "919693521763"; 
    const waLink = `https://wa.me/${botNumber}?text=VERIFY-${randomCode}`;
    
    res.json({ link: waLink });
});

// 3. Status Checker (Website ke liye)
app.get("/status", (req, res) => {
    const { number } = req.query;
    const cleanNumber = number.replace(/[^0-9]/g, '');

    const data = verificationStore.get(cleanNumber);
    
    if (data && data.verified) {
        // Verification ke baad memory se delete kar do (Safai)
        // verificationStore.delete(cleanNumber); 
        return res.json({ verified: true });
    }
    
    res.json({ verified: false });
});

app.get("/", (req, res) => {
    res.send(isConnected ? "✅ Connected" : "❌ Not Connected. Go to /pair");
});

app.listen(port, () => {
    console.log(`Server started on port ${port}`);
    startWhatsApp();
});
