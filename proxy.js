const http = require('http');

// CONFIGURATION INFRASTRUCTURE
const PC_IP = '192.168.5.215'; 
const OLLAMA_INF_PORT = 11434; 
const OLLAMA_MGMT_PORT = 3000; 
const PROXY_PORT = 11430;

// URLS DE L'API PC (Basées sur ton historique)
const MGMT_BASE = `http://${PC_IP}:${OLLAMA_MGMT_PORT}/`;
const MGMT_START = `http://${PC_IP}:${OLLAMA_MGMT_PORT}/start-ollama`; // URL mise à jour
const MGMT_STOP = `http://${PC_IP}:${OLLAMA_MGMT_PORT}/stop-ollama`;   // URL mise à jour
const OLLAMA_TAGS = `http://${PC_IP}:${OLLAMA_INF_PORT}/api/tags`;
const UPSNAP_URL = 'http://192.168.2.80:8090/api/nodes/mathieu-rtx/wake';

const debugLog = (ctx, msg) => console.log(`[${new Date().toLocaleTimeString()}] [${ctx}] ${msg}`);

const verboseFetch = (url, method = 'GET') => {
    return new Promise((resolve) => {
        const req = http.request(url, { method, timeout: 2500 }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                debugLog('RES', `${method} ${url} -> ${res.statusCode}`);
                resolve({ ok: res.statusCode < 500, status: res.statusCode, body });
            });
        });
        req.on('error', (err) => {
            debugLog('ERR', `${url}: ${err.message}`);
            resolve({ ok: false, err: err.message });
        });
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, err: 'timeout' }); });
        req.end();
    });
};

const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const lastUserMessage = (data.messages?.length > 0) 
                    ? data.messages[data.messages.length - 1].content : (data.prompt || "");
                const cmd = lastUserMessage.trim().toUpperCase();

                // --- COMMANDE STATUS ---
                if (cmd.includes("STATUS")) {
                    debugLog('CMD', 'STATUS Check');
                    const pcCheck = await verboseFetch(MGMT_BASE, 'GET');
                    const ollamaCheck = await verboseFetch(OLLAMA_TAGS, 'GET');
                    
                    let msg = `🖥️ **PC (Bressols)** : ${pcCheck.ok ? "ALLUMÉ ✅" : "ÉTEINT ❌"}\n`;
                    msg += `🦙 **Ollama (RTX)** : ${ollamaCheck.ok ? "PRÊT ✅" : "ARRÊTÉ ❌"}`;
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                }

                // --- COMMANDE START ---
                if (cmd.includes("START")) {
                    debugLog('CMD', 'START Sequence');
                    const pcCheck = await verboseFetch(MGMT_BASE, 'GET');

                    if (pcCheck.ok) {
                        debugLog('START', 'PC OK, envoi start-ollama (POST + GET)');
                        // On tente les deux pour être sûr de matcher le script PM2
                        await verboseFetch(MGMT_START, 'POST');
                        await verboseFetch(MGMT_START, 'GET');
                        
                        const msg = "✅ Commande de lancement envoyée au gestionnaire Ollama.";
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                    } else {
                        debugLog('START', 'PC Down, réveil UpSnap');
                        await verboseFetch(UPSNAP_URL, 'POST');
                        const msg = "⚠️ PC injoignable. Signal de réveil envoyé via UpSnap.";
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                    }
                }

                // --- COMMANDE STOP ---
                if (cmd.includes("STOP")) {
                    debugLog('CMD', 'STOP Sequence');
                    await verboseFetch(MGMT_STOP, 'POST');
                    await verboseFetch(MGMT_STOP, 'GET');
                    const msg = "🛑 Commande d'arrêt envoyée à la RTX.";
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                }

                // --- PROXY INFERENCE STANDARD ---
                const proxyReq = http.request({
                    host: PC_IP, port: OLLAMA_INF_PORT, path: req.url, method: 'POST',
                    headers: req.headers, timeout: 5000 
                }, (pcRes) => {
                    res.writeHead(pcRes.statusCode, pcRes.headers);
                    pcRes.pipe(res);
                });
                proxyReq.on('error', () => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: { role: "assistant", content: "Ollama est éteint. Tape START." }, done: true }));
                });
                proxyReq.write(body);
                proxyReq.end();

            } catch (e) {
                res.writeHead(400); res.end("Error");
            }
        });
    } else {
        // Redirection GET (tags)
        http.get(`http://${PC_IP}:${OLLAMA_INF_PORT}${req.url}`, (p) => p.pipe(res)).on('error', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
        });
    }
});

server.listen(PROXY_PORT, () => console.log(`[OK] Proxy configuré sur ${PROXY_PORT} avec URLs spécifiques.`));