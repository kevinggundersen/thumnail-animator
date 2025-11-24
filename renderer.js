const selectFolderBtn = document.getElementById('select-folder-btn');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const currentPathSpan = document.getElementById('current-path');
const breadcrumbContainer = document.getElementById('breadcrumb-container');
const gridContainer = document.getElementById('grid-container');
const searchBox = document.getElementById('search-box');
const filterAllBtn = document.getElementById('filter-all');
const filterVideosBtn = document.getElementById('filter-videos');
const filterImagesBtn = document.getElementById('filter-images');
const filterAudioBtn = document.getElementById('filter-audio');
const settingsBtn = document.getElementById('settings-btn');
const settingsDropdown = document.getElementById('settings-dropdown');
const layoutModeToggle = document.getElementById('layout-mode-toggle');
const layoutModeLabel = document.getElementById('layout-mode-label');
const rememberFolderToggle = document.getElementById('remember-folder-toggle');
const rememberFolderLabel = document.getElementById('remember-folder-label');
const sortTypeSelect = document.getElementById('sort-type-select');
const sortOrderSelect = document.getElementById('sort-order-select');

// Track current folder path for navigation
let currentFolderPath = null;

// Store current items for re-sorting without re-fetching
let currentItems = [];

// Track current filter state
let currentFilter = 'all'; // 'all', 'video', 'image', 'audio'

// Track layout mode: 'masonry' (dynamic) or 'grid' (rigid row-based)
let layoutMode = 'masonry'; // Default to masonry

// Track whether to remember last folder
let rememberLastFolder = true; // Default to true

// Track sorting preferences
let sortType = 'name'; // 'name' or 'date'
let sortOrder = 'ascending'; // 'ascending' or 'descending'

// Navigation history for back/forward functionality
const navigationHistory = {
    paths: [],
    currentIndex: -1,
    
    add(path) {
        // Remove any paths after current index (when navigating forward then going back)
        this.paths = this.paths.slice(0, this.currentIndex + 1);
        // Add new path
        this.paths.push(path);
        this.currentIndex = this.paths.length - 1;
        this.updateButtons();
    },
    
    canGoBack() {
        return this.currentIndex > 0;
    },
    
    canGoForward() {
        return this.currentIndex < this.paths.length - 1;
    },
    
    goBack() {
        if (this.canGoBack()) {
            this.currentIndex--;
            return this.paths[this.currentIndex];
        }
        return null;
    },
    
    goForward() {
        if (this.canGoForward()) {
            this.currentIndex++;
            return this.paths[this.currentIndex];
        }
        return null;
    },
    
    updateButtons() {
        backBtn.disabled = !this.canGoBack();
        forwardBtn.disabled = !this.canGoForward();
    }
};

// Lightbox Elements
const lightbox = document.getElementById('lightbox');
const lightboxVideo = document.getElementById('lightbox-video');
const lightboxImage = document.getElementById('lightbox-image');
const closeLightboxBtn = document.getElementById('close-lightbox');

// Context Menu Elements
const contextMenu = document.getElementById('context-menu');
let contextMenuTargetCard = null;

// Rename Dialog Elements
const renameDialog = document.getElementById('rename-dialog');
const renameInput = document.getElementById('rename-input');
const renameCancelBtn = document.getElementById('rename-cancel-btn');
const renameConfirmBtn = document.getElementById('rename-confirm-btn');
let renamePendingFile = null;

// Tiny 1x1 WebM to flush the decoder
const BLANK_VIDEO = 'data:video/webm;base64,GkXfo0AgQoaBAUL3gQFC8oEEQvOBCEKCQAR3ZWJtQoeBAkKFgQIYU4BnQI0VSalmQCgq17FAAw9CQE2AQAZ3aGFtbXlXQUAGd2hhbW15RIlACECPQAAAAAAAFlSua0AxrkAu14EBY8WBAZyBACK1nEADdW5khkAFVl9WUDglhohAA1ZQOIOBAeWBAOGHgQfBQAAAAAAAAEe4gQKGhkACLMhkAGw=';

// --- Manual GC Helper ---
let gcTimeout;
function scheduleGC() {
    clearTimeout(gcTimeout);
    gcTimeout = setTimeout(() => {
        // console.log('Triggering Manual GC');
        window.electronAPI.triggerGC();
    }, 1000); // Wait 1s after last action to trigger GC
}

// --- Track all video cards for periodic cleanup check ---
const videoCards = new WeakSet();

// --- Periodic cleanup check to catch videos that IntersectionObserver might miss ---
let cleanupCheckInterval;
let cleanupCheckTimeout;
function performCleanupCheck() {
    // Check all media cards and clean up media that aren't intersecting
    const allCards = gridContainer.querySelectorAll('.video-card');
    let cleaned = false;
    
    // Calculate viewport bounds with a buffer zone for cleanup
    // Media outside this buffer zone will be cleaned up aggressively
    const viewportTop = -100; // 100px buffer above viewport
    const viewportBottom = window.innerHeight + 100; // 100px buffer below viewport
    const viewportLeft = -100; // 100px buffer left of viewport
    const viewportRight = window.innerWidth + 100; // 100px buffer right of viewport
    
    // First pass: Remove media from cards outside the buffer zone
    allCards.forEach(card => {
        const videos = card.querySelectorAll('video');
        const images = card.querySelectorAll('img.media-thumbnail');
        
        if (videos.length === 0 && images.length === 0) return;
        
        const rect = card.getBoundingClientRect();
        // Check if card is within buffer zone
        const isInBufferZone = (
            rect.top < viewportBottom &&
            rect.bottom > viewportTop &&
            rect.left < viewportRight &&
            rect.right > viewportLeft
        );
        
        if (!isInBufferZone) {
            // Remove ALL media from this card (outside buffer zone)
            videos.forEach(video => {
                destroyVideoElement(video);
                activeVideoCount = Math.max(0, activeVideoCount - 1);
                cleaned = true;
            });
            images.forEach(img => {
                destroyImageElement(img);
                activeImageCount = Math.max(0, activeImageCount - 1);
                cleaned = true;
            });
        } else {
            // If visible but has multiple videos, keep only the first one
            if (videos.length > 1) {
                for (let i = 1; i < videos.length; i++) {
                    destroyVideoElement(videos[i]);
                    activeVideoCount = Math.max(0, activeVideoCount - 1);
                    cleaned = true;
                }
            }
            // If visible but has multiple images, keep only the first one
            if (images.length > 1) {
                for (let i = 1; i < images.length; i++) {
                    destroyImageElement(images[i]);
                    activeImageCount = Math.max(0, activeImageCount - 1);
                    cleaned = true;
                }
            }
        }
    });
    
    // Update counts
    activeVideoCount = gridContainer.querySelectorAll('video').length;
    activeImageCount = gridContainer.querySelectorAll('img.media-thumbnail').length;
    
    // Second pass: If we still have too many videos, aggressively remove furthest ones
    const remainingVideos = Array.from(gridContainer.querySelectorAll('video'));
    if (remainingVideos.length > MAX_VIDEOS) {
        // Calculate distance from viewport center for each video
        const videoDistances = remainingVideos.map(video => {
            const card = video.closest('.video-card');
            if (!card) return { video, distance: Infinity };
            const rect = card.getBoundingClientRect();
            const viewportCenterY = window.innerHeight / 2;
            const viewportCenterX = window.innerWidth / 2;
            const cardCenterY = rect.top + rect.height / 2;
            const cardCenterX = rect.left + rect.width / 2;
            
            // Calculate distance, but prioritize vertical distance (scrolling direction)
            const verticalDistance = Math.abs(cardCenterY - viewportCenterY);
            const horizontalDistance = Math.abs(cardCenterX - viewportCenterX);
            // Weight vertical distance more heavily since we scroll vertically
            const distance = verticalDistance * 2 + horizontalDistance;
            
            return { video, distance, cardCenterY };
        });
        
        // Sort by distance and remove the furthest ones
        videoDistances.sort((a, b) => b.distance - a.distance);
        const toRemove = videoDistances.slice(MAX_VIDEOS);
        toRemove.forEach(({ video }) => {
            destroyVideoElement(video);
            activeVideoCount = Math.max(0, activeVideoCount - 1);
            cleaned = true;
        });
    }
    
    // Third pass: If we're still over a safety threshold (90% of max), be even more aggressive
    const currentVideoCount = gridContainer.querySelectorAll('video').length;
    const currentImageCount = gridContainer.querySelectorAll('img.media-thumbnail').length;
    const totalMediaCount = currentVideoCount + currentImageCount;
    const safetyThreshold = Math.floor(MAX_TOTAL_MEDIA * 0.9); // 90% of max total media
    if (totalMediaCount > safetyThreshold) {
        // Combine all media and sort by distance
        const allMedia = [
            ...Array.from(gridContainer.querySelectorAll('video')).map(v => ({ element: v, type: 'video' })),
            ...Array.from(gridContainer.querySelectorAll('img.media-thumbnail')).map(i => ({ element: i, type: 'image' }))
        ];
        
        const mediaDistances = allMedia.map(({ element, type }) => {
            const card = element.closest('.video-card');
            if (!card) return { element, distance: Infinity, type };
            const rect = card.getBoundingClientRect();
            const viewportCenterY = window.innerHeight / 2;
            const cardCenterY = rect.top + rect.height / 2;
            // Only consider vertical distance for safety cleanup
            const distance = Math.abs(cardCenterY - viewportCenterY);
            return { element, distance, type };
        });
        
        mediaDistances.sort((a, b) => b.distance - a.distance);
        const toRemove = mediaDistances.slice(safetyThreshold);
        toRemove.forEach(({ element, type }) => {
            if (type === 'video') {
                destroyVideoElement(element);
                activeVideoCount = Math.max(0, activeVideoCount - 1);
            } else {
                destroyImageElement(element);
                activeImageCount = Math.max(0, activeImageCount - 1);
            }
            cleaned = true;
        });
    }
    
    // Update counts again
    activeVideoCount = gridContainer.querySelectorAll('video').length;
    activeImageCount = gridContainer.querySelectorAll('img.media-thumbnail').length;
    
    if (cleaned) {
        scheduleGC();
    }
}

