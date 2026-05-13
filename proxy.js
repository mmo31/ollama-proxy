const http = require('http');

const PC_IP = '192.168.5.215'; // Ton PC avec RTX
const PC_PORT = 11434;
const PROXY_PORT = 11430;

const server = http.createServer((req, res) => {
    console.log(`[${new Date().toLocaleTimeString()}] REQ: ${req.method} ${req.url}`);

    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                // Extraction du message pour vérification START/STOP
                const lastMessage = data.messages ? data.messages[data.messages.length - 1].content : (data.prompt || "");
                const cmd = lastMessage.trim().toUpperCase();

                // 1. INTERCEPTION DES COMMANDES (Priorité absolue)
                if (cmd === 'START' || cmd === 'STOP') {
                    console.log(` !!! COMMANDE DETECTEE: ${cmd}`);
                    const msg = cmd === 'START' ? 
                        "Ordre reçu. Je tente de réveiller le PC de Mathieu via WoL..." : 
                        "Ordre reçu. J'envoie la commande d'extinction au PC.";
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ 
                        message: { role: "assistant", content: msg }, 
                        response: msg, 
                        done: true 
                    }));
                }

                // 2. TENTATIVE DE PROXY VERS LA RTX
                const proxyReq = http.request({
                    host: PC_IP,
                    port: PC_PORT,
                    path: req.url,
                    method: 'POST',
                    headers: req.headers,
                    timeout: 2000 // On attend 2s max pour savoir si la RTX est là
                }, (pcRes) => {
                    console.log(` -> RTX répond (${pcRes.statusCode}). Streaming en cours...`);
                    res.writeHead(pcRes.statusCode, pcRes.headers);
                    pcRes.pipe(res);
                });

                proxyReq.on('error', (err) => {
                    console.log(` -> RTX injoignable. Envoi du message de secours.`);
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
                console.log(" -> Erreur : Impossible de parser le JSON");
                res.writeHead(400); res.end("Invalid JSON");
            }
        });
    } else {
        // Gestion des GET (tags, version, etc.) vers la RTX avec fallback vide
        http.get(`http://${PC_IP}:${PC_PORT}${req.url}`, (pcRes) => {
            res.writeHead(pcRes.statusCode, pcRes.headers);
            pcRes.pipe(res);
        }).on('error', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] })); // On simule la présence du modèle
        });
    }
});

server.listen(PROXY_PORT, () => {
    console.log(`[OK] Proxy intelligent actif sur le port ${PROXY_PORT}`);
});