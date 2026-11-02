/**
 * Single source of truth for new-project templates and default genre inference.
 */

const PHASER_INDEX_HTML = (title) => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <script src="https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js"></script>
</head>
<body>
    <script src="game.js"></script>
</body>
</html>`;

/** @type {Record<string, string|null>} */
const TEMPLATE_DEFAULT_GENRE = {
  blank: null,
  'web-app': 'vanilla-js',
  'landing-page': 'vanilla-js',
  'personal-portfolio': 'vanilla-js',
  'react-starter': 'react-spa',
  'vue-starter': 'vue-spa',
  blog: 'blog',
  'markdown-journal': 'blog',
  'ecommerce-starter': 'ecommerce',
  'python-beginner': 'python',
  'data-analysis': 'data-analysis',
  'python-flask': 'python',
  platformer: 'platformer',
  shooter: 'shooter',
  puzzle: 'puzzle',
  runner: 'runner',
  'phaser-starter': 'platformer',
  'pwa-starter': 'pwa',
  'vite-react': 'react-spa',
  'vite-vue': 'vue-spa',
  'node-cli': 'node-cli',
  'express-api': 'node-cli',
  'typescript-cli': 'node-cli',
};

const PHASER_GAME_IDS = new Set(['platformer', 'shooter', 'puzzle', 'runner', 'phaser-starter']);

const WEB_STATIC_IDS = new Set([
  'blank',
  'web-app',
  'landing-page',
  'personal-portfolio',
  'blog',
  'markdown-journal',
  'ecommerce-starter',
  'react-starter',
  'vue-starter',
  'pwa-starter',
]);

const NPM_TOOL_IDS = new Set(['node-cli', 'express-api', 'vite-react', 'vite-vue', 'typescript-cli']);

const TEMPLATES = {
  blank: {
    id: 'blank',
    category: 'general',
    name: 'Blank Project',
    description: 'Start from scratch with a clean slate',
    icon: '📄',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Project</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background: #1e1e1e;
            color: #fff;
        }
    </style>
</head>
<body>
    <h1>Hello, World!</h1>
    <p>Start coding here!</p>
    <script>
        console.log('Welcome to VIBE IDE!');
    </script>
</body>
</html>`,
    },
  },
  'web-app': {
    id: 'web-app',
    category: 'web',
    name: 'Web App',
    description: 'HTML, CSS, and JavaScript web application',
    icon: '🌐',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Web App</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>Welcome to My Web App!</h1>
        <button id="myButton">Click Me!</button>
        <p id="output"></p>
    </div>
    <script src="script.js"></script>
</body>
</html>`,
      'styles.css': `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
}

.container {
    background: white;
    padding: 40px;
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    text-align: center;
}

h1 {
    color: #333;
    margin-bottom: 20px;
}

button {
    background: #667eea;
    color: white;
    border: none;
    padding: 12px 24px;
    font-size: 16px;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.3s;
}

button:hover {
    background: #5568d3;
}

#output {
    margin-top: 20px;
    color: #666;
}`,
      'script.js': `document.getElementById('myButton').addEventListener('click', function() {
    const output = document.getElementById('output');
    output.textContent = 'Button clicked! 🎉';
    output.style.color = '#667eea';
});`,
    },
  },
  'python-beginner': {
    id: 'python-beginner',
    category: 'python',
    name: 'Python Beginner',
    description: 'Simple Python script to learn the basics',
    icon: '🐍',
    files: {
      'main.py': `# Welcome to Python!

name = "World"
print(f"Hello, {name}!")

def greet(name):
    return f"Hello, {name}! Welcome to Python!"

print(greet("Cursy"))

for i in range(1, 6):
    print(i)`,
    },
  },
  'data-analysis': {
    id: 'data-analysis',
    category: 'python',
    name: 'Data Analysis',
    description: 'Python project for analyzing simple datasets',
    icon: '📊',
    files: {
      'main.py': `# Data Analysis Project

data = [
    {"name": "Alice", "age": 25, "score": 85},
    {"name": "Bob", "age": 30, "score": 92},
    {"name": "Charlie", "age": 28, "score": 78},
]

average_score = sum(p["score"] for p in data) / len(data)
print(f"Average Score: {average_score:.2f}")

