const http = require('http');

const PC_IP = '192.168.5.215'; 
const PC_PORT = 11434;
const PROXY_PORT = 11430;

const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            // --- LOG DE LA REQUETE COMPLETE ---
            console.log("========================================");
            console.log(`[${new Date().toLocaleTimeString()}] REQUETE RECUE`);
            console.log(`HEADERS: ${JSON.stringify(req.headers)}`);
            // On affiche les 1000 premiers et 1000 derniers caractères pour ne pas saturer le terminal
            console.log(`BODY (Full Length: ${body.length}):`);
            console.log(body); 
            console.log("========================================");

            try {
                // Recherche insensible à la casse et flexible
                // On cherche "START" ou "STOP" entouré de guillemets pour cibler le contenu du message
                const isStart = /"content"\s*:\s*"[^"]*START[^"]*"/i.test(body) || /"prompt"\s*:\s*"[^"]*START[^"]*"/i.test(body);
                const isStop = /"content"\s*:\s*"[^"]*STOP[^"]*"/i.test(body) || /"prompt"\s*:\s*"[^"]*STOP[^"]*"/i.test(body);

                if (isStart || isStop) {
                    const action = isStart ? "START" : "STOP";
                    const msg = isStart ? 
                        "Ordre reçu. Je tente de réveiller le PC de Mathieu (RTX)..." : 
                        "Ordre reçu. J'éteins l'Ollama sur le PC de Mathieu.";
                    
                    console.log(` !!! ACTION DETECTEE: ${action}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ 
                        message: { role: "assistant", content: msg }, 
                        response: msg, 
                        done: true 
                    }));
                }

                // Proxy vers la RTX si pas de commande
                const proxyReq = http.request({
                    host: PC_IP, port: PC_PORT, path: req.url, method: 'POST',
                    headers: req.headers, timeout: 2000 
                }, (pcRes) => {
                    res.writeHead(pcRes.statusCode, pcRes.headers);
                    pcRes.pipe(res);
                });

                proxyReq.on('error', () => {
                    const fallbackMsg = "L'Ollama sur le PC de Mathieu (RTX) est actuellement arrêté. Dis START pour le lancer, ou STOP pour l'éteindre.";
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: { role: "assistant", content: fallbackMsg }, response: fallbackMsg, done: true }));
                });

                proxyReq.write(body);
                proxyReq.end();
            } catch (e) {
                console.log("ERREUR PROXY:", e);
                res.writeHead(400); res.end("Error");
            }
        });
    } else {
        // GET simple
        http.get(`http://${PC_IP}:${PC_PORT}${req.url}`, (pcRes) => pcRes.pipe(res)).on('error', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
        });
    }
});

server.listen(PROXY_PORT, () => console.log(`Proxy actif sur ${PROXY_PORT}`));
