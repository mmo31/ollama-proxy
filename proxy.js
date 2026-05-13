const http = require('http');

// CONFIGURATION INFRASTRUCTURE
const PC_IP = '192.168.5.215'; 
const OLLAMA_INF_PORT = 11434; 
const OLLAMA_MGMT_PORT = 3000; 
const PROXY_PORT = 11430;

// URL de ton API de lancement (à ajuster si le endpoint est spécifique, ex: /start)
const OLLAMA_START_URL = `http://${PC_IP}:${OLLAMA_MGMT_PORT}/`;
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

                if (cmd.includes("START")) {
                    console.log(`[${new Date().toLocaleTimeString()}] TENTATIVE DE LANCEMENT VIA API (PORT 3000)...`);

                    // 1) Tentative d'appel à l'API de lancement
                    const startService = () => {
                        return new Promise((resolve) => {
                            const request = http.get(OLLAMA_START_URL, { timeout: 1500 }, (r) => {
                                resolve(r.statusCode < 500); 
                            });
                            request.on('error', () => resolve(false));
                            request.end();
                        });
                    };

                    const apiSuccess = await startService();

                    if (apiSuccess) {
                        const msg = "PC déjà allumé. L'ordre de lancement a été envoyé à l'API Ollama (Port 3000).";
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                    }

                    // 2) Si le port 3000 est injoignable (PC OFF) -> UpSnap
                    console.log(" -> PC injoignable, appel UpSnap pour réveil matériel...");
                    const upSnapReq = http.request(UPSNAP_URL, { method: 'POST' });
                    upSnapReq.on('error', (e) => console.log("Error UpSnap:", e.message));
                    upSnapReq.end();

                    const msg = "Le PC est éteint. J'ai envoyé un signal de réveil via UpSnap. Réessaie START dans 1 minute pour lancer le service Ollama.";
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, done: true }));
                }

                // PROXY CLASSIQUE (INFÉRENCE)
                const proxyReq = http.request({
                    host: PC_IP, port: OLLAMA_INF_PORT, path: req.url, method: 'POST',
                    headers: req.headers, timeout: 2000 
                }, (pcRes) => {
                    res.writeHead(pcRes.statusCode, pcRes.headers);
                    pcRes.pipe(res);
                });

                proxyReq.on('error', () => {
                    const fallbackMsg = "Le service Ollama ne répond pas sur la RTX. Dis START pour le lancer.";
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
        http.get(`http://${PC_IP}:${OLLAMA_INF_PORT}${req.url}`, (pcRes) => pcRes.pipe(res))
            .on('error', () => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
            });
    }
});

server.listen(PROXY_PORT, () => console.log(`Proxy Opérationnel - Test API Port 3000`));
