const http = require('http');

const PC_IP = '192.168.5.215'; 
const OLLAMA_INF_PORT = 11434; 
const OLLAMA_MGMT_PORT = 3000; 
const PROXY_PORT = 11430;

// On teste juste la racine pour le PC Up
const MGMT_BASE_URL = `http://${PC_IP}:${OLLAMA_MGMT_PORT}/`;
const MGMT_START_URL = `http://${PC_IP}:${OLLAMA_MGMT_PORT}/start`;
const MGMT_STOP_URL = `http://${PC_IP}:${OLLAMA_MGMT_PORT}/stop`;
const OLLAMA_TAGS_URL = `http://${PC_IP}:${OLLAMA_INF_PORT}/api/tags`;
const UPSNAP_URL = 'http://192.168.2.80:8090/api/nodes/mathieu-rtx/wake';

const debugLog = (ctx, msg, data = null) => {
    console.log(`[${new Date().toLocaleTimeString()}] [${ctx}] ${msg}`);
    if (data) console.log(`[DEBUG-DATA]`, data);
};

const verboseFetch = (url, method = 'POST') => {
    return new Promise((resolve) => {
        const start = Date.now();
        debugLog('FETCH', `${method} -> ${url}`);
        
        const req = http.request(url, { method, timeout: 3000 }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                debugLog('RES', `Retour ${url} [Status: ${res.statusCode}] [${Date.now() - start}ms]`);
                if (body) debugLog('BODY', body);
                // On considère OK si le serveur répond, peu importe le code (même 404 ou 405) pour le check PC
                resolve({ ok: res.statusCode < 500, status: res.statusCode, body });
            });
        });

        req.on('error', (err) => {
            debugLog('ERR', `Echec ${url}: ${err.message}`);
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
                    debugLog('CMD', 'STATUS Check');
                    // Pour le PC, on teste juste la racine en GET
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
                    debugLog('CMD', 'START Sequence');
                    const pcCheck = await verboseFetch(MGMT_BASE_URL, 'GET');

                    if (pcCheck.ok) {
                        // On tente POST, si ça fait 405, l'API Node du PC n'accepte que GET
                        debugLog('START', 'PC OK, envoi /start (POST)');
                        const startRes = await verboseFetch(MGMT_START_URL, 'POST');
                        
                        const msg = startRes.ok ? "✅ Ordre START envoyé." : `❌ Erreur API (${startRes.status}).`;
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                    } else {
                        await verboseFetch(UPSNAP_URL, 'POST');
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: "⚠️ PC OFF. Signal UpSnap envoyé." }, done: true }));
                    }
                }

                // Inférence standard
                const proxyReq = http.request({
                    host: PC_IP, port: OLLAMA_INF_PORT, path: req.url, method: 'POST',
                    headers: req.headers, timeout: 5000 
                }, (pcRes) => {
                    res.writeHead(pcRes.statusCode, pcRes.headers);
                    pcRes.pipe(res);
                });
                proxyReq.on('error', () => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: { role: "assistant", content: "Ollama ne répond pas. Tape START." }, done: true }));
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