function startPeriodicCleanup() {
    if (cleanupCheckInterval) return;
    
    // Very frequent periodic check - every 16ms (~60fps) to catch leaks immediately
    cleanupCheckInterval = setInterval(() => {
        performCleanupCheck();
        retryPendingVideos(); // Also retry pending videos
    }, 16);
    
    // Also trigger cleanup immediately on scroll start and after scroll stops
    let scrollTimeout;
    let lastScrollTime = 0;
    gridContainer.addEventListener('scroll', () => {
        const now = Date.now();
        // Throttle scroll cleanup to max once per 16ms
        if (now - lastScrollTime >= 16) {
            performCleanupCheck();
            retryPendingVideos();
            lastScrollTime = now;
        }
        
        // Also cleanup after scroll stops
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            performCleanupCheck();
            retryPendingVideos();
        }, 50);
    }, { passive: true });
}

function stopPeriodicCleanup() {
    if (cleanupCheckInterval) {
        clearInterval(cleanupCheckInterval);
        cleanupCheckInterval = null;
    }
    if (cleanupCheckTimeout) {
        clearTimeout(cleanupCheckTimeout);
        cleanupCheckTimeout = null;
    }
}

// Track window minimized state
let isWindowMinimized = false;

// Pause all resource-intensive operations when window is minimized
function pauseWhenMinimized() {
    if (isWindowMinimized) return; // Already paused
    isWindowMinimized = true;
    
    // Pause all videos in the grid
    const allVideos = gridContainer.querySelectorAll('video');
    allVideos.forEach(video => {
        if (!video.paused) {
            video.pause();
        }
    });
    
    // Pause lightbox video if it's open
    if (lightboxVideo && !lightboxVideo.paused) {
        lightboxVideo.pause();
    }
    
    // Stop periodic cleanup interval (runs every 16ms)
    stopPeriodicCleanup();
    
    // Disconnect IntersectionObserver to stop watching for visibility changes
    const allCards = gridContainer.querySelectorAll('.video-card, .folder-card');
    allCards.forEach(card => {
        observer.unobserve(card);
    });
    
    // Trigger GC to free up memory
    scheduleGC();
}

// Resume all operations when window is restored
function resumeWhenRestored() {
    if (!isWindowMinimized) return; // Already resumed
    isWindowMinimized = false;
    
    // Reconnect IntersectionObserver for all cards
    const allCards = gridContainer.querySelectorAll('.video-card, .folder-card');
    allCards.forEach(card => {
        observer.observe(card);
    });
    
    // Resume videos that are in viewport
    const allVideos = gridContainer.querySelectorAll('video');
    allVideos.forEach(video => {
        const card = video.closest('.video-card');
        if (card) {
            const rect = card.getBoundingClientRect();
            const isInViewport = (
                rect.top < window.innerHeight &&
                rect.bottom > 0 &&
                rect.left < window.innerWidth &&
                rect.right > 0
            );
            if (isInViewport) {
                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.catch(() => {
                        // Ignore play errors
                    });
                }
            }
        }
    });
    
    // Resume lightbox video if lightbox is open
    if (!lightbox.classList.contains('hidden') && lightboxVideo && lightboxVideo.paused) {
        const playPromise = lightboxVideo.play();
        if (playPromise !== undefined) {
            playPromise.catch(() => {
                // Ignore play errors
            });
        }
    }
    
    // Restart periodic cleanup
    startPeriodicCleanup();
    
    // Trigger immediate cleanup check
    performCleanupCheck();
    retryPendingVideos();
}

// Track active media elements and pending creations
let activeVideoCount = 0;
let activeImageCount = 0;
let pendingMediaCreations = new Set();
let mediaToRetry = new Map(); // Track cards that need media retry
let lastCleanupTime = 0;
const MAX_VIDEOS = 120; // Max concurrent videos (increased for faster loading)
const MAX_IMAGES = 250; // Max concurrent images (increased - images are lighter)
const MAX_TOTAL_MEDIA = MAX_VIDEOS + MAX_IMAGES; // Total media limit
const CLEANUP_COOLDOWN_MS = 5; // Reduced cooldown to 5ms for faster loading
const PRELOAD_BUFFER_PX = 500; // Preload content 300px before it enters viewport
const PARALLEL_LOAD_LIMIT = 10; // Load up to 3 items in parallel for faster initial load

// Helper function to detect file type from URL
function getFileType(url) {
    const urlLower = url.toLowerCase();
    // Image formats
    if (urlLower.endsWith('.gif') || urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg') ||
        urlLower.endsWith('.png') || urlLower.endsWith('.webp') || urlLower.endsWith('.bmp') ||
        urlLower.endsWith('.svg')) return 'image';
    // Video formats
    if (urlLower.endsWith('.mp4') || urlLower.endsWith('.webm') || 
        urlLower.endsWith('.ogg') || urlLower.endsWith('.mov')) return 'video';
    return 'video'; // Default to video for unknown types
}

// Color mapping for file extensions
const EXTENSION_COLORS = {
    // Video formats
    'MP4': '#ff6b6b',   // Red
    'WEBM': '#4ecdc4',  // Teal
    'OGG': '#95e1d3',   // Light teal
    'MOV': '#f38181',   // Light red
    
    // Image formats
    'GIF': '#a8e6cf',   // Light green
    'JPG': '#ffd93d',   // Yellow
    'JPEG': '#ffd93d',  // Yellow
    'PNG': '#6bcf7f',   // Green
    'WEBP': '#4d96ff',  // Blue
    'BMP': '#9b59b6',   // Purple
    'SVG': '#ff9ff3',   // Pink
};

// Helper function to get color for extension
function getExtensionColor(extension) {
    return EXTENSION_COLORS[extension] || '#888888'; // Default gray for unknown extensions
}

// Helper function to convert hex to rgba with opacity
function hexToRgba(hex, opacity = 0.87) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// Predefined aspect ratios (width:height)
const ASPECT_RATIOS = [
    { name: '1:2', ratio: 0.5 },      // Portrait (vertical)
    { name: '9:16', ratio: 9/16 },    // Vertical video (common)
    { name: '1:1', ratio: 1.0 },      // Square
    { name: '4:3', ratio: 4/3 },      // Classic
    { name: '3:2', ratio: 3/2 },      // Photo
    { name: '16:9', ratio: 16/9 },    // Widescreen (common)
    { name: '21:9', ratio: 21/9 },    // Ultrawide
    { name: '2:1', ratio: 2.0 },      // Panoramic
];

// Map video aspect ratio to closest predefined ratio
function getClosestAspectRatio(videoWidth, videoHeight) {
    if (!videoWidth || !videoHeight) return '16:9'; // Default fallback
    
    const videoRatio = videoWidth / videoHeight;
    
    // Find the closest predefined ratio
    let closest = ASPECT_RATIOS[0];
    let minDifference = Math.abs(videoRatio - closest.ratio);
    
    for (const aspectRatio of ASPECT_RATIOS) {
        const difference = Math.abs(videoRatio - aspectRatio.ratio);
        if (difference < minDifference) {
            minDifference = difference;
            closest = aspectRatio;
        }
    }
    
    return closest.name;
}

// Apply aspect ratio to card
function applyAspectRatioToCard(card, aspectRatioName) {
    // Remove any existing aspect ratio classes
    card.classList.remove(...ASPECT_RATIOS.map(ar => `aspect-${ar.name.replace(':', '-')}`));
    
    // Add the new aspect ratio class
    const className = `aspect-${aspectRatioName.replace(':', '-')}`;
    card.classList.add(className);
    
    // Store the aspect ratio on the card for persistence
    card.dataset.aspectRatio = aspectRatioName;
    
    // Recalculate masonry layout when aspect ratio changes
    if (gridContainer.classList.contains('masonry')) {
        requestAnimationFrame(() => {
            layoutMasonry();
        });
    }
}

// --- Masonry Layout System ---
let masonryColumns = 0;
let columnHeights = [];
let resizeTimeout;
let masonryResizeObserver = null;
let masonryMutationObserver = null;
let masonryResizeHandler = null;

function calculateMasonryColumns() {
    const containerWidth = gridContainer.clientWidth - (parseInt(getComputedStyle(gridContainer).paddingLeft) * 2);
    const gap = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--gap')) || 16;
    const minColumnWidth = 250; // Minimum card width
    const columns = Math.max(1, Math.floor((containerWidth + gap) / (minColumnWidth + gap)));
    return columns;
}

