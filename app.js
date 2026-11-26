'use strict';

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Se conserva el nombre de la base de datos para mantener las partituras de la versión 1.
const DB_NAME = 'piano-progreso-db';
const DB_VERSION = 3;
const STORE = 'scores';
const FOLDER_STORE = 'folders';
const STATUS = {
  pending: { label: 'Pendiente', weight: 0 },
  learning: { label: 'Aprendiendo', weight: 25 },
  practicing: { label: 'En práctica', weight: 60 },
  mastered: { label: 'Dominado', weight: 100 }
};

let db;
let scores = [];
let folders = [];
let activeFolderId = 'all';
let selectedFiles = [];
let currentScore = null;
let currentPdf = null;
let currentPage = 1;
let currentImageUrl = null;
let currentPdfUrl = null;
let toastTimer = null;
let deferredInstallPrompt = null;
let detectToken = 0;

const $ = (selector) => document.querySelector(selector);
const els = {
  scoreGrid: $('#score-grid'), emptyState: $('#empty-state'), noResults: $('#no-results'),
  search: $('#search-input'), addModal: $('#add-modal'), addForm: $('#add-form'),
  fileInput: $('#score-files'), selectedFiles: $('#selected-files'), pageCount: $('#page-count'),
  pageCountField: $('#page-count-field'), saveScore: $('#save-score'), viewer: $('#viewer'),
  canvas: $('#pdf-canvas'), image: $('#image-page'), pdfFallback: $('#pdf-fallback'),
  sheetLoading: $('#sheet-loading'), sheetStage: $('#sheet-stage'), toast: $('#toast'),
  folderTabs: $('#folder-tabs'), folderModal: $('#folder-modal'), folderManagerList: $('#folder-manager-list'),
  scoreFolder: $('#score-folder')
};

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(FOLDER_STORE)) database.createObjectStore(FOLDER_STORE, { keyPath: 'id' });
      // La actualización agrega carpetas sin borrar ni recrear las partituras existentes.
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No se pudo abrir la base de datos.'));
  });
}

function storeRequest(mode, action, value, storeName = STORE) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = action === 'getAll' ? store.getAll()
      : action === 'get' ? store.get(value)
      : action === 'delete' ? store.delete(value)
      : store.put(value);
    let result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error || new Error('No se pudo realizar la operación.'));
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error('No se pudo guardar el cambio.'));
    transaction.onabort = () => reject(transaction.error || new Error('La operación fue cancelada.'));
  });
}

