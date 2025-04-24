import init, { apply_dither } from './pkg/dither_wasm.js';

const MAX_FILE_SIZE = 20 * 1024 * 1024;          // 20MB limit
const OUTPUT_SIZE_THRESHOLD = 4000000;             // 4,000,000 pixels (for some output functions)
const OPTIMAL_PIXEL_COUNT = 3000000;               // Prompt downscaling if total pixels > 3,000,000

let originalImageData = null;
const canvas = document.getElementById('demo-canvas');
const ctx = canvas.getContext('2d');

let panX = 0, panY = 0;
let isPanning = false;
let startPan = { x: 0, y: 0 };
let livePreview = true;

const canvasFrame = document.querySelector('.canvas-frame');
canvasFrame.addEventListener('mousedown', function(e) {
  isPanning = true;
  startPan = { x: e.clientX, y: e.clientY };
});
document.addEventListener('mousemove', function(e) {
  if (!isPanning) return;
  const dx = e.clientX - startPan.x;
  const dy = e.clientY - startPan.y;
  panX += dx;
  panY += dy;
  startPan = { x: e.clientX, y: e.clientY };
  updateCanvasTransform();
});
document.addEventListener('mouseup', function() {
  isPanning = false;
});

function updateCanvasTransform() {
  const zoom = parseFloat(document.getElementById('zoom').value);
  canvas.style.transform = 'translate(calc(-50% + ' + panX + 'px), calc(-50% + ' + panY + 'px)) scale(' + zoom + ')';
}

function toggleLivePreview() {
  livePreview = !livePreview;
  const btn = document.getElementById('toggle-preview-btn');
  const icon = btn.querySelector('i');
  
  // Update icon classes (using Font Awesome classes)
  if (livePreview) {
    icon.classList.remove('fa-play');
    icon.classList.add('fa-pause');
  } else {
    icon.classList.remove('fa-pause');
    icon.classList.add('fa-play');
  }
  
  // Add animation class for a brief pulse effect
  btn.classList.add('toggle-animation');
  setTimeout(() => {
    btn.classList.remove('toggle-animation');
  }, 300); // Duration of animation in ms
}


function updateZoomRange() {
  const zoomSlider = document.getElementById('zoom');
  const MIN_ZOOM = 0.1;
  zoomSlider.min = MIN_ZOOM;
  let currentZoom = parseFloat(zoomSlider.value);
  if (currentZoom < MIN_ZOOM) {
    currentZoom = MIN_ZOOM;
    zoomSlider.value = MIN_ZOOM;
    document.getElementById('zoom-value').textContent = MIN_ZOOM.toFixed(2);
  }
  updateCanvasTransform();
}

window.addEventListener('beforeunload', function(e) {
  e.preventDefault();
});

let rotationAngle = 0;
let invertImage = false;
let aspectRatio = 1;
let isUpdatingDimension = false;
const image = new Image();
image.src = '/image.png';

function showNotification(message) {
  return new Promise(function(resolve) {
    const modal = document.getElementById('notification-modal');
    const msgElem = document.getElementById('notification-message');
    msgElem.textContent = message;
    modal.style.display = 'flex';
    const okBtn = document.getElementById('notification-ok-btn');
    function cleanup() {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
    }
    function onOk() {
      cleanup();
      resolve();
    }
    okBtn.addEventListener('click', onOk);
  });
}

function showDownscaleModal(customText) {
  return new Promise(function(resolve) {
    if (localStorage.getItem('suppressDownscaleWarning') === 'true') {
      resolve(false);
      return;
    }
    const modal = document.getElementById('downscale-warning-modal');
    modal.querySelector('p').textContent = customText || "The output dimensions are large and might cause performance issues. Would you like to automatically downscale the image?";
    modal.style.display = 'flex';
    const yesBtn = document.getElementById('downscale-yes-btn');
    const noBtn = document.getElementById('downscale-no-btn');
    const checkbox = document.getElementById('suppress-downscale-warning-checkbox');

    function cleanup() {
      modal.style.display = 'none';
      yesBtn.removeEventListener('click', onYes);
      noBtn.removeEventListener('click', onNo);
    }
    function onYes() {
      if (checkbox.checked) {
        localStorage.setItem('suppressDownscaleWarning', 'true');
      }
      cleanup();
      resolve(true);
    }
    function onNo() {
      if (checkbox.checked) {
        localStorage.setItem('suppressDownscaleWarning', 'true');
      }
      cleanup();
      resolve(false);
    }
    yesBtn.addEventListener('click', onYes);
    noBtn.addEventListener('click', onNo);
  });
}

