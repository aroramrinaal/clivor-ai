const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");
const fs = require("node:fs");
const mime = require("mime-types");

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash", // Using Gemini 2.0 model for the translation task
});

const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192,
  responseModalities: [],
  responseMimeType: "text/plain",
};

// Function to translate text
async function translateText(text, targetLanguage) {
  const prompt = `Translate the following text to ${targetLanguage}: "${text}"`;

  const chatSession = model.startChat({
    generationConfig,
    history: [
      // You can add additional context here if needed
    ],
  });

  // Send the translation request to the Gemini model
  const result = await chatSession.sendMessage(prompt);

  // Output the translation in JSON format
  const candidates = result.response.candidates;
  let translatedText = "";
  for (let candidate_index = 0; candidate_index < candidates.length; candidate_index++) {
    for (let part_index = 0; part_index < candidates[candidate_index].content.parts.length; part_index++) {
      const part = candidates[candidate_index].content.parts[part_index];
      if (part.inlineData) {
        try {
          const filename = `output_${candidate_index}_${part_index}.${mime.extension(part.inlineData.mimeType)}`;
          fs.writeFileSync(filename, Buffer.from(part.inlineData.data, 'base64'));
          console.log(`Output written to: ${filename}`);
        } catch (err) {
          console.error(err);
        }
      }
      if (part.text) {
        translatedText = part.text;
      }
    }
  }

  // Log the translation result as a JSON object
  console.log(JSON.stringify({
    inputText: text,
    targetLanguage: targetLanguage,
    translatedText: translatedText
  }, null, 2));
}

translateText(text, targetLanguage);

module.exports = { translateText };