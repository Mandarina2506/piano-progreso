'use strict';

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const DB_NAME = 'piano-progreso-db';
const DB_VERSION = 1;
const STORE = 'scores';
let db;
let scores = [];
let selectedFiles = [];
let currentScore = null;
let currentPdf = null;
let currentPage = 1;
let currentImageUrl = null;
let currentPdfUrl = null;
let toastTimer = null;
let deferredInstallPrompt = null;

const $ = (selector) => document.querySelector(selector);
const els = {
  scoreGrid: $('#score-grid'), emptyState: $('#empty-state'), noResults: $('#no-results'),
  search: $('#search-input'), addModal: $('#add-modal'), addForm: $('#add-form'),
  fileInput: $('#score-files'), selectedFiles: $('#selected-files'), pageCount: $('#page-count'),
  pageCountField: $('#page-count-field'), saveScore: $('#save-score'), viewer: $('#viewer'),
  canvas: $('#pdf-canvas'), image: $('#image-page'), pdfFallback: $('#pdf-fallback'),
  sheetLoading: $('#sheet-loading'), sheetStage: $('#sheet-stage'), toast: $('#toast')
};

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No se pudo abrir la base de datos.'));
  });
}

function storeRequest(mode, action, value) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action === 'getAll' ? transaction.objectStore(STORE).getAll()
      : action === 'get' ? transaction.objectStore(STORE).get(value)
      : action === 'delete' ? transaction.objectStore(STORE).delete(value)
      : transaction.objectStore(STORE).put(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No se pudo guardar el cambio.'));
    transaction.onabort = () => reject(transaction.error || new Error('La operación fue cancelada.'));
  });
}