document.addEventListener('DOMContentLoaded', function() {
  // Force default algorithm to "jarvis" on every page load
  const algorithmElement = document.getElementById('algorithm');
  algorithmElement.value = 'jarvis';
  
  setupControls();
  setupDimensionLock();
  initLogoPreview();
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) {
    document.body.setAttribute('data-theme', savedTheme);
  }
  document.getElementById('toggle-preview-btn').addEventListener('click', toggleLivePreview);

  document.addEventListener('keydown', function(e) {
    if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].indexOf(document.activeElement.tagName) !== -1) {
      return;
    }
    if (
      document.getElementById('help-modal').style.display !== 'none' ||
      document.getElementById('large-dim-warning-modal').style.display !== 'none'
    ) {
      if (e.key !== 'Escape') return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      document.getElementById('export-image-btn').click();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      document.getElementById('file-input').click();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      const zoomSlider = document.getElementById('zoom');
      zoomSlider.stepUp();
      zoomSlider.dispatchEvent(new Event('input'));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
      e.preventDefault();
      const zoomSlider = document.getElementById('zoom');
      zoomSlider.stepDown();
      zoomSlider.dispatchEvent(new Event('input'));
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      document.getElementById('rotate-left-btn').click();
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      document.getElementById('rotate-right-btn').click();
      return;
    }
    if (e.key.toLowerCase() === 'p') {
      toggleLivePreview();
      return;
    }
    if (e.key.toLowerCase() === 'i') {
      document.getElementById('invert-image-checkbox').click();
      return;
    }
    if (e.key.toLowerCase() === 'r') {
      const resetBtn = document.getElementById('reset-controls-btn');
      if (resetBtn) resetBtn.click();
      return;
    }
    if (e.key.toLowerCase() === 'd') {
      const currentTheme = document.body.getAttribute('data-theme') || 'light';
      const newTheme = (currentTheme === 'dark') ? 'light' : 'dark';
      document.body.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
      return;
    }
    if (e.key === 'Escape') {
      const modals = document.querySelectorAll('.modal');
      modals.forEach(function(modal) {
        if (modal.style.display !== 'none') {
          modal.style.display = 'none';
        }
      });
      return;
    }
  });
  
  const outputWidthInput = document.getElementById('output-width');
  const outputHeightInput = document.getElementById('output-height');
  [outputWidthInput, outputHeightInput].forEach(function(input) {
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') applyOutputSize();
    });
    input.addEventListener('focus', function() {
      input.select();
    });
  });

  async function initLogoPreview() {
    await init();
    const logoCanvas = document.getElementById('logo-canvas');
    const ctx = logoCanvas.getContext('2d');
    const logoImg = new Image();
    logoImg.src = '/logo.png';
    logoImg.onload = function() {
      logoCanvas.width = logoImg.width;
      logoCanvas.height = logoImg.height;
      updateLogoPreview('jarvis');
    };
    function updateLogoPreview(algorithm) {
      ctx.drawImage(logoImg, 0, 0, logoCanvas.width, logoCanvas.height);
      let imageData = ctx.getImageData(0, 0, logoCanvas.width, logoCanvas.height);
      const threshold = 100;
      const contrast = 200;
      const gamma = 1;
      const pixelation = 0;
      const blur = 0;
      const blockScale = 9;
      const bayerWidth = 4;
      const bayerHeight = 4;
      apply_dither(
        algorithm,
        imageData.data,
        imageData.width,
        imageData.height,
        threshold,
        contrast,
        gamma,
        pixelation,
        blur,
        blockScale,
        bayerWidth,
        bayerHeight
      );
      ctx.putImageData(imageData, 0, 0);
    }
    document.querySelectorAll('.custom-option').forEach(function(option) {
      option.addEventListener('mouseenter', function() {
        const algo = option.getAttribute('data-value');
        updateLogoPreview(algo);
        if (!option.classList.contains('selected')) {
          flashPreview();
        }
      });
      option.addEventListener('mouseleave', function() {
        const selectedOption = document.querySelector('.custom-option.selected');
        const algo = selectedOption ? selectedOption.getAttribute('data-value') : 'jarvis';
        updateLogoPreview(algo);
      });
      option.addEventListener('click', function() {
        document.querySelectorAll('.custom-option').forEach(function(opt) {
          opt.classList.remove('selected');
        });
        option.classList.add('selected');
        const algo = option.getAttribute('data-value');
        document.getElementById('algorithm').value = algo;
        document.querySelector('.custom-select .selected-option').textContent = option.textContent;
        updateLogoPreview(algo);
      });
    });
  }
  
  image.onload = async function() {
    let newWidth = image.naturalWidth;
    let newHeight = image.naturalHeight;
    const totalPixels = newWidth * newHeight;
    if (totalPixels > OPTIMAL_PIXEL_COUNT) {
      const downscale = await showDownscaleModal("This image has " + totalPixels.toLocaleString() + " pixels. Downscale?");
      if (downscale) {
        const scaleFactor = Math.sqrt(OPTIMAL_PIXEL_COUNT / totalPixels);
        newWidth = Math.floor(newWidth * scaleFactor);
        newHeight = Math.floor(newHeight * scaleFactor);
        await showNotification("Image has been downscaled to " + newWidth + "×" + newHeight);
      } else {
        await showNotification("Proceeding with original dimensions; performance may be affected.");
      }
    }
    document.getElementById('output-width').value = newWidth;
    document.getElementById('output-height').value = newHeight;
    aspectRatio = newWidth / newHeight;
    initCanvas();
    updateSliderAvailability();
  };
  
  document.getElementById('help-btn').addEventListener('click', function() {
    document.getElementById('help-modal').style.display = 'flex';
  });
  document.getElementById('help-close-btn').addEventListener('click', function() {
    document.getElementById('help-modal').style.display = 'none';
  });
  
  const dragOverlay = createDragOverlay();
  let dragCounter = 0;
  document.addEventListener('dragenter', function(e) {
    e.preventDefault();
    dragCounter++;
    dragOverlay.style.display = 'flex';
  });
  document.addEventListener('dragleave', function(e) {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) dragOverlay.style.display = 'none';
  });
  document.addEventListener('dragover', function(e) {
    e.preventDefault();
  });
  document.addEventListener('drop', function(e) {
    e.preventDefault();
    dragCounter = 0;
    dragOverlay.style.display = 'none';
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = function(event) {
          image.src = event.target.result;
          image.onload = async function() {
            let newWidth = image.naturalWidth;
            let newHeight = image.naturalHeight;
            const totalPixels = newWidth * newHeight;
            if (totalPixels > OPTIMAL_PIXEL_COUNT) {
              const downscale = await showDownscaleModal("This image has " + totalPixels.toLocaleString() + " pixels. Downscale?");
              if (downscale) {
                const scaleFactor = Math.sqrt(OPTIMAL_PIXEL_COUNT / totalPixels);
                newWidth = Math.floor(newWidth * scaleFactor);
                newHeight = Math.floor(newHeight * scaleFactor);
                await showNotification("Image has been downscaled to " + newWidth + "×" + newHeight);
              } else {
                await showNotification("Proceeding with original dimensions; performance may be affected.");
              }
            }
            document.getElementById('output-width').value = newWidth;
            document.getElementById('output-height').value = newHeight;
            aspectRatio = newWidth / newHeight;
            initCanvas();
            updateSliderAvailability();
          };
        };
        reader.readAsDataURL(file);
      } else {
        showNotification('Please drop an image file.');
      }
    }
  });
  
  function createDragOverlay() {
    let overlay = document.getElementById('drag-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'drag-overlay';
      overlay.className = 'drag-overlay';
      overlay.innerHTML = '<div class="drag-overlay-content"><i class="fas fa-expand"></i><p>Drag and drop your image!</p></div>';
      overlay.style.display = 'none';
      document.body.appendChild(overlay);
    }
    return overlay;
  }
});

