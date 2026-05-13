const http = require('http');

// CONFIGURATION INFRASTRUCTURE
const PC_IP = '192.168.5.215'; 
const PC_PORT = 11434;
const PROXY_PORT = 11430;

// CONFIGURATION UPSNAP
// Utilisation de l'ID 'mathieu-rtx' tel qu'identifié pour ton PC de Mathieu
const UPSNAP_URL = 'http://192.168.2.80:8090/api/nodes/mathieu-rtx/wake'; 

const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                
                // Extraction du dernier message pour éviter les faux positifs de l'historique
                let lastUserMessage = "";
                if (data.messages && data.messages.length > 0) {
                    lastUserMessage = data.messages[data.messages.length - 1].content || "";
                } else if (data.prompt) {
                    lastUserMessage = data.prompt;
                }

                const cmd = lastUserMessage.trim().toUpperCase();
                const isStart = cmd.includes("START");
                const isStop = cmd.includes("STOP");

                // --- LOGIQUE DE COMMANDE START ---
                if (isStart) {
                    console.log(`[${new Date().toLocaleTimeString()}] PROCEDURE START : Vérification RTX...`);

                    // 1) Test de l'API Ollama (Vérifier si le PC est déjà up)
                    const checkPC = () => {
                        return new Promise((resolve) => {
                            const request = http.get(`http://${PC_IP}:${PC_PORT}/api/tags`, { timeout: 1000 }, (r) => {
                                resolve(r.statusCode === 200);
                            });
                            request.on('error', () => resolve(false));
                            request.end();
                        });
                    };

                    const isAlreadyUp = await checkPC();

                    if (isAlreadyUp) {
                        const msg = "Le PC RTX est déjà allumé et Ollama est opérationnel.";
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, response: msg, done: true }));
                    }

                    // 2) Si éteint -> Appel UpSnap pour Wake-on-LAN
                    console.log(" -> RTX éteinte. Appel API UpSnap...");
                    
                    const upSnapReq = http.request(UPSNAP_URL, { method: 'POST' }, (uRes) => {
                        console.log(` -> UpSnap retour HTTP: ${uRes.statusCode}`);
                    });
                    upSnapReq.on('error', (e) => console.log(" -> Erreur UpSnap:", e.message));
                    upSnapReq.end();

                    const msg = "Ordre reçu. J'ai lancé le réveil du PC de Mathieu via UpSnap. Ollama sera prêt dans un instant.";
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, response: msg, done: true }));
                }

                // --- LOGIQUE DE COMMANDE STOP ---
                if (isStop) {
                    console.log(`[${new Date().toLocaleTimeString()}] PROCEDURE STOP`);
                    const msg = "Ordre reçu. Commande d'extinction transmise.";
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, response: msg, done: true }));
                }

                // --- LOGIQUE PROXY STANDARD (PASSTHROUGH) ---
                const proxyReq = http.request({
                    host: PC_IP,
                    port: PC_PORT,
                    path: req.url,
                    method: 'POST',
                    headers: req.headers,
                    timeout: 2000 
                }, (pcRes) => {
                    res.writeHead(pcRes.statusCode, pcRes.headers);
                    pcRes.pipe(res);
                });

                proxyReq.on('error', () => {
                    const fallbackMsg = "L'Ollama sur le PC de Mathieu (RTX) est arrêté. Dis START pour le lancer.";
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: { role: "assistant", content: fallbackMsg }, response: fallbackMsg, done: true }));
                });

                proxyReq.write(body);
                proxyReq.end();

            } catch (e) {
                console.log("ERREUR PROXY:", e.message);
                res.writeHead(400); res.end("Error");
            }
        });
    } else {
        // Redirection des GET (tags, version) pour l'interface OpenClaw
        http.get(`http://${PC_IP}:${PC_PORT}${req.url}`, (pcRes) => pcRes.pipe(res))
            .on('error', () => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
            });
    }
});

server.listen(PROXY_PORT, () => {
    console.log(`[OK] Proxy intelligent actif sur le port ${PROXY_PORT}`);
    console.log(`Cible RTX: ${PC_IP}:${PC_PORT} | UpSnap: ${UPSNAP_URL}`);
});