highest = max(data, key=lambda x: x["score"])
print(f"Highest: {highest['name']} ({highest['score']})")`,
    },
  },
  platformer: {
    id: 'platformer',
    category: 'games',
    name: 'Platformer Game',
    description: 'Jump and run on platforms (Phaser.js)',
    icon: '🎮',
    files: {
      'index.html': PHASER_INDEX_HTML('Platformer Game'),
      'game.js': `const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    physics: {
        default: 'arcade',
        arcade: { gravity: { y: 800 }, debug: false }
    },
    scene: { preload, create, update }
};

new Phaser.Game(config);

function preload() {
    this.add.graphics().fillStyle(0x00ff00).fillRect(0, 0, 64, 64).generateTexture('player', 64, 64);
    this.add.graphics().fillStyle(0x8b4513).fillRect(0, 0, 200, 32).generateTexture('platform', 200, 32);
}

function create() {
    this.player = this.physics.add.sprite(100, 100, 'player');
    this.player.setCollideWorldBounds(true);
    this.platforms = this.physics.add.staticGroup();
    this.platforms.create(400, 500, 'platform');
    this.platforms.create(200, 400, 'platform');
    this.platforms.create(600, 300, 'platform');
    this.physics.add.collider(this.player, this.platforms);
    this.cursors = this.input.keyboard.createCursorKeys();
}

function update() {
    if (this.cursors.left.isDown) this.player.setVelocityX(-200);
    else if (this.cursors.right.isDown) this.player.setVelocityX(200);
    else this.player.setVelocityX(0);
    if (this.cursors.up.isDown && this.player.body.touching.down) this.player.setVelocityY(-600);
}`,
    },
  },
  shooter: {
    id: 'shooter',
    category: 'games',
    name: 'Top-Down Shooter',
    description: 'Move with arrows, shoot with space (Phaser.js)',
    icon: '🔫',
    files: {
      'index.html': PHASER_INDEX_HTML('Top-Down Shooter'),
      'game.js': `const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    backgroundColor: '#111122',
    physics: { default: 'arcade', arcade: { debug: false } },
    scene: { preload, create, update }
};

new Phaser.Game(config);

function preload() {
    this.add.graphics().fillStyle(0x44aaff).fillCircle(16, 16, 14).generateTexture('player', 32, 32);
    this.add.graphics().fillStyle(0xff4444).fillCircle(10, 10, 10).generateTexture('enemy', 20, 20);
    this.add.graphics().fillStyle(0xffff66).fillRect(0, 0, 8, 16).generateTexture('bullet', 8, 16);
}

function create() {
    this.player = this.physics.add.sprite(400, 300, 'player');
    this.player.setCollideWorldBounds(true);
    this.enemies = this.physics.add.group();
    this.bullets = this.physics.add.group();
    this.cursors = this.input.keyboard.createCursorKeys();
    this.fireKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.time.addEvent({ delay: 1500, callback: spawnEnemy, callbackScope: this, loop: true });
    this.physics.add.overlap(this.bullets, this.enemies, hitEnemy, null, this);
    this.physics.add.overlap(this.player, this.enemies, () => this.scene.restart(), null, this);
    this.score = 0;
    this.scoreText = this.add.text(16, 16, 'Score: 0', { fontSize: '20px', fill: '#fff' });
}

function spawnEnemy() {
    const x = Phaser.Math.Between(40, 760);
    const y = Phaser.Math.Between(40, 560);
    const e = this.enemies.create(x, y, 'enemy');
    e.setVelocity(Phaser.Math.Between(-80, 80), Phaser.Math.Between(-80, 80));
}

function hitEnemy(bullet, enemy) {
    bullet.destroy();
    enemy.destroy();
    this.score += 10;
    this.scoreText.setText('Score: ' + this.score);
}

function update() {
    const speed = 220;
    this.player.setVelocity(0);
    if (this.cursors.left.isDown) this.player.setVelocityX(-speed);
    else if (this.cursors.right.isDown) this.player.setVelocityX(speed);
    if (this.cursors.up.isDown) this.player.setVelocityY(-speed);
    else if (this.cursors.down.isDown) this.player.setVelocityY(speed);
    if (Phaser.Input.Keyboard.JustDown(this.fireKey)) {
        const b = this.bullets.create(this.player.x, this.player.y - 20, 'bullet');
        b.setVelocityY(-400);
    }
}`,
    },
  },
  puzzle: {
    id: 'puzzle',
    category: 'games',
    name: 'Slide Puzzle',
    description: 'Click tiles to swap and solve the grid (Phaser.js)',
    icon: '🧩',
    files: {
      'index.html': PHASER_INDEX_HTML('Slide Puzzle'),
      'game.js': `const config = {
    type: Phaser.AUTO,
    width: 480,
    height: 560,
    backgroundColor: '#2d2d44',
    scene: { create }
};