function layoutMasonry() {
    if (!gridContainer.classList.contains('masonry') || layoutMode !== 'masonry') return;
    
    const cards = Array.from(gridContainer.querySelectorAll('.video-card, .folder-card'));
    
    // Remove any existing spacer
    const existingSpacer = gridContainer.querySelector('.masonry-spacer');
    if (existingSpacer) {
        existingSpacer.remove();
    }
    
    if (cards.length === 0) {
        gridContainer.style.height = 'auto';
        gridContainer.style.minHeight = '0px';
        return;
    }
    
    const gap = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--gap')) || 16;
    const containerWidth = gridContainer.clientWidth - (parseInt(getComputedStyle(gridContainer).paddingLeft) * 2);
    const columns = calculateMasonryColumns();
    
    if (columns === 0) return;
    
    // Update CSS variable for column count
    gridContainer.style.setProperty('--columns', columns);
    
    // Reset column heights
    columnHeights = new Array(columns).fill(0);
    
    // Calculate column width
    const columnWidth = (containerWidth - gap * (columns - 1)) / columns;
    
    // Layout cards in masonry pattern
    cards.forEach((card) => {
        // Skip hidden cards (filtered by search)
        if (card.style.display === 'none') {
            return;
        }
        
        // Ensure card is absolutely positioned for masonry
        card.style.position = 'absolute';
        
        // Set width first - this determines the card's width
        card.style.width = `${columnWidth}px`;
        
        // Handle folder cards differently (square aspect ratio)
        let cardHeight;
        if (card.classList.contains('folder-card')) {
            // Folder cards are square
            cardHeight = columnWidth;
        } else {
            // Calculate height based on aspect ratio for media cards
            // First try to get aspect ratio from dataset (set when video metadata loads)
            let aspectRatioName = card.dataset.aspectRatio;
            
            // If not in dataset, try to determine from CSS class
            if (!aspectRatioName) {
                for (const ar of ASPECT_RATIOS) {
                    if (card.classList.contains(`aspect-${ar.name.replace(':', '-')}`)) {
                        aspectRatioName = ar.name;
                        break;
                    }
                }
            }
            
            // Default to 16:9 if no aspect ratio found
            if (!aspectRatioName) {
                aspectRatioName = '16:9';
            }
            
            // Get the aspect ratio object
            const aspectRatio = ASPECT_RATIOS.find(ar => ar.name === aspectRatioName);
            if (!aspectRatio) {
                console.warn('Aspect ratio not found for:', aspectRatioName, 'defaulting to 16:9');
                aspectRatioName = '16:9';
            }
            const aspectRatioValue = aspectRatio ? aspectRatio.ratio : (16/9);
            
            // Calculate height: height = width / aspectRatio
            // aspectRatio is width/height, so height = width / aspectRatio
            cardHeight = columnWidth / aspectRatioValue;
            
            // Ensure height is valid
            if (!cardHeight || cardHeight <= 0 || !isFinite(cardHeight)) {
                console.warn('Invalid card height calculated:', cardHeight, 'for aspect ratio:', aspectRatioName, 'using default');
                cardHeight = columnWidth / (16/9);
            }
        }
        
        // Ensure minimum height for visibility
        if (cardHeight < 50) {
            cardHeight = 50; // Minimum height to ensure cards are visible
        }
        
        // Set explicit height and remove padding-bottom to avoid conflicts
        card.style.height = `${cardHeight}px`;
        card.style.paddingBottom = '0';
        
        // Ensure card is visible (opacity and display)
        card.style.opacity = '1';
        card.style.visibility = 'visible';
        
        // Ensure card maintains position: relative for internal content (video, info)
        // Even though it's absolutely positioned for masonry, internal absolute elements
        // will still position relative to this card
        // Actually, we need position: absolute for masonry, but internal content should still work
        
        // Find the shortest column
        const shortestColumnIndex = columnHeights.indexOf(Math.min(...columnHeights));
        
        // Calculate position
        const left = shortestColumnIndex * (columnWidth + gap);
        const top = columnHeights[shortestColumnIndex];
        
        // Set position
        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
        
        // Ensure card has proper positioning context for internal absolute elements
        // Internal elements (video, info) use position: absolute and need the card
        // to establish a positioning context - even though card is absolutely positioned,
        // its children will still position relative to it
        // But to be safe, let's ensure the card maintains relative positioning for children
        // Actually, we can't do both - card needs to be absolute for masonry
        
        // Force a reflow to ensure dimensions are applied
        void card.offsetHeight;
        
        // Update column height (card height + gap)
        columnHeights[shortestColumnIndex] += cardHeight + gap;
    });
    
    // Set container height to accommodate all cards
    // For absolutely positioned children, we need to ensure the container's
    // scrollHeight is greater than clientHeight to enable scrolling.
    const maxHeight = Math.max(...columnHeights, 0);
    if (maxHeight > 0) {
        // The maxHeight already includes gaps between cards
        // Add container padding to get total content height
        const containerPaddingTop = parseInt(getComputedStyle(gridContainer).paddingTop) || 0;
        const containerPaddingBottom = parseInt(getComputedStyle(gridContainer).paddingBottom) || 0;
        const contentHeight = maxHeight + containerPaddingTop + containerPaddingBottom;
        
        // Get the viewport height available to the container
        const header = document.querySelector('header');
        const headerHeight = header ? header.offsetHeight : 0;
        const viewportHeight = window.innerHeight;
        const availableHeight = viewportHeight - headerHeight;
        
        // Create a spacer element to ensure scrollHeight is calculated correctly
        // Absolutely positioned children don't contribute to scrollHeight, so we need
        // a non-positioned element that establishes the scrollable area
        const spacer = document.createElement('div');
        spacer.className = 'masonry-spacer';
        spacer.style.width = '1px';
        spacer.style.height = `${contentHeight}px`;
        spacer.style.position = 'static'; // Not absolutely positioned!
        spacer.style.pointerEvents = 'none';
        spacer.style.visibility = 'hidden';
        spacer.style.margin = '0';
        spacer.style.padding = '0';
        gridContainer.appendChild(spacer);
        
        // The spacer (non-positioned) ensures the container's scrollHeight equals contentHeight
        // The container with flex: 1 will have clientHeight = availableHeight
        // So scrolling works when contentHeight > availableHeight
        
        // Force a reflow to ensure scrollHeight is calculated
        void gridContainer.offsetHeight;
    } else {
        gridContainer.style.minHeight = '0px';
    }
}

function cleanupMasonry() {
    // Clean up resize observer
    if (masonryResizeObserver) {
        masonryResizeObserver.disconnect();
        masonryResizeObserver = null;
    }
    
    // Clean up mutation observer
    if (masonryMutationObserver) {
        masonryMutationObserver.disconnect();
        masonryMutationObserver = null;
    }
    
    // Clean up resize event listener
    if (masonryResizeHandler) {
        window.removeEventListener('resize', masonryResizeHandler);
        masonryResizeHandler = null;
    }
}

function initMasonry() {
    if (layoutMode !== 'masonry') return; // Don't initialize if not in masonry mode
    
    if (gridContainer.classList.contains('masonry')) return; // Already initialized
    
    // Clean up any existing observers first
    cleanupMasonry();
    
    gridContainer.classList.add('masonry');
    gridContainer.classList.remove('grid');
    
    // Reset card positioning styles
    const cards = gridContainer.querySelectorAll('.video-card, .folder-card');
    cards.forEach(card => {
        card.style.position = '';
        card.style.left = '';
        card.style.top = '';
        card.style.width = '';
        card.style.height = '';
        card.style.opacity = '';
        card.style.visibility = '';
    });
    
    // Initial layout after a short delay to ensure cards are rendered
    setTimeout(() => {
        layoutMasonry();
    }, 100);
    
    // Recalculate on window resize (debounced)
    masonryResizeHandler = () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (layoutMode === 'masonry') {
                layoutMasonry();
            }
        }, 150);
    };
    
    window.addEventListener('resize', masonryResizeHandler);
    
    // Use ResizeObserver to detect when card sizes change (e.g., aspect ratio updates)
    masonryResizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => {
            if (layoutMode === 'masonry') {
                layoutMasonry();
            }
        });
    });
    
    // Observe container for size changes
    masonryResizeObserver.observe(gridContainer);
    
    // Observe all cards for size changes
    const observeCards = () => {
        const cards = gridContainer.querySelectorAll('.video-card, .folder-card');
        cards.forEach(card => {
            masonryResizeObserver.observe(card);
        });
    };
    
    // Recalculate when cards are added
    masonryMutationObserver = new MutationObserver((mutations) => {
        let shouldRelayout = false;
        mutations.forEach(mutation => {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1 && (node.classList.contains('video-card') || node.classList.contains('folder-card'))) {
                        if (masonryResizeObserver) {
                            masonryResizeObserver.observe(node);
                        }
                        shouldRelayout = true;
                    }
                });
            } else if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                // Aspect ratio class changed
                shouldRelayout = true;
            }
        });
        
        if (shouldRelayout && layoutMode === 'masonry') {
            requestAnimationFrame(() => {
                layoutMasonry();
            });
        }
    });
    
    masonryMutationObserver.observe(gridContainer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });
    
    // Initial card observation
    observeCards();
}

function initGrid() {
    if (layoutMode !== 'grid') return; // Don't initialize if not in grid mode
    
    // Clean up masonry observers
    cleanupMasonry();
    
    gridContainer.classList.add('grid');
    gridContainer.classList.remove('masonry');
    
    // Reset container height/style
    gridContainer.style.height = '';
    gridContainer.style.minHeight = '';
    
    // Remove masonry spacer if it exists
    const spacer = gridContainer.querySelector('.masonry-spacer');
    if (spacer) {
        spacer.remove();
    }
    
    // Reset card positioning styles for grid layout
    const cards = gridContainer.querySelectorAll('.video-card, .folder-card');
    cards.forEach(card => {
        card.style.position = '';
        card.style.left = '';
        card.style.top = '';
        card.style.width = '';
        card.style.height = '';
        card.style.paddingBottom = ''; // Reset padding-bottom to use CSS aspect ratio classes
        card.style.opacity = '';
        card.style.visibility = '';
        // Ensure card is visible (display is controlled by filters)
        if (card.style.display !== 'none') {
            card.style.display = '';
        }
    });
}

function switchLayoutMode() {
    // Toggle layout mode based on checkbox state
    layoutMode = layoutModeToggle.checked ? 'grid' : 'masonry';
    
    // Update label text
    layoutModeLabel.textContent = layoutMode === 'grid' ? 'Rigid' : 'Dynamic';
    
    // Save preference to localStorage
    localStorage.setItem('layoutMode', layoutMode);
    
    // Apply the new layout
    if (layoutMode === 'masonry') {
        initMasonry();
    } else {
        initGrid();
    }
    
    // Force a reflow to ensure layout is applied
    void gridContainer.offsetHeight;
    
    // Re-apply filters to trigger layout update and ensure cards are visible
    requestAnimationFrame(() => {
        applyFilters();
        // Force another reflow after filters
        void gridContainer.offsetHeight;
    });
}

function toggleRememberFolder() {
    rememberLastFolder = rememberFolderToggle.checked;
    
    // Update label
    rememberFolderLabel.textContent = rememberLastFolder ? 'On' : 'Off';
    
    // Save preference to localStorage
    localStorage.setItem('rememberLastFolder', rememberLastFolder.toString());
    
    // If disabling, clear the stored folder path
    if (!rememberLastFolder) {
        localStorage.removeItem('lastFolderPath');
    }
}

