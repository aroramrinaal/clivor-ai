const express = require('express');
const crypto = require('crypto');
const WebSocket = require('ws');
const path = require('path');
const { explainHardWordsWithGemini } = require('./utils/vocab'); 

const app = express();
const PORT = 3000;

app.use(express.json());

// Serve static files from the Vite build output directory
app.use(express.static(path.join(__dirname, 'client', 'dist')));

const ZOOM_SECRET_TOKEN = '';
const CLIENT_ID = '';
const CLIENT_SECRET = '';

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

            console.log("Gemini response: ", await explainHardWordsWithGemini(msg.content.data));
        } catch (err) {
            // Raw audio received
            console.log(`Received audio packet (${data.length} bytes)`);
            const base64Audio = data.toString('base64');
            console.log('Raw audio data (base64):', base64Audio);
        }
    });

    mediaWs.on('error', (err) => {
        console.error('Media socket error:', err);
    });

    mediaWs.on('close', () => {
        console.log('Media socket closed');
    });
}

// Serve the main index.html for the root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
});

// Catch-all route to handle client-side routing (must be after API routes)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});