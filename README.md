# VIBE IDE™

**Beginner-friendly coding environment with proactive AI assistance and educational features**

## 🚀 Vision

VIBE IDE is a coding environment designed for kids, teens, hobbyists, and anyone learning to code. Unlike professional IDEs that can be intimidating, VIBE IDE features an educational focus, family-friendly features, and an AI assistant ("Cursy") that actively helps without being asked.

## 🎯 Key Features

- ✅ **Monaco Editor** - VS Code's powerful editor, made beginner-friendly
- ✅ **Multi-Language Support** - Python, JavaScript, HTML/CSS
- ✅ **Proactive AI** - "Cursy" makes observations and suggestions
- ✅ **Educational Focus** - Learn while you code
- ✅ **Form-Based Setup** - Visual forms guide project creation
- ✅ **Project Type Rules** - AI knows your project context
- ✅ **Family Plans** - Multiple users, parent dashboards
- ✅ **Gamification** - Achievements, streaks, challenges

## 🏗️ Foundation

Built on the **GameForge IDE Alpha** codebase, which provides:
- Electron desktop app framework
- Monaco Editor integration
- File tree system
- Project structure
- Template system foundation

## 🎓 Target Audience

- Kids learning to code (10+)
- Teens/young adults starting out
- Hobbyists and amateurs
- People intimidated by professional IDEs
- Families learning together
- Students in coding courses

## 💻 Tech Stack

- **Electron** - Desktop app framework
- **Monaco Editor** - Code editing
- **Node.js** - File system operations
- **AI Integration** - Google **Gemini** (via BYO API key) for Cursy

## 🏃 Running the App

**Local brain (LM Studio):** install [LM Studio](https://lmstudio.ai), download **Gemma 4 E4B** (Team DC default for VIBE IDE: fits 8 GB VRAM, not the old Gemma 3 27B RAM crawl), load it, then **Local Server → Start Server** (default `http://127.0.0.1:1234/v1`). Copy `local-llm-config.example.json` to Electron **userData** as `local-llm-config.json` so the chip expects `gemma-4-e4b` (partial match). The menu bar **Local brain** chip shows status. Ollama: `"provider": "ollama"` or legacy `ollama-config.json`.

**Chat:** with LM Studio running and Gemma loaded, Cursy chat uses your **local model first** (no key). **Project Recall v1** hybrid search: keyword + **MiniLM** embeddings (cached in `.vibe/recall-index.json`); recent `cml/` logs load on project open. Local chat supports **OpenAI-style `provide_code_block` tools** when LM Studio exposes tool calling. **Bounded agent:** in chat, type `@agent your goal here` (max 8 steps; **approve** before writes). **Gemini API key (optional fallback):** copy `google-config.example.json` to userData as `google-config.json`, or set `GEMINI_API_KEY` / `GOOGLE_API_KEY`.

```bash
# Development mode (with DevTools)
npm run dev

# Production mode
npm start
```

## 📋 Development Status

**Status:** 🟡 Planning Phase

See `PROJECT_JOURNAL.md` for complete roadmap and specifications.

## 🎯 Key Differentiators

**vs. VS Code:** Beginner-friendly, educational focus, proactive AI, family plans
**vs. Cursor:** For beginners, not professionals, educational, family-friendly
**vs. Scratch/Blockly:** Real code, not blocks, professional tools, beginner-friendly

## 🚀 Future: Vibe Coding Academy

VIBE IDE is the foundation for a complete learning ecosystem:
- **VIBE IDE** - The tool
- **Vibe Coding Academy** - The education platform
- **Family Plans** - Learn together
- **Community** - Share projects, get help, celebrate wins

---

**Built with ❤️ by Damian & Cursy**  
**Team DC 🚀**  
**FutureVision Labs**