// Function to sort items based on current sorting preferences
function sortItems(items) {
    // Separate folders and files
    const folders = items.filter(item => item.type === 'folder');
    const files = items.filter(item => item.type !== 'folder');
    
    // Sort folders
    folders.sort((a, b) => {
        let comparison = 0;
        if (sortType === 'name') {
            comparison = a.name.localeCompare(b.name);
        } else if (sortType === 'date') {
            // Use mtime if available, otherwise fall back to name
            const aTime = a.mtime || 0;
            const bTime = b.mtime || 0;
            comparison = aTime - bTime;
            // If times are equal or missing, fall back to name
            if (comparison === 0) {
                comparison = a.name.localeCompare(b.name);
            }
        }
        return sortOrder === 'ascending' ? comparison : -comparison;
    });
    
    // Sort files
    files.sort((a, b) => {
        let comparison = 0;
        if (sortType === 'name') {
            comparison = a.name.localeCompare(b.name);
        } else if (sortType === 'date') {
            // Use mtime if available, otherwise fall back to name
            const aTime = a.mtime || 0;
            const bTime = b.mtime || 0;
            comparison = aTime - bTime;
            // If times are equal or missing, fall back to name
            if (comparison === 0) {
                comparison = a.name.localeCompare(b.name);
            }
        }
        return sortOrder === 'ascending' ? comparison : -comparison;
    });
    
    // Return folders first, then files
    return [...folders, ...files];
}

// Function to apply sorting and reload current folder
function applySorting() {
    if (currentFolderPath && currentItems.length > 0) {
        // Re-sort and re-render without re-fetching
        const sortedItems = sortItems(currentItems);
        renderItems(sortedItems);
    } else if (currentFolderPath) {
        // If no items cached, reload from backend
        loadVideos(currentFolderPath);
    }
}

// Function to render items (extracted from loadVideos for re-use)
function renderItems(items) {
    // Clean up all existing media before rendering
    const existingCards = gridContainer.querySelectorAll('.video-card, .folder-card');
    existingCards.forEach(card => {
        observer.unobserve(card);
        const videos = card.querySelectorAll('video');
        const images = card.querySelectorAll('img.media-thumbnail');
        videos.forEach(video => destroyVideoElement(video));
        images.forEach(img => destroyImageElement(img));
    });
    
    // Reset counters
    activeVideoCount = 0;
    activeImageCount = 0;
    pendingMediaCreations.clear();
    mediaToRetry.clear();
    lastCleanupTime = 0;
    
    // Clean up masonry spacer if it exists
    const spacer = gridContainer.querySelector('.masonry-spacer');
    if (spacer) {
        spacer.remove();
    }
    
    gridContainer.innerHTML = '';
    gridContainer.classList.remove('masonry'); // Reset masonry state
    gridContainer.classList.remove('grid'); // Reset grid state

    if (items.length === 0) {
        gridContainer.innerHTML = '<p style="grid-column: 1/-1; text-align: center;">No folders or supported media found.</p>';
        return;
    }

    const fragment = document.createDocumentFragment();
    const cardsToObserve = []; // Batch observer registration

    items.forEach(item => {
        if (item.type === 'folder') {
            // Create folder card
            const card = document.createElement('div');
            card.className = 'folder-card';
            card.dataset.folderPath = item.path;
            
            // Create folder icon (use textContent instead of innerHTML for better performance)
            const folderIcon = document.createElement('div');
            folderIcon.className = 'folder-icon';
            folderIcon.textContent = '📁';
            
            const info = document.createElement('div');
            info.className = 'folder-info';
            info.textContent = item.name;

            card.appendChild(folderIcon);
            card.appendChild(info);

            card.addEventListener('click', () => {
                navigateToFolder(item.path);
            });

            fragment.appendChild(card);
        } else {
            // Create media card (existing code)
            const card = document.createElement('div');
            card.className = 'video-card';
            card.dataset.src = item.url;
            card.dataset.filePath = item.path; // Store file path for context menu actions
            // Use item.type directly - already provided by backend, no need to call getFileType
            card.dataset.mediaType = item.type;
            
            // Extract file extension for label (optimized - use lastIndexOf instead of split)
            const lastDot = item.name.lastIndexOf('.');
            const fileExtension = lastDot !== -1 ? item.name.substring(lastDot + 1).toUpperCase() : '';
            
            // Create extension label with color
            const extensionLabel = document.createElement('div');
            extensionLabel.className = 'extension-label';
            extensionLabel.textContent = fileExtension;
            const extensionColor = getExtensionColor(fileExtension);
            // Add opacity to the background color for better readability
            extensionLabel.style.backgroundColor = hexToRgba(extensionColor, 0.87);
            
            // Apply stored aspect ratio if available (from previous load)
            // Otherwise, default will be applied via CSS

            const info = document.createElement('div');
            info.className = 'video-info';
            info.textContent = item.name;

            card.appendChild(extensionLabel);
            card.appendChild(info);

            card.addEventListener('click', () => {
                openLightbox(item.url, item.path, item.name);
            });

            fragment.appendChild(card);
            cardsToObserve.push(card);
            videoCards.add(card);
        }
    });

    gridContainer.appendChild(fragment);
    
    // Batch observer registration for better performance
    cardsToObserve.forEach(card => {
        observer.observe(card);
    });
    
    // Defer layout initialization to allow DOM to render first
    // This improves perceived performance
    requestAnimationFrame(() => {
        if (layoutMode === 'masonry') {
            initMasonry();
        } else {
            initGrid();
        }
    });
    
        // Proactively load cards that are in the preload zone immediately
        // This ensures preloading works even if IntersectionObserver hasn't fired yet
        requestAnimationFrame(() => {
            const allCards = gridContainer.querySelectorAll('.video-card');
            const cardsToLoadNow = [];
            
            allCards.forEach(card => {
                // Skip folder cards - they don't need media loading
                if (card.classList.contains('folder-card')) return;
                
                const videos = card.querySelectorAll('video');
                const images = card.querySelectorAll('img.media-thumbnail');
                
                if (videos.length === 0 && images.length === 0 && !pendingMediaCreations.has(card)) {
                    const rect = card.getBoundingClientRect();
                    const viewportTop = -PRELOAD_BUFFER_PX;
                    const viewportBottom = window.innerHeight + PRELOAD_BUFFER_PX;
                    const viewportLeft = -PRELOAD_BUFFER_PX;
                    const viewportRight = window.innerWidth + PRELOAD_BUFFER_PX;
                    
                    const isInPreloadZone = (
                        rect.top < viewportBottom &&
                        rect.bottom > viewportTop &&
                        rect.left < viewportRight &&
                        rect.right > viewportLeft
                    );
                    
                    if (isInPreloadZone) {
                        const viewportCenterY = window.innerHeight / 2;
                        const cardCenterY = rect.top + rect.height / 2;
                        const distance = Math.abs(cardCenterY - viewportCenterY);
                        cardsToLoadNow.push({ card, mediaUrl: card.dataset.src, distance });
                    }
                }
            });
            
            // Sort by distance and load up to PARALLEL_LOAD_LIMIT items immediately
            cardsToLoadNow.sort((a, b) => a.distance - b.distance);
            cardsToLoadNow.slice(0, PARALLEL_LOAD_LIMIT * 2).forEach(({ card, mediaUrl }) => {
                createMediaForCard(card, mediaUrl);
            });
        });
    
    // Apply filters after loading (in case a filter is active)
    requestAnimationFrame(() => {
        applyFilters();
    });
    
    // Start periodic cleanup check
    startPeriodicCleanup();
}

// Function to update sorting preferences
function updateSorting() {
    sortType = sortTypeSelect.value;
    sortOrder = sortOrderSelect.value;
    
    // Save preferences to localStorage
    localStorage.setItem('sortType', sortType);
    localStorage.setItem('sortOrder', sortOrder);
    
    // Apply sorting to current folder
    applySorting();
}

function toggleSettingsDropdown() {
    settingsDropdown.classList.toggle('hidden');
}

function closeSettingsDropdown() {
    settingsDropdown.classList.add('hidden');
}

function createMediaForCard(card, mediaUrl) {
    if (pendingMediaCreations.has(card)) return false;
    
    const fileType = card.dataset.mediaType || getFileType(mediaUrl);
    const currentVideoCount = gridContainer.querySelectorAll('video').length;
    const currentImageCount = gridContainer.querySelectorAll('img.media-thumbnail').length;
    const totalMediaCount = currentVideoCount + currentImageCount;
    
    // Check limits based on file type
    if (fileType === 'video' && currentVideoCount >= MAX_VIDEOS) {
        mediaToRetry.set(card, mediaUrl);
        return false;
    }
    if (fileType === 'image' && currentImageCount >= MAX_IMAGES) {
        mediaToRetry.set(card, mediaUrl);
        return false;
    }
    if (totalMediaCount >= MAX_TOTAL_MEDIA) {
        mediaToRetry.set(card, mediaUrl);
        return false;
    }
    
    pendingMediaCreations.add(card);
    
    if (fileType === 'image') {
        return createImageForCard(card, mediaUrl);
    } else {
        return createVideoForCard(card, mediaUrl);
    }
}

function createImageForCard(card, imageUrl) {
    activeImageCount++;
    
    // Calculate card size to limit image resolution
    const rect = card.getBoundingClientRect();
    const decodeWidth = Math.max(1, Math.floor(rect.width * 0.3));
    const decodeHeight = Math.max(1, Math.floor(rect.height * 0.3));
    
    const img = document.createElement('img');
    img.src = imageUrl;
    img.className = 'media-thumbnail';
    // Use 'eager' for images in viewport/preload zone for faster loading
    // The IntersectionObserver rootMargin handles preloading, so we can be eager here
    img.loading = 'eager';
    img.decoding = 'async'; // Decode asynchronously for better performance
    
    // Limit image decode resolution
    img.width = decodeWidth;
    img.height = decodeHeight;
    
    // Optimize rendering
    img.style.imageRendering = 'auto';
    img.style.willChange = 'contents';
    
    // Track loading state
    img.addEventListener('load', () => {
        // Detect and apply aspect ratio to card
        if (img.naturalWidth && img.naturalHeight) {
            const aspectRatioName = getClosestAspectRatio(img.naturalWidth, img.naturalHeight);
            applyAspectRatioToCard(card, aspectRatioName);
        }
    });
    
    // Add error handler - retry on error
    img.addEventListener('error', () => {
        destroyImageElement(img);
        activeImageCount = Math.max(0, activeImageCount - 1);
        pendingMediaCreations.delete(card);
        
        // Retry after a short delay if card is still in preload zone
        setTimeout(() => {
            const rect = card.getBoundingClientRect();
            // Check if in preload zone (accounting for rootMargin)
            const viewportTop = -PRELOAD_BUFFER_PX;
            const viewportBottom = window.innerHeight + PRELOAD_BUFFER_PX;
            const viewportLeft = -PRELOAD_BUFFER_PX;
            const viewportRight = window.innerWidth + PRELOAD_BUFFER_PX;
            const isInPreloadZone = (
                rect.top < viewportBottom &&
                rect.bottom > viewportTop &&
                rect.left < viewportRight &&
                rect.right > viewportLeft
            );
            if (isInPreloadZone && !card.querySelector('img.media-thumbnail')) {
                mediaToRetry.set(card, imageUrl);
            }
        }, 500);
    });
    
    const info = card.querySelector('.video-info');
    card.insertBefore(img, info);
    
    pendingMediaCreations.delete(card);
    return true;
}