async function initCanvas() {
  await init();
  const defaultWidth = image.naturalWidth;
  const defaultHeight = image.naturalHeight;
  let outputWidth = parseInt(document.getElementById('output-width').value) || defaultWidth;
  let outputHeight = parseInt(document.getElementById('output-height').value) || defaultHeight;
  outputWidth = Math.max(outputWidth, 1);
  outputHeight = Math.max(outputHeight, 1);
  document.getElementById('output-width').value = outputWidth;
  document.getElementById('output-height').value = outputHeight;
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  ctx.drawImage(image, 0, 0, outputWidth, outputHeight);
  ctx.imageSmoothingEnabled = false;
  originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  updateCanvas();
  updateZoomRange();
  const zoomSlider = document.getElementById('zoom');
  const MIN_ZOOM = 0.1;
  zoomSlider.value = Math.max(parseFloat(zoomSlider.value), MIN_ZOOM);
  zoomSlider.value = 0.70;
  document.getElementById('zoom-value').textContent = parseFloat(zoomSlider.value).toFixed(2);
  panX = -200;
  panY = -60;
  updateCanvasTransform();
}

document.getElementById('file-input').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > MAX_FILE_SIZE) {
    showNotification("File is too large! Please select a file <= 20MB.");
    e.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = function(ev) {
    image.src = ev.target.result;
    image.onload = async function() {
      let newWidth = image.naturalWidth;
      let newHeight = image.naturalHeight;
      const totalPixels = newWidth * newHeight;
      if (totalPixels > OPTIMAL_PIXEL_COUNT) {
        const downscale = await showDownscaleModal("This image has " + totalPixels.toLocaleString() + " pixels which exceeds our optimal threshold. Downscale?");
        if (downscale) {
          const scaleFactor = Math.sqrt(OPTIMAL_PIXEL_COUNT / totalPixels);
          newWidth = Math.floor(newWidth * scaleFactor);
          newHeight = Math.floor(newHeight * scaleFactor);
          await showNotification("Image has been downscaled to " + newWidth + "×" + newHeight);
        } else {
          await showNotification("Proceeding with original dimensions; performance may be affected.");
        }
      }
      document.getElementById('output-width').value = newWidth;
      document.getElementById('output-height').value = newHeight;
      aspectRatio = newWidth / newHeight;
      initCanvas();
      updateSliderAvailability();
    };
  };
  reader.readAsDataURL(file);
});