new Phaser.Game(config);

const COLORS = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0x95e1d3, 0xf38181, 0xaa96da, 0xfcbad3, 0xa8d8ea, 0];

function create() {
    this.tiles = [];
    this.grid = [1, 2, 3, 4, 5, 6, 7, 8, 0];
    Phaser.Utils.Array.Shuffle(this.grid);
    this.add.text(240, 24, 'Click two tiles to swap', { fontSize: '18px', fill: '#fff' }).setOrigin(0.5);
    drawBoard.call(this);
}

function drawBoard() {
    this.tiles.forEach(t => t.destroy());
    this.tiles = [];
    const size = 120;
    const ox = 60;
    const oy = 80;
    for (let i = 0; i < 9; i++) {
        const val = this.grid[i];
        if (val === 0) continue;
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = ox + col * size + size / 2;
        const y = oy + row * size + size / 2;
        const tile = this.add.rectangle(x, y, size - 8, size - 8, COLORS[val - 1]).setInteractive();
        tile.index = i;
        tile.label = this.add.text(x, y, String(val), { fontSize: '32px', fill: '#222' }).setOrigin(0.5);
        tile.on('pointerdown', () => onTileClick.call(this, tile));
        this.tiles.push(tile);
    }
}

function onTileClick(tile) {
    if (!this.selected) {
        this.selected = tile;
        tile.setStrokeStyle(4, 0xffffff);
        return;
    }
    if (this.selected === tile) {
        this.selected.setStrokeStyle(0);
        this.selected = null;
        return;
    }
    const a = this.selected.index;
    const b = tile.index;
    [this.grid[a], this.grid[b]] = [this.grid[b], this.grid[a]];
    this.selected.setStrokeStyle(0);
    this.selected = null;
    drawBoard.call(this);
    if (this.grid.every((v, idx) => v === (idx + 1) % 9)) {
        this.add.text(240, 520, 'You win! 🎉', { fontSize: '24px', fill: '#ffe66d' }).setOrigin(0.5);
    }
}`,
    },
  },
  runner: {
    id: 'runner',
    category: 'games',
    name: 'Endless Runner',
    description: 'Auto-run and jump obstacles (Phaser.js)',
    icon: '🏃',
    files: {
      'index.html': PHASER_INDEX_HTML('Endless Runner'),
      'game.js': `const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 400,
    backgroundColor: '#87ceeb',
    physics: { default: 'arcade', arcade: { gravity: { y: 900 }, debug: false } },
    scene: { preload, create, update }
};

new Phaser.Game(config);

function preload() {
    this.add.graphics().fillStyle(0xff00aa).fillRect(0, 0, 48, 48).generateTexture('player', 48, 48);
    this.add.graphics().fillStyle(0x663300).fillRect(0, 0, 40, 60).generateTexture('obstacle', 40, 60);
}

function create() {
    this.player = this.physics.add.sprite(120, 300, 'player');
    this.player.setCollideWorldBounds(true);
    this.ground = this.add.rectangle(400, 380, 800, 40, 0x228b22);
    this.physics.add.existing(this.ground, true);
    this.physics.add.collider(this.player, this.ground);
    this.obstacles = this.physics.add.group();
    this.cursors = this.input.keyboard.createCursorKeys();
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.speed = 240;
    this.time.addEvent({ delay: 1800, callback: spawnObstacle, callbackScope: this, loop: true });
    this.physics.add.overlap(this.player, this.obstacles, () => this.scene.restart(), null, this);
    this.distance = 0;
    this.distText = this.add.text(16, 16, '0 m', { fontSize: '20px', fill: '#fff' });
}

function spawnObstacle() {
    const o = this.obstacles.create(820, 340, 'obstacle');
    o.setVelocityX(-this.speed);
    o.setImmovable(true);
}

