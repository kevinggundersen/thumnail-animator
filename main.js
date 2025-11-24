const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
// const mime = require('mime-types'); // Removed unused dependency

// Fix cache access denied errors by setting a custom cache directory
// This ensures Electron uses a location with proper write permissions
// When packaged, __dirname points to app.asar which is read-only, so we need a different path
let userDataPath;
if (app.isPackaged) {
    // When packaged, use Electron's default userData directory
    userDataPath = app.getPath('userData');
} else {
    // In development, use a folder relative to the project
    userDataPath = path.join(__dirname, 'electron-cache');
}
if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
}
app.setPath('userData', userDataPath);

// Fix for VRAM leak: Disable Hardware Acceleration
// This forces software decoding which is often more stable for many simultaneous videos
// app.disableHardwareAcceleration(); // Re-enabled per user request

// Expose GC for manual memory management
app.commandLine.appendSwitch('js-flags', '--expose-gc');

// Additional cache-related command line switches to prevent cache errors
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');

// VRAM management flags - help prevent video decoder leaks
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// Reduce VRAM usage per video
app.commandLine.appendSwitch('disable-zero-copy'); // Prevent zero-copy which can hold VRAM
app.commandLine.appendSwitch('enable-low-res-tiling'); // Use lower resolution tiling
app.commandLine.appendSwitch('disable-partial-raster'); // Disable partial rasterization that can use VRAM
app.commandLine.appendSwitch('disable-accelerated-2d-canvas'); // Reduce GPU memory for canvas operations

let mainWindow = null;

// Window position persistence
const windowStateFile = path.join(userDataPath, 'window-state.json');
console.log('Window state file path:', windowStateFile);

function loadWindowState() {
    try {
        if (fs.existsSync(windowStateFile)) {
            const data = fs.readFileSync(windowStateFile, 'utf8');
            const state = JSON.parse(data);
            console.log('Loaded window state:', state);
            
            // Validate that the saved position is still valid (within screen bounds)
            if (state.x !== undefined && state.y !== undefined && 
                state.width !== undefined && state.height !== undefined &&
                typeof state.x === 'number' && typeof state.y === 'number' &&
                typeof state.width === 'number' && typeof state.height === 'number') {
                
                // Check if window would be visible on any display (more lenient check)
                const displays = screen.getAllDisplays();
                let isValidPosition = false;
                
                for (const display of displays) {
                    const { x, y, width: dWidth, height: dHeight } = display.bounds;
                    // Allow window to be partially off-screen, just check if any part is visible
                    if (state.x < x + dWidth && state.x + state.width > x &&
                        state.y < y + dHeight && state.y + state.height > y) {
                        isValidPosition = true;
                        break;
                    }
                }
                
                if (isValidPosition) {
                    console.log('Using saved window state');
                    return state;
                } else {
                    console.log('Saved window state is not valid for current displays');
                }
            }
        } else {
            console.log('No saved window state file found');
        }
    } catch (error) {
        console.error('Error loading window state:', error);
    }
    
    // Return default values if loading fails
    console.log('Using default window state');
    return {
        width: 1200,
        height: 800,
        x: undefined,
        y: undefined,
        isMaximized: false
    };
}

