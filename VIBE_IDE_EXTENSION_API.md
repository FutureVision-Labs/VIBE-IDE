# VIBE IDE Extension API - Planning Document

**Status:** Planning Phase  
**Date:** November 2025  
**Purpose:** Define the extension system for VIBE IDE

---

## 🎯 Overview

VIBE IDE will support two types of extensions:

1. **Monaco-based Extensions** - Simple compatibility (themes, language servers, snippets)
2. **VIBE IDE Exclusive Extensions** - Full-featured extensions using VIBE IDE's unique API

This document focuses on the **VIBE IDE Exclusive Extension API**.

---

## 🏗️ Architecture

### Extension Types

**1. Monaco-Compatible Extensions**
- Themes (VS Code theme format)
- Language Servers (LSP protocol)
- Code Snippets (VS Code snippet format)
- Basic language support

**2. VIBE IDE Exclusive Extensions**
- Full access to VIBE IDE APIs
- Can integrate with proactive AI
- Can use emojibar
- Can access project management
- Can create custom UI elements
- Can interact with educational features

---

## 📚 VIBE IDE Extension API

### Core APIs

#### 1. **Proactive AI API**
```javascript
// Access to Cursy (the AI assistant)
vibeIDE.ai.suggest({
  context: 'user just wrote a function',
  type: 'improvement',
  message: 'Great function! Here's a cleaner way...'
})

vibeIDE.ai.observe({
  code: currentCode,
  pattern: 'common-mistake',
  action: 'suggest-fix'
})

vibeIDE.ai.celebrate({
  milestone: 'first-function',
  message: '🎉 Awesome! You wrote your first function!'
})
```

#### 2. **Project Management API**
```javascript
// Access project information
vibeIDE.project.getName()
vibeIDE.project.getPath()
vibeIDE.project.getType() // 'web-app', 'python-beginner', etc.
vibeIDE.project.getConfig()

// Access PROJECT_JOURNAL
vibeIDE.project.getJournal()
vibeIDE.project.updateJournal(updates)
vibeIDE.project.exportJournal(format) // 'pdf', 'html', 'markdown'
```

#### 3. **File System API**
```javascript
// Read/write files
vibeIDE.fs.readFile(path)
vibeIDE.fs.writeFile(path, content)
vibeIDE.fs.createFile(path, content)
vibeIDE.fs.deleteFile(path)

// Directory operations
vibeIDE.fs.listFiles(directory)
vibeIDE.fs.createDirectory(path)
```

#### 4. **Editor API**
```javascript
// Access Monaco Editor
vibeIDE.editor.getContent()
vibeIDE.editor.setContent(content)
vibeIDE.editor.getSelection()
vibeIDE.editor.insertText(text)
vibeIDE.editor.replaceSelection(text)

// Editor events
vibeIDE.editor.onChange(callback)
vibeIDE.editor.onSave(callback)
```

#### 5. **Live Preview API**
```javascript
// Control live preview
vibeIDE.preview.reload()
vibeIDE.preview.openExternal()
vibeIDE.preview.getContent()
vibeIDE.preview.onUpdate(callback)
```

#### 6. **UI API**
```javascript
// Create custom UI elements
vibeIDE.ui.createPanel({
  id: 'my-panel',
  title: 'My Extension',
  view: 'sidebar' // 'sidebar', 'bottom', 'modal'
})

vibeIDE.ui.showNotification({
  message: 'Extension activated!',
  type: 'success' // 'success', 'info', 'warning', 'error'
})

vibeIDE.ui.createButton({
  label: 'Do Something',
  onClick: () => { /* ... */ }
})
```

#### 7. **Educational API**
```javascript
// Track learning progress
vibeIDE.education.trackMilestone({
  type: 'first-function',
  description: 'User wrote their first function'
})

vibeIDE.education.suggestTutorial({
  topic: 'functions',
  level: 'beginner'
})

vibeIDE.education.explainCode({
  code: selectedCode,
  level: 'beginner' // 'beginner', 'intermediate', 'advanced'
})
```

