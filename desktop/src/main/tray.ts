import { Tray, BrowserWindow, Menu, app, nativeImage, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DROPDOWN_WIDTH = 340;
const DEFAULT_DROPDOWN_HEIGHT = 540;
const MIN_DROPDOWN_HEIGHT = 420;
const DROPDOWN_VERTICAL_OFFSET = 4;

let tray: Tray | null = null;
let dropdownWindow: BrowserWindow | null = null;
let idleIcon: Electron.NativeImage | null = null;
let runningIcon: Electron.NativeImage | null = null;

function loadTemplateIcon(filename: string): Electron.NativeImage {
  const iconPath = path.join(__dirname, '..', '..', 'src', 'assets', filename);
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  return icon;
}

function drawBadge(bitmap: Buffer, width: number, height: number): void {
  const radius = Math.max(2, Math.round(Math.min(width, height) * 0.14));
  const centerX = width - radius - Math.max(2, Math.round(width * 0.14));
  const centerY = height - radius - Math.max(2, Math.round(height * 0.18));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if ((dx * dx) + (dy * dy) > radius * radius) continue;

      const offset = ((y * width) + x) * 4;
      bitmap[offset] = 255;
      bitmap[offset + 1] = 255;
      bitmap[offset + 2] = 255;
      bitmap[offset + 3] = 255;
    }
  }
}

function createRunningTemplateIcon(baseIcon: Electron.NativeImage): Electron.NativeImage {
  const icon = nativeImage.createEmpty();

  for (const scaleFactor of baseIcon.getScaleFactors()) {
    const { width, height } = baseIcon.getSize(scaleFactor);
    const bitmap = Buffer.from(baseIcon.toBitmap({ scaleFactor }));
    drawBadge(bitmap, width, height);
    icon.addRepresentation({ scaleFactor, width, height, buffer: bitmap });
  }

  icon.setTemplateImage(true);
  return icon;
}

function getDropdownMetrics(height = dropdownWindow?.getBounds().height ?? DEFAULT_DROPDOWN_HEIGHT): {
  x: number;
  y: number;
  height: number;
} | null {
  if (!tray) return null;

  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const y = Math.round(trayBounds.y + trayBounds.height + DROPDOWN_VERTICAL_OFFSET);
  const availableHeight = display.workArea.y + display.workArea.height - y - 8;
  const preferredHeight = Math.max(MIN_DROPDOWN_HEIGHT, Math.ceil(height));
  const clampedHeight = Math.min(preferredHeight, Math.max(260, availableHeight));
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - DROPDOWN_WIDTH / 2);
  const clampedX = Math.max(
    display.workArea.x,
    Math.min(x, display.workArea.x + display.workArea.width - DROPDOWN_WIDTH),
  );

  return { x: clampedX, y, height: clampedHeight };
}

/** Create the system tray icon and dropdown window. */
export function createTray(): { tray: Tray; window: BrowserWindow } {
  // Load template images (macOS auto-adapts for dark/light menu bar)
  try {
    idleIcon = loadTemplateIcon('tray-icon.png');
    runningIcon = createRunningTemplateIcon(idleIcon);
  } catch {
    idleIcon = nativeImage.createEmpty();
    runningIcon = idleIcon;
  }

  tray = new Tray(idleIcon);
  tray.setToolTip('ClawFace Gateway');

  // Create the dropdown BrowserWindow (hidden initially)
  dropdownWindow = new BrowserWindow({
    width: DROPDOWN_WIDTH,
    height: DEFAULT_DROPDOWN_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'src', 'main', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const htmlPath = path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html');
  dropdownWindow.loadFile(htmlPath);

  // Click tray → toggle dropdown
  tray.on('click', () => toggleDropdown());

  // Right-click → context menu
  tray.on('right-click', () => showContextMenu());

  // Hide on blur
  dropdownWindow.on('blur', () => {
    dropdownWindow?.hide();
  });

  return { tray, window: dropdownWindow };
}

/** Toggle the dropdown window visibility, positioned below the tray icon. */
function toggleDropdown(): void {
  if (!dropdownWindow || !tray) return;

  if (dropdownWindow.isVisible()) {
    dropdownWindow.hide();
    return;
  }

  const metrics = getDropdownMetrics();
  if (!metrics) return;

  dropdownWindow.setBounds({
    x: metrics.x,
    y: metrics.y,
    width: DROPDOWN_WIDTH,
    height: metrics.height,
  }, false);
  dropdownWindow.show();
  dropdownWindow.focus();
}

/** Show the right-click context menu. */
function showContextMenu(): void {
  const contextMenu = Menu.buildFromTemplate([
    { label: 'ClawFace Gateway', enabled: false },
    { type: 'separator' },
    {
      label: 'Start at Login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);

  tray?.popUpContextMenu(contextMenu);
}

/** Reflect OpenClaw service state in the menu bar icon and tooltip. */
export function updateTrayState(isRunning: boolean): void {
  if (!tray) return;
  tray.setImage(isRunning ? (runningIcon ?? idleIcon ?? nativeImage.createEmpty()) : (idleIcon ?? nativeImage.createEmpty()));
  tray.setToolTip(isRunning ? 'ClawFace Gateway — OpenClaw Running' : 'ClawFace Gateway — OpenClaw Stopped');
}

/** Resize the dropdown to fit its rendered content without forcing page scrollbars. */
export function resizeDropdown(contentHeight: number): void {
  if (!dropdownWindow) return;

  const nextHeight = Math.max(MIN_DROPDOWN_HEIGHT, Math.ceil(contentHeight));
  const metrics = getDropdownMetrics(nextHeight);
  if (!metrics) return;

  const currentBounds = dropdownWindow.getBounds();
  if (currentBounds.height === metrics.height && currentBounds.x === metrics.x && currentBounds.y === metrics.y) {
    return;
  }

  dropdownWindow.setBounds({
    x: metrics.x,
    y: metrics.y,
    width: DROPDOWN_WIDTH,
    height: metrics.height,
  }, false);
}

/** Get the dropdown BrowserWindow for IPC communication. */
export function getDropdownWindow(): BrowserWindow | null {
  return dropdownWindow;
}