async function scaleOutputSize(factor) {
  if (!image.naturalWidth || !image.naturalHeight) return;
  let newWidth = image.naturalWidth * factor;
  let newHeight = image.naturalHeight * factor;
  if (newWidth * newHeight > OUTPUT_SIZE_THRESHOLD) {
    const downscale = await showDownscaleModal();
    if (downscale) {
      const scaleFactor = Math.sqrt(OUTPUT_SIZE_THRESHOLD / (newWidth * newHeight));
      newWidth = Math.floor(newWidth * scaleFactor);
      newHeight = Math.floor(newHeight * scaleFactor);
      await showNotification("Output dimensions have been downscaled to " + newWidth + "×" + newHeight);
    } else {
      await showNotification("Proceeding with large dimensions; performance may be affected.");
    }
  }
  document.getElementById('output-width').value = newWidth;
  document.getElementById('output-height').value = newHeight;
  canvas.width = newWidth;
  canvas.height = newHeight;
  ctx.drawImage(image, 0, 0, newWidth, newHeight);
  ctx.imageSmoothingEnabled = false;
  originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  scheduleCanvasUpdate();
  updateZoomRange();
}

document.getElementById('scale-x1-btn').addEventListener('click', async function() {
  await scaleOutputSize(0.5);
});
document.getElementById('scale-x2-btn').addEventListener('click', async function() {
  await scaleOutputSize(1);
});
document.getElementById('scale-x3-btn').addEventListener('click', async function() {
  await scaleOutputSize(2);
});