function update(time, delta) {
    this.speed = Math.min(420, this.speed + 0.02);
    this.distance += delta * 0.05;
    this.distText.setText(Math.floor(this.distance) + ' m');
    if ((this.cursors.up.isDown || this.spaceKey.isDown) && this.player.body.touching.down) {
        this.player.setVelocityY(-420);
    }
    this.obstacles.children.iterate((o) => {
        if (o && o.x < -50) o.destroy();
    });
}`,
    },
  },
  'landing-page': {
    id: 'landing-page',
    category: 'web',
    name: 'Landing Page',
    description: 'Single-page synthwave-style promo site (HTML/CSS)',
    icon: '🌅',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Product — Launch</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="hero">
    <p class="eyebrow">FutureVision Labs presents</p>
    <h1>Ship something cool.</h1>
    <p class="lead">A starter landing page you can remix in VIBE IDE.</p>
    <button id="cta">Get started</button>
  </header>
  <section class="features">
    <article><h2>Fast</h2><p>Plain HTML and CSS. No build step required.</p></article>
    <article><h2>Friendly</h2><p>Cursy can help you edit copy and colors.</p></article>
    <article><h2>Fun</h2><p>Add your own sections below the fold.</p></article>
  </section>
  <footer><p>Built with VIBE IDE · Team DC</p></footer>
  <script src="script.js"></script>
</body>
</html>`,
      'styles.css': `:root {
  --bg: #0f1020;
  --pink: #ff2d95;
  --cyan: #2de2e6;
  --text: #f5f7ff;
}
* { box-sizing: border-box; margin: 0; }
body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); }
.hero {
  min-height: 70vh; display: flex; flex-direction: column; justify-content: center;
  align-items: center; text-align: center; padding: 2rem;
  background: radial-gradient(circle at top, #3a1c71, var(--bg));
}
.eyebrow { letter-spacing: 0.2em; text-transform: uppercase; color: var(--cyan); font-size: 0.85rem; }
h1 { font-size: clamp(2rem, 6vw, 3.5rem); margin: 1rem 0; }
.lead { max-width: 32rem; opacity: 0.85; margin-bottom: 1.5rem; }
#cta {
  background: linear-gradient(90deg, var(--pink), var(--cyan));
  border: none; color: #111; font-weight: 700; padding: 0.85rem 1.6rem;
  border-radius: 999px; cursor: pointer;
}
.features {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem; padding: 2rem; max-width: 960px; margin: 0 auto;
}
article { background: #1a1d33; padding: 1.25rem; border-radius: 12px; border: 1px solid #2a2f55; }
footer { text-align: center; padding: 2rem; opacity: 0.6; font-size: 0.9rem; }`,
      'script.js': `document.getElementById('cta').addEventListener('click', () => {
  alert('CTA clicked — wire this to your signup, itch page, or mailto!');
});`,
    },
  },
  'personal-portfolio': {
    id: 'personal-portfolio',
    category: 'web',
    name: 'Personal Portfolio',
    description: 'About, projects, and contact sections (vanilla JS)',
    icon: '💼',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Portfolio</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <nav><a href="#about">About</a><a href="#projects">Projects</a><a href="#contact">Contact</a></nav>
  <main>
    <section id="about"><h1>Hi, I'm <span id="name">Your Name</span></h1><p>I build games, web apps, and experiments.</p></section>
    <section id="projects"><h2>Projects</h2><ul id="project-list"></ul></section>
    <section id="contact"><h2>Contact</h2><p>Email: <a id="email" href="#">you@example.com</a></p></section>
  </main>
  <script src="script.js"></script>
</body>
</html>`,
      'styles.css': `body { font-family: Georgia, serif; max-width: 720px; margin: 0 auto; padding: 1.5rem; line-height: 1.6; }
nav { display: flex; gap: 1rem; margin-bottom: 2rem; font-family: system-ui, sans-serif; }
nav a { color: #335; }
#project-list { padding-left: 1.2rem; }`,
      'script.js': `const projects = [
  { name: 'VIBE IDE game jam entry', url: '#' },
  { name: 'Synthwave landing page', url: '#' },
  { name: 'Python data mini-project', url: '#' }
];
const list = document.getElementById('project-list');
projects.forEach(p => {
  const li = document.createElement('li');
  li.innerHTML = '<a href="' + p.url + '">' + p.name + '</a>';
  list.appendChild(li);
});`,
    },
  },
  'react-starter': {
    id: 'react-starter',
    category: 'web',
    name: 'React Starter (CDN)',
    description: 'React 18 via CDN, no build step (createElement)',
    icon: '⚛️',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>React Starter</title>
  <link rel="stylesheet" href="styles.css">
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
</head>
<body>
  <div id="root"></div>
  <script src="app.js"></script>
</body>
</html>`,
      'styles.css': `body { font-family: system-ui, sans-serif; background: #20232a; color: #61dafb; margin: 0; padding: 2rem; }`,
      'app.js': `const e = React.createElement;

function App() {
  const [count, setCount] = React.useState(0);
  return e('div', null,
    e('h1', null, 'Hello React from VIBE IDE'),
    e('p', null, 'Count: ', count),
    e('button', { onClick: () => setCount(c => c + 1) }, 'Increment')
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(e(App));`,
    },
  },
  'vue-starter': {
    id: 'vue-starter',
    category: 'web',
    name: 'Vue Starter (CDN)',
    description: 'Vue 3 global build, no build step',
    icon: '💚',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vue Starter</title>
  <link rel="stylesheet" href="styles.css">
  <script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
</head>
<body>
  <div id="app">
    <h1>{{ title }}</h1>
    <p>Count: {{ count }}</p>
    <button @click="count++">Increment</button>
  </div>
  <script src="app.js"></script>
</body>
</html>`,
      'styles.css': `body { font-family: system-ui, sans-serif; background: #1a4731; color: #42b883; padding: 2rem; }`,
      'app.js': `const { createApp } = Vue;
createApp({
  data() {
    return { title: 'Hello Vue from VIBE IDE', count: 0 };
  }
}).mount('#app');`,
    },
  },
  blog: {
    id: 'blog',
    category: 'content',
    name: 'Static Blog',
    description: 'Post list + reader fed by posts/posts.json',
    icon: '📝',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Blog</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header><h1>Devlog & Notes</h1><p id="tagline">Powered by VIBE IDE</p></header>
  <main><ul id="posts"></ul><article id="post-view" hidden></article></main>
  <script src="app.js"></script>
</body>
</html>`,
      'styles.css': `body { font-family: system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 1.5rem; }
ul { list-style: none; padding: 0; }
li { margin: 0.5rem 0; }
li button { background: none; border: none; color: #06c; cursor: pointer; font-size: 1rem; text-align: left; }
#post-view { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #ccc; white-space: pre-wrap; }`,
      'posts/posts.json': JSON.stringify(
        [
          {
            slug: 'welcome',
            title: 'Welcome to your blog',
            date: '2026-10-30',
            excerpt: 'Replace this with your first post.',
            body: 'Edit posts/posts.json or add new markdown files later.\n\nCursy can help you draft posts in chat, then paste them here.',
          },
          {
            slug: 'second-post',
            title: 'Groundswell not fork',
            date: '2026-10-29',
            excerpt: 'Team DC energy.',
            body: 'Ship small. Learn loud. Have fun.',
          },
        ],
        null,
        2
      ),
      'app.js': `async function loadPosts() {
  const res = await fetch('posts/posts.json');
  return res.json();
}
const listEl = document.getElementById('posts');
const viewEl = document.getElementById('post-view');
loadPosts().then(posts => {
  posts.forEach(post => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.textContent = post.date + ' — ' + post.title;
    btn.onclick = () => {
      viewEl.hidden = false;
      viewEl.innerHTML = '<h2>' + post.title + '</h2><p><em>' + post.date + '</em></p><p>' + post.body.replace(/\\n/g, '<br>') + '</p>';
    };
    li.appendChild(btn);
    listEl.appendChild(li);
  });
});`,
    },
  },
  'markdown-journal': {
    id: 'markdown-journal',
    category: 'content',
    name: 'Markdown Journal',
    description: 'Simple journal pages + starter entries in content/',
    icon: '📓',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>My Journal</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <h1>Journal</h1>
  <nav id="entries"></nav>
  <article id="content"><p>Pick an entry.</p></article>
  <script src="app.js"></script>
</body>
</html>`,
      'styles.css': `body { font-family: Georgia, serif; max-width: 640px; margin: auto; padding: 1.5rem; }
nav button { display: block; margin: 0.35rem 0; background: #f4f4f4; border: 1px solid #ddd; padding: 0.5rem; cursor: pointer; width: 100%; text-align: left; }
article { margin-top: 1.5rem; white-space: pre-wrap; }`,
      'content/entry-01.md': `# Day one\n\nWhat I learned today:\n\n- Opened VIBE IDE\n- Talked to Cursy\n- Shipped a tiny project\n`,
      'content/entry-02.md': `# Day two\n\nGoals:\n\n1. Fix one bug\n2. Write one devlog line\n3. Drink water\n`,
      'app.js': `const entries = [
  { file: 'content/entry-01.md', label: 'Day one' },
  { file: 'content/entry-02.md', label: 'Day two' }
];
const nav = document.getElementById('entries');
const content = document.getElementById('content');
entries.forEach(ent => {
  const btn = document.createElement('button');
  btn.textContent = ent.label;
  btn.onclick = async () => {
    const text = await fetch(ent.file).then(r => r.text());
    content.textContent = text;
  };
  nav.appendChild(btn);
});`,
    },
  },
  'ecommerce-starter': {
    id: 'ecommerce-starter',
    category: 'web',
    name: 'Mini Shop',
    description: 'Product grid + cart (vanilla JS, demo data)',
    icon: '🛒',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Mini Shop</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header><h1>Mini Shop</h1><p>Cart: <span id="cart-count">0</span> items · $<span id="cart-total">0</span></p></header>
  <main id="catalog"></main>
  <script src="shop.js"></script>
</body>
</html>`,
      'styles.css': `body { font-family: system-ui, sans-serif; margin: 0; padding: 1rem; background: #fafafa; }
#catalog { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1rem; }
.card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1rem; }
.card button { width: 100%; margin-top: 0.5rem; }`,
      'products.json': JSON.stringify(
        [
          { id: 1, name: 'Synthwave Sticker Pack', price: 8 },
          { id: 2, name: 'Team DC Mug', price: 14 },
          { id: 3, name: 'Cursy Plush (dream)', price: 99 },
        ],
        null,
        2
      ),
      'shop.js': `let cart = [];
async function init() {
  const products = await fetch('products.json').then(r => r.json());
  const catalog = document.getElementById('catalog');
  products.forEach(p => {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = '<strong>' + p.name + '</strong><p>$' + p.price + '</p>';
    const btn = document.createElement('button');
    btn.textContent = 'Add to cart';
    btn.onclick = () => { cart.push(p); renderCart(); };
    div.appendChild(btn);
    catalog.appendChild(div);
  });
}
function renderCart() {
  document.getElementById('cart-count').textContent = cart.length;
  document.getElementById('cart-total').textContent = cart.reduce((s, i) => s + i.price, 0);
}
init();`,
    },
  },
  'python-flask': {
    id: 'python-flask',
    category: 'python',
    name: 'Python Flask API',
    description: 'Tiny JSON API (run: pip install -r requirements.txt)',
    icon: '🧪',
    files: {
      'requirements.txt': `flask>=3.0.0
`,
      'app.py': `from flask import Flask, jsonify

app = Flask(__name__)

ITEMS = [
    {"id": 1, "name": "Cursy sticker", "price": 5},
    {"id": 2, "name": "Local LLM hours", "price": 0},
]

@app.get("/api/health")
def health():
    return jsonify({"ok": True, "service": "vibe-ide-flask-starter"})

@app.get("/api/items")
def list_items():
    return jsonify(ITEMS)

if __name__ == "__main__":
    app.run(debug=True, port=5000)
`,
      'README-run.md': `# Run this template

\`\`\`bash
pip install -r requirements.txt
python app.py
\`\`\`

Open http://127.0.0.1:5000/api/health
`,
    },
  },
  'phaser-starter': {
    id: 'phaser-starter',
    category: 'games',
    name: 'Phaser Blank Scene',
    description: 'Empty Phaser scene — fill in preload/create/update',
    icon: '✨',
    files: {
      'index.html': PHASER_INDEX_HTML('My Phaser Game'),
      'game.js': `const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    backgroundColor: '#1a1a2e',
    scene: { preload, create, update }
};

new Phaser.Game(config);

function preload() {
    // this.load.image('player', 'assets/player.png');
}

function create() {
    this.add.text(400, 280, 'Phaser starter — add your game here!', {
        fontSize: '22px',
        fill: '#e94560',
        align: 'center'
    }).setOrigin(0.5);
}

function update() {
    // game loop
}`,
    },
  },
  'pwa-starter': {
    id: 'pwa-starter',
    category: 'web',
    name: 'Progressive Web App',
    description: 'Installable web app with manifest + service worker',
    icon: '📱',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#2de2e6">
  <link rel="manifest" href="manifest.webmanifest">
  <title>My PWA</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <h1>Offline-ready app</h1>
    <p id="status">Checking service worker…</p>
    <button id="install" hidden>Install app</button>
  </main>
  <script src="app.js"></script>
</body>
</html>`,
      'styles.css': `body { font-family: system-ui, sans-serif; max-width: 480px; margin: 2rem auto; padding: 0 1rem; }
#install { margin-top: 1rem; padding: 0.75rem 1.25rem; background: #2de2e6; border: none; border-radius: 8px; font-weight: 600; }`,
      'manifest.webmanifest': JSON.stringify(
        {
          name: 'VIBE IDE PWA',
          short_name: 'PWA',
          start_url: './index.html',
          display: 'standalone',
          background_color: '#0f1020',
          theme_color: '#2de2e6',
          icons: [{ src: 'icon-192.svg', sizes: '192x192', type: 'image/svg+xml' }],
        },
        null,
        2
      ),
      'icon-192.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">
  <rect width="192" height="192" rx="32" fill="#2de2e6"/>
  <text x="96" y="110" text-anchor="middle" font-size="72" font-family="sans-serif" fill="#0f1020">V</text>
</svg>`,
      'sw.js': `const CACHE = 'vibe-pwa-v1';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon-192.svg'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});
self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});`,
      'app.js': `const status = document.getElementById('status');
