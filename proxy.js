const http = require('http');

// CONFIGURATION INFRASTRUCTURE
const PC_IP = '192.168.5.215'; 
const OLLAMA_INF_PORT = 11434; 
const OLLAMA_MGMT_PORT = 3000; 
const PROXY_PORT = 11430;

// CONFIGURATION DES URLS
const MGMT_START_URL = `http://${PC_IP}:${OLLAMA_MGMT_PORT}/start`;
const MGMT_STOP_URL = `http://${PC_IP}:${OLLAMA_MGMT_PORT}/stop`;
const UPSNAP_URL = 'http://192.168.2.80:8090/api/nodes/mathieu-rtx/wake';

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

                // --- GESTION DU START ---
                if (cmd.includes("START")) {
                    console.log(`\n[${new Date().toLocaleTimeString()}] >>> ACTION: START`);
                    console.log(`[LOG] Tentative d'appel API de gestion : ${MGMT_START_URL}`);

                    const callStartApi = () => {
                        return new Promise((resolve) => {
                            const startReq = http.get(MGMT_START_URL, { timeout: 2000 }, (apiRes) => {
                                console.log(`[LOG] Réponse API Management : Status ${apiRes.statusCode}`);
                                resolve(apiRes.statusCode < 500);
                            });
                            
                            startReq.on('error', (err) => {
                                console.log(`[LOG] Erreur API Management (PC probablement OFF) : ${err.message}`);
                                resolve(false);
                            });
                            
                            startReq.on('timeout', () => {
                                console.log(`[LOG] Timeout sur l'API Management (Port 3000 muet)`);
                                startReq.destroy();
                                resolve(false);
                            });
                        });
                    };

                    const apiSuccess = await callStartApi();

                    if (apiSuccess) {
                        console.log(`[LOG] Succès : Ordre de lancement transmis au PC.`);
                        const msg = "✅ PC en ligne. L'ordre de lancement 'ollama serve' a été transmis au gestionnaire (Port 3000).";
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                    } else {
                        console.log(`[LOG] Echec API : Déclenchement UpSnap pour réveil matériel...`);
                        
                        const upSnapReq = http.request(UPSNAP_URL, { method: 'POST' }, (uRes) => {
                            console.log(`[LOG] UpSnap a répondu avec le code : ${uRes.statusCode}`);
                        });
                        
                        upSnapReq.on('error', (e) => console.log(`[LOG] ERREUR CRITIQUE UPSNAP : ${e.message}`));
                        upSnapReq.end();

                        const msg = "⚠️ PC injoignable. J'ai envoyé un signal de réveil WoL via UpSnap. Attends 1 min que Windows boot, puis relance START.";
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                    }
                }

                // --- GESTION DU STOP ---
                if (cmd.includes("STOP")) {
                    console.log(`\n[${new Date().toLocaleTimeString()}] >>> ACTION: STOP`);
                    const callStopApi = () => {
                        return new Promise((resolve) => {
                            http.get(MGMT_STOP_URL, (r) => resolve(r.statusCode < 500))
                                .on('error', () => resolve(false));
                        });
                    };
                    const stopped = await callStopApi();
                    console.log(`[LOG] Résultat Stop : ${stopped ? "Transmis" : "Echec (PC OFF?)"}`);
                    const msg = stopped ? "🛑 Ordre d'arrêt transmis à la RTX." : "❌ Impossible de joindre le PC pour l'arrêt.";
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                }

                // --- PROXY STANDARD (INFÉRENCE) ---
                console.log(`[${new Date().toLocaleTimeString()}] PROXY: Transfert vers Ollama (11434)...`);
                const proxyReq = http.request({
                    host: PC_IP, port: OLLAMA_INF_PORT, path: req.url, method: 'POST',
                    headers: req.headers, timeout: 3000 
                }, (pcRes) => {
                    pcRes.on('data', () => {}); // On consomme pour les logs si besoin
                    res.writeHead(pcRes.statusCode, pcRes.headers);
                    pcRes.pipe(res);
                });

                proxyReq.on('error', () => {
                    console.log(`[LOG] Ollama (11434) ne répond pas.`);
                    const fallbackMsg = "Service Ollama hors ligne sur la RTX. Utilise START pour l'activer.";
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
        // Redirection GET (tags)
        http.get(`http://${PC_IP}:${OLLAMA_INF_PORT}${req.url}`, (pcRes) => pcRes.pipe(res))
            .on('error', () => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
            });
    }
});

server.listen(PROXY_PORT, () => console.log(`[SYSTEM] Proxy Node avec Logs actifs sur port ${PROXY_PORT}`));