async function applyOutputSize() {
  let newWidth = parseInt(document.getElementById('output-width').value);
  let newHeight = parseInt(document.getElementById('output-height').value);
  if (newWidth > 0 && newHeight > 0) {
    if (newWidth * newHeight > OUTPUT_SIZE_THRESHOLD) {
      const downscale = await showDownscaleModal();
      if (downscale) {
         const scaleFactor = Math.sqrt(OUTPUT_SIZE_THRESHOLD / (newWidth * newHeight));
         newWidth = Math.floor(newWidth * scaleFactor);
         newHeight = Math.floor(newHeight * scaleFactor);
         await showNotification("Output dimensions have been downscaled to " + newWidth + "×" + newHeight);
         document.getElementById('output-width').value = newWidth;
         document.getElementById('output-height').value = newHeight;
      } else {
         await showNotification("Proceeding with large dimensions; performance may be affected.");
      }
    }
    canvas.width = newWidth;
    canvas.height = newHeight;
    ctx.drawImage(image, 0, 0, newWidth, newHeight);
    ctx.imageSmoothingEnabled = false;
    originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    scheduleCanvasUpdate();
    updateZoomRange();
  } else {
    await showNotification("Please enter valid output dimensions.");
  }
}

document.getElementById('apply-output-size-btn').addEventListener('click', async function() {
  await applyOutputSize();
});

let canvasUpdateScheduled = false;
function scheduleCanvasUpdate() {
  if (!canvasUpdateScheduled) {
    canvasUpdateScheduled = true;
    requestAnimationFrame(function() {
      updateCanvas();
      canvasUpdateScheduled = false;
    });
  }
}

function setupControls() {
  document.getElementById('contrast').value = 131;
  document.getElementById('threshold').value = 124;
  document.getElementById('gamma').value = 0.9;
  document.getElementById('pixelation').value = 5;
  document.getElementById('blur').value = 0;
  document.getElementById('block-scale').value = 5;
  document.getElementById('invert-image-checkbox').checked = false;
  invertImage = false;

  const sliderConfigs = [
    { id: 'contrast', valueEl: 'contrast-value' },
    { id: 'threshold', valueEl: 'threshold-value' },
    { id: 'gamma', valueEl: 'gamma-value' },
    { id: 'pixelation', valueEl: 'pixelation-value' },
    { id: 'blur', valueEl: 'blur-value' },
    { id: 'block-scale', valueEl: 'block-scale-value' }
  ];

  sliderConfigs.forEach(function(config) {
    const slider = document.getElementById(config.id);
    const valueEl = document.getElementById(config.valueEl);
    valueEl.textContent = slider.value;
    slider.addEventListener('input', function() {
      valueEl.textContent = slider.value;
      // Use livePreview state to determine if we update the canvas
      if (livePreview) {
        scheduleCanvasUpdate();
      }
    });
    slider.addEventListener('change', function() {
      scheduleCanvasUpdate();
      document.getElementById('demo-canvas').focus();
    });
  });

  const zoomSlider = document.getElementById('zoom');
  const zoomValueEl = document.getElementById('zoom-value');
  function updateZoom() {
    let zoom = parseFloat(zoomSlider.value);
    zoom = Math.round(zoom * 100) / 100;
    zoomValueEl.textContent = zoom.toFixed(2);
    updateCanvasTransform();
  }
  zoomSlider.addEventListener('input', updateZoom);

  document.getElementById('algorithm').addEventListener('change', function() {
    updateSliderAvailability();
    scheduleCanvasUpdate();
    document.getElementById('demo-canvas').focus();
  });

  document.getElementById('rotate-left-btn').addEventListener('click', function() {
    rotationAngle = (rotationAngle - 90) % 360;
    scheduleCanvasUpdate();
  });
  document.getElementById('rotate-right-btn').addEventListener('click', function() {
    rotationAngle = (rotationAngle + 90) % 360;
    scheduleCanvasUpdate();
  });

  const invertCheckbox = document.getElementById('invert-image-checkbox');
  invertCheckbox.addEventListener('change', function() {
    invertImage = invertCheckbox.checked;
    scheduleCanvasUpdate();
  });

  document.getElementById('export-image-btn').addEventListener('click', function() {
    canvas.toBlob(function(blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dither-live.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  });

  const resetBtn = document.getElementById('reset-controls-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', function() {
      document.getElementById('contrast').value = 131;
      document.getElementById('threshold').value = 124;
      document.getElementById('gamma').value = 0.9;
      document.getElementById('pixelation').value = 5;
      document.getElementById('blur').value = 0;
      document.getElementById('block-scale').value = 5;
      invertCheckbox.checked = false;
      invertImage = false;
      sliderConfigs.forEach(function(config) {
        const slider = document.getElementById(config.id);
        const valueEl = document.getElementById(config.valueEl);
        valueEl.textContent = slider.value;
      });
      // Reset custom Bayer controls to default (4)
      document.querySelector('#custom-bayer-width .number-display').textContent = "4";
      document.querySelector('#custom-bayer-height .number-display').textContent = "4";
      scheduleCanvasUpdate();
    });
  }
  
  // --- Set up custom UI for Bayer matrix selectors ---
  function setupCustomBayerInput(id) {
    const container = document.getElementById(id);
    const decrementBtn = container.querySelector('.decrement');
    const incrementBtn = container.querySelector('.increment');
    const display = container.querySelector('.number-display');
    const min = parseInt(container.getAttribute('data-min')) || 1;
    const max = parseInt(container.getAttribute('data-max')) || 8;
    
    decrementBtn.addEventListener('click', function() {
      let current = parseInt(display.textContent) || min;
      if (current > min) {
        display.textContent = current - 1;
        scheduleCanvasUpdate();
      }
    });
    incrementBtn.addEventListener('click', function() {
      let current = parseInt(display.textContent) || min;
      if (current < max) {
        display.textContent = current + 1;
        scheduleCanvasUpdate();
      }
    });
    display.addEventListener('blur', function() {
      let current = parseInt(display.textContent);
      if (isNaN(current) || current < min) {
        current = min;
      }
      if (current > max) {
        current = max;
      }
      display.textContent = current;
      scheduleCanvasUpdate();
    });
    display.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        display.blur();
      }
    });
  }
  
  setupCustomBayerInput('custom-bayer-width');
  setupCustomBayerInput('custom-bayer-height');
  
  // End of setupControls()
}

