const express = require('express');
const axios = require('axios');
const app = express();

const PC_URL = 'http://192.168.5.215:11434';
const PORT = 11430;

app.use(express.json());

app.post('/api/generate', async (req, res) => {
    const userPrompt = req.body.prompt?.trim().toUpperCase();

    // INTERCEPTION DES COMMANDES
    if (userPrompt === 'START') {
        // Logique pour réveiller le PC (WoL) ou lancer le service
        return res.json({ response: "Ordre reçu. Je lance Ollama sur le PC de Mathieu... (Prêt dans 30s)" });
    }
    
    if (userPrompt === 'STOP') {
        // Logique pour éteindre (via un script SSH ou webhook)
        return res.json({ response: "Ordre reçu. J'éteins Ollama sur le PC de Mathieu." });
    }

    // VÉRIFICATION DE L'ÉTAT DU GROS LLM
    try {
        await axios.get(`${PC_URL}/api/tags`, { timeout: 2000 });
    } catch (e) {
        // Si le PC ne répond pas, on envoie le message d'instruction personnalisé
        return res.json({ 
            response: "L'Ollama sur le PC de Mathieu est arrêté. Dis START pour le lancer, ou STOP pour vérifier l'extinction." 
        });
    }

    // SI LE PC EST UP : PROXY CLASSIQUE
    try {
        const response = await axios.post(`${PC_URL}/api/generate`, req.body);
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: "Erreur de communication avec le PC." });
    }
});

app.listen(PORT, () => console.log(`Proxy actif sur le port ${PORT}`));