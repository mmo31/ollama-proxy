const http = require('http');

const PC_IP = '192.168.5.215';
const PC_PORT = 11434;
const PROXY_PORT = 11430;

const server = http.createServer((req, res) => {
    // On ne gère que le POST sur /api/chat ou /api/generate
    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const lastMessage = data.messages ? data.messages[data.messages.length - 1].content : (data.prompt || "");
                const cmd = lastMessage.trim().toUpperCase();

                // INTERCEPTION COMMANDES
                if (cmd === 'START' || cmd === 'STOP') {
                    const msg = cmd === 'START' ? 
                        "Ordre reçu. Je tente de réveiller le PC de Mathieu..." : 
                        "Ordre reçu. J'envoie la commande d'extinction au PC.";
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: { role: "assistant", content: msg }, response: msg, done: true }));
                }

                // VÉRIFICATION SI PC UP (TIMEOUT 2s)
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
                    const fallbackMsg = "L'Ollama sur le PC de Mathieu est arrêté. Dis START pour le lancer, ou STOP pour l'éteindre.";
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: { role: "assistant", content: fallbackMsg }, response: fallbackMsg, done: true }));
                });

                proxyReq.write(body);
                proxyReq.end();

            } catch (e) {
                res.writeHead(400);
                res.end("Invalid JSON");
            }
        });
    } else {
        // Redirection simple pour les GET (tags, etc.)
        http.get(`http://${PC_IP}:${PC_PORT}${req.url}`, (pcRes) => {
            res.writeHead(pcRes.statusCode, pcRes.headers);
            pcRes.pipe(res);
        }).on('error', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ models: [] }));
        });
    }
});

server.listen(PROXY_PORT, () => {
    console.log(`Proxy light actif sur le port ${PROXY_PORT} (Zero-dep mode)`);
});