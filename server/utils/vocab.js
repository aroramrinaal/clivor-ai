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

    const prompt = `Identify only genuinely advanced or uncommon words/phrases in: "${sentence}". 
For each, provide a clear, simple explanation with an example sentence.
Return the response as a valid JSON array of objects with "word" and "explanation" properties.
Format each explanation as a brief definition followed by an example sentence.
Skip basic vocabulary and focus only on words that intermediate ESL learners might struggle with.
Do not include any markdown formatting (like \`\`\`json) in your response.`;

    try {
        const result = await chatSession.sendMessage(prompt);
        let text = result.response.text();
        
        // Clean any markdown code block syntax
        text = text.replace(/```json|```/g, '').trim();
        
        // Parse JSON response
        let explanations;
        try {
            explanations = JSON.parse(text);
            
            // Format the explanations into HTML
            const formattedOutput = explanations.map(item => 
                `<div class="vocab-item">
                    <strong class="vocab-word">${item.word}</strong>: 
                    <span class="vocab-explanation">${item.explanation}</span>
                </div>`
            ).join('');
            
            return formattedOutput;
        } catch (jsonError) {
            console.error("Error parsing JSON from Gemini:", jsonError);
            console.log("Raw text received:", text);
            // Return cleaned text even if JSON parse failed
            return `<p>Unable to format properly:</p><pre>${text}</pre>`;
        }
    } catch (err) {
        console.error("Gemini error:", err);
        return "<p>Error explaining with Gemini.</p>";
    }
}

module.exports = { explainHardWordsWithGemini };