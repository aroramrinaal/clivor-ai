require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const WebSocket = require('ws');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("node:fs");
const mime = require("mime-types");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const ZOOM_SECRET_TOKEN = process.env.ZOOM_SECRET_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
});  

const generationConfig = {
    temperature: 1,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
    responseModalities: [
    ],
    responseMimeType: "text/plain",
};

async function explainHardWordsWithGemini(sentence) {
    const chatSession = model.startChat({
        generationConfig,
        history: [],
    });

    const prompt = `Identify difficult or uncommon words and phrases in the following sentence for international students in the U.S. Explain each simply with an example:\n\n"${sentence}"`;

    try {
        const result = await chatSession.sendMessage(prompt);

        const text = result.response.text();
        console.log("Gemini Explanation:\n", text);

        return text;
    } catch (err) {
        console.error("Gemini error:", err);
        return "Error explaining with Gemini.";
    }
}
  

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

            console.log("Gemini response: ", explainHardWordsWithGemini(msg.content.data));
        } catch (err) {
            // Raw audio received
            console.log(`Received audio packet (${data.length} bytes)`);
            const base64Audio = data.toString('base64');
            console.log('Raw audio data (base64):', base64Audio);

            // Mock a transcribed sentence for now
            const fakeSentence = "Despite the red tape, she managed to secure a green card.";

            const geminiResponse = await explainHardWordsWithGemini(fakeSentence);
            console.log('Gemini Explanation:\n', geminiResponse);
        }
    });

    mediaWs.on('error', (err) => {
        console.error('Media socket error:', err);
    });

    mediaWs.on('close', () => {
        console.log('Media socket closed');
    });
}

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