function updateSliderAvailability() {
  const algorithm = document.getElementById('algorithm').value;
  const thresholdSlider = document.getElementById('threshold');
  const scaleSlider = document.getElementById('block-scale');
  thresholdSlider.disabled = (algorithm === 'bayer' ||
                              algorithm === 'sierra' ||
                              algorithm === 'sierra-two-row' ||
                              algorithm === 'sierra-lite');
  scaleSlider.disabled = (algorithm === 'threshold');
  const bayerControls = document.querySelector('.bayer-options');
  if (bayerControls) {
    bayerControls.style.display = (algorithm === 'bayer') ? 'block' : 'none';
  }
}

function setupDimensionLock() {
  const outputWidthInput = document.getElementById('output-width');
  const outputHeightInput = document.getElementById('output-height');
  const lockAspectCheckbox = document.getElementById('lock-aspect-checkbox');
  outputWidthInput.addEventListener('input', function() {
    if (lockAspectCheckbox.checked && !isUpdatingDimension) {
      isUpdatingDimension = true;
      const newWidth = parseFloat(outputWidthInput.value);
      const newHeight = Math.round(newWidth / aspectRatio);
      outputHeightInput.value = newHeight;
      isUpdatingDimension = false;
    }
  });
  outputHeightInput.addEventListener('input', function() {
    if (lockAspectCheckbox.checked && !isUpdatingDimension) {
      isUpdatingDimension = true;
      const newHeight = parseFloat(outputHeightInput.value);
      const newWidth = Math.round(newHeight * aspectRatio);
      outputWidthInput.value = newWidth;
      isUpdatingDimension = false;
    }
  });
}

