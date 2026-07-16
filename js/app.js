(() => {
  'use strict';

  const STORAGE_KEY = 'cardlocke_state_v2';
  const OLD_TOTAL_KEY = 'gacha_total_robadas';
  const OLD_HISTORY_KEY = 'gacha_historial_cartas';
  const STATUS_LABELS = {
    active: 'Activa',
    saved: 'Guardada',
    resolved: 'Resuelta',
    discarded: 'Descartada'
  };
  const RARITY_ORDER = { N: 0, R: 1, SR: 2, SSR: 3, UR: 4 };
  const RARITY_WEIGHTS = [
    ['N', 40],
    ['R', 30],
    ['SR', 15],
    ['SSR', 10],
    ['UR', 5]
  ];

  const cards = Array.isArray(window.CARDLOCKE_CARDS) ? window.CARDLOCKE_CARDS : [];
  const cardById = new Map(cards.map(card => [card.id, card]));
  const cardByName = new Map(cards.map(card => [normalize(card.name), card]));

  const el = {
    activeRunTitle: document.querySelector('#active-run-title'),
    activeRunMeta: document.querySelector('#active-run-meta'),
    runDot: document.querySelector('#run-dot'),
    runProgressWrap: document.querySelector('#run-progress-wrap'),
    runProgressText: document.querySelector('#run-progress-text'),
    runProgressBar: document.querySelector('#run-progress-bar'),
    startRun: document.querySelector('#start-run'),
    finishRun: document.querySelector('#finish-run'),
    drawCard: document.querySelector('#draw-card'),
    drawLabel: document.querySelector('#draw-label'),
    hideCard: document.querySelector('#hide-card'),
    undoDraw: document.querySelector('#undo-draw'),
    cardVisual: document.querySelector('#card-visual'),
    cardImage: document.querySelector('#card-image'),
    rarity: document.querySelector('#rarity'),
    cardName: document.querySelector('#card-name'),
    cardDesc: document.querySelector('#card-desc'),
    runDrawCount: document.querySelector('#run-draw-count'),
    globalDrawCount: document.querySelector('#global-draw-count'),
    uniqueCardCount: document.querySelector('#unique-card-count'),
    topCardName: document.querySelector('#top-card-name'),
    currentCardStats: document.querySelector('#current-card-stats'),
    recentDraws: document.querySelector('#recent-draws'),
    gallery: document.querySelector('#gallery'),
    galleryEmpty: document.querySelector('#gallery-empty'),
    cardSearch: document.querySelector('#card-search'),
    cardSort: document.querySelector('#card-sort'),
    rarityFilters: document.querySelector('#rarity-filters'),
    startRunDialog: document.querySelector('#start-run-dialog'),
    startRunForm: document.querySelector('#start-run-form'),
    runName: document.querySelector('#run-name'),
    runGoal: document.querySelector('#run-goal'),
    finishRunDialog: document.querySelector('#finish-run-dialog'),
    finishRunForm: document.querySelector('#finish-run-form'),
    finishRunSummary: document.querySelector('#finish-run-summary'),
    finishRunNote: document.querySelector('#finish-run-note'),
    openHistory: document.querySelector('#open-history'),
    viewCurrentHistory: document.querySelector('#view-current-history'),
    historyDialog: document.querySelector('#history-dialog'),
    historyScope: document.querySelector('#history-scope'),
    historySearch: document.querySelector('#history-search'),
    historySummary: document.querySelector('#history-summary'),
    historyBody: document.querySelector('#history-body'),
    historyEmpty: document.querySelector('#history-empty'),
    exportCurrentView: document.querySelector('#export-current-view'),
    openBackup: document.querySelector('#open-backup'),
    backupDialog: document.querySelector('#backup-dialog'),
    exportData: document.querySelector('#export-data'),
    importData: document.querySelector('#import-data'),
    clearData: document.querySelector('#clear-data'),
    cardDialog: document.querySelector('#card-dialog'),
    detailImage: document.querySelector('#detail-image'),
    detailRarity: document.querySelector('#detail-rarity'),
    detailName: document.querySelector('#detail-name'),
    detailDescription: document.querySelector('#detail-description'),
    detailStats: document.querySelector('#detail-stats'),
    toastRegion: document.querySelector('#toast-region'),
    installApp: document.querySelector('#install-app')
  };

  let state = loadState();
  let currentCardId = null;
  let isDrawing = false;
  let activeRarityFilter = 'ALL';
  let deferredInstallPrompt = null;

  init();

  function init() {
    bindEvents();
    renderAll();
    registerServiceWorker();
    showMigrationMessage();
  }

  function bindEvents() {
    el.startRun.addEventListener('click', openStartRunDialog);
    el.finishRun.addEventListener('click', openFinishRunDialog);
    el.drawCard.addEventListener('click', drawCard);
    el.hideCard.addEventListener('click', hideCard);
    el.undoDraw.addEventListener('click', undoLastDraw);
    el.startRunForm.addEventListener('submit', createRun);
    el.finishRunForm.addEventListener('submit', finishCurrentRun);
    el.openHistory.addEventListener('click', () => openHistory('all'));
    el.viewCurrentHistory.addEventListener('click', () => openHistory(getActiveRun()?.id || 'all'));
    el.historyScope.addEventListener('change', renderHistory);
    el.historySearch.addEventListener('input', renderHistory);
    el.exportCurrentView.addEventListener('click', exportHistoryCsv);
    el.openBackup.addEventListener('click', () => el.backupDialog.showModal());
    el.exportData.addEventListener('click', exportBackup);
    el.importData.addEventListener('change', importBackup);
    el.clearData.addEventListener('click', clearAllData);
    el.cardSearch.addEventListener('input', renderGallery);
    el.cardSort.addEventListener('change', renderGallery);
    el.rarityFilters.addEventListener('click', event => {
      const button = event.target.closest('[data-rarity]');
      if (!button) return;
      activeRarityFilter = button.dataset.rarity;
      el.rarityFilters.querySelectorAll('[data-rarity]').forEach(item => item.classList.toggle('is-active', item === button));
      renderGallery();
    });

    document.querySelectorAll('.close-dialog').forEach(button => {
      button.addEventListener('click', () => button.closest('dialog')?.close());
    });

    document.querySelectorAll('dialog').forEach(dialog => {
      dialog.addEventListener('click', event => {
        if (event.target === dialog) dialog.close();
      });
    });

    document.addEventListener('keydown', event => {
      if (event.code !== 'Space' || event.repeat) return;
      if (document.querySelector('dialog[open]')) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target instanceof HTMLButtonElement) return;
      event.preventDefault();
      if (!el.drawCard.disabled) drawCard();
    });

    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      deferredInstallPrompt = event;
      el.installApp.hidden = false;
    });
    el.installApp.addEventListener('click', installApp);
  }

  function defaultState() {
    return {
      version: 2,
      activeRunId: null,
      runs: [],
      draws: [],
      migratedFromV1: false,
      createdAt: new Date().toISOString()
    };
  }

  function loadState() {
    const fallback = defaultState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isValidState(parsed)) return sanitizeState(parsed);
      }
    } catch (error) {
      console.warn('No se pudo leer el estado guardado.', error);
    }
    return migrateLegacyState(fallback);
  }

  function isValidState(candidate) {
    return candidate && candidate.version === 2 && Array.isArray(candidate.runs) && Array.isArray(candidate.draws);
  }

  function sanitizeState(candidate) {
    const clean = defaultState();
    clean.activeRunId = typeof candidate.activeRunId === 'string' ? candidate.activeRunId : null;
    clean.runs = candidate.runs.filter(Boolean).map(run => ({
      id: String(run.id || createId()),
      name: String(run.name || 'Locke sin nombre').slice(0, 60),
      startedAt: safeIso(run.startedAt) || new Date().toISOString(),
      endedAt: safeIso(run.endedAt),
      goal: Number.isFinite(Number(run.goal)) && Number(run.goal) > 0 ? Math.min(999, Math.floor(Number(run.goal))) : null,
      finalNote: String(run.finalNote || '').slice(0, 300)
    }));
    const runIds = new Set(clean.runs.map(run => run.id));
    clean.draws = candidate.draws.filter(draw => draw && runIds.has(String(draw.runId)) && cardById.has(String(draw.cardId))).map(draw => ({
      id: String(draw.id || createId()),
      runId: String(draw.runId),
      cardId: String(draw.cardId),
      drawnAt: safeIso(draw.drawnAt),
      status: STATUS_LABELS[draw.status] ? draw.status : 'active',
      note: String(draw.note || '').slice(0, 240),
      legacy: Boolean(draw.legacy)
    }));
    if (!runIds.has(clean.activeRunId) || clean.runs.find(run => run.id === clean.activeRunId)?.endedAt) clean.activeRunId = null;
    clean.migratedFromV1 = Boolean(candidate.migratedFromV1);
    clean.createdAt = safeIso(candidate.createdAt) || new Date().toISOString();
    return clean;
  }

  function migrateLegacyState(base) {
    try {
      const oldHistory = JSON.parse(localStorage.getItem(OLD_HISTORY_KEY) || 'null');
      const oldTotal = Number.parseInt(localStorage.getItem(OLD_TOTAL_KEY) || '0', 10);
      if (!oldHistory || typeof oldHistory !== 'object' || oldTotal <= 0) return base;

      const now = new Date().toISOString();
      const run = {
        id: createId(),
        name: 'Historial anterior',
        startedAt: now,
        endedAt: now,
        goal: null,
        finalNote: 'Datos migrados automáticamente desde la versión original.'
      };
      base.runs.push(run);
      for (const [name, countValue] of Object.entries(oldHistory)) {
        const card = cardByName.get(normalize(name));
        const count = Math.max(0, Math.min(10000, Number.parseInt(countValue, 10) || 0));
        if (!card) continue;
        for (let index = 0; index < count; index += 1) {
          base.draws.push({
            id: createId(),
            runId: run.id,
            cardId: card.id,
            drawnAt: null,
            status: 'resolved',
            note: 'Migrado de la versión anterior',
            legacy: true
          });
        }
      }
      base.migratedFromV1 = true;
      saveState(base);
      return base;
    } catch (error) {
      console.warn('No se pudo migrar el historial anterior.', error);
      return base;
    }
  }

  function saveState(nextState = state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    } catch (error) {
      console.error('No se pudo guardar el estado.', error);
      toast('No se pudieron guardar los datos', 'Puede que el almacenamiento del navegador esté lleno.');
    }
  }

  function renderAll() {
    renderRunStrip();
    renderStats();
    renderRecent();
    renderGallery();
    renderCurrentCardStats();
  }

  function getActiveRun() {
    return state.runs.find(run => run.id === state.activeRunId && !run.endedAt) || null;
  }

  function getRunDraws(runId) {
    return state.draws.filter(draw => draw.runId === runId);
  }

  function renderRunStrip() {
    const activeRun = getActiveRun();
    const activeDraws = activeRun ? getRunDraws(activeRun.id) : [];
    el.runDot.classList.toggle('is-active', Boolean(activeRun));
    el.startRun.hidden = Boolean(activeRun);
    el.finishRun.hidden = !activeRun;
    el.drawCard.disabled = !activeRun || isDrawing;
    el.undoDraw.disabled = !activeRun || activeDraws.length === 0 || isDrawing;

    if (!activeRun) {
      el.activeRunTitle.textContent = 'Ninguna partida activa';
      el.activeRunMeta.textContent = state.runs.length ? `${state.runs.length} partida${state.runs.length === 1 ? '' : 's'} guardada${state.runs.length === 1 ? '' : 's'} en este navegador.` : 'Empieza una partida para registrar tus robos por separado.';
      el.runProgressWrap.hidden = true;
      return;
    }

    el.activeRunTitle.textContent = activeRun.name;
    el.activeRunMeta.textContent = `Empezada ${formatDate(activeRun.startedAt)} · ${activeDraws.length} carta${activeDraws.length === 1 ? '' : 's'} robada${activeDraws.length === 1 ? '' : 's'}`;
    if (activeRun.goal) {
      const percentage = Math.min(100, (activeDraws.length / activeRun.goal) * 100);
      el.runProgressWrap.hidden = false;
      el.runProgressText.textContent = `${activeDraws.length} / ${activeRun.goal}`;
      el.runProgressBar.style.width = `${percentage}%`;
    } else {
      el.runProgressWrap.hidden = true;
    }
  }

  function renderStats() {
    const activeRun = getActiveRun();
    const activeDraws = activeRun ? getRunDraws(activeRun.id) : [];
    const globalCounts = countByCard(state.draws);
    const uniqueCount = [...globalCounts.values()].filter(count => count > 0).length;
    const topEntry = [...globalCounts.entries()].sort((a, b) => b[1] - a[1])[0];

    el.runDrawCount.textContent = String(activeDraws.length);
    el.globalDrawCount.textContent = String(state.draws.length);
    el.uniqueCardCount.textContent = String(uniqueCount);
    el.topCardName.textContent = topEntry ? cardById.get(topEntry[0])?.name || '—' : '—';
    el.topCardName.title = el.topCardName.textContent;
  }

  function renderCurrentCardStats() {
    el.currentCardStats.replaceChildren();
    if (!currentCardId || !cardById.has(currentCardId)) {
      const paragraph = document.createElement('p');
      paragraph.className = 'muted';
      paragraph.textContent = 'Aquí aparecerán las estadísticas de la carta revelada.';
      el.currentCardStats.append(paragraph);
      return;
    }
    const card = cardById.get(currentCardId);
    const activeRun = getActiveRun();
    const globalCount = state.draws.filter(draw => draw.cardId === card.id).length;
    const runCount = activeRun ? state.draws.filter(draw => draw.runId === activeRun.id && draw.cardId === card.id).length : 0;
    const globalPercent = state.draws.length ? (globalCount / state.draws.length) * 100 : 0;
    appendStatRow(el.currentCardStats, 'En esta run', `${runCount} ${runCount === 1 ? 'vez' : 'veces'}`);
    appendStatRow(el.currentCardStats, 'En global', `${globalCount} ${globalCount === 1 ? 'vez' : 'veces'}`);
    appendStatRow(el.currentCardStats, 'Porcentaje global', `${globalPercent.toFixed(2)}%`);
  }

  function appendStatRow(parent, label, value) {
    const row = document.createElement('div');
    row.className = 'card-stat-row';
    const left = document.createElement('span');
    left.textContent = label;
    const right = document.createElement('strong');
    right.textContent = value;
    row.append(left, right);
    parent.append(row);
  }

  function renderRecent() {
    el.recentDraws.replaceChildren();
    const recent = [...state.draws].sort(compareDrawsNewestFirst).slice(0, 6);
    if (!recent.length) {
      const item = document.createElement('li');
      item.className = 'empty-state';
      item.textContent = 'Todavía no hay robos registrados.';
      el.recentDraws.append(item);
      return;
    }
    recent.forEach(draw => {
      const card = cardById.get(draw.cardId);
      const run = state.runs.find(item => item.id === draw.runId);
      if (!card || !run) return;
      const item = document.createElement('li');
      item.className = 'recent-item';
      const image = document.createElement('img');
      image.src = card.thumbnail;
      image.alt = '';
      image.width = 42;
      image.height = 59;
      image.loading = 'lazy';
      const copy = document.createElement('div');
      copy.className = 'recent-copy';
      const name = document.createElement('strong');
      name.textContent = card.name;
      const meta = document.createElement('span');
      meta.textContent = `${run.name} · ${draw.drawnAt ? formatDateTime(draw.drawnAt) : 'Historial anterior'}`;
      copy.append(name, meta);
      const status = document.createElement('span');
      status.className = 'recent-status';
      status.textContent = STATUS_LABELS[draw.status];
      item.append(image, copy, status);
      el.recentDraws.append(item);
    });
  }

  function renderGallery() {
    const search = normalize(el.cardSearch.value);
    const globalCounts = countByCard(state.draws);
    let filtered = cards.filter(card => {
      const matchesRarity = activeRarityFilter === 'ALL' || card.rarity === activeRarityFilter;
      const matchesSearch = !search || normalize(`${card.name} ${card.description}`).includes(search);
      return matchesRarity && matchesSearch;
    });

    const sortMode = el.cardSort.value;
    filtered = [...filtered].sort((a, b) => {
      if (sortMode === 'name') return a.name.localeCompare(b.name, 'es');
      if (sortMode === 'draws') return (globalCounts.get(b.id) || 0) - (globalCounts.get(a.id) || 0) || a.name.localeCompare(b.name, 'es');
      return RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity] || a.name.localeCompare(b.name, 'es');
    });

    el.gallery.replaceChildren();
    el.galleryEmpty.hidden = filtered.length > 0;
    filtered.forEach(card => {
      const article = document.createElement('article');
      article.className = 'collection-card';
      article.tabIndex = 0;
      article.setAttribute('role', 'button');
      article.setAttribute('aria-label', `Ver ${card.name}`);
      article.addEventListener('click', () => openCardDetail(card.id));
      article.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openCardDetail(card.id);
        }
      });

      const imageWrap = document.createElement('div');
      imageWrap.className = 'collection-image-wrap';
      const image = document.createElement('img');
      image.src = card.thumbnail;
      image.alt = card.name;
      image.width = 300;
      image.height = 419;
      image.loading = 'lazy';
      image.decoding = 'async';
      const count = document.createElement('span');
      count.className = 'draw-count-pill';
      count.textContent = `${globalCounts.get(card.id) || 0} robos`;
      imageWrap.append(image, count);

      const copy = document.createElement('div');
      copy.className = 'collection-copy';
      copy.append(createRarityBadge(card.rarity));
      const title = document.createElement('h3');
      title.textContent = card.name;
      const description = document.createElement('p');
      description.textContent = card.description;
      copy.append(title, description);
      article.append(imageWrap, copy);
      el.gallery.append(article);
    });
  }

  function openStartRunDialog() {
    if (getActiveRun()) return;
    el.startRunForm.reset();
    el.startRunDialog.showModal();
    window.setTimeout(() => el.runName.focus(), 30);
  }

  function createRun(event) {
    event.preventDefault();
    const name = el.runName.value.trim();
    if (!name) {
      el.runName.focus();
      return;
    }
    const goalValue = Number.parseInt(el.runGoal.value, 10);
    const run = {
      id: createId(),
      name: name.slice(0, 60),
      startedAt: new Date().toISOString(),
      endedAt: null,
      goal: Number.isFinite(goalValue) && goalValue > 0 ? Math.min(goalValue, 999) : null,
      finalNote: ''
    };
    state.runs.push(run);
    state.activeRunId = run.id;
    saveState();
    el.startRunDialog.close();
    hideCard(false);
    renderAll();
    toast('Locke empezado', run.name);
  }

  function openFinishRunDialog() {
    const run = getActiveRun();
    if (!run) return;
    const draws = getRunDraws(run.id);
    el.finishRunSummary.textContent = `“${run.name}” tiene ${draws.length} carta${draws.length === 1 ? '' : 's'} registrada${draws.length === 1 ? '' : 's'}. Después de finalizar podrás consultarla en el historial global o por separado.`;
    el.finishRunNote.value = run.finalNote || '';
    el.finishRunDialog.showModal();
  }

  function finishCurrentRun(event) {
    event.preventDefault();
    const run = getActiveRun();
    if (!run) return;
    run.endedAt = new Date().toISOString();
    run.finalNote = el.finishRunNote.value.trim().slice(0, 300);
    state.activeRunId = null;
    saveState();
    el.finishRunDialog.close();
    renderAll();
    toast('Locke finalizado', `${run.name} se ha guardado en el historial.`);
  }

  function drawCard() {
    const run = getActiveRun();
    if (!run) {
      openStartRunDialog();
      return;
    }
    if (isDrawing) return;
    isDrawing = true;
    el.drawLabel.textContent = 'Robando…';
    renderRunStrip();
    el.cardVisual.classList.add('is-flipping');

    window.setTimeout(() => {
      const card = pickRandomCard();
      const draw = {
        id: createId(),
        runId: run.id,
        cardId: card.id,
        drawnAt: new Date().toISOString(),
        status: 'active',
        note: '',
        legacy: false
      };
      state.draws.push(draw);
      currentCardId = card.id;
      saveState();
      showCard(card);

      window.setTimeout(() => {
        el.cardVisual.classList.remove('is-flipping');
        isDrawing = false;
        el.drawLabel.textContent = 'Revelar carta';
        renderAll();
        const drawCount = getRunDraws(run.id).length;
        if (run.goal && drawCount >= run.goal) {
          toast('Objetivo alcanzado', `Has robado ${drawCount} cartas. Ya puedes finalizar el locke.`);
          window.setTimeout(() => {
            if (getActiveRun()?.id === run.id && !el.finishRunDialog.open) openFinishRunDialog();
          }, 650);
        }
      }, 70);
    }, 250);
  }

  function pickRandomCard() {
    const roll = randomInt(1, 100);
    let cumulative = 0;
    let rarity = 'N';
    for (const [candidate, weight] of RARITY_WEIGHTS) {
      cumulative += weight;
      if (roll <= cumulative) {
        rarity = candidate;
        break;
      }
    }
    const pool = cards.filter(card => card.rarity === rarity);
    return pool[randomInt(0, pool.length - 1)];
  }

  function randomInt(min, max) {
    const range = max - min + 1;
    if (window.crypto?.getRandomValues) {
      const maxUint = 0xFFFFFFFF;
      const limit = maxUint - (maxUint % range);
      const buffer = new Uint32Array(1);
      let value;
      do {
        window.crypto.getRandomValues(buffer);
        value = buffer[0];
      } while (value >= limit);
      return min + (value % range);
    }
    return min + Math.floor(Math.random() * range);
  }

  function showCard(card) {
    el.cardImage.src = card.image;
    el.cardImage.alt = card.name;
    el.cardVisual.classList.remove('is-hidden-card');
    el.rarity.hidden = false;
    el.rarity.className = `rarity-badge rarity-${card.rarity}`;
    el.rarity.textContent = card.rarity;
    el.cardName.textContent = card.name;
    el.cardDesc.textContent = card.description;
  }

  function hideCard(animate = true) {
    if (isDrawing) return;
    const reset = () => {
      currentCardId = null;
      el.cardImage.src = 'assets/cards/reverso.webp';
      el.cardImage.alt = 'Reverso de una carta Cardlocke';
      el.cardVisual.classList.add('is-hidden-card');
      el.rarity.hidden = true;
      el.rarity.className = 'rarity-badge';
      el.cardName.textContent = '¿Listo para tu suerte?';
      el.cardDesc.textContent = getActiveRun() ? 'Pulsa el botón para revelar una carta.' : 'Empieza un locke y pulsa el botón para revelar una carta.';
      renderCurrentCardStats();
    };
    if (!animate) {
      reset();
      return;
    }
    el.cardVisual.classList.add('is-flipping');
    window.setTimeout(() => {
      reset();
      window.setTimeout(() => el.cardVisual.classList.remove('is-flipping'), 40);
    }, 230);
  }

  function undoLastDraw() {
    const run = getActiveRun();
    if (!run || isDrawing) return;
    const draws = getRunDraws(run.id).sort(compareDrawsNewestFirst);
    const last = draws[0];
    if (!last) return;
    const card = cardById.get(last.cardId);
    if (!window.confirm(`¿Deshacer el último robo (${card?.name || 'carta'})?`)) return;
    state.draws = state.draws.filter(draw => draw.id !== last.id);
    if (currentCardId === last.cardId) hideCard(false);
    saveState();
    renderAll();
    toast('Robo deshecho', card?.name || 'Se eliminó la última carta.');
  }

  function openHistory(scope = 'all') {
    populateHistoryScope(scope);
    el.historySearch.value = '';
    renderHistory();
    el.historyDialog.showModal();
  }

  function populateHistoryScope(preferred = 'all') {
    el.historyScope.replaceChildren();
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = 'Historial global';
    el.historyScope.append(all);
    [...state.runs].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).forEach(run => {
      const option = document.createElement('option');
      option.value = run.id;
      option.textContent = `${run.endedAt ? 'Finalizado' : 'Activo'} · ${run.name}`;
      el.historyScope.append(option);
    });
    el.historyScope.value = [...el.historyScope.options].some(option => option.value === preferred) ? preferred : 'all';
  }

  function getFilteredHistoryDraws() {
    const scope = el.historyScope.value;
    const query = normalize(el.historySearch.value);
    return state.draws.filter(draw => {
      if (scope !== 'all' && draw.runId !== scope) return false;
      if (!query) return true;
      const card = cardById.get(draw.cardId);
      const run = state.runs.find(item => item.id === draw.runId);
      return normalize(`${card?.name || ''} ${card?.description || ''} ${run?.name || ''} ${draw.note || ''} ${STATUS_LABELS[draw.status] || ''}`).includes(query);
    }).sort(compareDrawsNewestFirst);
  }

  function renderHistory() {
    const draws = getFilteredHistoryDraws();
    renderHistorySummary(draws);
    el.historyBody.replaceChildren();
    el.historyEmpty.hidden = draws.length > 0;
    draws.forEach(draw => el.historyBody.append(createHistoryRow(draw)));
  }

  function renderHistorySummary(draws) {
    el.historySummary.replaceChildren();
    const counts = countByCard(draws);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const urCount = draws.filter(draw => cardById.get(draw.cardId)?.rarity === 'UR').length;
    const activeCount = draws.filter(draw => draw.status === 'active' || draw.status === 'saved').length;
    [
      ['Robos', String(draws.length)],
      ['Cartas únicas', String(counts.size)],
      ['Más repetida', top ? cardById.get(top[0])?.name || '—' : '—'],
      ['UR / pendientes', `${urCount} / ${activeCount}`]
    ].forEach(([label, value]) => {
      const box = document.createElement('div');
      box.className = 'metric';
      const span = document.createElement('span');
      span.textContent = label;
      const strong = document.createElement('strong');
      strong.textContent = value;
      strong.title = value;
      box.append(span, strong);
      el.historySummary.append(box);
    });
  }

  function createHistoryRow(draw) {
    const row = document.createElement('tr');
    const card = cardById.get(draw.cardId);
    const run = state.runs.find(item => item.id === draw.runId);
    appendCell(row, draw.drawnAt ? formatDateTime(draw.drawnAt) : 'Anterior');
    appendCell(row, run?.name || '—');
    appendCell(row, card?.name || 'Carta desconocida');
    const rarityCell = document.createElement('td');
    rarityCell.append(createRarityBadge(card?.rarity || 'N'));
    row.append(rarityCell);

    const statusCell = document.createElement('td');
    const select = document.createElement('select');
    select.setAttribute('aria-label', `Estado de ${card?.name || 'carta'}`);
    Object.entries(STATUS_LABELS).forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.append(option);
    });
    select.value = draw.status;
    select.addEventListener('change', () => {
      draw.status = select.value;
      saveState();
      renderRecent();
      renderHistorySummary(getFilteredHistoryDraws());
    });
    statusCell.append(select);
    row.append(statusCell);

    const noteCell = document.createElement('td');
    const note = document.createElement('input');
    note.type = 'text';
    note.maxLength = 240;
    note.placeholder = 'Añadir nota…';
    note.value = draw.note || '';
    note.setAttribute('aria-label', `Nota de ${card?.name || 'carta'}`);
    note.addEventListener('change', () => {
      draw.note = note.value.trim().slice(0, 240);
      saveState();
    });
    noteCell.append(note);
    row.append(noteCell);
    return row;
  }

  function appendCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.append(cell);
  }

  function exportHistoryCsv() {
    const draws = getFilteredHistoryDraws();
    const rows = [['Fecha', 'Partida', 'Carta', 'Rareza', 'Estado', 'Nota']];
    draws.forEach(draw => {
      const card = cardById.get(draw.cardId);
      const run = state.runs.find(item => item.id === draw.runId);
      rows.push([
        draw.drawnAt || 'Historial anterior',
        run?.name || '',
        card?.name || '',
        card?.rarity || '',
        STATUS_LABELS[draw.status] || draw.status,
        draw.note || ''
      ]);
    });
    const csv = '\uFEFF' + rows.map(row => row.map(csvEscape).join(';')).join('\n');
    const scope = el.historyScope.value === 'all' ? 'global' : slugify(state.runs.find(run => run.id === el.historyScope.value)?.name || 'partida');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `cardlocke-historial-${scope}.csv`);
  }

  function openCardDetail(cardId) {
    const card = cardById.get(cardId);
    if (!card) return;
    const globalCount = state.draws.filter(draw => draw.cardId === card.id).length;
    const activeRun = getActiveRun();
    const activeCount = activeRun ? state.draws.filter(draw => draw.runId === activeRun.id && draw.cardId === card.id).length : 0;
    const perCardProbability = RARITY_WEIGHTS.find(([rarity]) => rarity === card.rarity)?.[1] / cards.filter(item => item.rarity === card.rarity).length || 0;
    el.detailImage.src = card.image;
    el.detailImage.alt = card.name;
    el.detailRarity.className = `rarity-badge rarity-${card.rarity}`;
    el.detailRarity.textContent = card.rarity;
    el.detailName.textContent = card.name;
    el.detailDescription.textContent = card.description;
    el.detailStats.replaceChildren();
    [
      ['Robos globales', String(globalCount)],
      ['Robos en la run activa', String(activeCount)],
      ['Probabilidad aproximada', `${perCardProbability.toFixed(2)}% por robo`]
    ].forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'detail-stat';
      const left = document.createElement('span');
      left.textContent = label;
      const right = document.createElement('strong');
      right.textContent = value;
      row.append(left, right);
      el.detailStats.append(row);
    });
    el.cardDialog.showModal();
  }

  function exportBackup() {
    const payload = {
      format: 'cardlocke-backup',
      exportedAt: new Date().toISOString(),
      appVersion: '2.0.0',
      state
    };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `cardlocke-backup-${dateStamp()}.json`);
    toast('Copia exportada', 'Guarda el archivo en un lugar seguro.');
  }

  async function importBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const candidate = parsed?.format === 'cardlocke-backup' ? parsed.state : parsed;
      if (!isValidState(candidate)) throw new Error('Formato no reconocido');
      if (!window.confirm('La importación reemplazará las partidas guardadas en este navegador. ¿Continuar?')) return;
      state = sanitizeState(candidate);
      saveState();
      currentCardId = null;
      el.backupDialog.close();
      hideCard(false);
      renderAll();
      toast('Copia importada', `${state.runs.length} partidas y ${state.draws.length} robos recuperados.`);
    } catch (error) {
      console.warn(error);
      toast('No se pudo importar', 'El archivo no parece ser una copia válida de Cardlocke.');
    }
  }

  function clearAllData() {
    if (!window.confirm('Esto borrará todas las partidas, robos, estados y notas de este navegador. ¿Continuar?')) return;
    if (!window.confirm('Última confirmación: esta acción no se puede deshacer si no tienes una copia exportada.')) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(OLD_TOTAL_KEY);
    localStorage.removeItem(OLD_HISTORY_KEY);
    state = defaultState();
    currentCardId = null;
    saveState();
    el.backupDialog.close();
    hideCard(false);
    renderAll();
    toast('Datos borrados', 'Cardlocke ha vuelto a su estado inicial.');
  }

  function installApp() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.finally(() => {
      deferredInstallPrompt = null;
      el.installApp.hidden = true;
    });
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
      navigator.serviceWorker.register('./service-worker.js').catch(error => console.warn('Service worker no disponible.', error));
    }
  }

  function showMigrationMessage() {
    if (!state.migratedFromV1 || sessionStorage.getItem('cardlocke_migration_notice')) return;
    sessionStorage.setItem('cardlocke_migration_notice', '1');
    toast('Historial recuperado', 'Los contadores de la versión anterior están en “Historial anterior”.');
  }

  function createRarityBadge(rarity) {
    const badge = document.createElement('span');
    badge.className = `rarity-badge rarity-${rarity}`;
    badge.textContent = rarity;
    return badge;
  }

  function countByCard(draws) {
    const counts = new Map();
    draws.forEach(draw => counts.set(draw.cardId, (counts.get(draw.cardId) || 0) + 1));
    return counts;
  }

  function compareDrawsNewestFirst(a, b) {
    if (!a.drawnAt && !b.drawnAt) return 0;
    if (!a.drawnAt) return 1;
    if (!b.drawnAt) return -1;
    return b.drawnAt.localeCompare(a.drawnAt);
  }

  function safeIso(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function formatDate(value) {
    if (!value) return 'sin fecha';
    return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(new Date(value));
  }

  function formatDateTime(value) {
    if (!value) return 'Historial anterior';
    return new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  }

  function normalize(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function slugify(value) {
    return normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cardlocke';
  }

  function createId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function dateStamp() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function toast(title, message) {
    const item = document.createElement('div');
    item.className = 'toast';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const span = document.createElement('span');
    span.textContent = message;
    item.append(strong, span);
    el.toastRegion.append(item);
    requestAnimationFrame(() => item.classList.add('is-visible'));
    window.setTimeout(() => {
      item.classList.remove('is-visible');
      window.setTimeout(() => item.remove(), 220);
    }, 4200);
  }
})();