// Helper function to create sound label for videos with audio
function createSoundLabel(card) {
    // Check if sound label already exists
    if (card.querySelector('.sound-label')) {
        return;
    }
    
    // Mark card as having audio in dataset (for instant filtering)
    card.dataset.hasAudio = 'true';
    
    // Create sound label
    const soundLabel = document.createElement('div');
    soundLabel.className = 'sound-label';
    soundLabel.textContent = 'AUDIO';
    soundLabel.style.backgroundColor = hexToRgba('#4ecdc4', 0.87); // Teal color similar to extension labels
    
    // Insert before the video-info element
    const info = card.querySelector('.video-info');
    if (info) {
        card.insertBefore(soundLabel, info);
    } else {
        card.appendChild(soundLabel);
    }
    
    // If audio filter is active, re-apply filters to show this video immediately
    if (currentFilter === 'audio') {
        // Re-apply filters synchronously since we're checking dataset attribute, not DOM element
        applyFilters();
    }
}

function createVideoForCard(card, videoUrl) {
    activeVideoCount++;
    
    // Calculate card size to limit video resolution
    const rect = card.getBoundingClientRect();
    // Limit decode resolution to reduce VRAM - decode at 60% of card size (reduces VRAM by ~64%)
    // This is a good balance between quality and VRAM usage
    const decodeWidth = Math.max(1, Math.floor(rect.width * 0.3));
    const decodeHeight = Math.max(1, Math.floor(rect.height * 0.3));
    
    const video = document.createElement('video');
    video.src = videoUrl;
    video.muted = true;
    video.loop = true;
    // Use 'metadata' for balance - loads quickly without downloading entire video
    // Combined with rootMargin preloading, this provides fast loading
    video.preload = 'metadata';
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    // Make video draggable like images
    video.draggable = true;
    
    // Add dragstart handler to enable dragging videos
    video.addEventListener('dragstart', (e) => {
        const filePath = card.dataset.filePath;
        if (filePath) {
            // Set the file path and URL in the drag data
            // This allows dragging to copy the file path or open the video URL
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('text/plain', filePath);
            e.dataTransfer.setData('text/uri-list', videoUrl);
        }
    });
    
    // Limit video decode resolution to reduce VRAM usage
    // Setting width/height attributes tells the browser to decode at this resolution
    // CSS will still scale it to fill the card, but VRAM usage is reduced
    video.width = decodeWidth;
    video.height = decodeHeight;
    
    // Optimize rendering for lower VRAM usage
    video.style.imageRendering = 'auto';
    video.style.willChange = 'contents';
    
    // Track loading state
    let hasLoaded = false;
    video.addEventListener('loadedmetadata', () => {
        hasLoaded = true;
        
        // Detect and apply aspect ratio to card
        if (video.videoWidth && video.videoHeight) {
            const aspectRatioName = getClosestAspectRatio(video.videoWidth, video.videoHeight);
            applyAspectRatioToCard(card, aspectRatioName);
        }
        
        // After metadata loads, ensure video dimensions are constrained
        const rect = card.getBoundingClientRect();
        const maxWidth = rect.width;
        const maxHeight = rect.height;
        if (video.videoWidth > maxWidth || video.videoHeight > maxHeight) {
            // Video is larger than card - browser will scale, but we've limited decode size
            video.width = Math.min(video.videoWidth, maxWidth);
            video.height = Math.min(video.videoHeight, maxHeight);
        }
        
        // Check if video has audio tracks (cross-browser compatible)
        const checkAudio = () => {
            let hasAudio = false;
            
            // Method 1: Check audioTracks API (Chrome, Edge, Safari)
            if (video.audioTracks && video.audioTracks.length > 0) {
                hasAudio = true;
            }
            // Method 2: Firefox-specific method
            else if (video.mozHasAudio !== undefined && video.mozHasAudio) {
                hasAudio = true;
            }
            // Method 3: WebKit-specific method (older Safari)
            else if (video.webkitAudioDecodedByteCount !== undefined && video.webkitAudioDecodedByteCount > 0) {
                hasAudio = true;
            }
            
            if (hasAudio) {
                createSoundLabel(card);
            } else {
                // Explicitly mark as no audio - this will hide the card if audio filter is active
                card.dataset.hasAudio = 'false';
                // If audio filter is active, re-apply filters to hide videos without audio
                if (currentFilter === 'audio') {
                    applyFilters();
                }
            }
        };
        
        // Check immediately when metadata loads
        checkAudio();
        
        // Also check when video can play (more reliable for some browsers)
        video.addEventListener('canplay', checkAudio, { once: true });
    });
    
    // Add error handler - retry on error
    video.addEventListener('error', () => {
        destroyVideoElement(video);
        activeVideoCount = Math.max(0, activeVideoCount - 1);
        pendingMediaCreations.delete(card);
        
        // Retry after a short delay if card is still in preload zone
        setTimeout(() => {
            const rect = card.getBoundingClientRect();
            // Check if in preload zone (accounting for rootMargin)
            const viewportTop = -PRELOAD_BUFFER_PX;
            const viewportBottom = window.innerHeight + PRELOAD_BUFFER_PX;
            const viewportLeft = -PRELOAD_BUFFER_PX;
            const viewportRight = window.innerWidth + PRELOAD_BUFFER_PX;
            const isInPreloadZone = (
                rect.top < viewportBottom &&
                rect.bottom > viewportTop &&
                rect.left < viewportRight &&
                rect.right > viewportLeft
            );
            if (isInPreloadZone && !card.querySelector('video')) {
                mediaToRetry.set(card, videoUrl);
            }
        }, 500);
    });

    const info = card.querySelector('.video-info');
    card.insertBefore(video, info);

    const playPromise = video.play();
    if (playPromise !== undefined) {
        playPromise.catch(() => {
            // Ignore play errors
        });
    }
    
    pendingMediaCreations.delete(card);
    return true;
}

function processEntries(entries) {
    let changed = false;
    const now = Date.now();
    
    // FIRST: Clean up all media that are going out of view (SYNCHRONOUSLY)
    entries.forEach(entry => {
        if (!entry.isIntersecting) {
            const card = entry.target;
            const videos = card.querySelectorAll('video');
            const images = card.querySelectorAll('img.media-thumbnail');
            
            if (videos.length > 0) {
                videos.forEach(video => {
                    destroyVideoElement(video);
                    activeVideoCount = Math.max(0, activeVideoCount - 1);
                    pendingMediaCreations.delete(card);
                    mediaToRetry.delete(card);
                });
                changed = true;
                lastCleanupTime = now;
            }
            
            if (images.length > 0) {
                images.forEach(img => {
                    destroyImageElement(img);
                    activeImageCount = Math.max(0, activeImageCount - 1);
                    pendingMediaCreations.delete(card);
                    mediaToRetry.delete(card);
                });
                changed = true;
                lastCleanupTime = now;
            }
        }
    });
    
    // Update count after cleanup
    activeVideoCount = gridContainer.querySelectorAll('video').length;
    activeImageCount = gridContainer.querySelectorAll('img.media-thumbnail').length;
    
    // Check if cooldown has passed
    const timeSinceCleanup = now - lastCleanupTime;
    const canCreateNow = timeSinceCleanup >= CLEANUP_COOLDOWN_MS;
    
    // THEN: Create media for cards coming into view
    // First, collect all cards that need media and prioritize by distance from viewport center
    const cardsToLoad = [];
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const card = entry.target;
            const videos = card.querySelectorAll('video');
            const images = card.querySelectorAll('img.media-thumbnail');
            
            // Remove any duplicate videos first
            if (videos.length > 1) {
                for (let i = 1; i < videos.length; i++) {
                    destroyVideoElement(videos[i]);
                    activeVideoCount = Math.max(0, activeVideoCount - 1);
                    changed = true;
                }
            }
            
            // Remove any duplicate images first
            if (images.length > 1) {
                for (let i = 1; i < images.length; i++) {
                    destroyImageElement(images[i]);
                    activeImageCount = Math.max(0, activeImageCount - 1);
                    changed = true;
                }
            }
            
            // If no media exists and not pending, add to load queue
            if (videos.length === 0 && images.length === 0 && !pendingMediaCreations.has(card)) {
                const rect = card.getBoundingClientRect();
                const viewportCenterY = window.innerHeight / 2;
                const cardCenterY = rect.top + rect.height / 2;
                const distance = Math.abs(cardCenterY - viewportCenterY);
                cardsToLoad.push({ card, mediaUrl: card.dataset.src, distance });
            }
        }
    });
    
    // Sort by distance from viewport center (closest first)
    cardsToLoad.sort((a, b) => a.distance - b.distance);
    
    // Load media in parallel batches for faster initial loading
    let loadedInBatch = 0;
    cardsToLoad.forEach(({ card, mediaUrl }) => {
        const currentVideoCount = gridContainer.querySelectorAll('video').length;
        const currentImageCount = gridContainer.querySelectorAll('img.media-thumbnail').length;
        const totalMediaCount = currentVideoCount + currentImageCount;
        
        if (totalMediaCount >= MAX_TOTAL_MEDIA) {
            // If at limit, only load if this card is in the preload zone
            const rect = card.getBoundingClientRect();
            const viewportTop = -PRELOAD_BUFFER_PX;
            const viewportBottom = window.innerHeight + PRELOAD_BUFFER_PX;
            const viewportLeft = -PRELOAD_BUFFER_PX;
            const viewportRight = window.innerWidth + PRELOAD_BUFFER_PX;
            const isInPreloadZone = (
                rect.top < viewportBottom &&
                rect.bottom > viewportTop &&
                rect.left < viewportRight &&
                rect.right > viewportLeft
            );
            // Only load if in preload zone when at limit
            if (!isInPreloadZone) {
                mediaToRetry.set(card, mediaUrl);
                return;
            }
        }
        
        // Load multiple items in parallel for faster initial loading
        // Trust IntersectionObserver - if entry.isIntersecting is true, load immediately
        // No cooldown check for parallel loading to maximize speed
        if (loadedInBatch < PARALLEL_LOAD_LIMIT) {
            // Create immediately for parallel batch (no cooldown restriction)
            createMediaForCard(card, mediaUrl);
            loadedInBatch++;
        } else {
            // For items beyond parallel limit, still load immediately but use requestAnimationFrame
            // This ensures smooth loading without blocking
            requestAnimationFrame(() => {
                if (card.querySelectorAll('video').length === 0 && 
                    card.querySelectorAll('img.media-thumbnail').length === 0) {
                    createMediaForCard(card, mediaUrl);
                }
            });
        }
    });

    if (changed) {
        scheduleGC();
    }
}

