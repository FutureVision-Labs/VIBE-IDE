// VIBE IDE Website - Logo Carousel Script

// Logo file names (in order)
const logoFiles = [
    'VIBE IDE (option 2) Logo 1.jpg',
    'VIBE IDE (option 2) Logo 2.jpg',
    'VIBE IDE (option 2) Logo 3.jpg',
    'VIBE IDE (option 2) Logo 4.jpg',
    'VIBE IDE (option 2) Logo 5.jpg',
    'VIBE IDE (option 2) Logo 6.jpg',
    'VIBE IDE (option 2) Logo 7.jpg',
    'VIBE IDE (option 2) Logo 8.jpg',
    'VIBE IDE (option 2) Logo 9.jpg',
    'VIBE IDE (option 2) Logo 10.jpg'
];

// Shuffle array function
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Initialize logo carousel
function initLogoCarousel() {
    const carousel = document.getElementById('logoCarousel');
    if (!carousel) return;

    // Shuffle logos for random initial order
    const shuffledLogos = shuffleArray(logoFiles);
    
    // Create image elements
    shuffledLogos.forEach((logoFile, index) => {
        const img = document.createElement('img');
        img.src = `assets/logos/${logoFile}`;
        img.alt = 'VIBE IDE Logo';
        img.classList.add('logo-img');
        
        // First logo is visible
        if (index === 0) {
            img.classList.add('active', 'pulsing');
        }
        
        carousel.appendChild(img);
    });

    // Start rotation
    let currentIndex = 0;
    const images = carousel.querySelectorAll('img');
    
    function rotateLogo() {
        // Remove active class from current
        images[currentIndex].classList.remove('active', 'pulsing');
        
        // Pick random next logo (not the current one)
        let nextIndex;
        do {
            nextIndex = Math.floor(Math.random() * images.length);
        } while (nextIndex === currentIndex && images.length > 1);
        
        // Add active class to next
        images[nextIndex].classList.add('active', 'pulsing');
        currentIndex = nextIndex;
    }
    
    // Rotate every 2-3.5 seconds
    function scheduleNextRotation() {
        const delay = Math.random() * 1500 + 2000; // 2000-3500ms
        setTimeout(() => {
            rotateLogo();
            scheduleNextRotation();
        }, delay);
    }
    
    scheduleNextRotation();
}

// VIBE Acronyms
const vibeAcronyms = [
    'Versatile Integrated Beginner Environment',
    'Virtual Interactive Beginner Experience',
    'Visual Intelligent Beginner Environment',
    'Visionary Integrated Beginner Environment',
    'Very Intuitive Beginner Experience',
    'Versatile Innovative Beginner Ecosystem',
    'Visual Interactive Beginner Editor',
    'Virtual Intelligent Beginner Environment',
    'Visionary Innovative Beginner Environment',
    'Versatile Intuitive Beginner Experience',
    'Visual Integrated Beginner Ecosystem'
];

// Initialize acronym rotator
function initAcronymRotator() {
    const rotator = document.getElementById('acronymRotator');
    if (!rotator) return;
    
    // Create all acronym spans
    vibeAcronyms.forEach((acronym, index) => {
        const span = document.createElement('span');
        span.className = 'acronym-text';
        span.textContent = acronym;
        if (index === 0) {
            span.classList.add('active');
        }
        rotator.appendChild(span);
    });
    
    // Rotate through acronyms
    const acronyms = rotator.querySelectorAll('.acronym-text');
    let currentIndex = 0;
    
    function rotateAcronym() {
        // Fade out current
        acronyms[currentIndex].classList.remove('active');
        
        // Pick random next (not current)
        let nextIndex;
        do {
            nextIndex = Math.floor(Math.random() * acronyms.length);
        } while (nextIndex === currentIndex && acronyms.length > 1);
        
        // Wait for full fade-out (800ms transition) before fading in next
        setTimeout(() => {
            acronyms[nextIndex].classList.add('active');
            currentIndex = nextIndex;
        }, 850); // Slightly longer than the 800ms CSS transition to ensure complete fade-out
    }
    
    // Rotate every 3-5 seconds
    function scheduleNextRotation() {
        const delay = Math.random() * 2000 + 3000; // 3000-5000ms
        setTimeout(() => {
            rotateAcronym();
            scheduleNextRotation();
        }, delay);
    }
    
    scheduleNextRotation();
}

// Smooth scroll for anchor links
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
}

// Book Modal Functions
function openBookModal() {
    const modal = document.getElementById('bookModal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }
}

function closeBookModal() {
    const modal = document.getElementById('bookModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = ''; // Restore scrolling
    }
}

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeBookModal();
    }
});