#### 8. **Emojibar API**
```javascript
// Interact with emojibar
vibeIDE.emojibar.addEmoji(emoji)
vibeIDE.emojibar.sendMessage(message, format) // 'markdown', 'plain'
vibeIDE.emojibar.onMessage(callback)
```

#### 9. **Configuration API**
```javascript
// Extension settings
vibeIDE.config.get(key)
vibeIDE.config.set(key, value)
vibeIDE.config.onChange(callback)
```

---

## 📦 Extension Format

### Extension Structure

```
my-extension/
├── package.json          # Extension manifest
├── extension.js          # Main extension code
├── README.md            # Extension documentation
└── assets/              # Extension assets (optional)
    ├── icons/
    └── images/
```

### package.json Structure

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
  // Extension activation
  console.log('My extension is now active!')
  
  // Register commands
  const command = vibeIDE.commands.registerCommand(
    'myExtension.doSomething',
    () => {
      // Do something
      vibeIDE.ui.showNotification({
        message: 'Extension command executed!',
        type: 'success'
      })
    }
  )
  
  context.subscriptions.push(command)
}

function deactivate() {
  // Cleanup
  console.log('My extension is deactivating')
}

module.exports = {
  activate,
  deactivate
}
```

---

## 🎨 Example Extensions

### 1. Creator Tools Extension

```javascript
// creator-tools-extension.js
function activate(context) {
  // Butler integration
  vibeIDE.commands.registerCommand('creatorTools.publishToItch', async () => {
    const projectPath = vibeIDE.project.getPath()
    // Use Butler to publish
    await vibeIDE.fs.executeCommand(`butler push ${projectPath} user/game:channel`)
  })
  
  // Domain lookup
  vibeIDE.commands.registerCommand('creatorTools.checkDomain', async () => {
    const domain = await vibeIDE.ui.showInputBox({
      prompt: 'Enter domain name to check'
    })
    // Check domain availability
    const available = await checkDomainAvailability(domain)
    vibeIDE.ui.showNotification({
      message: `${domain} is ${available ? 'available' : 'taken'}`,
      type: available ? 'success' : 'info'
    })
  })
  
  // Generate itch.io description
  vibeIDE.commands.registerCommand('creatorTools.generateItchDescription', async () => {
    const project = vibeIDE.project.getConfig()
    const description = generateItchDescription(project)
    vibeIDE.ui.showPanel({
      id: 'itch-description',
      title: 'Itch.io Description',
      content: description
    })
  })
  
  // Generate PROJECT_JOURNAL
  vibeIDE.commands.registerCommand('creatorTools.generateProjectJournal', async () => {
    const project = vibeIDE.project.getConfig()
    const journal = generateProjectJournal(project)
    await vibeIDE.project.updateJournal(journal)
    vibeIDE.ui.showNotification({
      message: 'PROJECT_JOURNAL created!',
      type: 'success'
    })
  })
}
```

### 2. Educational Helper Extension

```javascript
// educational-helper-extension.js
function activate(context) {
  // Track code patterns
  vibeIDE.editor.onChange((content) => {
    const patterns = detectPatterns(content)
    patterns.forEach(pattern => {
      if (pattern.type === 'first-function') {
        vibeIDE.ai.celebrate({
          milestone: 'first-function',
          message: '🎉 You wrote your first function! Great job!'
        })
        vibeIDE.education.trackMilestone({
          type: 'first-function',
          description: 'User wrote their first function'
        })
      }
    })
  })
  
  // Explain code on demand
  vibeIDE.commands.registerCommand('educationalHelper.explainCode', async () => {
    const selection = vibeIDE.editor.getSelection()
    const explanation = await vibeIDE.education.explainCode({
      code: selection,
      level: 'beginner'
    })
    vibeIDE.ui.showPanel({
      id: 'code-explanation',
      title: 'Code Explanation',
      content: explanation
    })
  })
}
```

### 3. Devlog Generator Extension

```javascript
// devlog-generator-extension.js
function activate(context) {
  vibeIDE.commands.registerCommand('devlogGenerator.createDevlog', async () => {
    const journal = vibeIDE.project.getJournal()
    const recentChanges = journal.getRecentChanges()
    
    const devlog = await vibeIDE.ui.showInputBox({
      prompt: 'What did you work on?',
      multiline: true
    })
    
    const formattedDevlog = formatDevlog({
      title: `Devlog #${journal.getDevlogCount() + 1}`,
      content: devlog,
      changes: recentChanges,
      date: new Date()
    })
    
    // Save devlog
    await vibeIDE.fs.writeFile(
      `${vibeIDE.project.getPath()}/devlog-${Date.now()}.md`,
      formattedDevlog
    )
    
    vibeIDE.ui.showNotification({
      message: 'Devlog created!',
      type: 'success'
    })
  })
}
```

---

## 🔒 Security & Sandboxing

### Extension Isolation

- Extensions run in isolated contexts
- Limited file system access (project directory only)
- API permissions required in package.json
- User approval for sensitive operations

### Permission System

```json
{
  "vibeIDE": {
    "permissions": [
      "fs.read",
      "fs.write",
      "ai.suggest",
      "project.read"
    ]
  }
}
```

### Security Considerations

- Extensions can't access system files outside project
- Network requests require user approval
- Sensitive operations (file deletion) require confirmation
- Extension marketplace vetting process

---

## 📦 Extension Marketplace

### Curated Marketplace

- **Beginner-Friendly** - Only safe, simple extensions
- **Vetted** - All extensions reviewed
- **Categorized** - Easy to find what you need
- **Rated** - Community ratings and reviews

### Categories

- **Creator Tools** - Publishing, domain lookup, etc.
- **Educational** - Learning helpers, tutorials
- **Productivity** - Code snippets, shortcuts
- **Themes** - Visual customization
- **Language Support** - Additional language servers

### Installation

- One-click install from marketplace
- Automatic updates
- Extension manager in VIBE IDE
- Enable/disable extensions easily

---

## 🚀 Implementation Roadmap

### Phase 1: Core API (MVP)
- [ ] Extension loader
- [ ] Basic API structure
- [ ] File system API
- [ ] Editor API
- [ ] Project API

### Phase 2: Advanced APIs
- [ ] Proactive AI API
- [ ] Educational API
- [ ] Emojibar API
- [ ] UI API

### Phase 3: Marketplace
- [ ] Extension marketplace
- [ ] Installation system
- [ ] Update mechanism
- [ ] Review/vetting process

### Phase 4: Developer Tools
- [ ] Extension development tools
- [ ] Debugging support
- [ ] Documentation
- [ ] Examples and templates

---

## 📝 Developer Documentation

### Getting Started

1. **Create Extension**
   ```bash
   vibeide-extension create my-extension
   ```

2. **Develop Extension**
   - Use VIBE IDE Extension API
   - Test in development mode
   - Debug with extension host

3. **Publish Extension**
   - Submit to marketplace
   - Wait for review
   - Extension goes live!

### API Documentation

- Full API reference
- Code examples
- Best practices
- Security guidelines

### Extension Templates

- Basic extension template
- Creator tools template
- Educational extension template
- UI extension template

---

## 🎯 Goals

### For Beginners
- Simple, safe extensions
- Clear descriptions
- Easy installation
- No overwhelming choices

### For Advanced Users
- Powerful API access
- Custom functionality
- Integration with VIBE IDE features
- Extension development tools

### For Extension Developers
- Clear API documentation
- Development tools
- Marketplace access
- Community support

---

## 💭 Future Enhancements

- **VS Code Extension Compatibility** - Full compatibility layer (future)
- **Extension Packs** - Bundle related extensions
- **Extension Analytics** - Usage tracking (privacy-respecting)
- **Extension Recommendations** - AI suggests useful extensions
- **Extension Sharing** - Share extension configs

---

## 🤝 Community

- Extension developer forum
- API discussion
- Extension showcase
- Contribution guidelines

---

**This is a living document - will be updated as we build the extension system!**

