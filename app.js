// ==================================================
// BarePDF - app.js (Final with Cancel Support + Fade-in)
// ==================================================

let addingMoreFiles = false;

let pdfFiles = [];
let pdfDoc = null;
let currentFile = null;
let applyAggressiveCompression = false;
let currentPageIndex = 0;
const PAGES_PER_VIEW = 12;
let cancelOperation = false;

// DOM
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const modal = document.getElementById("modal");
const mergeModal = document.getElementById("mergeModal");
const infoModal = document.getElementById("infoModal");
const thumbs = document.getElementById("thumbs");
const tooltip = document.getElementById("tooltip");

// Overlay (progress + cancel)
function createOverlay() {
  let overlay = document.getElementById("progressOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "progressOverlay";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.8)",
      color: "#e7e7e7",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "Inter, sans-serif",
      fontSize: "1.1rem",
      zIndex: 999,
      opacity: 0,
      transition: "opacity 0.3s ease"
    });
    overlay.innerHTML = `
      <div id="progressText" style="margin-bottom:1rem;">Processing...</div>
      <button id="cancelOperation" style="background:#6ab3b1;color:#0f0f0f;border:none;padding:.6rem 1.2rem;border-radius:6px;font-weight:600;cursor:pointer;">Cancel</button>
    `;
    document.body.appendChild(overlay);
  }
  return overlay;
}
function showProgress(msg = "Processing...") {
  cancelOperation = false;
  const overlay = createOverlay();
  overlay.querySelector("#progressText").textContent = msg;
  overlay.style.opacity = 1;
  overlay.querySelector("#cancelOperation").onclick = () => {
    cancelOperation = true;
    overlay.querySelector("#progressText").textContent = "Cancelling...";
  };
}
function updateProgress(msg) {
  const overlay = document.getElementById("progressOverlay");
  if (overlay) overlay.querySelector("#progressText").textContent = msg;
}
function hideProgress() {
  const overlay = document.getElementById("progressOverlay");
  if (overlay) {
    overlay.style.opacity = 0;
    setTimeout(() => overlay.remove(), 500);
  }
}

// Dropzone
dropzone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", e => handleFiles(e.target.files));
dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("hover"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("hover"));
dropzone.addEventListener("drop", e => {
  e.preventDefault();
  dropzone.classList.remove("hover");
  handleFiles(e.dataTransfer.files);
});

async function handleFiles(files) {
  if (!files.length) return;
  const newPDFs = Array.from(files).filter(f => f.type === "application/pdf");

  if (addingMoreFiles) {
    // 🔧 Append instead of reset
    pdfFiles = pdfFiles.concat(newPDFs);
    const mergeList = document.getElementById("mergeList");
    newPDFs.forEach(f => {
      const item = document.createElement("div");
      item.className = "merge-item";
      item.textContent = f.name;
      mergeList.appendChild(item);
    });
    addingMoreFiles = false;
    return;
  }

  // Normal first load behavior
  pdfFiles = newPDFs;
  if (pdfFiles.length === 1) {
    currentFile = pdfFiles[0];
    await showPreviewModal(currentFile);
  } else if (pdfFiles.length >= 2) {
    showMergeModal();
  }
}


// Preview Modal
async function showPreviewModal(file) {
  const bytes = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  pdfDoc = await loadingTask.promise;
  const page = await pdfDoc.getPage(1);
  const viewport = page.getViewport({ scale: 0.6 });
  const canvas = document.getElementById("previewCanvas");
  const ctx = canvas.getContext("2d");
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  await page.render({ canvasContext: ctx, viewport }).promise;
  modal.classList.remove("hidden");
}
document.getElementById("closeModal").onclick = () => modal.classList.add("hidden");

// Split / Merge buttons
document.getElementById("splitBtn").onclick = async () => {
  modal.classList.add("hidden");
  dropzone.classList.add("hide");
  await renderPageSet();
};
document.getElementById("mergeBtn").onclick = () => { modal.classList.add("hidden"); showMergeModal(); };

function showMergeModal() {
  const mergeList = document.getElementById("mergeList");
  mergeList.innerHTML = pdfFiles.map(f => `<div class="merge-item">${f.name}</div>`).join("");
  mergeModal.classList.remove("hidden");
}
document.getElementById("addMoreBtn").onclick = () => {
  addingMoreFiles = true;
  fileInput.click();
};

document.getElementById("closeMerge").onclick = () => mergeModal.classList.add("hidden");

