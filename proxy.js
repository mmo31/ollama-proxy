const http = require('http');

const PC_IP = '192.168.5.215'; 
const OLLAMA_INF_PORT = 11434; 
const OLLAMA_MGMT_PORT = 3000; 
const PROXY_PORT = 11430;

const MGMT_BASE_URL = `http://${PC_IP}:${OLLAMA_MGMT_PORT}/`;
const MGMT_START_URL = `http://${PC_IP}:${OLLAMA_MGMT_PORT}/start`;
const MGMT_STOP_URL = `http://${PC_IP}:${OLLAMA_MGMT_PORT}/stop`;
const OLLAMA_TAGS_URL = `http://${PC_IP}:${OLLAMA_INF_PORT}/api/tags`;
const UPSNAP_URL = 'http://192.168.2.80:8090/api/nodes/mathieu-rtx/wake';

const debugLog = (ctx, msg) => {
    console.log(`[${new Date().toLocaleTimeString()}] [${ctx}] ${msg}`);
};

const verboseFetch = (url, method = 'GET') => {
    return new Promise((resolve) => {
        const start = Date.now();
        debugLog('FETCH', `${method} -> ${url}`);
        
        const req = http.request(url, { method, timeout: 2500 }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                debugLog('RES', `${url} [Status: ${res.statusCode}] [${Date.now() - start}ms]`);
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

                // --- 1. STATUS ---
                if (cmd.includes("STATUS")) {
                    debugLog('CMD', 'STATUS');
                    const pcCheck = await verboseFetch(MGMT_BASE_URL, 'GET');
                    const ollamaCheck = await verboseFetch(OLLAMA_TAGS_URL, 'GET');
                    
                    let msg = `🖥️ PC : ${pcCheck.ok ? "ALLUMÉ ✅" : "ÉTEINT ❌"}\n`;
                    msg += `🦙 Ollama : ${ollamaCheck.ok ? "DISPONIBLE ✅" : "ARRÊTÉ ❌"}`;

                    if (ollamaCheck.ok && ollamaCheck.body) {
                        try {
                            const tags = JSON.parse(ollamaCheck.body);
                            msg += `\n\n**Modèles** :\n${tags.models.map(m => `- ${m.name}`).join('\n')}`;
                        } catch (e) {}
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                }

                // --- 2. START ---
                if (cmd.includes("START")) {
                    debugLog('CMD', 'START');
                    const pcCheck = await verboseFetch(MGMT_BASE_URL, 'GET');

                    if (pcCheck.ok) {
                        // On passe en POST car le GET a renvoyé un 405
                        debugLog('START', 'Envoi /start (POST)');
                        const startRes = await verboseFetch(MGMT_START_URL, 'POST');
                        
                        const msg = startRes.ok ? "✅ Commande START (POST) envoyée." : `⚠️ Erreur API (${startRes.status}).`;
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                    } else {
                        await verboseFetch(UPSNAP_URL, 'POST');
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: "⚠️ PC OFF. Signal WoL envoyé." }, done: true }));
                    }
                }

                // --- 3. STOP ---
                if (cmd.includes("STOP")) {
                    debugLog('CMD', 'STOP');
                    const stopRes = await verboseFetch(MGMT_STOP_URL, 'POST');
                    const msg = stopRes.ok ? "🛑 Commande STOP envoyée." : "❌ Echec STOP.";
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                }

                // Inférence
                const proxyReq = http.request({
                    host: PC_IP, port: OLLAMA_INF_PORT, path: req.url, method: 'POST',
                    headers: req.headers, timeout: 5000 
                }, (pcRes) => {
                    res.writeHead(pcRes.statusCode, pcRes.headers);
                    pcRes.pipe(res);
                });
                proxyReq.on('error', () => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: { role: "assistant", content: "Ollama est OFF. Tape START." }, done: true }));
                });
                proxyReq.write(body);
                proxyReq.end();

            } catch (e) {
                res.writeHead(400); res.end("Error");
            }
        });
    } else {
        http.get(`http://${PC_IP}:${OLLAMA_INF_PORT}${req.url}`, (p) => p.pipe(res)).on('error', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
        });
    }
});

server.listen(PROXY_PORT, () => console.log(`[DEBUG] Proxy actif sur ${PROXY_PORT}`));
