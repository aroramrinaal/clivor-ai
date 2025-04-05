require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const WebSocket = require('ws');
const path = require('path');
const http = require('http');
const { explainHardWordsWithGemini } = require('./utils/vocab'); 
const { translateText } = require('./utils/translate');
const { DataPool } = require('./utils/pool');

const app = express();
const PORT = 3000;

// Create HTTP server and WebSocket server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Initialize data pool for collecting and reviewing content
const dataPool = new DataPool(10000); // 10 seconds pooling period

// Store connected clients
const clients = new Set();

// WebSocket connection handler for frontend clients
wss.on('connection', (ws) => {
    console.log('Frontend client connected');
    clients.add(ws);
    
    ws.on('message', (message) => {
        console.log('Received from client:', message.toString());
    });
    
    ws.on('close', () => {
        console.log('Frontend client disconnected');
        clients.delete(ws);
    });
    
    // Send initial connection message
    ws.send(JSON.stringify({ type: 'connected', message: 'Connected to Clivor.ai server' }));
});

// Setup data pool review callback
dataPool.onReviewReady = (reviewData) => {
    broadcastToClients(reviewData);
};

// Broadcast to all connected frontend clients
function broadcastToClients(data) {
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

app.use(express.json());

// Serve static files from the Vite build output directory
app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));

const ZOOM_SECRET_TOKEN = process.env.ZOOM_SECRET_TOKEN;
const CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;

// Webhook listener
app.post('/webhook', (req, res) => {
    console.log('Incoming Webhook:', JSON.stringify(req.body, null, 2));
    const { event, payload } = req.body;

    if (event === 'endpoint.url_validation' && payload?.plainToken) {
        const hash = crypto.createHmac('sha256', ZOOM_SECRET_TOKEN)
            .update(payload.plainToken)
            .digest('hex');
        return res.json({ plainToken: payload.plainToken, encryptedToken: hash });
    }

    if (event === 'meeting.rtms_started') {
        const { meeting_uuid, rtms_stream_id, server_urls } = payload;
        connectToSignalingWebSocket(meeting_uuid, rtms_stream_id, server_urls);
    }

    if (event === 'meeting.rtms_stopped') {
        console.log('RTMS Stopped:', JSON.stringify(payload, null, 2));
    }

    res.sendStatus(200);
});