document.getElementById("mergeDoneBtn").onclick = async () => {
  mergeModal.classList.add("hidden");
  const cb = document.getElementById("aggressiveCompress");
  if (cb) applyAggressiveCompression = cb.checked;
  if (pdfFiles.length < 2) return alert("Please select at least two PDFs to merge.");
  await mergeFiles();
};

async function mergeFiles() {
  showProgress("Merging PDFs...");
  const out = await PDFLib.PDFDocument.create();
  for (const f of pdfFiles) {
    if (cancelOperation) return hideProgress();
    updateProgress(`Adding: ${f.name}`);
    const bytes = await f.arrayBuffer();
    const src = await PDFLib.PDFDocument.load(bytes);
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach(p => out.addPage(p));
  }
  let blob;
  if (applyAggressiveCompression) {
    updateProgress("Recompressing images...");
    const merged = await out.save();
    blob = await recompressViaCanvas(merged, "merged");
  } else {
    blob = new Blob([await out.save({ useObjectStreams: true, compress: true })], { type: "application/pdf" });
  }
  hideProgress();
  if (!cancelOperation) await promptFilename("barepdf_merged.pdf", blob);
  resetToDropzone();
}

// Split rendering
async function renderPageSet() {
  thumbs.innerHTML = "";
  showProgress("Loading pages...");
  const bytes = await currentFile.arrayBuffer();
  pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;

  const start = currentPageIndex * PAGES_PER_VIEW;
  const end = Math.min(start + PAGES_PER_VIEW, pdfDoc.numPages);

  for (let i = start; i < end; i++) {
    if (cancelOperation) return hideProgress();
    const page = await pdfDoc.getPage(i + 1);
    const viewport = page.getViewport({ scale: 0.3 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({ canvasContext: ctx, viewport }).promise;

    const card = document.createElement("div");
    card.className = "page-card";
    card.dataset.page = i + 1;
    card.style.opacity = "0";

    const label = document.createElement("div");
    label.className = "page-label";
    label.textContent = `Page ${i + 1}`;
    card.appendChild(label);
    card.appendChild(canvas);

    const tools = document.createElement("div");
    tools.className = "thumb-tools";
    tools.innerHTML = `<button class="rotate">⟳</button><button class="delete">🗑️</button>`;
    card.appendChild(tools);
    thumbs.appendChild(card);

    requestAnimationFrame(() => {
      card.style.transition = "opacity 0.4s ease";
      card.style.opacity = "1";
    });
  }
  hideProgress();
  makeSortable();
  addThumbHandlers();
  showTooltip();
  addPageNav();
}

// Sortable + Handlers
function makeSortable() {
  let dragSrc = null;
  thumbs.querySelectorAll(".page-card").forEach(card => {
    card.draggable = true;
    card.addEventListener("dragstart", () => { dragSrc = card; card.classList.add("dragging"); });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.addEventListener("dragover", e => {
      e.preventDefault();
      const target = e.currentTarget;
      if (dragSrc && dragSrc !== target) {
        const rect = target.getBoundingClientRect();
        const next = (e.clientY - rect.top) / rect.height > 0.5;
        thumbs.insertBefore(dragSrc, next ? target.nextSibling : target);
      }
    });
  });
}
function addThumbHandlers() {
  thumbs.querySelectorAll(".rotate").forEach(btn => btn.onclick = e => {
    const card = e.target.closest(".page-card");
    const canvas = card.querySelector("canvas");
    canvas.style.transform = `rotate(${(parseInt(canvas.dataset.rot || 0) + 90) % 360}deg)`;
    canvas.dataset.rot = (parseInt(canvas.dataset.rot || 0) + 90) % 360;
  });
  thumbs.querySelectorAll(".delete").forEach(btn => btn.onclick = e => {
    e.target.closest(".page-card").remove();
  });
}

// Split saving
async function splitSelected() {
  showProgress("Generating split PDF...");
  const out = await PDFLib.PDFDocument.create();
  const bytes = await currentFile.arrayBuffer();
  const src = await PDFLib.PDFDocument.load(bytes);
  const cards = Array.from(thumbs.querySelectorAll(".page-card"));

  for (const [index, card] of cards.entries()) {
    if (cancelOperation) return hideProgress();
    updateProgress(`Processing page ${index + 1}/${cards.length}`);
    const pageNum = parseInt(card.dataset.page);
    const [p] = await out.copyPages(src, [pageNum - 1]);
    const rot = parseInt(card.querySelector("canvas").dataset.rot || 0);
    if (rot) p.setRotation(PDFLib.degrees(rot));
    out.addPage(p);
  }

  let blob;
  if (applyAggressiveCompression) {
    updateProgress("Recompressing images...");
    blob = await recompressViaCanvas(await out.save(), "split");
  } else {
    blob = new Blob([await out.save({ useObjectStreams: true, compress: true })], { type: "application/pdf" });
  }

  hideProgress();
  if (!cancelOperation) await promptFilename(currentFile.name.replace(/\.pdf$/i, "_edited.pdf"), blob);
  resetToDropzone();
}

// Aggressive compression
async function recompressViaCanvas(buffer, label) {
  const srcDoc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const outPdf = await PDFLib.PDFDocument.create();

  for (let i = 1; i <= srcDoc.numPages; i++) {
    if (cancelOperation) return hideProgress();
    updateProgress(`Compressing page ${i}/${srcDoc.numPages}`);

    const page = await srcDoc.getPage(i);
    const viewport = page.getViewport({ scale: 1 }); // keep scale at 1 for text fidelity

    // Render the page onto a canvas
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: false });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;

    // Compress to JPEG with mild reduction
    const imgData = canvas.toDataURL("image/jpeg", 0.75);
    const img = await outPdf.embedJpg(imgData);
    const newPage = outPdf.addPage([viewport.width, viewport.height]);
    newPage.drawImage(img, { x: 0, y: 0, width: viewport.width, height: viewport.height });
  }

  // Compact the streams
  const compressed = await outPdf.save({ useObjectStreams: true });
  return new Blob([compressed], { type: "application/pdf" });
}