function saveWindowState(win) {
    try {
        // Don't save if window is being destroyed
        if (win.isDestroyed()) {
            return;
        }
        
        const bounds = win.getBounds();
        const isMaximized = win.isMaximized();
        
        const state = {
            width: bounds.width,
            height: bounds.height,
            x: bounds.x,
            y: bounds.y,
            isMaximized: isMaximized
        };
        
        // Ensure directory exists
        const dir = path.dirname(windowStateFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(windowStateFile, JSON.stringify(state, null, 2), 'utf8');
        console.log('Window state saved:', state);
    } catch (error) {
        console.error('Error saving window state:', error);
    }
}

function createWindow() {
    const windowState = loadWindowState();
    
    // Build window options object
    const windowOptions = {
        width: windowState.width || 1200,
        height: windowState.height || 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        },
        backgroundColor: '#1a1a1a', // Dark mode base
        autoHideMenuBar: true // Hide menu bar by default, show with Alt key
    };
    
    // Only set x/y if they are valid numbers
    if (typeof windowState.x === 'number' && typeof windowState.y === 'number') {
        windowOptions.x = windowState.x;
        windowOptions.y = windowState.y;
    }
    
    const win = new BrowserWindow(windowOptions);

    win.loadFile('index.html');
    
    // Restore maximized state after window is ready
    if (windowState.isMaximized) {
        win.once('ready-to-show', () => {
            win.maximize();
        });
    }
    // win.webContents.openDevTools(); // Open DevTools for debugging
    
    // Hide menu bar when window loses focus
    win.on('blur', () => {
        win.setMenuBarVisibility(false);
    });
    
    // Track window minimize/maximize events to reduce resource usage
    win.on('minimize', () => {
        win.webContents.send('window-minimized');
    });
    
    win.on('restore', () => {
        win.webContents.send('window-restored');
    });
    
    win.on('show', () => {
        win.webContents.send('window-restored');
    });
    
    // Save window state when window is moved or resized
    let saveTimeout;
    const debouncedSave = () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            saveWindowState(win);
        }, 500); // Save after 500ms of no changes
    };
    
    win.on('move', debouncedSave);
    win.on('resize', debouncedSave);
    win.on('maximize', () => {
        clearTimeout(saveTimeout);
        saveWindowState(win);
    });
    win.on('unmaximize', () => {
        clearTimeout(saveTimeout);
        saveWindowState(win);
    });
    
    // Save state when window is closed (clear timeout and save immediately)
    win.on('close', () => {
        clearTimeout(saveTimeout);
        saveWindowState(win);
    });
    
    mainWindow = win;
    return win;
}

app.whenReady().then(() => {
    const win = createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC Handlers
ipcMain.handle('select-folder', async (event, defaultPath) => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        defaultPath: defaultPath || undefined
    });
    return result.filePaths[0];
});

ipcMain.handle('trigger-gc', () => {
    if (global.gc) {
        global.gc();
        // console.log('GC Triggered');
    }
});

ipcMain.handle('scan-folder', async (event, folderPath) => {
    try {
        const items = await fs.promises.readdir(folderPath, { withFileTypes: true });
        
        // Use Sets for O(1) lookup instead of O(n) array.includes()
        const videoExtensions = new Set(['.mp4', '.webm', '.ogg', '.mov']);
        const imageExtensions = new Set(['.gif', '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.svg']);
        const supportedExtensions = new Set([...videoExtensions, ...imageExtensions]);

        const folders = [];
        const mediaFiles = [];
        
        // Pre-compute folder path separator for URL conversion
        const isWindows = process.platform === 'win32';
        const urlSeparator = '/';

        for (const item of items) {
            if (item.isDirectory()) {
                // Get folder stats for date sorting
                const itemPath = path.join(folderPath, item.name);
                try {
                    const stats = await fs.promises.stat(itemPath);
                    folders.push({
                        name: item.name,
                        path: itemPath,
                        type: 'folder',
                        mtime: stats.mtime.getTime() // Modification time as timestamp
                    });
                } catch (error) {
                    // If stat fails, still add folder without date
                    folders.push({
                        name: item.name,
                        path: itemPath,
                        type: 'folder',
                        mtime: 0
                    });
                }
            } else if (item.isFile()) {
                // Fast extension check using Set
                const name = item.name;
                const lastDot = name.lastIndexOf('.');
                if (lastDot === -1) continue; // No extension, skip
                
                const ext = name.substring(lastDot).toLowerCase();
                if (!supportedExtensions.has(ext)) continue; // Not a supported extension, skip
                
                // Build path and URL efficiently
                const itemPath = path.join(folderPath, name);
                const url = isWindows 
                    ? `file:///${itemPath.replace(/\\/g, '/')}` 
                    : `file://${itemPath}`;
                
                // Get file stats for date sorting
                try {
                    const stats = await fs.promises.stat(itemPath);
                    mediaFiles.push({
                        name: name,
                        path: itemPath,
                        url: url,
                        type: imageExtensions.has(ext) ? 'image' : 'video',
                        mtime: stats.mtime.getTime() // Modification time as timestamp
                    });
                } catch (error) {
                    // If stat fails, still add file without date
                    mediaFiles.push({
                        name: name,
                        path: itemPath,
                        url: url,
                        type: imageExtensions.has(ext) ? 'image' : 'video',
                        mtime: 0
                    });
                }
            }
        }

        // Note: Sorting will be done client-side based on user preferences
        // Default alphabetical sorting kept for backward compatibility
        if (folders.length > 1) {
            folders.sort((a, b) => a.name.localeCompare(b.name));
        }
        if (mediaFiles.length > 1) {
            mediaFiles.sort((a, b) => a.name.localeCompare(b.name));
        }

        // Return folders first, then media files
        return folders.length + mediaFiles.length > 0 ? [...folders, ...mediaFiles] : [];
    } catch (error) {
        console.error('Error scanning folder:', error);
        return [];
    }
});

