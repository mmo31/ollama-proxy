const http = require('http');

// CONFIGURATION INFRASTRUCTURE
const PC_IP = '192.168.5.215'; 
const OLLAMA_INF_PORT = 11434; 
const OLLAMA_MGMT_PORT = 3000; 
const PROXY_PORT = 11430;

const MGMT_STATUS_URL = `http://${PC_IP}:${OLLAMA_MGMT_PORT}/status`;
const MGMT_START_URL = `http://${PC_IP}:${OLLAMA_MGMT_PORT}/start`;
const MGMT_STOP_URL = `http://${PC_IP}:${OLLAMA_MGMT_PORT}/stop`;
const OLLAMA_TAGS_URL = `http://${PC_IP}:${OLLAMA_INF_PORT}/api/tags`;
const UPSNAP_URL = 'http://192.168.2.80:8090/api/nodes/mathieu-rtx/wake';

// Helper de log enrichi
const debugLog = (ctx, msg, data = null) => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] [${ctx}] ${msg}`);
    if (data) console.log(`[DEBUG-DATA]`, JSON.stringify(data, null, 2));
};

// Helper d'appel API avec log détaillé du retour
const verboseFetch = (url, method = 'GET') => {
    return new Promise((resolve) => {
        const start = Date.now();
        debugLog('FETCH', `Appel ${method} -> ${url}`);
        
        const req = http.request(url, { method, timeout: 3000 }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                const duration = Date.now() - start;
                debugLog('RES', `Retour de ${url} [Status: ${res.statusCode}] [Durée: ${duration}ms]`);
                debugLog('BODY', body || "(corps vide)");
                resolve({ ok: res.statusCode < 500, status: res.statusCode, body });
            });
        });

        req.on('error', (err) => {
            debugLog('ERR', `Echec de l'appel vers ${url}: ${err.message}`);
            resolve({ ok: false, err: err.message });
        });
        
        req.on('timeout', () => {
            debugLog('TIMEOUT', `L'URL ${url} n'a pas répondu assez vite.`);
            req.destroy();
            resolve({ ok: false, err: 'timeout' });
        });
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
                const lastUserMessage = (data.messages && data.messages.length > 0) 
                    ? data.messages[data.messages.length - 1].content : (data.prompt || "");
                const cmd = lastUserMessage.trim().toUpperCase();

                // --- STATUS ---
                if (cmd.includes("STATUS")) {
                    debugLog('CMD', 'Traitement commande STATUS');
                    const pcStatus = await verboseFetch(MGMT_STATUS_URL);
                    const ollamaStatus = await verboseFetch(OLLAMA_TAGS_URL);
                    
                    let responseMsg = `🖥️ **État du PC** : ${pcStatus.ok ? "ALLUMÉ ✅" : "ÉTEINT ❌"}\n`;
                    responseMsg += `🦙 **Ollama (11434)** : ${ollamaStatus.ok ? "DISPONIBLE ✅" : "ARRÊTÉ ❌"}\n`;

                    if (ollamaStatus.ok && ollamaStatus.body) {
                        try {
                            const tags = JSON.parse(ollamaStatus.body);
                            const models = tags.models.map(m => `- ${m.name}`).join('\n');
                            responseMsg += `\n**Modèles dispos** :\n${models}`;
                        } catch (e) { responseMsg += "\n(Erreur lecture modèles)"; }
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: { role: "assistant", content: responseMsg }, done: true }));
                }

                // --- START ---
                if (cmd.includes("START")) {
                    debugLog('CMD', 'Traitement commande START');
                    const pcCheck = await verboseFetch(MGMT_STATUS_URL);

                    if (pcCheck.ok) {
                        debugLog('START-FLOW', 'PC en ligne, déclenchement du script de lancement...');
                        const startResult = await verboseFetch(MGMT_START_URL);
                        const msg = startResult.ok ? "✅ Ordre transmis. Vérifie le port 11434 dans 10s." : "❌ L'API 3000 a renvoyé une erreur lors du START.";
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                    } else {
                        debugLog('START-FLOW', 'PC hors ligne, appel WoL UpSnap.');
                        await verboseFetch(UPSNAP_URL, 'POST');
                        const msg = "⚠️ PC éteint. Signal envoyé via UpSnap.";
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                    }
                }

                // --- PROXY STANDARD ---
                debugLog('PROXY', `Forward inférence -> ${req.url}`);
                const proxyReq = http.request({
                    host: PC_IP, port: OLLAMA_INF_PORT, path: req.url, method: 'POST',
                    headers: req.headers, timeout: 5000 
                }, (pcRes) => {
                    debugLog('PROXY-RES', `Ollama a répondu: ${pcRes.statusCode}`);
                    res.writeHead(pcRes.statusCode, pcRes.headers);
                    pcRes.pipe(res);
                });

                proxyReq.on('error', (err) => {
                    debugLog('PROXY-ERR', `Inférence échouée: ${err.message}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: { role: "assistant", content: "Ollama ne répond pas. Tape STATUS." }, done: true }));
                });

                proxyReq.write(body);
                proxyReq.end();

            } catch (e) {
                debugLog('FATAL', e.message);
                res.writeHead(400); res.end("Error");
            }
        });
    } else {
        // GET standard (tags)
        http.get(`http://${PC_IP}:${OLLAMA_INF_PORT}${req.url}`, (pcRes) => pcRes.pipe(res))
            .on('error', () => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
            });
    }
});

server.listen(PROXY_PORT, () => console.log(`[DEBUG-MODE] Proxy actif sur ${PROXY_PORT}`));
