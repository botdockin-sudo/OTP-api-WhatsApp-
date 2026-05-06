const { default: makeWASocket, useMultiFileAuthState, Browsers, delay, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const { createClient } = require('@supabase/supabase-js');
const express = require("express");
const pino = require("pino");

// 1. Supabase Details (Apni wali dalein)
const supabase = createClient('https://yrqrymnjadgmubutzixj.supabase.co', 'YAHAN_APNI_ANON_KEY_DALEIN');

const app = express();
let sock;
let isConnected = false;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        auth: state,
        version,
        logger: pino({ level: 'silent' }),
        // Render ke liye ye sabse stable browser signature hai
        browser: Browsers.macOS("Desktop"),
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000
    });

    sock.ev.on('creds.update', saveCreds);

    // Verify logic
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const sender = msg.key.remoteJid.replace(/[^0-9]/g, '');
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (text && text.startsWith("VERIFY-")) {
            const code = text.split("-")[1];
            const { error } = await supabase.from('verified_users').update({ is_verified: true }).eq('phone_number', sender).eq('code', code);
            if (!error) await sock.sendMessage(msg.key.remoteJid, { text: "✅ Mobile Number Verified!" });
        }
    });

    sock.ev.on('connection.update', (u) => {
        const { connection } = u;
        if (connection === 'open') isConnected = true;
        if (connection === 'close') { isConnected = false; setTimeout(startBot, 5000); }
    });
}

// Pairing Code Endpoint
app.get("/pair", async (req, res) => {
    let num = req.query.number;
    if (!num) return res.send("Number please? ?number=91...");
    num = num.replace(/[^0-9]/g, '');
    try {
        await delay(5000);
        const code = await sock.requestPairingCode(num);
        res.send(`<h1 style='font-family:sans-serif;'>Code: ${code}</h1>`);
    } catch (e) { res.send(e.message); }
});

// Website Link Generator
app.get("/get-link", async (req, res) => {
    const num = req.query.number;
    const code = Math.floor(100000 + Math.random() * 900000);
    await supabase.from('verified_users').upsert({ phone_number: num, code: code.toString(), is_verified: false });
    res.json({ link: `https://wa.me/919693521763?text=VERIFY-${code}` });
});

// Website Status Checker
app.get("/status", async (req, res) => {
    const { data } = await supabase.from('verified_users').select('is_verified').eq('phone_number', req.query.number).single();
    res.json({ verified: data?.is_verified || false });
});

app.listen(process.env.PORT || 10000, () => startBot());