function makeId() {
  return window.crypto?.randomUUID ? crypto.randomUUID() : `score-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function pageTotal(score) { return Math.max(1, Number(score.pageCount) || 1); }
function completedCount(score) { return (score.donePages || []).filter(Boolean).length; }
function progressOf(score) { return Math.round((completedCount(score) / pageTotal(score)) * 100); }
function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2800);
}

async function refreshScores() {
  scores = (await storeRequest('readonly', 'getAll')).sort((a, b) => b.updatedAt - a.updatedAt);
  renderDashboard();
}

function renderDashboard() {
  const totalPieces = scores.length;
  const totalPages = scores.reduce((sum, score) => sum + pageTotal(score), 0);
  const donePages = scores.reduce((sum, score) => sum + completedCount(score), 0);
  const progress = totalPages ? Math.round(donePages / totalPages * 100) : 0;
  $('#stat-scores').textContent = totalPieces;
  $('#stat-done').innerHTML = `${donePages} <small>/ ${totalPages}</small>`;
  $('#stat-progress').textContent = `${progress}%`;
  $('#stat-progress-bar').style.width = `${progress}%`;
  $('#library-count').textContent = `(${totalPieces})`;

  const query = els.search.value.trim().toLocaleLowerCase('es');
  const filtered = scores.filter(score => `${score.title} ${score.composer || ''}`.toLocaleLowerCase('es').includes(query));
  els.scoreGrid.innerHTML = filtered.map(score => {
    const percentage = progressOf(score);
    return `<article class="score-card">
      <div class="score-card-top"><div class="score-symbol"><svg viewBox="0 0 24 24"><path d="M5 3h9l5 5v13H5zM14 3v5h5M8 13h8M8 17h8"/></svg></div><span class="score-type">${score.kind === 'pdf' ? 'DOCUMENTO PDF' : 'IMÁGENES'}</span></div>
      <h3>${escapeHtml(score.title)}</h3><div class="score-composer">${escapeHtml(score.composer || 'Compositor no indicado')}</div>
      <div class="score-progress-meta"><span>${completedCount(score)} de ${pageTotal(score)} páginas</span><strong>${percentage}%</strong></div>
      <div class="score-progress-track"><span style="width:${percentage}%"></span></div>
      <div class="score-card-footer"><span class="page-count">${pageTotal(score)} ${pageTotal(score) === 1 ? 'página' : 'páginas'}</span><button class="open-score" data-open-score="${escapeHtml(score.id)}">Abrir partitura ↗</button></div>
    </article>`;
  }).join('');

  els.emptyState.hidden = totalPieces > 0;
  els.noResults.hidden = totalPieces === 0 || filtered.length > 0;
  els.scoreGrid.hidden = filtered.length === 0;
}

function openAddModal() {
  els.addModal.hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#score-title').focus(), 50);
}
function closeAddModal() {
  els.addModal.hidden = true;
  document.body.style.overflow = '';
  els.addForm.reset();
  selectedFiles = [];
  updateFileSummary();
  els.pageCount.disabled = false;
  els.pageCount.value = 1;
}

function updateFileSummary() {
  if (!selectedFiles.length) {
    els.selectedFiles.textContent = 'Todavía no seleccionaste archivos';
    els.pageCountField.querySelector('.optional').textContent = '(se detecta automáticamente cuando es posible)';
    return;
  }
  const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  if (selectedFiles[0].type === 'application/pdf' || selectedFiles[0].name.toLowerCase().endsWith('.pdf')) {
    els.selectedFiles.textContent = `${selectedFiles[0].name} · ${formatSize(totalSize)}`;
    els.pageCount.disabled = false;
    els.pageCountField.querySelector('.optional').textContent = '(se detecta automáticamente si el lector PDF está disponible; podés corregirlo)';
    detectPdfPages(selectedFiles[0]);
  } else {
    els.selectedFiles.textContent = `${selectedFiles.length} ${selectedFiles.length === 1 ? 'imagen seleccionada' : 'imágenes seleccionadas'} · ${formatSize(totalSize)}`;
    els.pageCount.value = selectedFiles.length;
    els.pageCount.disabled = true;
    els.pageCountField.querySelector('.optional').textContent = '(cantidad de imágenes cargadas)';
  }
}

let detectToken = 0;
async function detectPdfPages(file) {
  const token = ++detectToken;
  if (!window.pdfjsLib) return;
  try {
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    if (token === detectToken && selectedFiles[0] === file) els.pageCount.value = pdf.numPages;
    await pdf.destroy();
  } catch (error) {
    console.warn('No se pudieron detectar las páginas del PDF:', error);
  }
}

async function handleAddScore(event) {
  event.preventDefault();
  const title = $('#score-title').value.trim();
  const composer = $('#score-composer').value.trim();
  if (!title) return showToast('Escribí el nombre de la pieza.');
  if (!selectedFiles.length) return showToast('Seleccioná un PDF o al menos una imagen.');
  const isPdf = selectedFiles.length === 1 && (selectedFiles[0].type === 'application/pdf' || selectedFiles[0].name.toLowerCase().endsWith('.pdf'));
  const hasPdf = selectedFiles.some(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  if (hasPdf && !isPdf) return showToast('Cargá un solo PDF o varias imágenes, pero no los mezcles.');
  if (selectedFiles.some(file => !isPdf && !file.type.startsWith('image/'))) return showToast('El formato de archivo no es compatible.');
  const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > 60 * 1024 * 1024) return showToast('El tamaño total supera 60 MB. Probá con archivos más livianos.');

  let pageCount = isPdf ? Math.max(1, parseInt(els.pageCount.value, 10) || 1) : selectedFiles.length;
  els.saveScore.disabled = true;
  els.saveScore.textContent = 'Guardando…';
  try {
    if (isPdf && window.pdfjsLib) {
      try {
        const pdf = await pdfjsLib.getDocument({ data: await selectedFiles[0].arrayBuffer() }).promise;
        pageCount = pdf.numPages;
        await pdf.destroy();
      } catch (error) {
        console.warn('Se usará la cantidad de páginas indicada manualmente.', error);
      }
    }
    const record = {
      id: makeId(), title, composer, kind: isPdf ? 'pdf' : 'images',
      pageCount, donePages: Array(pageCount).fill(false),
      file: isPdf ? selectedFiles[0] : null,
      images: isPdf ? [] : selectedFiles.map(file => ({ name: file.name, type: file.type, blob: file })),
      notes: '', createdAt: Date.now(), updatedAt: Date.now()
    };
    await storeRequest('readwrite', 'put', record);
    closeAddModal();
    await refreshScores();
    showToast('Partitura agregada a tu biblioteca.');
  } catch (error) {
    console.error(error);
    showToast('No se pudo guardar. Revisá el espacio disponible del dispositivo.');
  } finally {
    els.saveScore.disabled = false;
    els.saveScore.textContent = 'Guardar partitura';
  }
}

async function openScore(id) {
  const score = scores.find(item => item.id === id) || await storeRequest('readonly', 'get', id);
  if (!score) return showToast('No se encontró esa partitura.');
  currentScore = score;
  currentPage = 1;
  currentPdf = null;
  $('#viewer-score-title').textContent = score.title;
  $('#viewer-score-composer').textContent = score.composer || 'Compositor no indicado';
  $('#score-notes').value = score.notes || '';
  $('#notes-status').textContent = 'Los cambios se guardan al presionar Guardar notas.';
  els.viewer.hidden = false;
  document.body.style.overflow = 'hidden';
  await refreshViewer();
}

function releaseViewerUrls() {
  if (currentImageUrl) URL.revokeObjectURL(currentImageUrl);
  if (currentPdfUrl) URL.revokeObjectURL(currentPdfUrl);
  currentImageUrl = null;
  currentPdfUrl = null;
}

async function refreshViewer() {
  if (!currentScore) return;
  const total = pageTotal(currentScore);
  const done = completedCount(currentScore);
  const pct = progressOf(currentScore);
  $('#viewer-percent').textContent = `${pct}%`;
  $('#viewer-pages-label').textContent = `${done} de ${total} páginas`;
  $('#viewer-progress-bar').style.width = `${pct}%`;
  $('#viewer-progress-message').textContent = pct === 100 ? 'Pieza completada. Conservá la práctica para mantenerla.' : 'Marcá las páginas que ya podés tocar con seguridad.';
  $('#page-position').textContent = `Página ${currentPage} de ${total}`;
  $('#prev-page').disabled = currentPage <= 1;
  $('#next-page').disabled = currentPage >= total;
  const isDone = Boolean(currentScore.donePages?.[currentPage - 1]);
  $('#page-state-title').textContent = isDone ? 'Página completada' : 'Página pendiente';
  $('#page-state-description').textContent = isDone ? 'Esta página ya cuenta en tu progreso.' : 'Cuando tengas esta página dominada, marcala como aprendida.';
  $('#toggle-page-done').textContent = isDone ? 'Desmarcar página' : 'Marcar como aprendida';
  $('#toggle-page-done').classList.toggle('button-secondary', isDone);
  $('#toggle-page-done').classList.toggle('button-primary', !isDone);
  await renderCurrentPage();
}

async function renderCurrentPage() {
  if (!currentScore) return;
  releaseViewerUrls();
  els.canvas.hidden = true;
  els.image.hidden = true;
  els.pdfFallback.hidden = true;
  els.sheetLoading.hidden = false;
  els.sheetLoading.textContent = 'Cargando partitura…';
  try {
    if (currentScore.kind === 'images') {
      const image = currentScore.images[currentPage - 1];
      if (!image) throw new Error('No se encontró la imagen de esta página.');
      currentImageUrl = URL.createObjectURL(image.blob);
      els.image.src = currentImageUrl;
      els.image.hidden = false;
      els.sheetLoading.hidden = true;
      return;
    }
    if (!window.pdfjsLib) {
      currentPdfUrl = URL.createObjectURL(currentScore.file);
      els.pdfFallback.src = `${currentPdfUrl}#page=${currentPage}&toolbar=1`;
      els.pdfFallback.hidden = false;
      els.sheetLoading.hidden = true;
      return;
    }
    if (!currentPdf) {
      currentPdf = await pdfjsLib.getDocument({ data: await currentScore.file.arrayBuffer() }).promise;
    }
    const page = await currentPdf.getPage(currentPage);
    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(260, els.sheetStage.clientWidth - 30);
    const scale = Math.min(2.2, availableWidth / baseViewport.width);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: scale * pixelRatio });
    const context = els.canvas.getContext('2d', { alpha: false });
    els.canvas.width = viewport.width;
    els.canvas.height = viewport.height;
    els.canvas.style.width = `${Math.round(baseViewport.width * scale)}px`;
    els.canvas.style.height = `${Math.round(baseViewport.height * scale)}px`;
    els.canvas.hidden = false;
    await page.render({ canvasContext: context, viewport }).promise;
    els.sheetLoading.hidden = true;
  } catch (error) {
    console.error(error);
    els.sheetLoading.textContent = 'No se pudo mostrar esta página. Comprobá que el archivo no esté dañado.';
  }
}