// Retry mechanism for media that couldn't load due to limit
function retryPendingVideos() {
    if (mediaToRetry.size === 0) return;
    
    const currentVideoCount = gridContainer.querySelectorAll('video').length;
    const currentImageCount = gridContainer.querySelectorAll('img.media-thumbnail').length;
    const totalMediaCount = currentVideoCount + currentImageCount;
    
    if (totalMediaCount >= MAX_TOTAL_MEDIA) return;
    
    // Try to create multiple media from retry queue in parallel (faster loading)
    // Use IntersectionObserver to check if cards are in preload zone
    let retriedCount = 0;
    for (const [card, mediaUrl] of mediaToRetry.entries()) {
        if (retriedCount >= PARALLEL_LOAD_LIMIT) break; // Limit parallel retries
        
        // Check if card is intersecting (respects rootMargin from IntersectionObserver)
        // We need to manually check intersection since we're in retry queue
        const rect = card.getBoundingClientRect();
        const viewportTop = -PRELOAD_BUFFER_PX;
        const viewportBottom = window.innerHeight + PRELOAD_BUFFER_PX;
        const viewportLeft = -PRELOAD_BUFFER_PX;
        const viewportRight = window.innerWidth + PRELOAD_BUFFER_PX;
        
        const isInPreloadZone = (
            rect.top < viewportBottom &&
            rect.bottom > viewportTop &&
            rect.left < viewportRight &&
            rect.right > viewportLeft
        );
        
        if (isInPreloadZone && card.querySelectorAll('video').length === 0 && 
            card.querySelectorAll('img.media-thumbnail').length === 0) {
            if (createMediaForCard(card, mediaUrl)) {
                mediaToRetry.delete(card);
                retriedCount++;
            }
        } else if (!isInPreloadZone) {
            // Remove from retry queue if card is outside preload zone
            mediaToRetry.delete(card);
        }
    }
}

// --- Intersection Observer ---
// Use viewport as root (null) instead of gridContainer for proper intersection detection
// Preload content before it enters viewport for smoother scrolling
const observerOptions = {
    root: null, // Use viewport instead of gridContainer
    // rootMargin format: "top right bottom left" - expands viewport for preloading
    rootMargin: `${PRELOAD_BUFFER_PX}px ${PRELOAD_BUFFER_PX}px ${PRELOAD_BUFFER_PX}px ${PRELOAD_BUFFER_PX}px`,
    threshold: 0.0 // Trigger as soon as any part intersects
};

// Helper function to aggressively clean up video elements
function destroyVideoElement(video) {
    if (!video) return;
    
    // Store parent reference before we start cleanup
    const parent = video.parentNode;
    
    try {
        // 1. Stop playback FIRST before removing from DOM
        try {
            video.pause();
            video.currentTime = 0;
            // Cancel any pending operations
            if (video.requestVideoFrameCallback) {
                // Cancel any frame callbacks if supported
            }
        } catch (e) {
            // Ignore if already paused/stopped
        }
        
        // 2. Stop all tracks (releases decoder resources) BEFORE removing from DOM
        try {
            if (video.srcObject) {
                const tracks = video.srcObject.getTracks();
                tracks.forEach(track => {
                    try {
                        track.stop();
                    } catch (e) {
                        // Ignore track stop errors
                    }
                });
                video.srcObject = null;
            }
        } catch (e) {
            // Ignore srcObject errors
        }
        
        // 3. Clear src BEFORE removing from DOM to release decoder
        try {
            // Set to blank video first to flush decoder
            video.src = BLANK_VIDEO;
            video.load();
            // Then clear completely
            video.removeAttribute('src');
            video.src = '';
            video.load();
        } catch (e) {
            // Ignore src errors
        }
        
        // 4. Remove from DOM to stop rendering
        if (parent) {
            try {
                parent.removeChild(video);
            } catch (e) {
                // Video might already be removed
            }
        } else {
            try {
                video.remove();
            } catch (e) {
                // Ignore
            }
        }
        
        // 5. Clear all attributes and properties
        try {
            video.removeAttribute('src');
            video.removeAttribute('playsinline');
            if (video.srcObject) video.srcObject = null;
            if (video.src) video.src = '';
        } catch (e) {
            // Ignore
        }
        
        // 6. Explicitly nullify
        video = null;
    } catch (e) {
        // Final fallback - just try to remove from DOM
        try {
            if (video && video.parentNode) {
                video.parentNode.removeChild(video);
            } else if (video) {
                video.remove();
            }
        } catch (e2) {
            // Ignore all errors - video might already be gone
        }
    }
}

// Helper function to clean up image elements
function destroyImageElement(img) {
    if (!img) return;
    
    const parent = img.parentNode;
    
    try {
        // Clear src to stop loading/rendering
        img.src = '';
        img.removeAttribute('src');
        
        // Remove from DOM
        if (parent) {
            try {
                parent.removeChild(img);
            } catch (e) {
                // Image might already be removed
            }
        } else {
            try {
                img.remove();
            } catch (e) {
                // Ignore
            }
        }
        
        // Clear all attributes
        try {
            img.removeAttribute('src');
            img.removeAttribute('width');
            img.removeAttribute('height');
        } catch (e) {
            // Ignore
        }
        
        // Explicitly nullify
        img = null;
    } catch (e) {
        // Final fallback - just try to remove from DOM
        try {
            if (img && img.parentNode) {
                img.parentNode.removeChild(img);
            } else if (img) {
                img.remove();
            }
        } catch (e2) {
            // Ignore all errors - image might already be gone
        }
    }
}

const observer = new IntersectionObserver((entries) => {
    // Process entries immediately - no throttling that could cause missed cleanups
    processEntries(entries);
    
    // Also trigger immediate cleanup check synchronously
    performCleanupCheck();
    
    // Retry pending videos
    retryPendingVideos();
}, observerOptions);


// --- Filter and Search Functionality ---
function applyFilters() {
    const cards = gridContainer.querySelectorAll('.video-card, .folder-card');
    const query = searchBox.value.toLowerCase().trim();
    
    cards.forEach(card => {
        const info = card.querySelector('.video-info, .folder-info');
        const fileName = info ? info.textContent.toLowerCase() : '';
        
        // Check if card matches search query
        const matchesSearch = query === '' || fileName.includes(query);
        
        // Check if card matches filter
        let matchesFilter = true;
        if (currentFilter === 'video') {
            // Show only video files (not folders or images)
            matchesFilter = card.classList.contains('video-card') && card.dataset.mediaType === 'video';
        } else if (currentFilter === 'image') {
            // Show only image files (not folders or videos)
            matchesFilter = card.classList.contains('video-card') && card.dataset.mediaType === 'image';
        } else if (currentFilter === 'audio') {
            // Show videos that have audio OR are still loading (hasAudio not set yet)
            // This ensures videos show up immediately, then get filtered out if no audio once metadata loads
            const isVideo = card.classList.contains('video-card') && card.dataset.mediaType === 'video';
            const hasAudio = card.dataset.hasAudio === 'true';
            const audioNotChecked = card.dataset.hasAudio === undefined || card.dataset.hasAudio === '';
            matchesFilter = isVideo && (hasAudio || audioNotChecked);
        } else {
            // 'all' - show everything
            matchesFilter = true;
        }
        
        // Show card only if it matches both search and filter
        if (matchesSearch && matchesFilter) {
            card.style.display = '';
        } else {
            card.style.display = 'none';
        }
    });
    
    // Recalculate layout after filtering
    if (layoutMode === 'masonry' && gridContainer.classList.contains('masonry')) {
        requestAnimationFrame(() => {
            layoutMasonry();
        });
    }
}

function performSearch(searchQuery) {
    applyFilters();
}

// --- Event Listeners ---

selectFolderBtn.addEventListener('click', async () => {
    // Get the last folder path from localStorage if remembering is enabled
    const lastFolderPath = rememberLastFolder ? localStorage.getItem('lastFolderPath') : null;
    const folderPath = await window.electronAPI.selectFolder(lastFolderPath);
    if (folderPath) {
        // Save the selected folder path to localStorage if remembering is enabled
        if (rememberLastFolder) {
            localStorage.setItem('lastFolderPath', folderPath);
        }
        navigateToFolder(folderPath);
    }
});

// Back/Forward button handlers
backBtn.addEventListener('click', goBack);
forwardBtn.addEventListener('click', goForward);

// Handle mouse back/forward buttons (browser navigation)
window.addEventListener('popstate', (event) => {
    // This handles browser back/forward buttons
    // We'll use our own history system instead
});

// Handle mouse back/forward buttons directly
// Use auxclick event which is specifically for non-primary mouse buttons
document.addEventListener('auxclick', (e) => {
    // Check for mouse back button (button 3) or forward button (button 4)
    if (e.button === 3) {
        // Back button
        e.preventDefault();
        e.stopPropagation();
        if (navigationHistory.canGoBack()) {
            goBack();
        }
    } else if (e.button === 4) {
        // Forward button
        e.preventDefault();
        e.stopPropagation();
        if (navigationHistory.canGoForward()) {
            goForward();
        }
    }
});

// Also handle mouseup as fallback for older browsers
document.addEventListener('mouseup', (e) => {
    // Only handle if auxclick didn't fire (button 3 or 4)
    if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
        if (e.button === 3 && navigationHistory.canGoBack()) {
            goBack();
        } else if (e.button === 4 && navigationHistory.canGoForward()) {
            goForward();
        }
    }
});

