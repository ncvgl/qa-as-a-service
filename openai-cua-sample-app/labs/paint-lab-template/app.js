const palette = {
  blank: {
    color: "#fff9f0",
    label: "White",
  },
  coral: {
    color: "#fb7185",
    label: "Coral",
  },
  gold: {
    color: "#f3b739",
    label: "Gold",
  },
  midnight: {
    color: "#1e293b",
    label: "Midnight",
  },
  sage: {
    color: "#7e9678",
    label: "Sage",
  },
  sky: {
    color: "#73b7f7",
    label: "Sky",
  },
  clay: {
    color: "#c98067",
    label: "Clay",
  },
  teal: {
    color: "#2f8f86",
    label: "Teal",
  },
};

const gridColumns = 12;
const gridRows = 6;

const initialGrid = Array.from({ length: gridRows }, () =>
  Array.from({ length: gridColumns }, () => "blank"),
);

const state = {
  grid: cloneGrid(initialGrid),
  isPointerDown: false,
  savedRecord: null,
  selectedColor: "midnight",
};

const paletteElement = document.querySelector("[data-testid='palette']");
const paintGridElement = document.querySelector("[data-testid='paint-grid']");
const paintStatusElement = document.querySelector("[data-testid='paint-status']");
const saveStatusElement = document.querySelector("[data-testid='save-status']");
const savedChecksumElement = document.querySelector("[data-testid='saved-checksum']");
const savedCellCountElement = document.querySelector("[data-testid='saved-cell-count']");
const saveIndicatorElement = document.querySelector("[data-role='save-indicator']");
const currentColorSwatchElement = document.querySelector("[data-role='current-color-swatch']");
const currentColorNameElement = document.querySelector("[data-role='current-color-name']");
const clearButton = document.querySelector("[data-testid='clear-canvas']");
const saveButton = document.querySelector("[data-testid='save-poster']");

paintGridElement.style.setProperty("--grid-columns", String(gridColumns));
paintGridElement.style.setProperty("--grid-rows", String(gridRows));

function cloneGrid(grid) {
  return JSON.parse(JSON.stringify(grid));
}

function readCanvasGrid() {
  return cloneGrid(state.grid);
}

function readSaveRecord() {
  return state.savedRecord ? { ...state.savedRecord } : null;
}

function computeChecksum(grid) {
  return grid.map((row) => row.join("-")).join("/");
}

function countPaintedCells(grid) {
  return grid.flat().filter((cell) => cell !== "blank").length;
}

function hasSavedCurrentGrid() {
  return state.savedRecord?.checksum === computeChecksum(state.grid);
}

function selectColor(colorId) {
  state.selectedColor = colorId;
  render();
}

function paintCell(rowIndex, columnIndex) {
  state.grid[rowIndex][columnIndex] = state.selectedColor;
  render();
}

function clearCanvas() {
  state.grid = cloneGrid(initialGrid);
  render();
}

function savePoster() {
  state.savedRecord = {
    checksum: computeChecksum(state.grid),
    paintedCellCount: countPaintedCells(state.grid),
  };
  render();
}

function renderPalette() {
  paletteElement.innerHTML = "";

  for (const [colorId, colorMeta] of Object.entries(palette)) {
    const button = document.createElement("button");
    button.className = `paletteButton${state.selectedColor === colorId ? " isSelected" : ""}`;
    button.dataset.testid = `palette-${colorId}`;
    button.type = "button";
    button.innerHTML = `
      <span class="paletteInfo">
        <span class="swatch" style="background:${colorMeta.color}"></span>
        <span class="paletteMeta">
          <span class="paletteName">${colorMeta.label}</span>
        </span>
      </span>
    `;
    button.addEventListener("click", () => selectColor(colorId));
    paletteElement.append(button);
  }
}

function renderGrid(rootElement, grid, { editable }) {
  rootElement.innerHTML = "";

  grid.forEach((row, rowIndex) => {
    row.forEach((colorId, columnIndex) => {
      const cell = document.createElement(editable ? "button" : "div");
      cell.className = "paintCell";
      cell.style.setProperty("--cell-color", palette[colorId].color);

      if (editable) {
        cell.type = "button";
        cell.dataset.testid = `canvas-cell-${rowIndex}-${columnIndex}`;
        cell.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          state.isPointerDown = true;
          paintCell(rowIndex, columnIndex);
        });
        cell.addEventListener("pointerenter", () => {
          if (state.isPointerDown) {
            paintCell(rowIndex, columnIndex);
          }
        });
      }

      rootElement.append(cell);
    });
  });
}

function renderStudioState() {
  const selectedColor = palette[state.selectedColor];
  const savedCurrentGrid = hasSavedCurrentGrid();

  currentColorSwatchElement.style.setProperty("--current-color", selectedColor.color);
  currentColorNameElement.textContent = selectedColor.label;

  saveIndicatorElement.textContent = savedCurrentGrid ? "Saved draft" : "Unsaved changes";
  saveIndicatorElement.classList.toggle("isSaved", savedCurrentGrid);
}

function renderTelemetry() {
  paintStatusElement.textContent = "Canvas ready";

  if (!state.savedRecord) {
    saveStatusElement.textContent = "No artwork saved yet";
    savedChecksumElement.textContent = "none";
    savedCellCountElement.textContent = "0";
    return;
  }

  saveStatusElement.textContent = hasSavedCurrentGrid() ? "Draft saved" : "Draft saved, canvas changed";
  savedChecksumElement.textContent = state.savedRecord.checksum;
  savedCellCountElement.textContent = String(state.savedRecord.paintedCellCount);
}

function render() {
  renderPalette();
  renderGrid(paintGridElement, state.grid, { editable: true });
  renderStudioState();
  renderTelemetry();
}

document.addEventListener("pointerup", () => {
  state.isPointerDown = false;
});

document.addEventListener("pointercancel", () => {
  state.isPointerDown = false;
});

clearButton.addEventListener("click", clearCanvas);
saveButton.addEventListener("click", savePoster);

window.__paintLabReady = true;
window.__paintReplaceGrid = (nextGrid) => {
  state.grid = cloneGrid(nextGrid);
  render();
};
window.__paintReadCanvasGrid = readCanvasGrid;
window.__paintReadSaveRecord = readSaveRecord;
window.__paintSavePoster = savePoster;

render();