const installBtn = document.getElementById('install');
let deferredPrompt;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(() => {
    status.textContent = 'Service worker registered. Try going offline in DevTools!';
  }).catch((err) => { status.textContent = 'SW failed: ' + err.message; });
} else {
  status.textContent = 'Service workers not supported in this browser.';
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});

installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  installBtn.hidden = true;
});`,
      'README-run.md': `# Run this PWA locally

Use a local server (required for service workers):

\`\`\`bash
npm start
\`\`\`

Then open http://localhost:8080
`,
    },
  },
  'vite-react': {
    id: 'vite-react',
    category: 'web',
    name: 'Vite + React',
    description: 'Modern React with Vite (npm install, then npm run dev)',
    icon: '⚡',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite + React</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`,
      'vite.config.js': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});`,
      'src/main.jsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`,
      'src/App.jsx': `import { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main className="app">
      <h1>Vite + React</h1>
      <p>Count: {count}</p>
      <button type="button" onClick={() => setCount((c) => c + 1)}>Increment</button>
    </main>
  );
}`,
      'src/index.css': `body { margin: 0; font-family: system-ui, sans-serif; background: #0f1020; color: #f5f7ff; }
.app { min-height: 100vh; display: grid; place-content: center; text-align: center; gap: 0.75rem; }
button { padding: 0.6rem 1.2rem; border-radius: 8px; border: none; background: #ff2d95; color: #111; font-weight: 700; cursor: pointer; }`,
      'README-run.md': `# Vite + React

\`\`\`bash
npm install
npm run dev
\`\`\`

Open the URL Vite prints (usually http://localhost:5173).
`,
    },
  },
  'vite-vue': {
    id: 'vite-vue',
    category: 'web',
    name: 'Vite + Vue',
    description: 'Modern Vue 3 with Vite (npm install, then npm run dev)',
    icon: '⚡',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite + Vue</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>`,
      'vite.config.js': `import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
});`,
      'src/main.js': `import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

