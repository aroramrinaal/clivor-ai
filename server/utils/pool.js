const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Gemini API
const apiKey = ''; // Replace with your actual API key
const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 4096,
    },
});

class DataPool {
    constructor(poolingTime = 10000) {
        this.pool = [];
        this.poolingTime = poolingTime;
        this.poolingActive = false;
        this.lastReviewTime = Date.now();
        this.onReviewReady = null;
    }

    addData(data) {
        this.pool.push({
            timestamp: Date.now(),
            content: data
        });

        // Start pooling if not already active
        if (!this.poolingActive) {
            this.startPooling();
        }
    }

    startPooling() {
        this.poolingActive = true;
        this.lastReviewTime = Date.now();

        setTimeout(() => {
            this.generateReview();
        }, this.poolingTime);
    }

    async generateReview() {
        if (this.pool.length === 0) {
            this.poolingActive = false;
            return;
        }

        // Collect all data since last review
        const currentTime = Date.now();
        const relevantData = this.pool.filter(item => item.timestamp > this.lastReviewTime);
        this.lastReviewTime = currentTime;

        // Extract content for review
        const contentToReview = relevantData.map(item => {
            if (typeof item.content === 'string') {
                return item.content;
            } else if (item.content.originalText) {
                return item.content.originalText;
            } else {
                return JSON.stringify(item.content);
            }
        }).join('\n');

        if (contentToReview.trim() === '') {
            this.poolingActive = false;
            return;
        }

        try {
            const review = await this.summarizeWithGemini(contentToReview);
            
            if (this.onReviewReady && typeof this.onReviewReady === 'function') {
                this.onReviewReady({
                    type: 'review',
                    review: review,
                    originalContent: contentToReview,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error('Error generating review:', error);
        }

        // Reset pooling
        this.poolingActive = false;
        this.startPooling();
    }

    async summarizeWithGemini(content) {
        const prompt = `Please analyze the following text and provide a structured content review.
Format your response exactly as follows:

**Main Topic:** [1-3 word topic]

**Key Point:** [One concise sentence about the main idea]

**Important Vocabulary/Phrases:** [List 2-4 key terms from the text]

**Overview:** [A 1-2 sentence summary that would help someone understand what was discussed]

Text to analyze:
${content}`;

        try {
            const result = await model.generateContent(prompt);
            return result.response.text();
        } catch (error) {
            console.error('Gemini API error:', error);
            return 'Unable to generate summary at this time.';
        }
    }

    // For streaming Gemini responses
    async streamSummarizeWithGemini(content, streamCallback) {
        const prompt = `Please analyze the following text and provide a structured content review.
Format your response exactly as follows:

**Main Topic:** [1-3 word topic]

**Key Point:** [One concise sentence about the main idea]

**Important Vocabulary/Phrases:** [List 2-4 key terms from the text]

**Overview:** [A 1-2 sentence summary that would help someone understand what was discussed]

Text to analyze:
${content}`;

        try {
            const streamingResponse = await model.generateContentStream(prompt);
            
            for await (const chunk of streamingResponse.stream) {
                const chunkText = chunk.text();
                streamCallback({
                    type: 'stream',
                    chunk: chunkText
                });
            }
            
            return true;
        } catch (error) {
            console.error('Gemini streaming API error:', error);
            streamCallback({
                type: 'error',
                message: 'Unable to stream summary at this time.'
            });
            return false;
        }
    }
}

module.exports = { DataPool };