// Context menu IPC handlers
ipcMain.handle('reveal-in-explorer', async (event, filePath) => {
    try {
        // shell.showItemInFolder opens the file's parent folder and selects the file
        shell.showItemInFolder(filePath);
        return { success: true };
    } catch (error) {
        console.error('Error revealing file in explorer:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('rename-file', async (event, filePath, newName) => {
    try {
        const dir = path.dirname(filePath);
        const newPath = path.join(dir, newName);
        
        // Check if new name already exists
        if (fs.existsSync(newPath)) {
            return { success: false, error: 'A file with this name already exists' };
        }
        
        await fs.promises.rename(filePath, newPath);
        return { success: true, newPath };
    } catch (error) {
        console.error('Error renaming file:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('delete-file', async (event, filePath) => {
    try {
        await fs.promises.unlink(filePath);
        return { success: true };
    } catch (error) {
        console.error('Error deleting file:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('open-with-default', async (event, filePath) => {
    try {
        // shell.openPath opens the file with the system's default application
        await shell.openPath(filePath);
        return { success: true };
    } catch (error) {
        console.error('Error opening file with default app:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('open-with', async (event, filePath) => {
    try {
        if (process.platform === 'win32') {
            // On Windows, use exec with cmd /c start to launch rundll32
            const { exec } = require('child_process');
            
            // Ensure we have an absolute path
            const absolutePath = path.resolve(filePath);
            
            // Verify the file exists
            if (!fs.existsSync(absolutePath)) {
                console.error('File does not exist:', absolutePath);
                return { success: false, error: 'File does not exist' };
            }
            
            console.log('Opening "Open With" dialog for:', absolutePath);
            
            // Escape the path properly - double quotes for cmd.exe
            const escapedPath = absolutePath.replace(/"/g, '""');
            
            // Build the rundll32 command
            const command = `rundll32.exe shell32.dll,OpenAs_RunDLL "${escapedPath}"`;
            
            console.log('Executing command:', command);
            console.log('File path:', absolutePath);
            console.log('File exists:', fs.existsSync(absolutePath));
            
            // Execute the command directly
            exec(command, {
                windowsVerbatimArguments: false,
                shell: true,
                cwd: path.dirname(absolutePath) // Set working directory to file's directory
            }, (error, stdout, stderr) => {
                if (error) {
                    console.error('Error executing open-with command:', error);
                    console.error('Error code:', error.code);
                    console.error('Error signal:', error.signal);
                }
                if (stdout) {
                    console.log('stdout:', stdout);
                }
                if (stderr) {
                    console.log('stderr:', stderr);
                }
            });
            
            return { success: true };
        } else {
            // For non-Windows, fall back to default app
            await shell.openPath(filePath);
            return { success: true };
        }
    } catch (error) {
        console.error('Error opening file with dialog:', error);
        return { success: false, error: error.message };
    }
});

// Get available drives (Windows only)
ipcMain.handle('get-drives', async () => {
    try {
        if (process.platform !== 'win32') {
            // For non-Windows, return empty array or root paths
            return [];
        }
        
        const drives = [];
        // Check drives A: through Z:
        for (let i = 65; i <= 90; i++) {
            const driveLetter = String.fromCharCode(i);
            const drivePath = `${driveLetter}:\\`;
            
            try {
                // Try to stat the drive root to check if it exists
                // This works even for empty drives (like CD drives without discs)
                const stats = await fs.promises.stat(drivePath);
                if (stats.isDirectory()) {
                    drives.push({
                        letter: driveLetter,
                        path: drivePath,
                        name: `${driveLetter}:`
                    });
                }
            } catch (error) {
                // Drive doesn't exist or isn't accessible, skip it
            }
        }
        
        return drives;
    } catch (error) {
        console.error('Error getting drives:', error);
        return [];
    }
});
