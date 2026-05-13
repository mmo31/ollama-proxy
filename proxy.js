const http = require('http');

const PC_IP = '192.168.5.215'; 
const PC_PORT = 11434;
const PROXY_PORT = 11430;

const server = http.createServer((req, res) => {
    // Log de base pour voir l'activité
    console.log(`[${new Date().toLocaleTimeString()}] REQ: ${req.method} ${req.url}`);

    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                
                // Extraction sécurisée du contenu du TOUT DERNIER message uniquement
                // On gère le format standard "messages" ou le format fallback "prompt"
                let lastUserMessage = "";
                if (data.messages && data.messages.length > 0) {
                    lastUserMessage = data.messages[data.messages.length - 1].content || "";
                } else if (data.prompt) {
                    lastUserMessage = data.prompt;
                }

                const cmd = lastUserMessage.trim().toUpperCase();

                // --- LOGIQUE D'INTERCEPTION ---
                // On vérifie si le DERNIER message est strictement START ou STOP
                const isStart = cmd.includes("START");
                const isStop = cmd.includes("STOP");

                if (isStart || isStop) {
                    console.log(` !!! COMMANDE DETECTEE DANS LE DERNIER MSG: ${cmd}`);
                    
                    const msg = isStart ? 
                        "Ordre reçu. Je tente de réveiller le PC de Mathieu (RTX)..." : 
                        "Ordre reçu. J'envoie la commande d'extinction au PC.";
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ 
                        message: { role: "assistant", content: msg }, 
                        response: msg, 
                        done: true 
                    }));
                }

                // --- LOGIQUE PROXY VERS RTX ---
                // Si ce n'est pas une commande, on tente de joindre la RTX
                const proxyReq = http.request({
                    host: PC_IP,
                    port: PC_PORT,
                    path: req.url,
                    method: 'POST',
                    headers: req.headers,
                    timeout: 2000 // Timeout court pour basculer vite sur le message d'aide
                }, (pcRes) => {
                    res.writeHead(pcRes.statusCode, pcRes.headers);
                    pcRes.pipe(res);
                });

                proxyReq.on('error', (err) => {
                    console.log(` -> RTX injoignable (${err.message}). Envoi du menu d'aide.`);
                    const fallbackMsg = "L'Ollama sur le PC de Mathieu (RTX) est actuellement arrêté. Dis START pour le lancer, ou STOP pour l'éteindre.";
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        message: { role: "assistant", content: fallbackMsg }, 
                        response: fallbackMsg, 
                        done: true 
                    }));
                });

                proxyReq.write(body);
                proxyReq.end();

            } catch (e) {
                console.log(" !!! ERREUR PARSING JSON:", e.message);
                res.writeHead(400); 
                res.end(JSON.stringify({ error: "Invalid JSON structure" }));
            }
        });
    } else {
        // Gestion des requêtes GET (tags, version, etc.)
        http.get(`http://${PC_IP}:${PC_PORT}${req.url}`, (pcRes) => {
            res.writeHead(pcRes.statusCode, pcRes.headers);
            pcRes.pipe(res);
        }).on('error', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
        });
    }
});

server.listen(PROXY_PORT, () => {
    console.log(`[OK] Proxy intelligent actif sur le port ${PROXY_PORT}`);
    console.log(`Cible RTX: ${PC_IP}:${PC_PORT}`);
});
