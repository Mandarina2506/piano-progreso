'use strict';

// Funciones añadidas en Piano Progreso v4. Comparten la base IndexedDB de la v3.
let plannerEntries = [];
let weeklyTargetMinutes = 120;
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedPlannerDate = localDateString();
let metronomeContext = null;
let metronomeInterval = null;
let metronomeBeat = 0;
let annotationMode = false;

const plannerStore = PLANNER_STORE;
const plannerEl = (selector) => document.querySelector(selector);

function plannerStoreRequest(action, value) {
  return storeRequest('readonly', action, value, plannerStore);
}

async function initializeEnhancements() {
  try {
    const records = await plannerStoreRequest('getAll');
    const settings = records.find(record => record.id === '__settings__');
    weeklyTargetMinutes = Math.max(0, Number(settings?.weeklyTargetMinutes ?? 120) || 0);
    plannerEntries = records.filter(record => record.id !== '__settings__' && record.type === 'practice-plan');
    plannerEl('#weekly-target-input').value = weeklyTargetMinutes;
    plannerEl('#plan-date').value = selectedPlannerDate;
    bindEnhancementEvents();
    renderPlanner();
    renderScoreOptions();
    renderAnnotations();
  } catch (error) {
    console.error('No se pudo iniciar la agenda:', error);
    showToast('No se pudo cargar el calendario de estudio.');
  }
}

function bindEnhancementEvents() {
  plannerEl('#export-backup').addEventListener('click', exportBackup);
  plannerEl('#import-backup-trigger').addEventListener('click', () => plannerEl('#import-backup-file').click());
  plannerEl('#import-backup-file').addEventListener('change', importBackup);

  plannerEl('#calendar-prev').addEventListener('click', () => {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
    renderPlanner();
  });
  plannerEl('#calendar-next').addEventListener('click', () => {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
    renderPlanner();
  });
  plannerEl('#calendar-grid').addEventListener('click', event => {
    const dayButton = event.target.closest('[data-calendar-date]');
    if (!dayButton) return;
    selectedPlannerDate = dayButton.dataset.calendarDate;
    plannerEl('#plan-date').value = selectedPlannerDate;
    const picked = parseLocalDate(selectedPlannerDate);
    calendarMonth = new Date(picked.getFullYear(), picked.getMonth(), 1);
    renderPlanner();
  });
  plannerEl('#plan-date').addEventListener('change', event => {
    if (!event.target.value) return;
    selectedPlannerDate = event.target.value;
    const picked = parseLocalDate(selectedPlannerDate);
    calendarMonth = new Date(picked.getFullYear(), picked.getMonth(), 1);
    renderPlanner();
  });
  plannerEl('#plan-form').addEventListener('submit', savePracticePlan);
  plannerEl('#selected-day-plans').addEventListener('change', updatePlanStatus);
  plannerEl('#selected-day-plans').addEventListener('click', deletePracticePlan);
  plannerEl('#weekly-target-form').addEventListener('submit', saveWeeklyTarget);

  plannerEl('#metronome-bpm').addEventListener('input', event => {
    const bpm = Number(event.target.value);
    plannerEl('#metronome-bpm-label').textContent = bpm;
    if (currentScore) currentScore.metronomeBpm = bpm;
    if (metronomeInterval) restartMetronomeInterval();
  });
  plannerEl('#metronome-bpm').addEventListener('change', async () => {
    if (currentScore) await persistCurrentScore('Tempo guardado para esta obra.');
  });
  plannerEl('#metronome-meter').addEventListener('change', () => {
    metronomeBeat = 0;
    renderBeatIndicator();
    if (metronomeInterval) restartMetronomeInterval();
  });
  plannerEl('#metronome-start').addEventListener('click', startMetronome);
  plannerEl('#metronome-stop').addEventListener('click', stopMetronome);

  plannerEl('#add-annotation-mode').addEventListener('click', toggleAnnotationMode);
  plannerEl('#sheet-page-wrap').addEventListener('click', handleSheetAnnotationClick);
  plannerEl('#annotation-list').addEventListener('click', handleAnnotationListClick);
  window.addEventListener('piano:score-opened', syncMetronomeToScore);
  window.addEventListener('piano:viewer-closed', () => {
    stopMetronome();
    setAnnotationMode(false);
  });
  window.addEventListener('piano:page-rendered', renderAnnotations);
  window.addEventListener('piano:page-changed', () => {
    setAnnotationMode(false);
    renderAnnotations();
  });
  window.addEventListener('piano:viewer-data-updated', renderAnnotations);
  window.addEventListener('piano:scores-updated', () => {
    renderScoreOptions();
    renderPlanner();
  });
}

