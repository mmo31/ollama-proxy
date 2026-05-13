const http = require('http');

const PC_IP = '192.168.5.215'; 
const OLLAMA_INF_PORT = 11434; 
const OLLAMA_MGMT_PORT = 3000; 
const PROXY_PORT = 11430;

const MGMT_URLS = {
    base: `http://${PC_IP}:${OLLAMA_MGMT_PORT}/`,
    start: `http://${PC_IP}:${OLLAMA_MGMT_PORT}/start`,
    stop: `http://${PC_IP}:${OLLAMA_MGMT_PORT}/stop`
};
const OLLAMA_TAGS_URL = `http://${PC_IP}:${OLLAMA_INF_PORT}/api/tags`;
const UPSNAP_URL = 'http://192.168.2.80:8090/api/nodes/mathieu-rtx/wake';

const debugLog = (ctx, msg) => console.log(`[${new Date().toLocaleTimeString()}] [${ctx}] ${msg}`);

const verboseFetch = (url, method = 'GET') => {
    return new Promise((resolve) => {
        const req = http.request(url, { method, timeout: 2000 }, (res) => {
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

                // --- STATUS ---
                if (cmd.includes("STATUS")) {
                    debugLog('CMD', 'STATUS');
                    const pcCheck = await verboseFetch(MGMT_URLS.base, 'GET');
                    const ollamaCheck = await verboseFetch(OLLAMA_TAGS_URL, 'GET');
                    let msg = `🖥️ PC : ${pcCheck.ok ? "ALLUMÉ ✅" : "ÉTEINT ❌"}\n`;
                    msg += `🦙 Ollama : ${ollamaCheck.ok ? "DISPONIBLE ✅" : "ARRÊTÉ ❌"}`;
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                }

                // --- START (Séquence de force) ---
                if (cmd.includes("START")) {
                    debugLog('CMD', 'START Sequence triggered');
                    const pcCheck = await verboseFetch(MGMT_URLS.base, 'GET');

                    if (pcCheck.ok) {
                        debugLog('START', 'PC is UP. Trying multiple triggers...');
                        // On tente START en POST puis en GET si besoin
                        const r1 = await verboseFetch(MGMT_URLS.start, 'POST');
                        if (r1.status === 404 || r1.status === 405) {
                            debugLog('START', 'POST failed, trying GET /start...');
                            await verboseFetch(MGMT_URLS.start, 'GET');
                        }
                        
                        const msg = "✅ Signal START envoyé (vérification des méthodes effectuée).";
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                    } else {
                        verboseFetch(UPSNAP_URL, 'POST');
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: "⚠️ PC OFF. Signal WoL envoyé via UpSnap." }, done: true }));
                    }
                }

                // --- STOP ---
                if (cmd.includes("STOP")) {
                    await verboseFetch(MGMT_URLS.stop, 'POST');
                    await verboseFetch(MGMT_URLS.stop, 'GET');
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: { role: "assistant", content: "🛑 Signal STOP envoyé." }, done: true }));
                }

                // PROXY INFERENCE
                const proxyReq = http.request({
                    host: PC_IP, port: OLLAMA_INF_PORT, path: req.url, method: 'POST',
                    headers: req.headers, timeout: 5000 
                }, (pcRes) => {
                    res.writeHead(pcRes.statusCode, pcRes.headers);
                    pcRes.pipe(res);
                });
                proxyReq.on('error', () => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: { role: "assistant", content: "Ollama est OFF sur la RTX. Tape START." }, done: true }));
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

server.listen(PROXY_PORT, () => console.log(`[SYSTEM] Proxy Multi-Trigger actif sur ${PROXY_PORT}`));