async function toggleCurrentPage() {
  if (!currentScore) return;
  if (!Array.isArray(currentScore.donePages)) currentScore.donePages = Array(pageTotal(currentScore)).fill(false);
  currentScore.donePages[currentPage - 1] = !currentScore.donePages[currentPage - 1];
  currentScore.updatedAt = Date.now();
  try {
    await storeRequest('readwrite', 'put', currentScore);
    await refreshScores();
    await refreshViewer();
  } catch (error) {
    console.error(error);
    showToast('No se pudo guardar el progreso.');
  }
}

async function saveNotes() {
  if (!currentScore) return;
  currentScore.notes = $('#score-notes').value;
  currentScore.updatedAt = Date.now();
  try {
    await storeRequest('readwrite', 'put', currentScore);
    $('#notes-status').textContent = 'Notas guardadas en este dispositivo.';
    showToast('Notas guardadas.');
    await refreshScores();
  } catch (error) {
    console.error(error);
    $('#notes-status').textContent = 'No se pudieron guardar las notas.';
  }
}

async function deleteCurrentScore() {
  if (!currentScore) return;
  const confirmed = window.confirm(`¿Eliminar “${currentScore.title}” y sus archivos? Esta acción no se puede deshacer.`);
  if (!confirmed) return;
  try {
    await storeRequest('readwrite', 'delete', currentScore.id);
    closeViewer();
    await refreshScores();
    showToast('Partitura eliminada.');
  } catch (error) {
    console.error(error);
    showToast('No se pudo eliminar la partitura.');
  }
}