function makeId() {
  return window.crypto?.randomUUID ? crypto.randomUUID() : `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function parseLocalDate(value) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  return year && month && day ? new Date(year, month - 1, day) : new Date();
}
function formatDate(value, options = { day: '2-digit', month: 'short' }) {
  if (!value) return 'Sin fecha';
  return parseLocalDate(value).toLocaleDateString('es-AR', options);
}
function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function pageTotal(score) { return Math.max(1, Number(score.pageCount) || 1); }
function normalizeScore(score) {
  const total = pageTotal(score);
  if (!Array.isArray(score.sections)) {
    const oldDone = Array.isArray(score.donePages) ? score.donePages : [];
    score.sections = Array.from({ length: total }, (_, index) => ({
      id: makeId(), page: index + 1, label: `Página ${index + 1}`,
      status: oldDone[index] ? 'mastered' : 'pending'
    }));
  }
  score.sections = score.sections.map((section, index) => ({
    id: section.id || makeId(),
    page: Math.min(total, Math.max(1, Number(section.page) || 1)),
    label: section.label || `Fragmento ${index + 1}`,
    status: STATUS[section.status] ? section.status : (section.done ? 'mastered' : 'pending')
  }));
  if (!Array.isArray(score.sessions)) score.sessions = [];
  if (typeof score.goalDescription !== 'string') score.goalDescription = '';
  if (typeof score.goalDate !== 'string') score.goalDate = '';
  if (!Number.isFinite(Number(score.weeklyGoalMinutes))) score.weeklyGoalMinutes = 120;
  if (typeof score.notes !== 'string') score.notes = '';
  if (typeof score.folderId !== 'string') score.folderId = '';
  return score;
}
function sectionsForPage(score, page) { return score.sections.filter(section => section.page === page); }
function pageProgress(score, page) {
  const units = sectionsForPage(score, page);
  if (!units.length) return 0;
  return units.reduce((sum, unit) => sum + STATUS[unit.status].weight, 0) / units.length;
}
function progressOf(score) {
  const perPage = Array.from({ length: pageTotal(score) }, (_, index) => pageProgress(score, index + 1));
  return Math.round(perPage.reduce((sum, value) => sum + value, 0) / perPage.length);
}
function masteredCount(score) { return score.sections.filter(section => section.status === 'mastered').length; }
function totalPracticeMinutes(score) { return score.sessions.reduce((sum, session) => sum + (Number(session.minutes) || 0), 0); }
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2800);
}

async function refreshScores() {
  const [raw, storedFolders] = await Promise.all([
    storeRequest('readonly', 'getAll'),
    storeRequest('readonly', 'getAll', undefined, FOLDER_STORE)
  ]);
  folders = storedFolders.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (activeFolderId !== 'all' && activeFolderId !== 'unfiled' && !folders.some(folder => folder.id === activeFolderId)) {
    activeFolderId = 'all';
  }
  const normalized = raw.map(original => ({
    score: normalizeScore(original),
    needsMigration: !Array.isArray(original.sections)
      || !Array.isArray(original.sessions)
      || typeof original.goalDescription !== 'string'
      || typeof original.goalDate !== 'string'
      || !Number.isFinite(Number(original.weeklyGoalMinutes))
  }));
  scores = normalized.map(item => item.score)
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  // Solo escribir los registros antiguos una vez. Evita volver a clonar PDFs grandes en cada apertura.
  for (const item of normalized) {
    if (item.needsMigration) await storeRequest('readwrite', 'put', item.score);
  }
  renderDashboard();
}

function getLastSevenDays() {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const key = localDateString(date);
    const label = date.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '').slice(0, 3);
    return { key, label, minutes: 0 };
  });
}
function renderWeeklyChart() {
  const days = getLastSevenDays();
  const lookup = new Map(days.map(day => [day.key, day]));
  scores.forEach(score => score.sessions.forEach(session => {
    const day = lookup.get(session.date);
    if (day) day.minutes += Number(session.minutes) || 0;
  }));
  const maximum = Math.max(30, ...days.map(day => day.minutes));
  const total = days.reduce((sum, day) => sum + day.minutes, 0);
  $('#weekly-total').innerHTML = `${total} <small>minutos</small>`;
  $('#weekly-chart').innerHTML = days.map(day => {
    const height = day.minutes ? Math.max(5, day.minutes / maximum * 100) : 2;
    return `<div class="day-column" title="${escapeHtml(day.label)}: ${day.minutes} minutos">
      <div class="day-bar-wrap"><span class="day-bar" style="height:${height}%"></span></div>
      <span class="day-label">${escapeHtml(day.label)}</span>
    </div>`;
  }).join('');
}

function folderName(folderId) {
  return folders.find(folder => folder.id === folderId)?.name || 'Sin carpeta';
}
function renderFolderOptions() {
  if (!els.scoreFolder) return;
  const previous = els.scoreFolder.value;
  els.scoreFolder.innerHTML = '<option value="">Sin carpeta</option>' + folders.map(folder =>
    `<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.name)}</option>`
  ).join('');
  if (folders.some(folder => folder.id === previous)) els.scoreFolder.value = previous;
  else if (activeFolderId !== 'all' && activeFolderId !== 'unfiled' && folders.some(folder => folder.id === activeFolderId)) els.scoreFolder.value = activeFolderId;
}
function renderFolderManager() {
  els.folderManagerList.innerHTML = folders.length ? folders.map(folder => {
    const count = scores.filter(score => score.folderId === folder.id).length;
    return `<form class="folder-manager-row" data-folder-id="${escapeHtml(folder.id)}">\n      <span class="folder-manager-icon" aria-hidden="true">▤</span>\n      <label class="sr-only" for="folder-edit-${escapeHtml(folder.id)}">Nombre de la carpeta</label>\n      <input id="folder-edit-${escapeHtml(folder.id)}" name="name" type="text" maxlength="35" value="${escapeHtml(folder.name)}" required>\n      <span class="folder-manager-count">${count} ${count === 1 ? 'obra' : 'obras'}</span>\n      <button class="button button-secondary button-small" type="submit">Guardar</button>\n      <button class="folder-delete-button" type="button" data-delete-folder aria-label="Eliminar carpeta ${escapeHtml(folder.name)}" title="Eliminar carpeta">×</button>\n    </form>`;
  }).join('') : '<div class="folder-manager-empty">Todavía no creaste carpetas. Podés empezar con compositor, nivel o tipo de repertorio.</div>';
}
function renderFolderTabs() {
  const allCount = scores.length;
  const unfiledCount = scores.filter(score => !score.folderId || !folders.some(folder => folder.id === score.folderId)).length;
  const tabs = [
    { id: 'all', label: 'Todas', count: allCount },
    { id: 'unfiled', label: 'Sin carpeta', count: unfiledCount },
    ...folders.map(folder => ({ id: folder.id, label: folder.name, count: scores.filter(score => score.folderId === folder.id).length }))
  ];
  els.folderTabs.innerHTML = tabs.map(tab => `<button type="button" class="folder-tab ${activeFolderId === tab.id ? 'is-active' : ''}" data-folder-filter="${escapeHtml(tab.id)}" aria-pressed="${activeFolderId === tab.id}"><span class="folder-tab-icon" aria-hidden="true">${tab.id === 'all' ? '♫' : '▤'}</span><span>${escapeHtml(tab.label)}</span><small>${tab.count}</small></button>`).join('');
}
function renderFolderUI() {
  renderFolderTabs();
  renderFolderOptions();
  renderFolderManager();
}
function openFolderModal() {
  renderFolderManager();
  els.folderModal.hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#folder-name').focus(), 40);
}
function closeFolderModal() {
  els.folderModal.hidden = true;
  document.body.style.overflow = '';
  $('#folder-create-form').reset();
}
async function createFolder(event) {
  event.preventDefault();
  const name = $('#folder-name').value.trim();
  if (!name) return showToast('Escribí un nombre para la carpeta.');
  if (folders.some(folder => folder.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'))) {
    return showToast('Ya existe una carpeta con ese nombre.');
  }
  const folder = { id: makeId(), name, createdAt: Date.now(), updatedAt: Date.now() };
  try {
    await storeRequest('readwrite', 'put', folder, FOLDER_STORE);
    activeFolderId = folder.id;
    $('#folder-name').value = '';
    await refreshScores();
    showToast(`Carpeta «${name}» creada.`);
  } catch (error) {
    console.error(error);
    showToast('No se pudo crear la carpeta.');
  }
}
async function renameFolder(event) {
  event.preventDefault();
  const row = event.target.closest('[data-folder-id]');
  if (!row) return;
  const folder = folders.find(item => item.id === row.dataset.folderId);
  const name = new FormData(row).get('name')?.toString().trim();
  if (!folder || !name) return showToast('El nombre de la carpeta no puede quedar vacío.');
  if (folders.some(item => item.id !== folder.id && item.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'))) {
    return showToast('Ya existe otra carpeta con ese nombre.');
  }
  folder.name = name;
  folder.updatedAt = Date.now();
  try {
    await storeRequest('readwrite', 'put', folder, FOLDER_STORE);
    await refreshScores();
    showToast('Carpeta renombrada.');
  } catch (error) {
    console.error(error);
    showToast('No se pudo renombrar la carpeta.');
  }
}
async function deleteFolder(folderId) {
  const folder = folders.find(item => item.id === folderId);
  if (!folder) return;
  const assigned = scores.filter(score => score.folderId === folderId);
  const confirmed = window.confirm(`¿Eliminar la carpeta «${folder.name}»? ${assigned.length} ${assigned.length === 1 ? 'partitura pasará' : 'partituras pasarán'} a «Sin carpeta». No se eliminarán las obras ni sus avances.`);
  if (!confirmed) return;
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE, FOLDER_STORE], 'readwrite');
      const scoreStore = transaction.objectStore(STORE);
      assigned.forEach(score => {
        score.folderId = '';
        score.updatedAt = Date.now();
        scoreStore.put(score);
      });
      transaction.objectStore(FOLDER_STORE).delete(folderId);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('No se pudo eliminar la carpeta.'));
      transaction.onabort = () => reject(transaction.error || new Error('La eliminación fue cancelada.'));
    });
    if (activeFolderId === folderId) activeFolderId = 'all';
    await refreshScores();
    showToast('Carpeta eliminada. Las partituras siguen guardadas.');
  } catch (error) {
    console.error(error);
    showToast('No se pudo eliminar la carpeta.');
  }
}
async function moveScoreToFolder(scoreId, folderId) {
  const score = scores.find(item => item.id === scoreId);
  if (!score) return;
  if (folderId && !folders.some(folder => folder.id === folderId)) return showToast('La carpeta seleccionada ya no existe.');
  score.folderId = folderId;
  score.updatedAt = Date.now();
  try {
    await storeRequest('readwrite', 'put', score);
    await refreshScores();
    showToast(folderId ? `Partitura movida a «${folderName(folderId)}».` : 'Partitura movida a «Sin carpeta».');
  } catch (error) {
    console.error(error);
    showToast('No se pudo mover la partitura.');
  }
}

function renderDashboard() {
  const totalPieces = scores.length;
  const totalMinutes = scores.reduce((sum, score) => sum + score.sessions.reduce((s, session) => s + (Number(session.minutes) || 0), 0), 0);
  const recentDays = new Set(getLastSevenDays().map(day => day.key));
  const weekMinutes = scores.reduce((sum, score) => sum + score.sessions.reduce((s, session) => s + (recentDays.has(session.date) ? Number(session.minutes) || 0 : 0), 0), 0);
  const weekSessions = scores.reduce((sum, score) => sum + score.sessions.filter(session => recentDays.has(session.date)).length, 0);
  const weightedProgress = totalPieces ? Math.round(scores.reduce((sum, score) => sum + progressOf(score), 0) / totalPieces) : 0;
  $('#stat-scores').textContent = totalPieces;
  $('#stat-progress').innerHTML = `${weightedProgress}<small>%</small>`;
  $('#stat-progress-bar').style.width = `${weightedProgress}%`;
  $('#stat-minutes').innerHTML = `${weekMinutes}<small> min</small>`;
  $('#stat-sessions').textContent = `${weekSessions} ${weekSessions === 1 ? 'sesión' : 'sesiones'} · ${totalMinutes} min en total`;
  $('#library-count').textContent = `(${totalPieces})`;
  renderWeeklyChart();
  renderFolderUI();

  const query = els.search.value.trim().toLocaleLowerCase('es');
  const filtered = scores.filter(score => {
    const matchesQuery = `${score.title} ${score.composer || ''}`.toLocaleLowerCase('es').includes(query);
    const matchesFolder = activeFolderId === 'all'
      || (activeFolderId === 'unfiled' && (!score.folderId || !folders.some(folder => folder.id === score.folderId)))
      || score.folderId === activeFolderId;
    return matchesQuery && matchesFolder;
  });
  els.scoreGrid.innerHTML = filtered.map(score => {
    const percentage = progressOf(score);
    const goal = score.goalDescription ? `<div class="score-card-extra">✧ ${escapeHtml(score.goalDescription)}</div>` : '';
    const currentFolderId = folders.some(folder => folder.id === score.folderId) ? score.folderId : '';
    const folderLabel = currentFolderId ? folderName(currentFolderId) : 'Sin carpeta';
    const folderOptions = `<option value="" ${!currentFolderId ? 'selected' : ''}>Sin carpeta</option>` + folders.map(folder =>
      `<option value="${escapeHtml(folder.id)}" ${folder.id === currentFolderId ? 'selected' : ''}>${escapeHtml(folder.name)}</option>`
    ).join('');
    return `<article class="score-card">
      <div class="score-card-top"><div class="score-symbol"><svg viewBox="0 0 24 24"><path d="M5 3h9l5 5v13H5zM14 3v5h5M8 13h8M8 17h8"/></svg></div><span class="score-type">${score.kind === 'pdf' ? 'DOCUMENTO PDF' : 'IMÁGENES'}</span></div>
      <h3>${escapeHtml(score.title)}</h3><div class="score-composer">${escapeHtml(score.composer || 'Compositor no indicado')}</div>
      <div class="score-folder-label"><span aria-hidden="true">▤</span> ${escapeHtml(folderLabel)}</div>
      <div class="score-progress-meta"><span>${masteredCount(score)} de ${score.sections.length} fragmentos dominados</span><strong>${percentage}%</strong></div>
      <div class="score-progress-track"><span style="width:${percentage}%"></span></div>
      ${goal}
      <div class="score-card-footer"><span class="page-count">${pageTotal(score)} ${pageTotal(score) === 1 ? 'página' : 'páginas'} · ${totalPracticeMinutes(score)} min</span><button class="open-score" data-open-score="${escapeHtml(score.id)}">Abrir cuaderno ↗</button></div>
      <label class="move-score-label">Mover a<select class="move-score-select" data-move-score="${escapeHtml(score.id)}" aria-label="Mover ${escapeHtml(score.title)} a otra carpeta">${folderOptions}</select></label>
    </article>`;
  }).join('');

  els.emptyState.hidden = totalPieces > 0;
  els.noResults.textContent = totalPieces === 0 ? '' : (activeFolderId === 'all' && query ? 'No hay partituras que coincidan con esa búsqueda.' : 'No hay partituras en esta vista.');
  els.noResults.hidden = totalPieces === 0 || filtered.length > 0;
  els.scoreGrid.hidden = filtered.length === 0;
}

function openAddModal() {
  renderFolderOptions();
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
  const isPdf = selectedFiles.length === 1 && (selectedFiles[0].type === 'application/pdf' || selectedFiles[0].name.toLowerCase().endsWith('.pdf'));
  if (isPdf) {
    els.selectedFiles.textContent = `${selectedFiles[0].name} · ${formatSize(totalSize)}`;
    els.pageCount.disabled = false;
    els.pageCountField.querySelector('.optional').textContent = '(se detecta con el lector PDF si está disponible)';
    detectPdfPages(selectedFiles[0]);
  } else {
    els.selectedFiles.textContent = `${selectedFiles.length} ${selectedFiles.length === 1 ? 'imagen seleccionada' : 'imágenes seleccionadas'} · ${formatSize(totalSize)}`;
    els.pageCount.value = selectedFiles.length;
    els.pageCount.disabled = true;
    els.pageCountField.querySelector('.optional').textContent = '(cantidad de imágenes cargadas)';
  }
}
async function detectPdfPages(file) {
  const token = ++detectToken;
  if (!window.pdfjsLib) return;
  try {
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    if (token === detectToken && selectedFiles[0] === file) els.pageCount.value = pdf.numPages;
    await pdf.destroy();
  } catch (error) { console.warn('No se pudieron detectar las páginas del PDF:', error); }
}

async function handleAddScore(event) {
  event.preventDefault();
  const title = $('#score-title').value.trim();
  const composer = $('#score-composer').value.trim();
  if (!title) return showToast('Escribí el nombre de la pieza.');
  if (!selectedFiles.length) return showToast('Seleccioná un PDF o al menos una imagen.');
  const pdfs = selectedFiles.filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  const isPdf = pdfs.length === 1 && selectedFiles.length === 1;
  if (pdfs.length && !isPdf) return showToast('Cargá un solo PDF o varias imágenes, pero no los mezcles.');
  if (!isPdf && selectedFiles.some(file => !file.type.startsWith('image/'))) return showToast('El formato de archivo no es compatible.');
  const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > 60 * 1024 * 1024) return showToast('El tamaño total supera 60 MB. Probá con archivos más livianos.');

  let pageCount = isPdf ? Math.max(1, Math.min(500, parseInt(els.pageCount.value, 10) || 1)) : selectedFiles.length;
  els.saveScore.disabled = true;
  els.saveScore.textContent = 'Guardando…';
  try {
    if (isPdf && window.pdfjsLib) {
      try {
        const pdf = await pdfjsLib.getDocument({ data: await selectedFiles[0].arrayBuffer() }).promise;
        pageCount = pdf.numPages;
        await pdf.destroy();
      } catch (error) { console.warn('Se usará la cantidad de páginas indicada manualmente.', error); }
    }
    const now = Date.now();
    const record = normalizeScore({
      id: makeId(), title, composer, kind: isPdf ? 'pdf' : 'images', pageCount,
      folderId: els.scoreFolder.value || '',
      sections: Array.from({ length: pageCount }, (_, index) => ({ id: makeId(), page: index + 1, label: `Página ${index + 1}`, status: 'pending' })),
      file: isPdf ? selectedFiles[0] : null,
      images: isPdf ? [] : selectedFiles.map(file => ({ name: file.name, type: file.type, blob: file })),
      sessions: [], goalDescription: '', goalDate: '', weeklyGoalMinutes: 120,
      notes: '', createdAt: now, updatedAt: now
    });
    await storeRequest('readwrite', 'put', record);
    closeAddModal();
    await refreshScores();
    showToast('Partitura agregada. Se creó una unidad de estudio por página.');
  } catch (error) {
    console.error(error);
    showToast('No se pudo guardar. Revisá el espacio disponible del dispositivo.');
  } finally {
    els.saveScore.disabled = false;
    els.saveScore.textContent = 'Guardar partitura';
  }
}

async function persistCurrentScore(message = '') {
  if (!currentScore) return;
  currentScore.updatedAt = Date.now();
  try {
    await storeRequest('readwrite', 'put', currentScore);
    await refreshScores();
    renderViewerData();
    if (message) showToast(message);
    return true;
  } catch (error) {
    console.error(error);
    showToast('No se pudo guardar el cambio.');
    return false;
  }
}

async function openScore(id) {
  const score = scores.find(item => item.id === id) || await storeRequest('readonly', 'get', id);
  if (!score) return showToast('No se encontró esa partitura.');
  currentScore = normalizeScore(score);
  currentPage = 1;
  currentPdf = null;
  $('#viewer-score-title').textContent = currentScore.title;
  $('#viewer-score-composer').textContent = currentScore.composer || 'Compositor no indicado';
  $('#score-notes').value = currentScore.notes || '';
  $('#notes-status').textContent = 'Los apuntes se guardan al presionar Guardar.';
  $('#session-date').value = localDateString();
  $('#goal-description').value = currentScore.goalDescription || '';
  $('#goal-date').value = currentScore.goalDate || '';
  $('#goal-minutes').value = currentScore.weeklyGoalMinutes ?? 120;
  $('#unit-page').value = 1;
  els.viewer.hidden = false;
  document.body.style.overflow = 'hidden';
  renderViewerData();
  await renderCurrentPage();
}

function releaseViewerUrls() {
  if (currentImageUrl) URL.revokeObjectURL(currentImageUrl);
  if (currentPdfUrl) URL.revokeObjectURL(currentPdfUrl);
  currentImageUrl = null;
  currentPdfUrl = null;
}
function renderViewerData() {
  if (!currentScore) return;
  const total = pageTotal(currentScore);
  const percentage = progressOf(currentScore);
  const mastered = masteredCount(currentScore);
  $('#viewer-percent').textContent = `${percentage}%`;
  $('#viewer-units-label').textContent = `${mastered} de ${currentScore.sections.length} fragmentos dominados`;
  $('#viewer-progress-bar').style.width = `${percentage}%`;
  $('#viewer-progress-message').textContent = percentage === 100 ? 'Todos los fragmentos están dominados. Mantené la obra en tu repertorio de práctica.' : 'Cada fragmento suma cuando avanzás de nivel. No hace falta correr.';
  $('#page-position').textContent = `Página ${currentPage} de ${total}`;
  $('#prev-page').disabled = currentPage <= 1;
  $('#next-page').disabled = currentPage >= total;
  $('#unit-page').max = total;
  $('#unit-page').value = currentPage;
  renderUnitList();
  renderGoalStatus();
  renderSessions();
}
function renderUnitList() {
  const units = currentScore.sections.slice().sort((a, b) => a.page - b.page || a.label.localeCompare(b.label, 'es'));
  $('#unit-count').textContent = String(units.length).padStart(2, '0');
  if (!units.length) {
    $('#unit-list').innerHTML = '<div class="empty-units">Todavía no hay fragmentos. Agregá uno para comenzar.</div>';
    return;
  }
  $('#unit-list').innerHTML = units.map(unit => `<div class="unit-row" data-unit-id="${escapeHtml(unit.id)}">
    <div class="unit-row-copy"><input type="text" maxlength="70" value="${escapeHtml(unit.label)}" data-unit-label aria-label="Nombre del fragmento"><small>Página ${unit.page}</small></div>
    <select data-unit-status aria-label="Nivel de dominio">
      <option value="pending" ${unit.status === 'pending' ? 'selected' : ''}>Pendiente</option>
      <option value="learning" ${unit.status === 'learning' ? 'selected' : ''}>Aprendiendo</option>
      <option value="practicing" ${unit.status === 'practicing' ? 'selected' : ''}>En práctica</option>
      <option value="mastered" ${unit.status === 'mastered' ? 'selected' : ''}>Dominado</option>
    </select>
    <button type="button" class="delete-unit" data-delete-unit aria-label="Eliminar fragmento" title="Eliminar fragmento">×</button>
  </div>`).join('');
}
function renderGoalStatus() {
  const description = currentScore.goalDescription;
  const goalDate = currentScore.goalDate;
  const minutes = Number(currentScore.weeklyGoalMinutes) || 0;
  if (!description && !goalDate && !minutes) {
    $('#goal-status').textContent = 'Definí una meta para esta pieza.';
    return;
  }
  const details = [];
  if (description) details.push(description);
  if (goalDate) details.push(`Fecha objetivo: ${formatDate(goalDate, { day: 'numeric', month: 'long', year: 'numeric' })}`);
  if (minutes) details.push(`Meta semanal: ${minutes} minutos`);
  $('#goal-status').textContent = details.join(' · ');
}
function renderSessions() {
  const sessions = currentScore.sessions.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
  $('#score-practice-total').textContent = `${totalPracticeMinutes(currentScore)} min`;
  $('#session-list').innerHTML = sessions.length ? sessions.slice(0, 5).map(session => `<div class="session-item">
    <span class="session-date-label">${escapeHtml(formatDate(session.date))}</span>
    <span class="session-description">${escapeHtml(session.note || 'Práctica registrada')}</span>
    <span class="session-duration">${Number(session.minutes) || 0} min</span>
  </div>`).join('') : '<div class="session-empty">Todavía no registraste sesiones.</div>';
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
    if (!currentPdf) currentPdf = await pdfjsLib.getDocument({ data: await currentScore.file.arrayBuffer() }).promise;
    const page = await currentPdf.getPage(currentPage);
    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(260, els.sheetStage.clientWidth - 25);
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

async function addUnit(event) {
  event.preventDefault();
  if (!currentScore) return;
  const label = $('#unit-label').value.trim();
  const page = Number($('#unit-page').value);
  if (!label) return showToast('Escribí el nombre del fragmento.');
  if (!Number.isInteger(page) || page < 1 || page > pageTotal(currentScore)) return showToast('Elegí una página válida.');
  // Al dividir por primera vez una página, reemplazar su unidad general pendiente.
  // Así no se cuenta dos veces el mismo contenido en el porcentaje.
  currentScore.sections = currentScore.sections.filter(section => !(
    section.page === page && section.label === `Página ${page}` && section.status === 'pending'
  ));
  currentScore.sections.push({ id: makeId(), page, label, status: 'pending' });
  $('#unit-label').value = '';
  await persistCurrentScore('Fragmento agregado.');
}
async function handleUnitListChange(event) {
  if (!currentScore) return;
  const row = event.target.closest('[data-unit-id]');
  if (!row) return;
  const unit = currentScore.sections.find(item => item.id === row.dataset.unitId);
  if (!unit) return;
  if (event.target.matches('[data-unit-status]')) unit.status = STATUS[event.target.value] ? event.target.value : 'pending';
  else if (event.target.matches('[data-unit-label]')) unit.label = event.target.value.trim() || unit.label;
  else return;
  await persistCurrentScore('Progreso actualizado.');
}
async function handleUnitListClick(event) {
  const button = event.target.closest('[data-delete-unit]');
  if (!button || !currentScore) return;
  const row = button.closest('[data-unit-id]');
  const unit = currentScore.sections.find(item => item.id === row?.dataset.unitId);
  if (!unit) return;
  if (!window.confirm(`¿Eliminar el fragmento “${unit.label}”?`)) return;
  currentScore.sections = currentScore.sections.filter(item => item.id !== unit.id);
  await persistCurrentScore('Fragmento eliminado.');
}
async function saveGoal(event) {
  event.preventDefault();
  if (!currentScore) return;
  currentScore.goalDescription = $('#goal-description').value.trim();
  currentScore.goalDate = $('#goal-date').value;
  currentScore.weeklyGoalMinutes = Math.max(0, Number($('#goal-minutes').value) || 0);
  await persistCurrentScore('Objetivo guardado.');
}
async function saveSession(event) {
  event.preventDefault();
  if (!currentScore) return;
  const date = $('#session-date').value || localDateString();
  const minutes = Number($('#session-minutes').value);
  const note = $('#session-note').value.trim();
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) return showToast('La duración debe estar entre 1 y 600 minutos.');
  currentScore.sessions.push({ id: makeId(), date, minutes, note, createdAt: Date.now() });
  $('#session-note').value = '';
  $('#session-date').value = localDateString();
  await persistCurrentScore('Sesión registrada.');
}
async function saveNotes() {
  if (!currentScore) return;
  currentScore.notes = $('#score-notes').value;
  const saved = await persistCurrentScore('Apuntes guardados.');
  $('#notes-status').textContent = saved ? 'Apuntes guardados en este dispositivo.' : 'No se pudieron guardar los apuntes.';
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
  if (!currentScore) return;
  const total = pageTotal(currentScore);
  if (nextPage < 1 || nextPage > total) return;
  currentPage = nextPage;
  renderViewerData();
  renderCurrentPage();
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
  $('#open-add-secondary').addEventListener('click', openAddModal);
  $('#empty-add').addEventListener('click', openAddModal);
  $('#close-add').addEventListener('click', closeAddModal);
  $('#cancel-add').addEventListener('click', closeAddModal);
  els.addModal.addEventListener('click', event => { if (event.target === els.addModal) closeAddModal(); });
  els.fileInput.addEventListener('change', event => {
    selectedFiles = Array.from(event.target.files || []);
    const pdfCount = selectedFiles.filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')).length;
    if (pdfCount && selectedFiles.length > 1) {
      selectedFiles = [];
      els.fileInput.value = '';
      showToast('Para un PDF, seleccioná solamente ese archivo.');
    }
    updateFileSummary();
  });
  els.addForm.addEventListener('submit', handleAddScore);
  els.search.addEventListener('input', renderDashboard);
  els.folderTabs.addEventListener('click', event => {
    const button = event.target.closest('[data-folder-filter]');
    if (!button) return;
    activeFolderId = button.dataset.folderFilter;
    renderDashboard();
  });
  $('#open-folders').addEventListener('click', openFolderModal);
  $('#close-folders').addEventListener('click', closeFolderModal);
  $('#done-folders').addEventListener('click', closeFolderModal);
  els.folderModal.addEventListener('click', event => { if (event.target === els.folderModal) closeFolderModal(); });
  $('#folder-create-form').addEventListener('submit', createFolder);
  els.folderManagerList.addEventListener('submit', renameFolder);
  els.folderManagerList.addEventListener('click', event => {
    const button = event.target.closest('[data-delete-folder]');
    if (button) deleteFolder(button.closest('[data-folder-id]')?.dataset.folderId);
  });
  els.scoreGrid.addEventListener('change', event => {
    const select = event.target.closest('[data-move-score]');
    if (select) moveScoreToFolder(select.dataset.moveScore, select.value);
  });
  els.scoreGrid.addEventListener('click', event => {
    const button = event.target.closest('[data-open-score]');
    if (button) openScore(button.dataset.openScore);
  });
  $('#close-viewer').addEventListener('click', closeViewer);
  $('#prev-page').addEventListener('click', () => goToPage(currentPage - 1));
  $('#next-page').addEventListener('click', () => goToPage(currentPage + 1));
  $('#add-unit-form').addEventListener('submit', addUnit);
  $('#unit-list').addEventListener('change', handleUnitListChange);
  $('#unit-list').addEventListener('click', handleUnitListClick);
  $('#goal-form').addEventListener('submit', saveGoal);
  $('#session-form').addEventListener('submit', saveSession);
  $('#save-notes').addEventListener('click', saveNotes);
  $('#delete-score').addEventListener('click', deleteCurrentScore);
  window.addEventListener('resize', () => { if (currentScore?.kind === 'pdf') renderCurrentPage(); });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (!els.addModal.hidden) closeAddModal();
      else if (!els.folderModal.hidden) closeFolderModal();
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
    showToast('El navegador no permitió guardar datos. Usá Chrome, Safari o Edge actualizados.');
  }
}

document.addEventListener('DOMContentLoaded', init);
