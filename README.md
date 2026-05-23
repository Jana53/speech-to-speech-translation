# OmniBank Global Translate

Ultra-low latency real-time speech-to-speech translation for global banking calls, powered by the **Gemini 3.1 Multimodal Live API**.

## Features
- **Real-time Translation**: Seamless communication between different languages.
- **Ultra-low Latency**: Powered by the native audio-to-audio capabilities of Gemini 3.1.
- **Professional Polish UI**: A clean, banker-grade interface for high-stakes conversations.

## Prerequisites
- **Node.js**: v18 or later.
- **Gemini API Key**: You can get one for free at [Google AI Studio](https://aistudio.google.com/app/apikey).

## Local Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment**:
   Create a `.env` file in the root directory (you can copy `.env.example`):
   ```env
   GEMINI_API_KEY=your_api_key_here
   ```

3. **Start Development Server**:
   ```bash
   npm run dev
   ```
   The app will be available at `http://localhost:3000`.

## Free Tier Usage
The `gemini-3.1-flash-live-preview` model is available under the Google AI Studio free tier. 
- **Latency**: High-performance, though subject to rate limits.
- **Cost**: Free (with limits).

## Troubleshooting
- **Microphone Access**: Ensure your browser allows microphone access for `localhost`.
- **API Errors**: If you see `RESOURCE_EXHAUSTED`, you may have hit the free tier quota limits.
- **Browser Compatibility**: Recommended for use in modern Chrome or Edge for full Web Audio API support.
