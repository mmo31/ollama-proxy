const http = require('http');

const PC_IP = '192.168.5.215'; 
const OLLAMA_INF_PORT = 11434; 
const OLLAMA_MGMT_PORT = 3000; 
const PROXY_PORT = 11430;

// Utilisation stricte du GET comme prévu dans ton script PM2 initial
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
                // Un PC est "UP" si le serveur répond, même avec une erreur 404/405
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

                if (cmd.includes("START")) {
                    debugLog('CMD', 'START');
                    const pcCheck = await verboseFetch(MGMT_BASE_URL, 'GET');

                    if (pcCheck.ok) {
                        // FORCE GET ici pour correspondre à ton app Express
                        debugLog('START', 'PC répond, envoi /start (GET)');
                        const startRes = await verboseFetch(MGMT_START_URL, 'GET');
                        
                        const msg = (startRes.status === 200 || startRes.status === 404) 
                            ? "✅ Commande START envoyée au PC." 
                            : `⚠️ Réponse inattendue de l'API (${startRes.status}).`;
                        
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                    } else {
                        await verboseFetch(UPSNAP_URL, 'POST');
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: "⚠️ PC injoignable. Signal WoL envoyé." }, done: true }));
                    }
                }

                if (cmd.includes("STOP")) {
                    debugLog('CMD', 'STOP');
                    const stopRes = await verboseFetch(MGMT_STOP_URL, 'GET');
                    const msg = stopRes.ok ? "🛑 Commande STOP envoyée." : "❌ Echec de l'envoi STOP.";
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                }

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
