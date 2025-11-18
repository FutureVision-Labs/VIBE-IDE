# Devlog #005: VIBE IDE Extension API - A Developer's Guide

**Date:** November 18th 2025  
**Status:** Planning Phase  
**Topic:** How to build extensions for VIBE IDE

---

## 🎯 Introduction

In [Devlog #004](devlog-004-extension-system-journey.md), we talked about why we're building our own extension system for VIBE IDE. Now let's dive into the **how** - the actual API that extension developers will use!

This is a developer-focused guide. If you're interested in building extensions for VIBE IDE, this is for you!

---

## 🏗️ Extension Architecture Overview

VIBE IDE supports two types of extensions:

### 1. Monaco-Compatible Extensions
These work out of the box with Monaco Editor:
- **Themes** - VS Code theme format
- **Language Servers** - LSP protocol
- **Code Snippets** - VS Code snippet format
- **Basic Language Support** - Syntax highlighting, etc.

No special API needed - just use standard Monaco/VS Code formats!

### 2. VIBE IDE Exclusive Extensions
These use our custom API and can access VIBE IDE's unique features:
- Proactive AI integration
- PROJECT_JOURNAL access
- Educational tracking
- Emojibar interaction
- Custom UI elements
- And more!

---

## 📚 Core APIs

### 1. Proactive AI API

Interact with Cursy (VIBE IDE's AI assistant):

```javascript
// Make a suggestion
vibeIDE.ai.suggest({
  context: 'user just wrote a function',
  type: 'improvement',
  message: 'Great function! Here's a cleaner way to write it...'
})

// Celebrate a milestone
vibeIDE.ai.celebrate({
  milestone: 'first-function',
  message: '🎉 Awesome! You wrote your first function!'
})

// Observe code patterns
vibeIDE.ai.observe({
  code: currentCode,
  pattern: 'common-mistake',
  action: 'suggest-fix'
})
```

**Use cases:**
- Educational extensions that provide learning feedback
- Code quality extensions that suggest improvements
- Milestone tracking extensions

---

### 2. Project Management API

Access project information and PROJECT_JOURNAL:

```javascript
// Get project info
const projectName = vibeIDE.project.getName()
const projectPath = vibeIDE.project.getPath()
const projectType = vibeIDE.project.getType() // 'web-app', 'python-beginner', etc.
const config = vibeIDE.project.getConfig()

// Work with PROJECT_JOURNAL
const journal = vibeIDE.project.getJournal()
vibeIDE.project.updateJournal({
  progress: 'Added new feature',
  decisions: ['Used React for UI']
})
vibeIDE.project.exportJournal('pdf') // 'pdf', 'html', 'markdown'
```

**Use cases:**
- PROJECT_JOURNAL management extensions
- Project template generators
- Project analytics extensions

---

### 3. File System API

Read and write files in the project:

```javascript
// Read files
const content = await vibeIDE.fs.readFile('src/main.js')

// Write files
await vibeIDE.fs.writeFile('src/main.js', newContent)

// Create files
await vibeIDE.fs.createFile('src/new-file.js', '// New file')

// Delete files
await vibeIDE.fs.deleteFile('src/old-file.js')

// Directory operations
const files = await vibeIDE.fs.listFiles('src')
await vibeIDE.fs.createDirectory('src/components')
```

**Security:** Extensions can only access files within the project directory.

**Use cases:**
- File generators
- Code formatters
- Project scaffolding tools

---

### 4. Editor API

Access Monaco Editor:

```javascript
// Get/set editor content
const content = vibeIDE.editor.getContent()
vibeIDE.editor.setContent(newContent)

// Work with selection
const selection = vibeIDE.editor.getSelection()
vibeIDE.editor.insertText('Hello, World!')
vibeIDE.editor.replaceSelection('New text')

// Editor events
vibeIDE.editor.onChange((content) => {
  console.log('Content changed:', content)
})

vibeIDE.editor.onSave(() => {
  console.log('File saved!')
})
```

**Use cases:**
- Code formatters
- Snippet inserters
- Code analyzers

---

### 5. Live Preview API

Control the live preview pane:

```javascript
// Reload preview
vibeIDE.preview.reload()

// Open in external browser
vibeIDE.preview.openExternal()

// Get preview content
const previewContent = vibeIDE.preview.getContent()

// Listen for updates
vibeIDE.preview.onUpdate((content) => {
  console.log('Preview updated:', content)
})
```

**Use cases:**
- Preview enhancers
- Testing tools
- Debugging extensions

---

### 6. UI API

Create custom UI elements:

```javascript
// Create a panel
const panel = vibeIDE.ui.createPanel({
  id: 'my-extension-panel',
  title: 'My Extension',
  view: 'sidebar' // 'sidebar', 'bottom', 'modal'
})

// Show notifications
vibeIDE.ui.showNotification({
  message: 'Extension activated!',
  type: 'success' // 'success', 'info', 'warning', 'error'
})

// Create buttons
vibeIDE.ui.createButton({
  label: 'Do Something',
  onClick: () => {
    console.log('Button clicked!')
  }
})
```

**Use cases:**
- Custom tool panels
- Status displays
- Interactive extensions

---

### 7. Educational API

Track learning progress and provide educational content:

```javascript
// Track milestones
vibeIDE.education.trackMilestone({
  type: 'first-function',
  description: 'User wrote their first function'
})

// Suggest tutorials
vibeIDE.education.suggestTutorial({
  topic: 'functions',
  level: 'beginner'
})

// Explain code
const explanation = await vibeIDE.education.explainCode({
  code: selectedCode,
  level: 'beginner' // 'beginner', 'intermediate', 'advanced'
})
```

**Use cases:**
- Learning trackers
- Tutorial systems
- Code explanation tools

---

### 8. Emojibar API

Interact with the emojibar:

```javascript
// Send a message
vibeIDE.emojibar.sendMessage('Hello from extension!', 'markdown')

// Listen for messages
vibeIDE.emojibar.onMessage((message) => {
  console.log('User sent:', message)
})

// Add emoji
vibeIDE.emojibar.addEmoji('🚀')
```

**Use cases:**
- Chat integrations
- Notification systems
- Interactive assistants

---

### 9. Configuration API

Manage extension settings:

```javascript
// Get/set configuration
const value = vibeIDE.config.get('myExtension.setting')
vibeIDE.config.set('myExtension.setting', newValue)

// Listen for changes
vibeIDE.config.onChange((key, newValue) => {
  console.log(`${key} changed to ${newValue}`)
})
```

**Use cases:**
- Settings management
- User preferences
- Extension configuration

---

## 📦 Extension Structure

### Basic Extension

```
my-extension/
├── package.json          # Extension manifest
├── extension.js          # Main extension code
├── README.md            # Extension documentation
└── assets/              # Extension assets (optional)
    ├── icons/
    └── images/
```

### package.json

```json
{
  "name": "my-vibe-ide-extension",
  "version": "1.0.0",
  "displayName": "My Extension",
  "description": "What my extension does",
  "publisher": "my-publisher",
  "vibeIDE": {
    "version": ">=0.1.0",
    "apis": [
      "project",
      "ai",
      "fs"
    ],
    "permissions": [
      "fs.read",
      "fs.write",
      "ai.suggest"
    ],
    "activationEvents": [
      "onStart",
      "onFileOpen"
    ]
  },
  "main": "extension.js",
  "contributes": {
    "commands": [
      {
        "command": "myExtension.doSomething",
        "title": "Do Something"
      }
    ],
    "menus": {
      "file": [
        {
          "command": "myExtension.doSomething",
          "when": "projectOpen"
        }
      ]
    }
  }
}
```

### Extension Entry Point

```javascript
// extension.js
function activate(context) {
  console.log('My extension is now active!')
  
  // Register a command
  const command = vibeIDE.commands.registerCommand(
    'myExtension.doSomething',
    async () => {
      // Get project info
      const projectName = vibeIDE.project.getName()
      
      // Show notification
      vibeIDE.ui.showNotification({
        message: `Hello from ${projectName}!`,
        type: 'success'
      })
      
      // Do something with the project
      const journal = vibeIDE.project.getJournal()
      console.log('Project journal:', journal)
    }
  )
  
  context.subscriptions.push(command)
}

function deactivate() {
  console.log('My extension is deactivating')
  // Cleanup
}

module.exports = {
  activate,
  deactivate
}
```

---

## 🎨 Example: Creator Tools Extension

Here's how the Creator Tools Extension (the one that started it all!) would work:

```javascript
// creator-tools-extension.js
function activate(context) {
  // Butler integration - Publish to itch.io
  vibeIDE.commands.registerCommand(
    'creatorTools.publishToItch',
    async () => {
      const projectPath = vibeIDE.project.getPath()
      const projectName = vibeIDE.project.getName()
      
      // Show progress
      vibeIDE.ui.showNotification({
        message: 'Publishing to itch.io...',
        type: 'info'
      })
      
      // Use Butler to publish
      // (Butler would be installed separately)
      await vibeIDE.fs.executeCommand(
        `butler push ${projectPath} user/${projectName}:channel`
      )
      
      vibeIDE.ui.showNotification({
        message: 'Published to itch.io!',
        type: 'success'
      })
    }
  )
  
  // Domain lookup
  vibeIDE.commands.registerCommand(
    'creatorTools.checkDomain',
    async () => {
      const domain = await vibeIDE.ui.showInputBox({
        prompt: 'Enter domain name to check'
      })
      
      // Check domain availability (would use an API)
      const available = await checkDomainAvailability(domain)
      
      vibeIDE.ui.showNotification({
        message: `${domain} is ${available ? 'available' : 'taken'}`,
        type: available ? 'success' : 'info'
      })
    }
  )
  
  // Generate itch.io description
  vibeIDE.commands.registerCommand(
    'creatorTools.generateItchDescription',
    async () => {
      const project = vibeIDE.project.getConfig()
      const journal = vibeIDE.project.getJournal()
      
      // Generate description from project info
      const description = generateItchDescription({
        name: project.name,
        description: project.description,
        features: journal.features,
        // ... more project info
      })
      
      // Show in a panel
      vibeIDE.ui.createPanel({
        id: 'itch-description',
        title: 'Itch.io Description',
        content: description,
        view: 'modal'
      })
    }
  )
  
  // Generate PROJECT_JOURNAL
  vibeIDE.commands.registerCommand(
    'creatorTools.generateProjectJournal',
    async () => {
      const project = vibeIDE.project.getConfig()
      
      // Generate journal from template
      const journal = generateProjectJournal({
        name: project.name,
        type: project.type,
        techStack: project.techStack,
        // ... more project info
      })
      
      // Update project journal
      await vibeIDE.project.updateJournal(journal)
      
      vibeIDE.ui.showNotification({
        message: 'PROJECT_JOURNAL created!',
        type: 'success'
      })
    }
  )
  
  // Export PROJECT_JOURNAL to PDF
  vibeIDE.commands.registerCommand(
    'creatorTools.exportJournalPDF',
    async () => {
      const pdfPath = await vibeIDE.project.exportJournal('pdf')
      
      vibeIDE.ui.showNotification({
        message: `Exported to ${pdfPath}`,
        type: 'success'
      })
    }
  )
}
```

---

## 🔒 Security & Permissions

### Permission System

Extensions must declare what they need:

```json
{
  "vibeIDE": {
    "permissions": [
      "fs.read",      // Read files
      "fs.write",     // Write files
      "ai.suggest",   // Make AI suggestions
      "project.read", // Read project info
      "network"       // Make network requests
    ]
  }
}
```

### Security Features

- **Sandboxed execution** - Extensions run in isolated contexts
- **Limited file access** - Only project directory
- **User approval** - Sensitive operations require confirmation
- **Network restrictions** - Network requests need permission
- **Vetted marketplace** - All extensions reviewed

---

## 📦 Extension Marketplace

### Curated & Beginner-Friendly

Extensions in the marketplace are:
- **Vetted** - Reviewed for safety and quality
- **Categorized** - Easy to find what you need
- **Rated** - Community ratings and reviews
- **Documented** - Clear descriptions and examples

### Categories

- **Creator Tools** - Publishing, domain lookup, etc.
- **Educational** - Learning helpers, tutorials
- **Productivity** - Code snippets, shortcuts
- **Themes** - Visual customization
- **Language Support** - Additional language servers

---

## 🚀 Getting Started

### 1. Create Your Extension

```bash
# Use VIBE IDE extension template (coming soon!)
vibeide-extension create my-extension
```

### 2. Develop Your Extension

- Use the VIBE IDE Extension API
- Test in development mode
- Debug with extension host tools

### 3. Test Locally

- Load extension in VIBE IDE
- Test all features
- Check for errors

### 4. Publish to Marketplace

- Submit to VIBE IDE Extension Marketplace
- Wait for review
- Extension goes live!

---

## 📝 Full API Documentation

This is a summary guide. For complete technical documentation, see:

**[VIBE_IDE_EXTENSION_API.md](VIBE_IDE_EXTENSION_API.md)**

The full documentation includes:
- Complete API reference
- All available methods
- Detailed examples
- Security guidelines
- Best practices
- Extension templates

---

## 🎯 Extension Ideas

Need inspiration? Here are some extension ideas:

### Creator Tools
- **Butler Integration** - Publish to itch.io
- **Domain Lookup** - Check domain availability
- **Itch Description Generator** - Generate page descriptions
- **Devlog Generator** - Create devlog posts
- **PROJECT_JOURNAL Tools** - Manage project journals

### Educational
- **Code Explainer** - Explain code in plain English
- **Learning Tracker** - Track coding milestones
- **Tutorial System** - Interactive tutorials
- **Progress Visualizer** - Show learning progress

### Productivity
- **Code Snippets** - Language-specific snippets
- **Quick Actions** - Common tasks shortcuts
- **File Templates** - Generate file templates
- **Code Formatters** - Format code automatically

### Themes
- **Color Themes** - Visual customization
- **Icon Packs** - Custom icons
- **UI Themes** - Complete UI themes

---

## 💭 Best Practices

### 1. Keep It Simple
- Focus on one thing
- Clear, simple UI
- Beginner-friendly

### 2. Use VIBE IDE Features
- Integrate with proactive AI
- Use emojibar for notifications
- Access PROJECT_JOURNAL
- Leverage educational APIs

### 3. Security First
- Request minimal permissions
- Validate user input
- Handle errors gracefully
- Don't access system files

### 4. Document Well
- Clear README
- Code comments
- Usage examples
- Screenshots/GIFs

### 5. Test Thoroughly
- Test all features
- Test error cases
- Test with different project types
- Get feedback from users

---

## 🔮 What's Next?

### Implementation Roadmap

**Phase 1: Core API (MVP)**
- Extension loader
- Basic API structure
- File system API
- Editor API
- Project API

**Phase 2: Advanced APIs**
- Proactive AI API
- Educational API
- Emojibar API
- UI API

**Phase 3: Marketplace**
- Extension marketplace
- Installation system
- Update mechanism
- Review/vetting process

**Phase 4: Developer Tools**
- Extension development tools
- Debugging support
- Documentation
- Examples and templates

---

## 🤝 Join the Community

Want to build extensions for VIBE IDE?

- **Read the full API docs** - [VIBE_IDE_EXTENSION_API.md](VIBE_IDE_EXTENSION_API.md)
- **Join the discussion** - Share your ideas
- **Build extensions** - Start creating!
- **Share feedback** - Help us improve the API

---

## 🎉 Conclusion

The VIBE IDE Extension API is designed to be:
- **Powerful** - Access to all VIBE IDE features
- **Simple** - Easy to use and understand
- **Secure** - Sandboxed and permission-based
- **Beginner-Friendly** - Designed with beginners in mind

**Ready to build?** Check out the full API documentation and start creating extensions for VIBE IDE!

---

**Full API Documentation:** [VIBE_IDE_EXTENSION_API.md](VIBE_IDE_EXTENSION_API.md)

**Follow our progress:** [futurevisionlabs.itch.io/vibe-ide](https://futurevisionlabs.itch.io/vibe-ide)

**Let's build the future of beginner-friendly coding together!** 🚀✨

---

**Next Devlog:** We'll start implementing the extension system and building our first extension!

*See you in the next devlog!* 😊

