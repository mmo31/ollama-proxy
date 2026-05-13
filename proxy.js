const http = require('http');

// CONFIGURATION INFRASTRUCTURE
const PC_IP = '192.168.5.215'; 
const OLLAMA_INF_PORT = 11434; 
const OLLAMA_MGMT_PORT = 3000; 
const PROXY_PORT = 11430;

// CONFIGURATION DES URLS
const MGMT_STATUS_URL = `http://${PC_IP}:${OLLAMA_MGMT_PORT}/status`; // Nouvelle route de check
const MGMT_START_URL = `http://${PC_IP}:${OLLAMA_MGMT_PORT}/start`;
const MGMT_STOP_URL = `http://${PC_IP}:${OLLAMA_MGMT_PORT}/stop`;
const OLLAMA_TAGS_URL = `http://${PC_IP}:${OLLAMA_INF_PORT}/api/tags`;
const UPSNAP_URL = 'http://192.168.2.80:8090/api/nodes/mathieu-rtx/wake';

// Fonction utilitaire pour tester une URL
const checkUrl = (url, timeout = 1500) => {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout }, (res) => resolve(res.statusCode < 500));
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
    });
};

const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                let lastUserMessage = (data.messages && data.messages.length > 0) 
                    ? data.messages[data.messages.length - 1].content : (data.prompt || "");
                
                const cmd = lastUserMessage.trim().toUpperCase();

                // --- 1. GESTION DU STATUS ---
                if (cmd.includes("STATUS")) {
                    console.log(`\n[${new Date().toLocaleTimeString()}] >>> ACTION: STATUS`);
                    const pcUp = await checkUrl(MGMT_STATUS_URL);
                    const ollamaUp = await checkUrl(OLLAMA_TAGS_URL);
                    
                    let responseMsg = `🖥️ **État du PC** : ${pcUp ? "ALLUMÉ ✅" : "ÉTEINT ❌"}\n`;
                    responseMsg += `🦙 **Ollama (11434)** : ${ollamaUp ? "DISPONIBLE ✅" : "ARRÊTÉ ❌"}\n`;

                    if (ollamaUp) {
                        // Si Ollama est UP, on tente de lister les modèles pour le user
                        try {
                            const tagsRaw = await new Promise((resolve) => {
                                http.get(OLLAMA_TAGS_URL, (r) => {
                                    let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(JSON.parse(d)));
                                });
                            });
                            const models = tagsRaw.models.map(m => `- ${m.name}`).join('\n');
                            responseMsg += `\n**Modèles dispos** :\n${models}`;
                        } catch (e) { responseMsg += "\n(Impossible de lister les modèles)"; }
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: { role: "assistant", content: responseMsg }, done: true }));
                }

                // --- 2. GESTION DU START ---
                if (cmd.includes("START")) {
                    console.log(`\n[${new Date().toLocaleTimeString()}] >>> ACTION: START`);
                    const pcUp = await checkUrl(MGMT_STATUS_URL);

                    if (pcUp) {
                        console.log("[LOG] PC déjà UP, envoi de l'ordre /start...");
                        await checkUrl(MGMT_START_URL);
                        const msg = "✅ Le PC était déjà allumé. L'ordre de lancement Ollama a été envoyé.";
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                    } else {
                        console.log("[LOG] PC éteint, appel UpSnap...");
                        http.request(UPSNAP_URL, { method: 'POST' }).end();
                        const msg = "⚠️ PC éteint. Signal de réveil envoyé via UpSnap. Attends 1 min puis relance START.";
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                    }
                }

                // --- 3. GESTION DU STOP ---
                if (cmd.includes("STOP")) {
                    console.log(`\n[${new Date().toLocaleTimeString()}] >>> ACTION: STOP`);
                    const stopped = await checkUrl(MGMT_STOP_URL);
                    const msg = stopped ? "🛑 Ordre d'arrêt Ollama transmis." : "❌ PC injoignable (déjà éteint ?).";
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                }

                // --- PROXY STANDARD (INFÉRENCE) ---
                const proxyReq = http.request({
                    host: PC_IP, port: OLLAMA_INF_PORT, path: req.url, method: 'POST',
                    headers: req.headers, timeout: 3000 
                }, (pcRes) => {
                    res.writeHead(pcRes.statusCode, pcRes.headers);
                    pcRes.pipe(res);
                });

                proxyReq.on('error', () => {
                    const fallbackMsg = "Service Ollama hors ligne. Tape STATUS ou START.";
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: { role: "assistant", content: fallbackMsg }, done: true }));
                });

                proxyReq.write(body);
                proxyReq.end();

            } catch (e) {
                console.log(`[ERREUR] ${e.message}`);
                res.writeHead(400); res.end("Error");
            }
        });
    } else {
        // Redirection GET standard
        http.get(`http://${PC_IP}:${OLLAMA_INF_PORT}${req.url}`, (pcRes) => pcRes.pipe(res))
            .on('error', () => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
            });
    }
});

server.listen(PROXY_PORT, () => console.log(`Proxy Node vStatus actif sur ${PROXY_PORT}`));
