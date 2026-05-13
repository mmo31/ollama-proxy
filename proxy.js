const http = require('http');

// CONFIGURATION INFRASTRUCTURE
const PC_IP = '192.168.5.215'; 
const OLLAMA_INF_PORT = 11434; // Port pour les requêtes de chat
const OLLAMA_MGMT_PORT = 3000; // TON PORT DE MANAGEMENT / API DE LANCEMENT
const PROXY_PORT = 11430;

// CONFIGURATION UPSNAP
const UPSNAP_URL = 'http://192.168.2.80:8090/api/nodes/mathieu-rtx/wake';

const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                
                let lastUserMessage = "";
                if (data.messages && data.messages.length > 0) {
                    lastUserMessage = data.messages[data.messages.length - 1].content || "";
                } else if (data.prompt) {
                    lastUserMessage = data.prompt;
                }

                const cmd = lastUserMessage.trim().toUpperCase();
                const isStart = cmd.includes("START");

                // --- LOGIQUE DE COMMANDE START ---
                if (isStart) {
                    console.log(`[${new Date().toLocaleTimeString()}] TEST DISPO SUR PORT ${OLLAMA_MGMT_PORT}...`);

                    // 1) Test de l'API sur le PORT 3000
                    const checkPC = () => {
                        return new Promise((resolve) => {
                            // On teste le port 3000 pour voir si l'interface de gestion répond
                            const request = http.get(`http://${PC_IP}:${OLLAMA_MGMT_PORT}/`, { timeout: 1000 }, (r) => {
                                resolve(r.statusCode < 500); // Si ça répond (même un 404), le port est ouvert
                            });
                            request.on('error', () => resolve(false));
                            request.end();
                        });
                    };

                    const isAlreadyUp = await checkPC();

                    if (isAlreadyUp) {
                        const msg = "Le PC RTX est déjà allumé (Port 3000 actif).";
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                    }

                    // 2) Si le port 3000 ne répond pas -> UpSnap
                    console.log(" -> Port 3000 fermé, envoi du signal WoL via UpSnap...");
                    
                    const upSnapReq = http.request(UPSNAP_URL, { method: 'POST' }, (uRes) => {
                        console.log(` -> UpSnap retour: ${uRes.statusCode}`);
                    });
                    upSnapReq.on('error', (e) => console.log(" -> Erreur UpSnap:", e.message));
                    upSnapReq.end();

                    const msg = "Ordre reçu. J'ai sollicité UpSnap pour réveiller le PC. Le service sur le port 3000 devrait être disponible d'ici 1 minute.";
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                }

                // --- PROXY STANDARD VERS PORT 11434 ---
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
                    const fallbackMsg = "Le PC RTX ne répond pas. Envoie START pour le réveiller.";
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: { role: "assistant", content: fallbackMsg }, done: true }));
                });

                proxyReq.write(body);
                proxyReq.end();

            } catch (e) {
                res.writeHead(400); res.end("Error");
            }
        });
    } else {
        // Redirection GET vers l'API Ollama standard
        http.get(`http://${PC_IP}:${OLLAMA_INF_PORT}${req.url}`, (pcRes) => pcRes.pipe(res))
            .on('error', () => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
            });
    }
});

server.listen(PROXY_PORT, () => console.log(`Proxy actif (Test Port: ${OLLAMA_MGMT_PORT})`));
