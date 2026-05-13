const http = require('http');

// CONFIGURATION INFRASTRUCTURE
const PC_IP = '192.168.5.215'; 
const OLLAMA_INF_PORT = 11434; 
const OLLAMA_MGMT_PORT = 3000; 
const PROXY_PORT = 11430;

// CONFIGURATION DES URLS DE GESTION
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
                
                // Extraction du dernier message uniquement
                let lastUserMessage = (data.messages && data.messages.length > 0) 
                    ? data.messages[data.messages.length - 1].content : (data.prompt || "");
                
                const cmd = lastUserMessage.trim().toUpperCase();

                // --- GESTION DU START ---
                if (cmd.includes("START")) {
                    console.log(`[${new Date().toLocaleTimeString()}] COMMANDE START : Appel API Port 3000...`);

                    const callStartApi = () => {
                        return new Promise((resolve) => {
                            const request = http.get(MGMT_START_URL, { timeout: 1500 }, (r) => {
                                resolve(r.statusCode < 500); 
                            });
                            request.on('error', () => resolve(false));
                            request.end();
                        });
                    };

                    const apiSuccess = await callStartApi();

                    if (apiSuccess) {
                        const msg = "Ordre envoyé : Le service Ollama est en cours de lancement sur le PC RTX (via Port 3000).";
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                    } else {
                        // Si l'API 3000 est injoignable, on réveille le PC
                        console.log(" -> PC injoignable, appel UpSnap...");
                        const upSnapReq = http.request(UPSNAP_URL, { method: 'POST' });
                        upSnapReq.on('error', (e) => console.log("Error UpSnap:", e.message));
                        upSnapReq.end();

                        const msg = "Le PC semble éteint. Signal de réveil envoyé via UpSnap. Patiente 1 min puis relance START.";
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                    }
                }

                // --- GESTION DU STOP ---
                if (cmd.includes("STOP")) {
                    console.log(`[${new Date().toLocaleTimeString()}] COMMANDE STOP : Appel API Port 3000...`);

                    const callStopApi = () => {
                        return new Promise((resolve) => {
                            const request = http.get(MGMT_STOP_URL, { timeout: 1500 }, (r) => {
                                resolve(r.statusCode < 500);
                            });
                            request.on('error', () => resolve(false));
                            request.end();
                        });
                    };

                    const stopped = await callStopApi();
                    const msg = stopped ? "Ordre envoyé : Le processus Ollama est en cours d'arrêt." : "Impossible de joindre le service de gestion (PC peut-être déjà éteint).";
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                }

                // --- PROXY STANDARD (INFÉRENCE) ---
                const proxyReq = http.request({
                    host: PC_IP,
                    port: OLLAMA_INF_PORT,
                    path: req.url,
                    method: 'POST',
                    headers: req.headers,
                    timeout: 2000 
                }, (pcRes) => {
                    res.writeHead(pcRes.statusCode, pcRes.headers);
                    pcRes.pipe(res);
                });

                proxyReq.on('error', () => {
                    const fallbackMsg = "Le PC ne répond pas sur le port 11434. Utilise START pour l'allumer ou lancer le service.";
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: { role: "assistant", content: fallbackMsg }, done: true }));
                });

                proxyReq.write(body);
                proxyReq.end();

            } catch (e) {
                res.writeHead(400); res.end("Error Parsing JSON");
            }
        });
    } else {
        // Redirection des GET (tags/version) vers Ollama 11434
        http.get(`http://${PC_IP}:${OLLAMA_INF_PORT}${req.url}`, (pcRes) => pcRes.pipe(res))
            .on('error', () => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
            });
    }
});

server.listen(PROXY_PORT, () => console.log(`Proxy Node actif sur ${PROXY_PORT} (MGMT: 3000, INF: 11434)`));
