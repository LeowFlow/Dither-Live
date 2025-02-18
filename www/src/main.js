import init, { threshold_dither, floyd_steinberg_dither, ordered_dither } from './pkg/dither_wasm.js';

let originalImageData = null;
const canvas = document.getElementById('demo-canvas');
const ctx = canvas.getContext('2d');

let customPalette = [];

const presetPalettes = [
  { name: 'Original', value: 'original', colors: [] },
  { name: 'Red', value: 'red', colors: ['#ffffff', '#f46842', '#aa2f0d', '#000000'] },
  { name: 'Green', value: 'green', colors: ['#ffffff', '#c4f441', '#6da90c', '#000000'] },
  { name: 'Blue', value: 'blue', colors: ['#ffffff', '#41e2f4', '#0c9fa9', '#000000'] },
  { name: 'Game Boy DMG-01', value: 'gameboy', colors: ['#CADC9F', '#0F380F', '#306230', '#8BAC0F', '#9BBC0F'] },
  { name: 'Black & White', value: 'blackwhite', colors: ['#ffffff', '#000000'] }
];

let activeSwatchIndex = null; 


let panX = 0, panY = 0;
let isPanning = false;
let startPan = { x: 0, y: 0 };

const canvasFrame = document.querySelector('.canvas-frame');

canvasFrame.addEventListener('mousedown', (e) => {
  isPanning = true;
  startPan = { x: e.clientX, y: e.clientY };
});
document.addEventListener('mousemove', (e) => {
  if (!isPanning) return;
  const dx = e.clientX - startPan.x;
  const dy = e.clientY - startPan.y;
  panX += dx;
  panY += dy;
  startPan = { x: e.clientX, y: e.clientY };
  updateCanvasTransform();
});
document.addEventListener('mouseup', () => {
  isPanning = false;
});


function updateCanvasTransform() {
  const zoom = parseFloat(document.getElementById('zoom').value);
  canvas.style.transform = `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px)) scale(${zoom})`;
}

const image = new Image();
image.src = 'src/image.png';
image.onload = () => {
  initCanvas();
};

async function initCanvas() {
  await init();
  canvas.width = image.width;
  canvas.height = image.height;
  ctx.drawImage(image, 0, 0);
  ctx.imageSmoothingEnabled = false;
  originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  setupControls();
  populatePresetDropdown();
  updateCanvas();
}

// scheduler to throttle canvas updates.
let canvasUpdateScheduled = false;
function scheduleCanvasUpdate() {
  if (!canvasUpdateScheduled) {
    canvasUpdateScheduled = true;
    requestAnimationFrame(() => {
      updateCanvas();
      canvasUpdateScheduled = false;
    });
  }
}

function setupControls() {
  const sliders = [
    { id: 'contrast', valueEl: 'contrast-value' },
    { id: 'threshold', valueEl: 'threshold-value' },
    { id: 'gamma', valueEl: 'gamma-value' },
    { id: 'pixelation', valueEl: 'pixelation-value' },
    { id: 'blur', valueEl: 'blur-value' }
  ];
  sliders.forEach(slider => {
    const el = document.getElementById(slider.id);
    const valueEl = document.getElementById(slider.valueEl);
    el.addEventListener('input', () => {
      valueEl.textContent = el.value;
      scheduleCanvasUpdate();
    });
  });
  
  const zoomSlider = document.getElementById('zoom');
  const zoomValueEl = document.getElementById('zoom-value');
  zoomSlider.addEventListener('input', () => {
    zoomValueEl.textContent = zoomSlider.value;
    updateCanvasTransform();
  });
  
  document.getElementById('algorithm').addEventListener('change', scheduleCanvasUpdate);
  document.getElementById('presetPalettes').addEventListener('change', presetPaletteSelected);
  document.getElementById('add-color-btn').addEventListener('click', addNewSwatch);
  document.getElementById('clear-palette-btn').addEventListener('click', clearPalette);
  document.getElementById('export-palette-btn').addEventListener('click', exportPalette);
  document.getElementById('import-palette-btn').addEventListener('click', importPalette);
  document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('modal-remove-btn').addEventListener('click', () => {
    removeSwatch(activeSwatchIndex);
    closeModal();
  });
  document.getElementById('modal-select-btn').addEventListener('click', () => {
    const newColor = document.getElementById('color-picker').value;
    if (activeSwatchIndex !== null) {
      customPalette[activeSwatchIndex] = newColor;
      updatePaletteUI();
      scheduleCanvasUpdate();
    }
    closeModal();
  });
}