createApp(App).mount('#app');`,
      'src/App.vue': `<script setup>
import { ref } from 'vue';
const count = ref(0);
</script>

<template>
  <main class="app">
    <h1>Vite + Vue</h1>
    <p>Count: {{ count }}</p>
    <button type="button" @click="count++">Increment</button>
  </main>
</template>`,
      'src/style.css': `body { margin: 0; font-family: system-ui, sans-serif; background: #1a4731; color: #42b883; }
.app { min-height: 100vh; display: grid; place-content: center; text-align: center; gap: 0.75rem; }
button { padding: 0.6rem 1.2rem; border-radius: 8px; border: none; background: #42b883; color: #fff; font-weight: 700; cursor: pointer; }`,
      'README-run.md': `# Vite + Vue

\`\`\`bash
npm install
npm run dev
\`\`\`
`,
    },
  },
  'node-cli': {
    id: 'node-cli',
    category: 'tools',
    name: 'Node CLI Tool',
    description: 'Command-line script with args (node cli.js)',
    icon: '🖥️',
    files: {
      'cli.js': `#!/usr/bin/env node
const args = process.argv.slice(2);
const name = args[0] || 'Cursy';

console.log('Hello, ' + name + '! 👋');
console.log('Args:', args.length ? args.join(' ') : '(none)');
console.log('\\nTip: npm start -- YourName');
`,
      'README-run.md': `# Node CLI

\`\`\`bash
npm start
npm start -- Damo
node cli.js hello world
\`\`\`
`,
    },
  },
  'express-api': {
    id: 'express-api',
    category: 'tools',
    name: 'Express REST API',
    description: 'Tiny JSON API with Express (npm install first)',
    icon: '🔌',
    files: {
      'server.js': `import express from 'express';

const app = express();
const port = process.env.PORT || 3000;

const todos = [
  { id: 1, text: 'Ship VIBE IDE templates', done: true },
  { id: 2, text: 'Give Cursy purple hair', done: false },
];

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'vibe-express-starter' });
});

app.get('/api/todos', (_req, res) => {
  res.json(todos);
});

app.listen(port, () => {
  console.log('API listening on http://127.0.0.1:' + port);
});
`,
      'README-run.md': `# Express API

\`\`\`bash
npm install
npm start
\`\`\`

Try http://127.0.0.1:3000/api/health
`,
    },
  },
  'typescript-cli': {
    id: 'typescript-cli',
    category: 'tools',
    name: 'TypeScript CLI',
    description: 'TS entry point run with tsx (npm install first)',
    icon: '📘',
    files: {
      'tsconfig.json': JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            outDir: 'dist',
            rootDir: 'src',
          },
          include: ['src'],
        },
        null,
        2
      ),
      'src/index.ts': `const name = process.argv[2] ?? 'Team DC';

function greet(who: string): string {
  return \`Hello, \${who}! TypeScript CLI is alive.\`;
}

console.log(greet(name));
console.log('Args:', process.argv.slice(2));
`,
      'README-run.md': `# TypeScript CLI

\`\`\`bash
npm install
npm start
npm start -- Damo
\`\`\`
`,
    },
  },
};

