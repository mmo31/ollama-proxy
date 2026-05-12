const http = require('http');
const httpProxy = require('http-proxy');

const proxy = httpProxy.createProxyServer({});
const REMOTE_OLLAMA = 'http://192.168.5.215:11434'; 
const LOCAL_OLLAMA = 'http://ollama-local:11434';

const server = http.createServer((req, res) => {
  const check = http.get(`${REMOTE_OLLAMA}/api/tags`, { timeout: 1200 }, (remoteRes) => {
    console.log('--- [RTX 4080 ONLINE] ---');
    proxy.web(req, res, { target: REMOTE_OLLAMA });
    check.destroy();
  });

  check.on('error', () => {
    console.log('--- [RTX OFFLINE] Failover to NAS (TinyLlama) ---');
    proxy.web(req, res, { target: LOCAL_OLLAMA });
  });

  check.on('timeout', () => {
    check.destroy();
    console.log('--- [TIMEOUT] Switching to NAS ---');
    proxy.web(req, res, { target: LOCAL_OLLAMA });
  });
});

proxy.on('error', (err, req, res) => {
  res.writeHead(502);
  res.end('Proxy Error');
});

server.listen(11430);
console.log('✅ Proxy de résilience actif sur 11430');