// -----------------------------------------------------------------------------
// 1. Backup completo: incluye blobs de PDF e imágenes, carpetas, agenda y datos.
// -----------------------------------------------------------------------------
function blobToBackupValue(blob) {
  if (!blob) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      __pianoBlob: true,
      dataUrl: reader.result,
      type: blob.type || 'application/octet-stream',
      name: typeof blob.name === 'string' ? blob.name : ''
    });
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer un archivo para la copia.'));
    reader.readAsDataURL(blob);
  });
}

async function scoreToBackupValue(score) {
  const record = { ...score };
  record.file = await blobToBackupValue(score.file);
  record.images = await Promise.all((score.images || []).map(async image => ({
    ...image,
    blob: await blobToBackupValue(image.blob)
  })));
  return record;
}

async function exportBackup() {
  const button = plannerEl('#export-backup');
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = 'Preparando copia…';
  try {
    const [storedScores, storedFolders, storedPlanner] = await Promise.all([
      storeRequest('readonly', 'getAll', undefined, STORE),
      storeRequest('readonly', 'getAll', undefined, FOLDER_STORE),
      storeRequest('readonly', 'getAll', undefined, PLANNER_STORE)
    ]);
    const backup = {
      format: 'piano-progreso-backup',
      formatVersion: 1,
      appVersion: '4.0',
      exportedAt: new Date().toISOString(),
      scores: await Promise.all(storedScores.map(scoreToBackupValue)),
      folders: storedFolders,
      planner: storedPlanner
    };
    const file = new Blob([JSON.stringify(backup)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = `piano-progreso-copia-${localDateString()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast('Copia de seguridad descargada. Guardala en otro dispositivo o nube.');
  } catch (error) {
    console.error(error);
    showToast('No se pudo crear la copia de seguridad.');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function backupValueToBlob(value) {
  if (!value) return null;
  if (!value.__pianoBlob || typeof value.dataUrl !== 'string' || !value.dataUrl.includes(',')) {
    throw new Error('La copia contiene un archivo con formato inválido.');
  }
  const base64 = value.dataUrl.slice(value.dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const blob = new Blob([bytes], { type: value.type || 'application/octet-stream' });
  return value.name && typeof File !== 'undefined'
    ? new File([blob], value.name, { type: blob.type })
    : blob;
}

function restoreScoreFromBackup(score) {
  if (!score || typeof score.id !== 'string' || typeof score.title !== 'string') {
    throw new Error('La copia contiene una partitura inválida.');
  }
  const restored = { ...score };
  restored.file = backupValueToBlob(score.file);
  restored.images = Array.isArray(score.images) ? score.images.map(image => ({
    ...image,
    blob: backupValueToBlob(image.blob)
  })) : [];
  return normalizeScore(restored);
}

function replaceDatabaseContents(scoreRecords, folderRecords, plannerRecords) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE, FOLDER_STORE, PLANNER_STORE], 'readwrite');
    const scoreStore = transaction.objectStore(STORE);
    const folderStore = transaction.objectStore(FOLDER_STORE);
    const plannerObjectStore = transaction.objectStore(PLANNER_STORE);
    scoreStore.clear();
    folderStore.clear();
    plannerObjectStore.clear();
    scoreRecords.forEach(record => scoreStore.put(record));
    folderRecords.forEach(record => folderStore.put(record));
    plannerRecords.forEach(record => plannerObjectStore.put(record));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('No se pudo restaurar la copia.'));
    transaction.onabort = () => reject(transaction.error || new Error('La restauración fue cancelada.'));
  });
}

async function importBackup(event) {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 800 * 1024 * 1024) throw new Error('El archivo supera el límite de 800 MB.');
    const data = JSON.parse(await file.text());
    if (data.format !== 'piano-progreso-backup' || data.formatVersion !== 1
      || !Array.isArray(data.scores) || !Array.isArray(data.folders) || !Array.isArray(data.planner)) {
      throw new Error('El archivo no parece ser una copia válida de Piano Progreso.');
    }
    const confirmed = window.confirm(
      `La copia contiene ${data.scores.length} partituras y ${data.folders.length} carpetas.\n\n` +
      'Restaurar reemplazará todas las partituras, carpetas y datos locales actuales de este dispositivo. ' +
      'Se recomienda descargar primero una copia de seguridad de los datos actuales. ¿Continuar?'
    );
    if (!confirmed) return;
    const button = plannerEl('#import-backup-trigger');
    button.disabled = true;
    button.textContent = 'Restaurando…';
    const restoredScores = data.scores.map(restoreScoreFromBackup);
    const restoredFolders = data.folders.filter(folder => folder && typeof folder.id === 'string' && typeof folder.name === 'string');
    const restoredPlanner = data.planner.filter(record => record && typeof record.id === 'string');
    if (!restoredPlanner.some(record => record.id === '__settings__')) {
      restoredPlanner.push({ id: '__settings__', weeklyTargetMinutes: 120 });
    }
    await replaceDatabaseContents(restoredScores, restoredFolders, restoredPlanner);
    await refreshScores();
    const settings = restoredPlanner.find(record => record.id === '__settings__');
    weeklyTargetMinutes = Math.max(0, Number(settings?.weeklyTargetMinutes ?? 120) || 0);
    plannerEntries = restoredPlanner.filter(record => record.id !== '__settings__' && record.type === 'practice-plan');
    plannerEl('#weekly-target-input').value = weeklyTargetMinutes;
    renderPlanner();
    renderScoreOptions();
    showToast('Copia restaurada. Se recuperaron partituras, archivos y registros.');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'No se pudo restaurar la copia.');
  } finally {
    input.value = '';
    const button = plannerEl('#import-backup-trigger');
    button.disabled = false;
    button.textContent = '↑ Restaurar copia';
  }
}

// -----------------------------------------------------------------------------
// 2. Metrónomo con acento de compás y tempo guardado por partitura.
// -----------------------------------------------------------------------------
function syncMetronomeToScore() {
  stopMetronome();
  const bpm = Math.min(240, Math.max(30, Number(currentScore?.metronomeBpm) || 80));
  plannerEl('#metronome-bpm').value = bpm;
  plannerEl('#metronome-bpm-label').textContent = bpm;
  metronomeBeat = 0;
  renderBeatIndicator();
}

function renderBeatIndicator() {
  const count = Number(plannerEl('#metronome-meter').value) || 4;
  plannerEl('#metronome-beat-indicator').textContent = Array.from({ length: count }, (_, index) => index === metronomeBeat ? '●' : '○').join(' ');
}

function metronomeClick(accent = false) {
  if (!metronomeContext) return;
  const now = metronomeContext.currentTime;
  const oscillator = metronomeContext.createOscillator();
  const gain = metronomeContext.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(accent ? 1320 : 880, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(accent ? 0.22 : 0.13, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
  oscillator.connect(gain);
  gain.connect(metronomeContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.07);
}

function metronomeTick() {
  const meter = Number(plannerEl('#metronome-meter').value) || 4;
  metronomeClick(metronomeBeat === 0);
  plannerEl('#metronome-beat-indicator').textContent = Array.from({ length: meter }, (_, index) => index === metronomeBeat ? '●' : '○').join(' ');
  metronomeBeat = (metronomeBeat + 1) % meter;
}

function restartMetronomeInterval() {
  if (!metronomeInterval) return;
  clearInterval(metronomeInterval);
  const bpm = Number(plannerEl('#metronome-bpm').value) || 80;
  metronomeInterval = setInterval(metronomeTick, 60000 / bpm);
}

async function startMetronome() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return showToast('Este navegador no admite el metrónomo de audio.');
    if (!metronomeContext) metronomeContext = new AudioContextClass();
    await metronomeContext.resume();
    stopMetronome();
    metronomeBeat = 0;
    metronomeTick();
    plannerEl('#metronome-start').disabled = true;
    plannerEl('#metronome-stop').disabled = false;
    const bpm = Number(plannerEl('#metronome-bpm').value) || 80;
    metronomeInterval = setInterval(metronomeTick, 60000 / bpm);
    showToast(`Metrónomo iniciado a ${plannerEl('#metronome-bpm').value} BPM.`);
  } catch (error) {
    console.error(error);
    showToast('No se pudo iniciar el audio. Revisá los permisos del navegador.');
  }
}

function stopMetronome() {
  if (metronomeInterval) clearInterval(metronomeInterval);
  metronomeInterval = null;
  plannerEl('#metronome-start').disabled = false;
  plannerEl('#metronome-stop').disabled = true;
  metronomeBeat = 0;
  renderBeatIndicator();
}

// -----------------------------------------------------------------------------
// 3. Calendario: prácticas programadas, objetivos semanales y agenda diaria.
// -----------------------------------------------------------------------------
function renderScoreOptions() {
  const select = plannerEl('#plan-score');
  if (!select) return;
  const previous = select.value;
  select.innerHTML = '<option value="">Práctica libre</option>' + scores.map(score =>
    `<option value="${escapeHtml(score.id)}">${escapeHtml(score.title)}${score.composer ? ` · ${escapeHtml(score.composer)}` : ''}</option>`
  ).join('');
  if (scores.some(score => score.id === previous)) select.value = previous;
}

function plansOn(date) {
  return plannerEntries.filter(plan => plan.date === date).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

function renderPlanner() {
  if (!plannerEl('#calendar-grid')) return;
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  plannerEl('#calendar-month-label').textContent = calendarMonth.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  const first = new Date(year, month, 1, 12);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - mondayOffset, 12);
  const todayKey = localDateString();
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = localDateString(date);
    const plans = plansOn(key);
    const doneCount = plans.filter(plan => plan.done).length;
    const classes = [
      'calendar-day',
      date.getMonth() !== month ? 'outside-month' : '',
      key === todayKey ? 'is-today' : '',
      key === selectedPlannerDate ? 'is-selected' : ''
    ].filter(Boolean).join(' ');
    const marker = plans.length ? `<span class="calendar-day-marker ${doneCount === plans.length ? 'all-done' : ''}">${plans.length}</span>` : '';
    cells.push(`<button type="button" class="${classes}" data-calendar-date="${key}" aria-label="${key}, ${plans.length} prácticas programadas"><span class="calendar-day-number">${date.getDate()}</span>${marker}</button>`);
  }
  plannerEl('#calendar-grid').innerHTML = cells.join('');
  renderSelectedDay();
  renderWeeklyTargetProgress();
}

function renderSelectedDay() {
  const date = parseLocalDate(selectedPlannerDate);
  plannerEl('#selected-day-label').textContent = date.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  plannerEl('#plan-date').value = selectedPlannerDate;
  const plans = plansOn(selectedPlannerDate);
  plannerEl('#selected-day-plans').innerHTML = plans.length ? plans.map(plan => `
    <div class="planned-item ${plan.done ? 'is-done' : ''}" data-plan-id="${escapeHtml(plan.id)}">
      <label class="planned-item-check"><input type="checkbox" data-plan-done ${plan.done ? 'checked' : ''} aria-label="Marcar práctica como completada"><span></span></label>
      <div class="planned-item-copy"><strong>${escapeHtml(plan.scoreTitle || 'Práctica libre')}</strong><span>${Number(plan.minutes) || 0} min · ${escapeHtml(plan.note || 'Práctica programada')}</span></div>
      <button type="button" class="planned-item-delete" data-plan-delete aria-label="Eliminar práctica programada">×</button>
    </div>`).join('') : '<p class="planner-empty">No hay prácticas programadas para este día.</p>';
}

function getCurrentWeekRange() {
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { monday: localDateString(monday), sunday: localDateString(sunday) };
}

function renderWeeklyTargetProgress() {
  const range = getCurrentWeekRange();
  const minutes = scores.reduce((total, score) => total + (score.sessions || []).reduce((sum, session) => {
    return sum + (session.date >= range.monday && session.date <= range.sunday ? Number(session.minutes) || 0 : 0);
  }, 0), 0);
  const target = weeklyTargetMinutes;
  const percentage = target > 0 ? Math.min(100, Math.round(minutes / target * 100)) : (minutes > 0 ? 100 : 0);
  plannerEl('#weekly-target-progress').textContent = `${minutes} / ${target} min`;
  plannerEl('#weekly-target-percent').textContent = `${percentage}%`;
  plannerEl('#weekly-target-bar').style.width = `${percentage}%`;
}

async function savePracticePlan(event) {
  event.preventDefault();
  const date = plannerEl('#plan-date').value;
  const minutes = Number(plannerEl('#plan-minutes').value);
  const scoreId = plannerEl('#plan-score').value;
  const score = scores.find(item => item.id === scoreId);
  if (!date) return showToast('Elegí una fecha para la práctica.');
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 600) return showToast('La duración debe estar entre 5 y 600 minutos.');
  const plan = {
    id: makeId(), type: 'practice-plan', date, minutes,
    scoreId: score?.id || '', scoreTitle: score?.title || 'Práctica libre',
    note: plannerEl('#plan-note').value.trim(), done: false, createdAt: Date.now()
  };
  try {
    await storeRequest('readwrite', 'put', plan, PLANNER_STORE);
    plannerEntries.push(plan);
    plannerEl('#plan-note').value = '';
    selectedPlannerDate = date;
    const picked = parseLocalDate(date);
    calendarMonth = new Date(picked.getFullYear(), picked.getMonth(), 1);
    renderPlanner();
    showToast('Práctica agregada al calendario.');
  } catch (error) {
    console.error(error);
    showToast('No se pudo guardar la práctica programada.');
  }
}

async function updatePlanStatus(event) {
  if (!event.target.matches('[data-plan-done]')) return;
  const id = event.target.closest('[data-plan-id]')?.dataset.planId;
  const plan = plannerEntries.find(item => item.id === id);
  if (!plan) return;
  plan.done = event.target.checked;
  try {
    await storeRequest('readwrite', 'put', plan, PLANNER_STORE);
    renderPlanner();
    showToast(plan.done ? 'Práctica marcada como completada.' : 'Práctica marcada como pendiente.');
  } catch (error) {
    console.error(error);
    showToast('No se pudo actualizar la práctica.');
  }
}

async function deletePracticePlan(event) {
  const button = event.target.closest('[data-plan-delete]');
  if (!button) return;
  const id = button.closest('[data-plan-id]')?.dataset.planId;
  const plan = plannerEntries.find(item => item.id === id);
  if (!plan || !window.confirm('¿Eliminar esta práctica programada?')) return;
  try {
    await storeRequest('readwrite', 'delete', id, PLANNER_STORE);
    plannerEntries = plannerEntries.filter(item => item.id !== id);
    renderPlanner();
    showToast('Práctica eliminada del calendario.');
  } catch (error) {
    console.error(error);
    showToast('No se pudo eliminar la práctica.');
  }
}

async function saveWeeklyTarget(event) {
  event.preventDefault();
  const value = Number(plannerEl('#weekly-target-input').value);
  if (!Number.isInteger(value) || value < 0 || value > 10000) return showToast('El objetivo debe estar entre 0 y 10.000 minutos.');
  weeklyTargetMinutes = value;
  try {
    await storeRequest('readwrite', 'put', { id: '__settings__', weeklyTargetMinutes }, PLANNER_STORE);
    renderWeeklyTargetProgress();
    showToast('Objetivo semanal actualizado.');
  } catch (error) {
    console.error(error);
    showToast('No se pudo guardar el objetivo semanal.');
  }
}

// -----------------------------------------------------------------------------
// 4. Anotaciones ancladas sobre la página: coordenadas relativas y por página.
// -----------------------------------------------------------------------------
function setAnnotationMode(enabled) {
  annotationMode = Boolean(enabled);
  const button = plannerEl('#add-annotation-mode');
  if (!button) return;
  button.classList.toggle('is-active', annotationMode);
  button.setAttribute('aria-pressed', String(annotationMode));
  plannerEl('#annotation-hint').textContent = annotationMode
    ? 'Ahora tocá o hacé clic en el lugar de la partitura donde va la nota.'
    : 'Marcá un punto de la partitura para guardar una indicación.';
}

function toggleAnnotationMode() {
  if (!currentScore) return;
  if (plannerEl('#pdf-fallback').hidden === false) {
    showToast('Las anotaciones sobre la página necesitan que PDF.js pueda cargar el visor.');
    return;
  }
  setAnnotationMode(!annotationMode);
}

async function handleSheetAnnotationClick(event) {
  if (!currentScore) return;
  const existingPin = event.target.closest('[data-annotation-id]');
  if (existingPin) {
    const annotation = currentScore.annotations.find(item => item.id === existingPin.dataset.annotationId);
    if (annotation) editAnnotation(annotation);
    return;
  }
  if (!annotationMode) return;
  if (plannerEl('#pdf-fallback').hidden === false) {
    setAnnotationMode(false);
    return showToast('No se puede anclar una nota a este visor PDF alternativo.');
  }
  const rect = plannerEl('#sheet-page-wrap').getBoundingClientRect();
  if (!rect.width || !rect.height) return showToast('La página todavía no está lista.');
  const text = window.prompt('¿Qué querés recordar en este punto? (digitación, dinámica, compás difícil, etc.)');
  if (text === null) return setAnnotationMode(false);
  const trimmed = text.trim().slice(0, 240);
  if (!trimmed) return showToast('La anotación no puede quedar vacía.');
  const x = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
  const y = Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100));
  currentScore.annotations.push({ id: makeId(), page: currentPage, x, y, text: trimmed, createdAt: Date.now() });
  setAnnotationMode(false);
  const saved = await persistCurrentScore('Anotación guardada en la partitura.');
  if (saved) renderAnnotations();
}

async function editAnnotation(annotation) {
  const text = window.prompt('Editar anotación. Dejá el campo vacío para eliminarla.', annotation.text);
  if (text === null) return;
  const trimmed = text.trim().slice(0, 240);
  if (!trimmed) {
    if (!window.confirm('¿Eliminar esta anotación?')) return;
    currentScore.annotations = currentScore.annotations.filter(item => item.id !== annotation.id);
  } else {
    annotation.text = trimmed;
  }
  await persistCurrentScore(trimmed ? 'Anotación actualizada.' : 'Anotación eliminada.');
  renderAnnotations();
}

function renderAnnotations() {
  const layer = plannerEl('#annotation-layer');
  const list = plannerEl('#annotation-list');
  if (!layer || !list) return;
  if (!currentScore) {
    layer.innerHTML = '';
    list.innerHTML = '';
    return;
  }
  const annotations = (currentScore.annotations || []).filter(item => Number(item.page) === currentPage);
  layer.innerHTML = annotations.map((item, index) => `
    <button type="button" class="annotation-pin" data-annotation-id="${escapeHtml(item.id)}" style="left:${Math.max(0, Math.min(100, Number(item.x) || 0))}%;top:${Math.max(0, Math.min(100, Number(item.y) || 0))}%" aria-label="Anotación ${index + 1}: ${escapeHtml(item.text)}" title="${escapeHtml(item.text)}">${index + 1}</button>
  `).join('');
  list.innerHTML = annotations.length ? annotations.map((item, index) => `
    <div class="annotation-list-item" data-annotation-id="${escapeHtml(item.id)}">
      <span class="annotation-list-number">${index + 1}</span>
      <span class="annotation-list-text">${escapeHtml(item.text)}</span>
      <button type="button" data-annotation-edit aria-label="Editar anotación">Editar</button>
      <button type="button" data-annotation-delete aria-label="Eliminar anotación">×</button>
    </div>
  `).join('') : '<p class="annotation-empty">Todavía no hay anotaciones en esta página.</p>';
}

async function handleAnnotationListClick(event) {
  const row = event.target.closest('[data-annotation-id]');
  if (!row || !currentScore) return;
  const annotation = currentScore.annotations.find(item => item.id === row.dataset.annotationId);
  if (!annotation) return;
  if (event.target.closest('[data-annotation-edit]')) return editAnnotation(annotation);
  if (event.target.closest('[data-annotation-delete]')) {
    if (!window.confirm('¿Eliminar esta anotación?')) return;
    currentScore.annotations = currentScore.annotations.filter(item => item.id !== annotation.id);
    await persistCurrentScore('Anotación eliminada.');
    renderAnnotations();
  }
}

window.addEventListener('piano:ready', initializeEnhancements);