function closeViewer() {
  els.viewer.hidden = true;
  document.body.style.overflow = '';
  if (currentPdf) currentPdf.destroy().catch(() => {});
  currentPdf = null;
  releaseViewerUrls();
  currentScore = null;
}

function goToPage(nextPage) {
  const total = pageTotal(currentScore);
  if (nextPage < 1 || nextPage > total) return;
  currentPage = nextPage;
  refreshViewer();
}

function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $('#install-button').hidden = false;
  });
  $('#install-button').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $('#install-button').hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    $('#install-button').hidden = true;
    showToast('Piano Progreso quedó instalada.');
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./service-worker.js').catch(error => console.warn('No se pudo registrar el modo instalable:', error));
  }
}

function bindEvents() {
  $('#open-add').addEventListener('click', openAddModal);
  $('#empty-add').addEventListener('click', openAddModal);
  $('#close-add').addEventListener('click', closeAddModal);
  $('#cancel-add').addEventListener('click', closeAddModal);
  els.addModal.addEventListener('click', event => { if (event.target === els.addModal) closeAddModal(); });
  els.fileInput.addEventListener('change', event => {
    selectedFiles = Array.from(event.target.files || []);
    const pdfs = selectedFiles.filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length && selectedFiles.length > 1) {
      selectedFiles = [];
      els.fileInput.value = '';
      showToast('Para un PDF, seleccioná solamente ese archivo.');
    }
    updateFileSummary();
  });
  els.addForm.addEventListener('submit', handleAddScore);
  els.search.addEventListener('input', renderDashboard);
  els.scoreGrid.addEventListener('click', event => {
    const button = event.target.closest('[data-open-score]');
    if (button) openScore(button.dataset.openScore);
  });
  $('#close-viewer').addEventListener('click', closeViewer);
  $('#prev-page').addEventListener('click', () => goToPage(currentPage - 1));
  $('#next-page').addEventListener('click', () => goToPage(currentPage + 1));
  $('#toggle-page-done').addEventListener('click', toggleCurrentPage);
  $('#save-notes').addEventListener('click', saveNotes);
  $('#delete-score').addEventListener('click', deleteCurrentScore);
  window.addEventListener('resize', () => { if (currentScore?.kind === 'pdf') renderCurrentPage(); });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (!els.addModal.hidden) closeAddModal();
      else if (!els.viewer.hidden) closeViewer();
    }
    if (!els.viewer.hidden && event.key === 'ArrowRight') goToPage(currentPage + 1);
    if (!els.viewer.hidden && event.key === 'ArrowLeft') goToPage(currentPage - 1);
  });
}

async function init() {
  bindEvents();
  setupInstallPrompt();
  registerServiceWorker();
  try {
    db = await openDatabase();
    await refreshScores();
  } catch (error) {
    console.error(error);
    showToast('El navegador no permitió guardar datos. Usá una versión actualizada de Chrome, Safari o Edge.');
  }
}

document.addEventListener('DOMContentLoaded', init);
