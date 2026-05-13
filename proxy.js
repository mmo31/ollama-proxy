const http = require('http');

const PC_IP = '192.168.5.215'; 
const PC_PORT = 11434;
const PROXY_PORT = 11430;

const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                // On cherche START ou STOP de manière brute dans le texte pour éviter les erreurs de parsing JSON
                const isStart = body.toUpperCase().includes('"CONTENT":"START"') || body.toUpperCase().includes('"PROMPT":"START"');
                const isStop = body.toUpperCase().includes('"CONTENT":"STOP"') || body.toUpperCase().includes('"PROMPT":"STOP"');

                if (isStart || isStop) {
                    const msg = isStart ? 
                        "Ordre reçu. Je tente de réveiller le PC de Mathieu (RTX)..." : 
                        "Ordre reçu. J'éteins l'Ollama sur le PC de Mathieu.";
                    
                    console.log(` !!! ACTION: ${isStart ? 'START' : 'STOP'}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ 
                        message: { role: "assistant", content: msg }, 
                        response: msg, 
                        done: true 
                    }));
                }

                // Sinon, on tente de joindre la RTX
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
                res.writeHead(400); res.end("Error");
            }
        });
    } else {
        http.get(`http://${PC_IP}:${PC_PORT}${req.url}`, (pcRes) => pcRes.pipe(res))
            .on('error', () => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
            });
    }
});

server.listen(PROXY_PORT, () => console.log("Proxy START/STOP OK"));