const CATEGORY_LABELS = {
  general: 'General',
  web: 'Web & apps',
  content: 'Content & blogs',
  python: 'Python',
  tools: 'Node & tools',
  games: 'Games (Phaser)',
};

function inferGenre(templateId) {
  return TEMPLATE_DEFAULT_GENRE[templateId] ?? null;
}

function getTemplate(templateId) {
  return TEMPLATES[templateId] || TEMPLATES.blank;
}

function listTemplateMeta() {
  return Object.values(TEMPLATES).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    icon: t.icon,
    category: t.category,
    categoryLabel: CATEGORY_LABELS[t.category] || t.category,
    defaultGenre: inferGenre(t.id),
  }));
}

function isPhaserTemplate(templateId) {
  return PHASER_GAME_IDS.has(templateId);
}

function needsPackageJson(templateId) {
  return WEB_STATIC_IDS.has(templateId) || isPhaserTemplate(templateId) || NPM_TOOL_IDS.has(templateId);
}

function packageJsonMainEntry(templateId) {
  if (isPhaserTemplate(templateId)) return 'game.js';
  if (templateId === 'node-cli') return 'cli.js';
  if (templateId === 'express-api') return 'server.js';
  if (templateId === 'typescript-cli') return 'src/index.ts';
  return 'index.html';
}