// Filename prompt modal
async function promptFilename(defaultName, blob) {
  return new Promise(resolve => {
    const modal = document.getElementById("saveAsModal");
    const input = document.getElementById("saveFilename");
    const confirm = document.getElementById("confirmSave");
    const cancel = document.getElementById("cancelSave");

    input.value = defaultName;
    modal.classList.remove("hidden");
    input.focus();
    input.select();

    const cleanup = () => {
      modal.classList.add("hidden");
      confirm.onclick = cancel.onclick = input.onkeydown = null;
    };

    confirm.onclick = () => {
      cleanup();
      const name = input.value.trim() || defaultName;
      saveAs(blob, name.endsWith(".pdf") ? name : `${name}.pdf`);
      resolve();
    };
    cancel.onclick = () => { cleanup(); resolve(); };
    input.onkeydown = e => {
      if (e.key === "Enter") confirm.click();
      if (e.key === "Escape") cancel.click();
    };
  });
}

// Navigation + reset
function addPageNav() {
  document.querySelectorAll(".page-nav").forEach(n => n.remove());

  const nav = document.createElement("div");
  nav.className = "page-nav";
  nav.innerHTML = `
    <button class="nav-btn" id="prevSet">Prev</button>
    <span class="nav-status">Pages ${currentPageIndex * PAGES_PER_VIEW + 1}-${Math.min((currentPageIndex + 1) * PAGES_PER_VIEW, pdfDoc.numPages)} of ${pdfDoc.numPages}</span>
    <button class="nav-btn" id="nextSet">Next</button>
    <button class="nav-btn" id="saveSplit">Save PDF</button>
  `;
  document.body.appendChild(nav);

  document.getElementById("prevSet").onclick = async () => {
    if (currentPageIndex > 0) { currentPageIndex--; await renderPageSet(); }
  };
  document.getElementById("nextSet").onclick = async () => {
    if ((currentPageIndex + 1) * PAGES_PER_VIEW < pdfDoc.numPages) {
      currentPageIndex++; await renderPageSet();
    }
  };
  document.getElementById("saveSplit").onclick = splitSelected;
}

function resetToDropzone() {
  thumbs.innerHTML = "";
  dropzone.classList.remove("hide");
  document.querySelectorAll(".page-nav").forEach(n => n.remove());
  currentPageIndex = 0;
  pdfFiles = [];
  currentFile = null;
  cancelOperation = false;
}

// Tooltip + Info
function showTooltip() {
  tooltip.classList.remove("hidden");
  tooltip.classList.add("show");
  setTimeout(() => tooltip.classList.remove("show"), 4000);
}
document.getElementById("infoBtn").onclick = () => infoModal.classList.remove("hidden");
document.getElementById("closeInfo").onclick = () => infoModal.classList.add("hidden");