// Function to show drives selection
async function showDrivesSelection() {
    try {
        const drives = await window.electronAPI.getDrives();
        if (drives.length === 0) {
            return; // No drives available or not on Windows
        }
        
        // Create a dropdown/popup to show drives
        const existingDropdown = document.getElementById('drives-dropdown');
        if (existingDropdown) {
            existingDropdown.remove();
        }
        
        const dropdown = document.createElement('div');
        dropdown.id = 'drives-dropdown';
        dropdown.className = 'drives-dropdown';
        
        drives.forEach(drive => {
            const driveItem = document.createElement('div');
            driveItem.className = 'drive-item';
            driveItem.textContent = drive.name;
            driveItem.addEventListener('click', (e) => {
                e.stopPropagation();
                navigateToFolder(drive.path);
                dropdown.remove();
            });
            dropdown.appendChild(driveItem);
        });
        
        // Position dropdown near the Computer breadcrumb item
        const computerItem = breadcrumbContainer.querySelector('.breadcrumb-item[data-path="computer"]');
        let rect;
        if (computerItem) {
            rect = computerItem.getBoundingClientRect();
        } else {
            // Fallback positioning - use breadcrumb container
            rect = breadcrumbContainer.getBoundingClientRect();
        }
        
        dropdown.style.position = 'fixed';
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.top = `${rect.bottom + 5}px`;
        dropdown.style.zIndex = '1000';
        
        // Ensure dropdown doesn't go off screen
        requestAnimationFrame(() => {
            const dropdownRect = dropdown.getBoundingClientRect();
            if (dropdownRect.right > window.innerWidth) {
                dropdown.style.left = `${window.innerWidth - dropdownRect.width - 10}px`;
            }
            if (dropdownRect.bottom > window.innerHeight) {
                dropdown.style.top = `${rect.top - dropdownRect.height - 5}px`;
            }
        });
        
        document.body.appendChild(dropdown);
        
        // Close dropdown when clicking outside
        const closeDropdown = (e) => {
            if (!dropdown.contains(e.target) && !computerItem?.contains(e.target)) {
                dropdown.remove();
                document.removeEventListener('click', closeDropdown);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeDropdown);
        }, 0);
    } catch (error) {
        console.error('Error showing drives:', error);
    }
}

// Function to update breadcrumb navigation
function updateBreadcrumb(folderPath) {
    if (!folderPath) {
        currentPathSpan.textContent = 'No folder selected';
        breadcrumbContainer.innerHTML = '<span id="current-path" class="breadcrumb-editable">No folder selected</span>';
        return;
    }

    // Normalize path separators
    const normalizedPath = folderPath.replace(/\\/g, '/');
    const isWindowsPath = folderPath.includes('\\') || (folderPath.length > 1 && folderPath[1] === ':');
    const separator = isWindowsPath ? '\\' : '/';
    
    // Split path into parts
    const pathParts = normalizedPath.split('/').filter(part => part.length > 0);
    
    // Handle Windows drive letters (e.g., "C:")
    let breadcrumbParts = [];
    if (pathParts.length > 0 && pathParts[0].endsWith(':')) {
        // Windows path - keep drive letter as first part
        breadcrumbParts.push(pathParts[0]);
        for (let i = 1; i < pathParts.length; i++) {
            breadcrumbParts.push(pathParts[i]);
        }
    } else {
        // Unix/Mac path
        breadcrumbParts = pathParts;
    }

    // Build breadcrumb HTML with editable path display
    let breadcrumbHTML = '';
    let currentPath = '';
    
    // Add "Computer" item before drive on Windows (always show it for Windows paths)
    if (isWindowsPath && breadcrumbParts.length > 0 && breadcrumbParts[0].endsWith(':')) {
        breadcrumbHTML += `<span class="breadcrumb-item" data-path="computer">Computer</span>`;
        breadcrumbHTML += '<span class="breadcrumb-separator">/</span>';
    }
    
    breadcrumbParts.forEach((part, index) => {
        // Build path up to this part
        if (index === 0) {
            if (part.endsWith(':')) {
                // Windows drive letter
                currentPath = part + separator;
            } else {
                // Unix root
                currentPath = separator + part + separator;
            }
        } else {
            currentPath = currentPath + (currentPath.endsWith(separator) ? '' : separator) + part + separator;
        }
        
        // Remove trailing separator for data-path
        const pathForData = currentPath.replace(/[/\\]$/, '');
        breadcrumbHTML += `<span class="breadcrumb-item" data-path="${pathForData.replace(/\\/g, '\\\\')}">${part}</span>`;
        if (index < breadcrumbParts.length - 1) {
            breadcrumbHTML += '<span class="breadcrumb-separator">/</span>';
        }
    });
    
    // Add editable path input (hidden by default, shown when clicked)
    breadcrumbHTML += `<input type="text" class="breadcrumb-input" value="${folderPath.replace(/\\/g, '\\\\')}" style="display: none;">`;

    breadcrumbContainer.innerHTML = breadcrumbHTML;
    
    const breadcrumbInput = breadcrumbContainer.querySelector('.breadcrumb-input');
    const breadcrumbItems = breadcrumbContainer.querySelectorAll('.breadcrumb-item, .breadcrumb-separator');
    
    // Add click handlers to breadcrumb items (for navigation)
    breadcrumbContainer.querySelectorAll('.breadcrumb-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            const targetPath = item.dataset.path;
            
            // Special handling for "Computer" item
            if (targetPath === 'computer') {
                await showDrivesSelection();
                return;
            }
            
            const normalizedTargetPath = targetPath.replace(/\\\\/g, '\\');
            navigateToFolder(normalizedTargetPath);
        });
    });
    
    // Make breadcrumb editable when clicking on empty space or separators
    breadcrumbContainer.addEventListener('click', (e) => {
        // Don't trigger if clicking on an individual breadcrumb item (they navigate)
        if (e.target.classList.contains('breadcrumb-item')) {
            return;
        }
        
        // Show input, hide breadcrumb items
        breadcrumbItems.forEach(item => item.style.display = 'none');
        breadcrumbInput.style.display = 'block';
        breadcrumbInput.focus();
        breadcrumbInput.select();
    });
    
    // Handle input events
    breadcrumbInput.addEventListener('blur', () => {
        // Hide input, show breadcrumb items
        breadcrumbItems.forEach(item => item.style.display = '');
        breadcrumbInput.style.display = 'none';
    });
    
    breadcrumbInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const newPath = breadcrumbInput.value.trim();
            if (newPath) {
                // Validate and navigate to the path
                // The navigateToFolder function will handle errors if path doesn't exist
                navigateToFolder(newPath);
            } else {
                // Reset to current path if empty
                breadcrumbInput.value = folderPath;
                breadcrumbInput.blur();
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            // Reset to current path
            breadcrumbInput.value = folderPath;
            breadcrumbInput.blur();
        }
    });
}

// Function to navigate to a folder
async function navigateToFolder(folderPath, addToHistory = true) {
    try {
        // Validate path exists by trying to scan it
        const items = await window.electronAPI.scanFolder(folderPath);
        
        // If scan succeeds (even with empty results), path is valid
        currentFolderPath = folderPath;
        // Save the folder path to localStorage whenever we navigate to a folder (if remembering is enabled)
        if (rememberLastFolder) {
            localStorage.setItem('lastFolderPath', folderPath);
        }
        if (addToHistory) {
            navigationHistory.add(folderPath);
        }
        updateBreadcrumb(folderPath);
        searchBox.value = ''; // Clear search when navigating
        currentFilter = 'all'; // Reset filter when navigating
        filterAllBtn.classList.add('active');
        filterVideosBtn.classList.remove('active');
        filterImagesBtn.classList.remove('active');
        filterAudioBtn.classList.remove('active');
        loadVideos(folderPath);
    } catch (error) {
        // Path doesn't exist or is invalid - show error and revert breadcrumb
        console.error('Invalid path:', folderPath, error);
        // Revert breadcrumb to current path
        if (currentFolderPath) {
            updateBreadcrumb(currentFolderPath);
        }
        // Could show a toast/notification here if desired
        alert(`Path not found: ${folderPath}`);
    }
}

// Navigation functions
async function goBack() {
    const path = navigationHistory.goBack();
    if (path) {
        await navigateToFolder(path, false); // Don't add to history since we're navigating history
    }
}

async function goForward() {
    const path = navigationHistory.goForward();
    if (path) {
        await navigateToFolder(path, false); // Don't add to history since we're navigating history
    }
}

// Live search as user types
searchBox.addEventListener('input', (e) => {
    performSearch(e.target.value);
});

// Filter button event listeners
filterAllBtn.addEventListener('click', () => {
    currentFilter = 'all';
    filterAllBtn.classList.add('active');
    filterVideosBtn.classList.remove('active');
    filterImagesBtn.classList.remove('active');
    filterAudioBtn.classList.remove('active');
    applyFilters();
});

filterVideosBtn.addEventListener('click', () => {
    currentFilter = 'video';
    filterAllBtn.classList.remove('active');
    filterVideosBtn.classList.add('active');
    filterImagesBtn.classList.remove('active');
    filterAudioBtn.classList.remove('active');
    applyFilters();
});

filterImagesBtn.addEventListener('click', () => {
    currentFilter = 'image';
    filterAllBtn.classList.remove('active');
    filterVideosBtn.classList.remove('active');
    filterImagesBtn.classList.add('active');
    filterAudioBtn.classList.remove('active');
    applyFilters();
});

filterAudioBtn.addEventListener('click', () => {
    currentFilter = 'audio';
    filterAllBtn.classList.remove('active');
    filterVideosBtn.classList.remove('active');
    filterImagesBtn.classList.remove('active');
    filterAudioBtn.classList.add('active');
    applyFilters();
});

// Settings button event listener
settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSettingsDropdown();
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!settingsBtn.contains(e.target) && !settingsDropdown.contains(e.target)) {
        closeSettingsDropdown();
    }
});

// Layout mode toggle event listener
layoutModeToggle.addEventListener('change', () => {
    switchLayoutMode();
});

// Remember folder toggle event listener
rememberFolderToggle.addEventListener('change', () => {
    toggleRememberFolder();
});

