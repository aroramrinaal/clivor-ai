const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const mime = require("mime-types");

const app = express();

app.use(express.json());

const apiKey = ''; // Replace with your actual API key
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

    const prompt = `Identify only genuinely advanced or uncommon words/phrases in: "${sentence}". For each, return a one-line JSON like [{"word":"...","explanation":"simple definition with example: '...'"}]. Use simple words in explanations. Skip common words. Target intermediate ESL learners.`;

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

module.exports = { explainHardWordsWithGemini };