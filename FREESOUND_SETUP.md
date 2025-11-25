# Freesound API Setup Guide (Developer)

VIBE IDE uses **Freesound.org** for music and sound effects search (not Pixabay, which doesn't have a dedicated audio API). This is a built-in feature - users don't need to configure anything.

## Developer Setup

1. **Sign up for a Freesound account** (if you don't have one):
   - Go to https://freesound.org/
   - Click "Sign up" and create a free account

2. **Apply for API credentials**:
   - Go to https://freesound.org/apiv2/apply/
   - Fill out the application form
   - You'll receive your **Client ID** and **API Key** via email (usually within a few hours)

3. **Create the config file in the project root**:
   - Copy `freesound-config.example.json` to `freesound-config.json` in the VIBE-IDE project root directory
   - This file should be at: `VIBE-IDE/freesound-config.json`

4. **Add your credentials**:
   ```json
   {
     "clientId": "YOUR_FREESOUND_CLIENT_ID_HERE",
     "apiKey": "YOUR_FREESOUND_API_KEY_HERE"
   }
   ```
   
   **Note**: The `apiKey` is required (this is your access token). The `clientId` is optional but recommended for full API functionality.

5. **Restart VIBE IDE** - The credentials will be loaded automatically from the project root!

## What Freesound Provides

- **Music**: Background music, ambient tracks, loops
- **Sound Effects**: UI sounds, game SFX, environmental sounds
- **All Creative Commons licensed** - Free to use in your projects!

## Troubleshooting

- **"API key not configured"**: Make sure `freesound-config.json` is in the VIBE-IDE project root directory and contains a valid `apiKey` field (this is required)
- **"Search failed"**: Check that your API key is valid and hasn't expired
- **No results**: Try different search terms - Freesound has a huge library but specific terms work best
- **Missing clientId**: The `clientId` is optional, but if you have it, add it to the config for full API functionality

## Why Freesound?

- Pixabay doesn't have a dedicated audio API (only images/videos)
- Freesound is specifically designed for audio content
- Much better search results for music and SFX
- Large library of Creative Commons audio

---

**Get your API key:** https://freesound.org/apiv2/apply/