function getPackageJson(templateId, projectName) {
  if (!needsPackageJson(templateId)) return null;

  const base = {
    name: projectName,
    version: '1.0.0',
    description: 'Project created with VIBE IDE',
  };

  if (templateId === 'vite-react') {
    return {
      ...base,
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview',
      },
      dependencies: {
        react: '^18.3.1',
        'react-dom': '^18.3.1',
      },
      devDependencies: {
        vite: '^5.4.11',
        '@vitejs/plugin-react': '^4.3.4',
      },
    };
  }

  if (templateId === 'vite-vue') {
    return {
      ...base,
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview',
      },
      dependencies: {
        vue: '^3.5.13',
      },
      devDependencies: {
        vite: '^5.4.11',
        '@vitejs/plugin-vue': '^5.2.1',
      },
    };
  }

  if (templateId === 'node-cli') {
    return {
      ...base,
      type: 'module',
      scripts: { start: 'node cli.js' },
    };
  }

  if (templateId === 'express-api') {
    return {
      ...base,
      type: 'module',
      scripts: { start: 'node server.js' },
      dependencies: { express: '^4.21.2' },
    };
  }

  if (templateId === 'typescript-cli') {
    return {
      ...base,
      type: 'module',
      scripts: { start: 'tsx src/index.ts' },
      devDependencies: {
        typescript: '^5.6.3',
        tsx: '^4.19.2',
      },
    };
  }

  const pkg = {
    ...base,
    main: packageJsonMainEntry(templateId),
    scripts: { start: 'npx http-server -p 8080' },
  };
  if (isPhaserTemplate(templateId)) {
    pkg.dependencies = { phaser: '^3.90.0' };
  }
  return pkg;
}

module.exports = {
  TEMPLATE_DEFAULT_GENRE,
  CATEGORY_LABELS,
  inferGenre,
  getTemplate,
  listTemplateMeta,
  isPhaserTemplate,
  needsPackageJson,
  packageJsonMainEntry,
  getPackageJson,
};