const customSelectWrappers = document.querySelectorAll('.custom-select-wrapper');
customSelectWrappers.forEach(function(wrapper) {
  const selectBox = wrapper.querySelector('.custom-select');
  const optionsList = wrapper.querySelector('.custom-options');
  const options = wrapper.querySelectorAll('.custom-option');
  const hiddenInput = wrapper.querySelector('input[type="hidden"]');
  selectBox.addEventListener('click', function() {
    wrapper.classList.toggle('open');
    selectBox.classList.toggle('active');
  });
  document.addEventListener('click', function(e) {
    if (!wrapper.contains(e.target)) {
      wrapper.classList.remove('open');
      selectBox.classList.remove('active');
    }
  });
  options.forEach(function(option) {
    option.addEventListener('click', function() {
      options.forEach(function(opt) { opt.classList.remove('selected'); });
      option.classList.add('selected');
      const selectedText = option.textContent;
      wrapper.querySelector('.selected-option').textContent = selectedText;
      const selectedValue = option.getAttribute('data-value');
      hiddenInput.value = selectedValue;
      wrapper.classList.remove('open');
      selectBox.classList.remove('active');
      const changeEvent = new Event('change', { bubbles: true });
      hiddenInput.dispatchEvent(changeEvent);
    });
  });
  selectBox.addEventListener('keydown', function(e) {
    const currentIndex = Array.from(options).findIndex(function(opt) {
      return opt.classList.contains('selected');
    });
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      let nextIndex = (currentIndex + 1) % options.length;
      options[nextIndex].click();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      let prevIndex = (currentIndex - 1 + options.length) % options.length;
      options[prevIndex].click();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      wrapper.classList.toggle('open');
      selectBox.classList.toggle('active');
    } else if (e.key === 'Escape') {
      wrapper.classList.remove('open');
      selectBox.classList.remove('active');
    }
  });
});

function updateCanvas() {
  if (!originalImageData) return;
  const newData = new Uint8ClampedArray(originalImageData.data);
  let imageData = new ImageData(newData, originalImageData.width, originalImageData.height);
  const contrast = parseFloat(document.getElementById('contrast').value);
  const threshold = parseInt(document.getElementById('threshold').value);
  const gamma = parseFloat(document.getElementById('gamma').value);
  const pixelation = parseInt(document.getElementById('pixelation').value);
  const blur = parseInt(document.getElementById('blur').value);
  const algorithm = document.getElementById('algorithm').value;
  const blockScale = parseInt(document.getElementById('block-scale').value) || 1;
  
  if (algorithm === 'bayer') {
    const bayerWidth = parseInt(document.querySelector('#custom-bayer-width .number-display').textContent) || 4;
    const bayerHeight = parseInt(document.querySelector('#custom-bayer-height .number-display').textContent) || 4;
    apply_dither(
      algorithm,
      imageData.data,
      imageData.width,
      imageData.height,
      threshold,
      contrast,
      gamma,
      pixelation,
      blur,
      blockScale,
      bayerWidth,
      bayerHeight
    );
  } else {
    apply_dither(
      algorithm,
      imageData.data,
      imageData.width,
      imageData.height,
      threshold,
      contrast,
      gamma,
      pixelation,
      blur,
      blockScale
    );
  }
  if (invertImage) {
    for (let i = 0; i < imageData.data.length; i += 4) {
      imageData.data[i] = 255 - imageData.data[i];
      imageData.data[i + 1] = 255 - imageData.data[i + 1];
      imageData.data[i + 2] = 255 - imageData.data[i + 2];
    }
  }
  let angle = rotationAngle % 360;
  if (angle < 0) angle += 360;
  const w = imageData.width;
  const h = imageData.height;
  let rotatedWidth = w;
  let rotatedHeight = h;
  if (angle === 90 || angle === 270) {
    rotatedWidth = h;
    rotatedHeight = w;
  }
  const offscreen = document.createElement('canvas');
  offscreen.width = rotatedWidth;
  offscreen.height = rotatedHeight;
  const offCtx = offscreen.getContext('2d');
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = w;
  tempCanvas.height = h;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.putImageData(imageData, 0, 0);
  offCtx.save();
  offCtx.translate(rotatedWidth / 2, rotatedHeight / 2);
  offCtx.rotate(angle * Math.PI / 180);
  offCtx.drawImage(tempCanvas, -w / 2, -h / 2);
  offCtx.restore();
  canvas.width = rotatedWidth;
  canvas.height = rotatedHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(offscreen, 0, 0);
  document.getElementById('output-width').value = rotatedWidth;
  document.getElementById('output-height').value = rotatedHeight;
  aspectRatio = rotatedWidth / rotatedHeight;
}

window.addEventListener('resize', updateZoomRange);