// Signature generator
function generateSignature(clientId, meetingUuid, streamId, secret) {
    const message = `${clientId},${meetingUuid},${streamId}`;
    return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

function connectToSignalingWebSocket(meetingUuid, streamId, serverUrl) {
    const ws = new WebSocket(serverUrl);

    ws.on('open', () => {
        const signature = generateSignature(CLIENT_ID, meetingUuid, streamId, CLIENT_SECRET);
        const handshake = {
            msg_type: 1,
            protocol_version: 1,
            meeting_uuid: meetingUuid,
            rtms_stream_id: streamId,
            sequence: Math.floor(Math.random() * 1e9),
            signature
        };
        ws.send(JSON.stringify(handshake));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        console.log('Signaling Message:', JSON.stringify(msg, null, 2));

        if (msg.msg_type === 2 && msg.status_code === 0) {
            const mediaUrl = msg.media_server?.server_urls?.all;
            if (mediaUrl) {
                connectToMediaWebSocket(mediaUrl, meetingUuid, streamId, ws);
            }
        }

        if (msg.msg_type === 12) {
            const keepAliveResponse = {
                msg_type: 13,
                timestamp: msg.timestamp
            };
            console.log('Responding to Signaling KEEP_ALIVE_REQ:', keepAliveResponse);
            ws.send(JSON.stringify(keepAliveResponse));
        }
    });

    ws.on('error', (err) => {
        console.error('Signaling socket error:', err);
    });

    ws.on('close', () => {
        console.log('Signaling socket closed');
    });
}

function connectToMediaWebSocket(mediaUrl, meetingUuid, streamId, signalingSocket) {
    const mediaWs = new WebSocket(mediaUrl, { rejectUnauthorized: false });

    mediaWs.on('open', () => {
        const signature = generateSignature(CLIENT_ID, meetingUuid, streamId, CLIENT_SECRET);
        const handshake = {
            msg_type: 3,
            protocol_version: 1,
            meeting_uuid: meetingUuid,
            rtms_stream_id: streamId,
            signature,
            media_type: 8,
            payload_encryption: false
        };
        mediaWs.send(JSON.stringify(handshake));
    });

    mediaWs.on('message', async (data) => {
        try {
            const msg = JSON.parse(data.toString());
            console.log('Media JSON Message:', JSON.stringify(msg, null, 2));

            if (msg.msg_type === 4 && msg.status_code === 0) {
                signalingSocket.send(JSON.stringify({
                    msg_type: 7,
                    rtms_stream_id: streamId
                }));
            }

            if (msg.msg_type === 12) {
                mediaWs.send(JSON.stringify({
                    msg_type: 13,
                    timestamp: msg.timestamp
                }));
            }

            // If there's content to process with Gemini
            if (msg.content && msg.content.data) {
                const explanation = await explainHardWordsWithGemini(msg.content.data);
                console.log("Gemini response: ", explanation);
                
                // Get Spanish translation
                const translation = await translateText(msg.content.data, "Spanish");
                console.log("Spanish translation: ", translation);
                
                const vocabData = {
                    type: 'vocabulary',
                    originalText: msg.content.data,
                    explanation: explanation,
                    translation: translation,
                    timestamp: new Date().toISOString()
                };
                
                // Broadcast to all connected frontend clients
                broadcastToClients(vocabData);
                
                // Add data to the pool for periodic review
                dataPool.addData(vocabData);
            }
        } catch (err) {
            // Raw audio received
            console.log(`Received audio packet (${data.length} bytes)`);
            const base64Audio = data.toString('base64');
            console.log('Raw audio data (base64):', base64Audio);
            
            // You could also broadcast audio data if needed
            // broadcastToClients({ type: 'audio', data: base64Audio });
        }
    });

    mediaWs.on('error', (err) => {
        console.error('Media socket error:', err);
    });

    mediaWs.on('close', () => {
        console.log('Media socket closed');
    });
}

// Test endpoint to verify WebSocket broadcasting
app.get('/api/test-broadcast', (req, res) => {
    console.log(`Broadcasting test message to ${clients.size} clients`);
    
    const testData = {
        type: 'vocabulary',
        originalText: "Despite the red tape, she managed to secure a green card.",
        explanation: "<div class=\"vocab-item\"><strong class=\"vocab-word\">red tape</strong>: <span class=\"vocab-explanation\">Excessive bureaucracy or regulations that make it difficult to get something done. Example: The project was delayed due to government red tape.</span></div><div class=\"vocab-item\"><strong class=\"vocab-word\">green card</strong>: <span class=\"vocab-explanation\">A United States Permanent Resident Card, which allows non-citizens to live and work permanently in the US. Example: After living in the US for several years, she finally received her green card.</span></div>",
        translation: "A pesar de la burocracia, logró obtener una tarjeta verde.",
        timestamp: new Date().toISOString()
    };
    
    // Add to the data pool and broadcast
    dataPool.addData(testData);
    broadcastToClients(testData);
    
    res.json({ success: true, message: 'Test message broadcast to all connected clients', clientCount: clients.size });
});

// Test endpoint to trigger a streaming response
app.get('/api/test-streaming', (req, res) => {
    console.log(`Testing streaming API with ${clients.size} clients`);
    
    const testContent = "The economic outlook remains uncertain as inflation pressures persist despite central bank interventions. Market analysts suggest a cautious approach to investments while monitoring key indicators. Meanwhile, technological innovations continue to reshape various industries, creating both challenges and opportunities for businesses adapting to the digital transformation.";
    
    // Stream the response directly to clients
    dataPool.streamSummarizeWithGemini(testContent, (streamChunk) => {
        broadcastToClients({
            type: 'streaming',
            ...streamChunk,
            timestamp: new Date().toISOString()
        });
    });
    
    res.json({ success: true, message: 'Streaming test initiated', clientCount: clients.size });
});

// Serve the main index.html for the root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
});

// Catch-all route to handle client-side routing (must be after API routes)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
});

// Use server.listen instead of app.listen
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`WebSocket server is running on ws://localhost:${PORT}`);
});