// Sorting dropdown event listeners
sortTypeSelect.addEventListener('change', () => {
    updateSorting();
});

sortOrderSelect.addEventListener('change', () => {
    updateSorting();
});

function openLightbox(mediaUrl, filePath, fileName) {
    const mediaType = getFileType(mediaUrl);
    
    // Store file info for copy buttons
    const lightboxFilename = document.getElementById('lightbox-filename');
    const copyPathBtn = document.getElementById('copy-path-btn');
    const copyNameBtn = document.getElementById('copy-name-btn');
    
    // Display filename
    if (lightboxFilename && fileName) {
        lightboxFilename.textContent = fileName;
    }
    
    // Store file path and name in button data attributes for copying
    if (copyPathBtn && filePath) {
        copyPathBtn.dataset.filePath = filePath;
    }
    if (copyNameBtn && fileName) {
        copyNameBtn.dataset.fileName = fileName;
    }
    
    if (mediaType === 'image') {
        // Hide video, show image
        lightboxVideo.style.display = 'none';
        lightboxImage.style.display = 'block';
        lightboxImage.src = mediaUrl;
        lightbox.classList.remove('hidden');
    } else {
        // Hide image, show video
        lightboxImage.style.display = 'none';
        lightboxVideo.style.display = 'block';
        lightboxVideo.src = mediaUrl;
        lightbox.classList.remove('hidden');
        lightboxVideo.play();
    }
}

function closeLightbox() {
    // Clean up video
    lightboxVideo.pause();
    lightboxVideo.src = "";
    lightboxVideo.removeAttribute('src');
    
    // Clean up image
    lightboxImage.src = "";
    lightboxImage.removeAttribute('src');
    
    lightbox.classList.add('hidden');

    // Trigger GC after closing lightbox too
    scheduleGC();
}

closeLightboxBtn.addEventListener('click', closeLightbox);

lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) {
        closeLightbox();
    }
});

// Copy button functionality
const copyPathBtn = document.getElementById('copy-path-btn');
const copyNameBtn = document.getElementById('copy-name-btn');

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        // Visual feedback - could add a toast notification here if desired
        return true;
    } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        // Fallback for older browsers
        try {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            return true;
        } catch (fallbackError) {
            console.error('Fallback copy failed:', fallbackError);
            return false;
        }
    }
}

if (copyPathBtn) {
    copyPathBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Prevent closing lightbox
        const filePath = copyPathBtn.dataset.filePath;
        if (filePath) {
            const success = await copyToClipboard(filePath);
            if (success) {
                // Visual feedback
                const originalText = copyPathBtn.textContent;
                copyPathBtn.textContent = 'Copied!';
                setTimeout(() => {
                    copyPathBtn.textContent = originalText;
                }, 1000);
            }
        }
    });
}

if (copyNameBtn) {
    copyNameBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Prevent closing lightbox
        const fileName = copyNameBtn.dataset.fileName;
        if (fileName) {
            const success = await copyToClipboard(fileName);
            if (success) {
                // Visual feedback
                const originalText = copyNameBtn.textContent;
                copyNameBtn.textContent = 'Copied!';
                setTimeout(() => {
                    copyNameBtn.textContent = originalText;
                }, 1000);
            }
        }
    });
}

// --- Context Menu Functionality ---
function showContextMenu(event, card) {
    event.preventDefault();
    event.stopPropagation();
    
    // Only show context menu for media cards (not folders)
    if (card.classList.contains('folder-card')) {
        return;
    }
    
    contextMenuTargetCard = card;
    
    // Position the context menu at the cursor position
    const x = event.clientX;
    const y = event.clientY;
    
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.remove('hidden');
    
    // Adjust position if menu goes off screen
    requestAnimationFrame(() => {
        const rect = contextMenu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            contextMenu.style.left = `${window.innerWidth - rect.width - 10}px`;
        }
        if (rect.bottom > window.innerHeight) {
            contextMenu.style.top = `${window.innerHeight - rect.height - 10}px`;
        }
    });
}

function hideContextMenu() {
    contextMenu.classList.add('hidden');
    contextMenuTargetCard = null;
}

// Hide context menu when clicking elsewhere
document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) {
        hideContextMenu();
    }
});

// Handle context menu item clicks
contextMenu.addEventListener('click', async (e) => {
    const action = e.target.dataset.action;
    if (!action || !contextMenuTargetCard) return;
    
    const filePath = contextMenuTargetCard.dataset.filePath;
    if (!filePath) return;
    
    // Store the file name before hiding the menu (since we clear contextMenuTargetCard)
    const fileNameElement = contextMenuTargetCard.querySelector('.video-info');
    const fileName = fileNameElement ? fileNameElement.textContent : '';
    
    hideContextMenu();
    
    switch (action) {
        case 'reveal':
            try {
                await window.electronAPI.revealInExplorer(filePath);
            } catch (error) {
                alert(`Error: ${error.message}`);
            }
            break;
            
        case 'rename':
            // Show rename dialog
            renamePendingFile = { filePath, fileName };
            renameInput.value = fileName;
            renameDialog.classList.remove('hidden');
            renameInput.focus();
            renameInput.select();
            break;
            
        case 'delete':
            try {
                if (confirm(`Are you sure you want to delete "${fileName}"?`)) {
                    const result = await window.electronAPI.deleteFile(filePath);
                    if (result.success) {
                        // Reload the current folder to reflect the change
                        if (currentFolderPath) {
                            await loadVideos(currentFolderPath);
                        }
                    } else {
                        alert(`Error deleting file: ${result.error}`);
                    }
                }
            } catch (error) {
                alert(`Error: ${error.message}`);
            }
            break;
            
        case 'open':
            try {
                await window.electronAPI.openWithDefault(filePath);
            } catch (error) {
                alert(`Error: ${error.message}`);
            }
            break;
            
        case 'open-with':
            try {
                await window.electronAPI.openWith(filePath);
            } catch (error) {
                alert(`Error: ${error.message}`);
            }
            break;
    }
});

// Prevent default context menu on cards and show custom menu
document.addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.video-card');
    if (card) {
        showContextMenu(e, card);
    }
});

// Rename Dialog Handlers
async function handleRenameConfirm() {
    if (!renamePendingFile) return;
    
    const newName = renameInput.value.trim();
    if (!newName || newName === renamePendingFile.fileName) {
        renameDialog.classList.add('hidden');
        renamePendingFile = null;
        return;
    }
    
    try {
        const result = await window.electronAPI.renameFile(renamePendingFile.filePath, newName);
        if (result.success) {
            renameDialog.classList.add('hidden');
            renamePendingFile = null;
            // Reload the current folder to reflect the change
            if (currentFolderPath) {
                await loadVideos(currentFolderPath);
            }
        } else {
            alert(`Error renaming file: ${result.error}`);
        }
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
}

function handleRenameCancel() {
    renameDialog.classList.add('hidden');
    renamePendingFile = null;
}

renameConfirmBtn.addEventListener('click', handleRenameConfirm);
renameCancelBtn.addEventListener('click', handleRenameCancel);

// Handle Enter key in rename input
renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleRenameConfirm();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        handleRenameCancel();
    }
});

// Close rename dialog when clicking outside
renameDialog.addEventListener('click', (e) => {
    if (e.target === renameDialog) {
        handleRenameCancel();
    }
});

async function loadVideos(folderPath) {
    // Stop periodic cleanup during folder switch
    stopPeriodicCleanup();
    
    window.electronAPI.triggerGC(); // GC before loading new folder

    const items = await window.electronAPI.scanFolder(folderPath);
    
    // Store items for re-sorting without re-fetching
    currentItems = items;

    // Apply sorting to items before displaying
    const sortedItems = sortItems(items);
    
    // Render the sorted items
    renderItems(sortedItems);
}

// Restore last folder and layout mode on app startup
window.addEventListener('DOMContentLoaded', async () => {
    // Restore remember folder preference
    const savedRememberFolder = localStorage.getItem('rememberLastFolder');
    if (savedRememberFolder !== null) {
        rememberLastFolder = savedRememberFolder === 'true';
        rememberFolderToggle.checked = rememberLastFolder;
        rememberFolderLabel.textContent = rememberLastFolder ? 'On' : 'Off';
    }
    
    // Restore layout mode preference
    const savedLayoutMode = localStorage.getItem('layoutMode');
    if (savedLayoutMode === 'grid' || savedLayoutMode === 'masonry') {
        layoutMode = savedLayoutMode;
        // Update toggle checkbox state
        layoutModeToggle.checked = layoutMode === 'grid';
        layoutModeLabel.textContent = layoutMode === 'grid' ? 'Rigid' : 'Dynamic';
    }
    
    // Restore sorting preferences
    const savedSortType = localStorage.getItem('sortType');
    if (savedSortType === 'name' || savedSortType === 'date') {
        sortType = savedSortType;
        sortTypeSelect.value = sortType;
    }
    
    const savedSortOrder = localStorage.getItem('sortOrder');
    if (savedSortOrder === 'ascending' || savedSortOrder === 'descending') {
        sortOrder = savedSortOrder;
        sortOrderSelect.value = sortOrder;
    }
    
    // Only restore last folder if remembering is enabled
    if (rememberLastFolder) {
        const lastFolderPath = localStorage.getItem('lastFolderPath');
        if (lastFolderPath) {
            // Try to navigate to the last folder
            // navigateToFolder will handle errors gracefully
            try {
                // Validate path exists first before navigating
                const items = await window.electronAPI.scanFolder(lastFolderPath);
                // If scan succeeds, navigate to the folder
                await navigateToFolder(lastFolderPath);
            } catch (error) {
                // Silently fail if the folder no longer exists (don't show alert on startup)
                console.log('Last folder no longer exists:', lastFolderPath);
                // Clear the invalid path from localStorage
                localStorage.removeItem('lastFolderPath');
            }
        }
    }
    
    // Listen for window minimize/restore events to reduce resource usage
    window.electronAPI.onWindowMinimized(() => {
        pauseWhenMinimized();
    });
    
    window.electronAPI.onWindowRestored(() => {
        resumeWhenRestored();
    });
    
    // Also use Page Visibility API as a backup (handles tab switching, etc.)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            pauseWhenMinimized();
        } else {
            resumeWhenRestored();
        }
    });
});