function updateCanvas() {
  const newData = new Uint8ClampedArray(originalImageData.data);
  const imageData = new ImageData(newData, originalImageData.width, originalImageData.height);

  const contrast = parseFloat(document.getElementById('contrast').value);
  const threshold = parseInt(document.getElementById('threshold').value);
  const gamma = parseFloat(document.getElementById('gamma').value);
  const pixelation = parseInt(document.getElementById('pixelation').value);
  const blur = parseInt(document.getElementById('blur').value);
  const algorithm = document.getElementById('algorithm').value;

  if (algorithm === "threshold") {
    threshold_dither(imageData.data, imageData.width, imageData.height, threshold, contrast, gamma, pixelation, blur);
  } else if (algorithm === "floyd-steinberg") {
    floyd_steinberg_dither(imageData.data, imageData.width, imageData.height, threshold, contrast, gamma, pixelation, blur);
  } else if (algorithm === "ordered_dither") {
    ordered_dither(imageData.data, imageData.width, imageData.height, threshold, contrast, gamma, pixelation, blur);
  }

  if (customPalette.length > 0) {
    applyCustomPalette(imageData, customPalette);
  }
  ctx.putImageData(imageData, 0, 0);
}

function hexToRgb(hex) {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const num = parseInt(hex, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function applyCustomPalette(imageData, palette) {
  const data = imageData.data;
  const n = palette.length;
  const paletteRGB = palette.map(hex => hexToRgb(hex));
  for (let i = 0; i < data.length; i += 4) {
    const lum = data[i];
    const index = Math.round((lum / 255) * (n - 1));
    const color = paletteRGB[index];
    data[i] = color.r;
    data[i + 1] = color.g;
    data[i + 2] = color.b;
  }
}

function populatePresetDropdown() {
  const select = document.getElementById('presetPalettes');
  select.innerHTML = '';
  presetPalettes.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.value;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
}

function presetPaletteSelected(e) {
  const selected = e.target.value;
  const preset = presetPalettes.find(p => p.value === selected);
  customPalette = (preset && preset.colors.length > 0) ? [...preset.colors] : [];
  updatePaletteUI();
  scheduleCanvasUpdate();
}

function addNewSwatch() {
  customPalette.push('#ffffff');
  updatePaletteUI();
  scheduleCanvasUpdate();
}

function clearPalette() {
  customPalette = [];
  updatePaletteUI();
  scheduleCanvasUpdate();
}

function updatePaletteUI() {
  const container = document.getElementById('palette-container');
  container.innerHTML = '';
  customPalette.forEach((color, index) => {
    const swatch = document.createElement('div');
    swatch.className = 'palette-item';
    swatch.style.backgroundColor = color;
    swatch.addEventListener('click', () => openColorModal(index, color));
    container.appendChild(swatch);
  });
}

function openColorModal(index, color) {
  activeSwatchIndex = index;
  document.getElementById('color-picker').value = color;
  document.getElementById('color-modal').style.display = 'flex';
}

function closeModal() {
  activeSwatchIndex = null;
  document.getElementById('color-modal').style.display = 'none';
}

function exportPalette() {
  const textarea = document.getElementById('palette-textarea');
  textarea.style.display = 'block';
  textarea.value = JSON.stringify(customPalette);
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(customPalette));
  const downloadAnchorNode = document.createElement('a');
  downloadAnchorNode.setAttribute("href", dataStr);
  downloadAnchorNode.setAttribute("download", "palette.json");
  document.body.appendChild(downloadAnchorNode);
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
  setTimeout(() => { textarea.style.display = 'none'; }, 3000);
}

function importPalette() {
  const input = prompt("Paste your palette JSON here:");
  if (input) {
    try {
      const imported = JSON.parse(input);
      if (Array.isArray(imported)) {
        customPalette = imported;
        updatePaletteUI();
        scheduleCanvasUpdate();
      } else {
        alert("Invalid palette format.");
      }
    } catch (e) {
      alert("Error parsing palette JSON.");
    }
  }
}
