const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const mime = require("mime-types");

const app = express();

app.use(express.json());

const apiKey = 'YOUR_GOOGLE_API_KEY'; // Replace with your actual API key
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

    const prompt = `From the sentence below, identify difficult or uncommon English words or phrases that may be hard for international students in the U.S. 

        Return the result as a JSON array in this format:
        [
        {
            "word": "hard word here",
            "explanation": "simple explanation with an example sentence"
        }
        ]

        Sentence: "${sentence}"`;

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
  