// Audiobook Player
const chapters = [
    { name: 'Opening', file: 'opening.mp3' },
    { name: "Chapter 1 - 'The Pivot'", file: 'chapter1.mp3' },
    { name: "Chapter 2 - 'The Name Game'", file: 'chapter2.mp3' },
    { name: "Chapter 3 - 'The Chatbox Revolution'", file: 'chapter3.mp3' },
    { name: "Chapter 4 - 'Self Awareness & Identity'", file: 'chapter4.mp3' },
    { name: "Chapter 5 - 'Coding Day'", file: 'chapter5.mp3' },
    { name: "Chapter 6 - 'Stop Apologizing For Vibe Coding'", file: 'chapter6.mp3' },
    { name: "Chapter 7 - 'Cursy's Corner - The Placeholder'", file: 'chapter7.mp3' },
    { name: "Chapter 8 - 'Cursy's Corner - The Transformation'", file: 'chapter8.mp3' },
    { name: "Chapter 9 - 'The Speech Bubbles Saga'", file: 'chapter9.mp3' },
    { name: "Chapter 10 - 'The Math Correction'", file: 'chapter10.mp3' },
    { name: "Chapter 11 - 'The Housewarming'", file: 'chapter11.mp3' },
    { name: "Chapter 12 - 'The Community'", file: 'chapter12.mp3' },
    { name: "Chapter 13 - 'The Future'", file: 'chapter13.mp3' },
    { name: 'Conclusion', file: 'conclusion.mp3' }
];

let currentChapterIndex = 0;
let wasPlaying = false;
let isAutoAdvancing = false;

function initAudiobookPlayer() {
    const audioPlayer = document.getElementById('audio-player');
    const playPauseBtn = document.getElementById('play-pause');
    const prevBtn = document.getElementById('prev-chapter');
    const nextBtn = document.getElementById('next-chapter');
    const currentChapterSpan = document.getElementById('current-chapter');
    const progressSpan = document.getElementById('chapter-progress');
    const progressBar = document.getElementById('progress');
    const chapterItems = document.querySelectorAll('.chapter-item');

    if (!audioPlayer) return;

    function loadChapter(index, autoPlay = false) {
        if (index < 0 || index >= chapters.length) return;
        
        currentChapterIndex = index;
        const chapter = chapters[index];
        audioPlayer.src = `assets/audio/audiobook/${chapter.file}`;
        currentChapterSpan.textContent = chapter.name;
        
        // Update active chapter in list
        chapterItems.forEach((item, i) => {
            item.classList.toggle('active', i === index);
        });
        
        // Auto-play if user was playing OR if auto-advancing
        if (wasPlaying || autoPlay) {
            // Small delay to ensure audio is loaded
            setTimeout(() => {
                audioPlayer.play().catch(e => {
                    console.log('Auto-play prevented:', e);
                    // If autoplay is blocked, update button state
                    playPauseBtn.textContent = '▶ Play';
                    wasPlaying = false;
                });
            }, 100);
        }
        
        // Update progress
        updateProgress();
    }

    function updateProgress() {
        if (audioPlayer.duration) {
            const current = formatTime(audioPlayer.currentTime);
            const total = formatTime(audioPlayer.duration);
            progressSpan.textContent = `${current} / ${total}`;
            
            const percent = (audioPlayer.currentTime / audioPlayer.duration) * 100;
            progressBar.style.width = `${percent}%`;
        } else {
            progressSpan.textContent = '0:00 / 0:00';
            progressBar.style.width = '0%';
        }
    }

    function formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Play/Pause button
    playPauseBtn.addEventListener('click', () => {
        if (audioPlayer.paused) {
            audioPlayer.play();
            playPauseBtn.textContent = '⏸ Pause';
            wasPlaying = true;
        } else {
            audioPlayer.pause();
            playPauseBtn.textContent = '▶ Play';
            wasPlaying = false;
        }
    });

    // Previous chapter
    prevBtn.addEventListener('click', () => {
        if (currentChapterIndex > 0) {
            // Remember if we were playing, but don't autoplay when manually navigating
            wasPlaying = !audioPlayer.paused;
            loadChapter(currentChapterIndex - 1, false);
        }
    });

    // Next chapter
    nextBtn.addEventListener('click', () => {
        if (currentChapterIndex < chapters.length - 1) {
            // Remember if we were playing, but don't autoplay when manually navigating
            wasPlaying = !audioPlayer.paused;
            loadChapter(currentChapterIndex + 1, false);
        }
    });

    // Click chapter in list to load it
    chapterItems.forEach((item, index) => {
        item.addEventListener('click', () => {
            // Remember if we were playing, but don't autoplay when manually selecting
            wasPlaying = !audioPlayer.paused;
            loadChapter(index, false);
        });
    });

    // Auto-advance to next chapter when current ends
    audioPlayer.addEventListener('ended', () => {
        if (currentChapterIndex < chapters.length - 1) {
            // If we were playing, auto-play the next chapter
            isAutoAdvancing = wasPlaying;
            loadChapter(currentChapterIndex + 1, isAutoAdvancing);
            isAutoAdvancing = false;
        } else {
            // Last chapter ended
            playPauseBtn.textContent = '▶ Play';
            wasPlaying = false;
        }
    });

    // Update progress bar and time
    audioPlayer.addEventListener('timeupdate', updateProgress);

    // Update play/pause button when audio state changes
    audioPlayer.addEventListener('play', () => {
        playPauseBtn.textContent = '⏸ Pause';
        wasPlaying = true;
    });

    audioPlayer.addEventListener('pause', () => {
        playPauseBtn.textContent = '▶ Play';
        // Only set wasPlaying to false if we're not auto-advancing
        if (!isAutoAdvancing) {
            wasPlaying = false;
        }
    });

    // Update progress when metadata loads
    audioPlayer.addEventListener('loadedmetadata', updateProgress);

    // Initialize with first chapter
    loadChapter(0);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initLogoCarousel();
    initAcronymRotator();
    initSmoothScroll();
    initAudiobookPlayer();
});

