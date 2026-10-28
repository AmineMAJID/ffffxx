'use strict';

(() => {
  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
  const PAGE_SIZE = 25;
  const byId = (id) => document.getElementById(id);

  const dom = {
    uploadView: byId('upload-view'),
    processingView: byId('processing-view'),
    editorView: byId('editor-view'),
    workspace: byId('workspace'),
    uploadForm: byId('upload-form'),
    fileInput: byId('file-input'),
    dropZone: byId('drop-zone'),
    selectedFile: byId('selected-file'),
    selectedFileName: byId('selected-file-name'),
    selectedFileSize: byId('selected-file-size'),
    clearFile: byId('clear-file'),
    contentKey: byId('content-key'),
    decodeButton: byId('decode-button'),
    uploadError: byId('upload-error'),
    processingTitle: byId('processing-title'),
    processingFile: byId('processing-file'),
    uploadProgress: byId('upload-progress'),
    progressStatus: byId('progress-status'),
    progressValue: byId('progress-value'),
    stageUpload: byId('stage-upload'),
    stageDecode: byId('stage-decode'),
    stageReady: byId('stage-ready'),
    resultBanner: byId('result-banner'),
    resultIcon: byId('result-icon'),
    resultTitle: byId('result-title'),
    resultDescription: byId('result-description'),
    resultTags: byId('result-tags'),
    editorError: byId('editor-error'),
    summaryOneLabel: byId('summary-one-label'),
    summaryOneValue: byId('summary-one-value'),
    summaryTwoLabel: byId('summary-two-label'),
    summaryTwoValue: byId('summary-two-value'),
    summaryThreeLabel: byId('summary-three-label'),
    summaryThreeValue: byId('summary-three-value'),
    summaryFourLabel: byId('summary-four-label'),
    summaryFourValue: byId('summary-four-value'),
    archiveEditor: byId('archive-editor'),
    binaryResult: byId('binary-result'),
    fileCountBadge: byId('file-count-badge'),
    resetArchive: byId('reset-archive'),
    clearArchive: byId('clear-archive'),
    fileSearch: byId('file-search'),
    fileSort: byId('file-sort'),
    removeSelected: byId('remove-selected'),
    selectedCount: byId('selected-count'),
    selectPage: byId('select-page'),
    tableContainer: byId('table-container'),
    fileList: byId('file-list'),
    emptyState: byId('empty-state'),
    emptyTitle: byId('empty-title'),
    emptyDescription: byId('empty-description'),
    paginationSummary: byId('pagination-summary'),
    previousPage: byId('previous-page'),
    nextPage: byId('next-page'),
    pageIndicator: byId('page-indicator'),
    newUpload: byId('new-upload'),
    sessionExpiry: byId('session-expiry'),
    downloadButton: byId('download-button'),
    downloadLabel: byId('download-label'),
    clearDialog: byId('clear-dialog'),
    confirmClear: byId('confirm-clear'),
    toastRegion: byId('toast-region'),
    backendStatus: byId('backend-status'),
  };

  const state = {
    file: null,
    job: null,
    selected: new Set(),
    query: '',
    sort: 'name-asc',
    page: 1,
    uploading: false,
    mutating: false,
  };

  function createIcon(symbol) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    use.setAttribute('href', symbol);
    svg.appendChild(use);
    return svg;
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KiB', 'MiB', 'GiB'];
    let size = bytes;
    let unit = -1;
    do { size /= 1024; unit += 1; } while (size >= 1024 && unit < units.length - 1);
    const digits = size >= 100 ? 0 : size >= 10 ? 1 : 2;
    return `${size.toFixed(digits).replace(/\.0+$|(\.\d)0$/, '$1')} ${units[unit]}`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'soon';
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function showAlert(element, message) {
    element.querySelector('span').textContent = message;
    element.hidden = false;
  }

  function hideAlert(element) {
    element.hidden = true;
    element.querySelector('span').textContent = '';
  }

  function showToast(message, type = 'success') {
    while (dom.toastRegion.children.length >= 3) dom.toastRegion.firstElementChild.remove();
    const toast = document.createElement('div');
    toast.className = `toast${type === 'error' ? ' error' : ''}`;
    toast.appendChild(createIcon(type === 'error' ? '#icon-alert' : '#icon-check-circle'));
    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);
    dom.toastRegion.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add('removing');
      window.setTimeout(() => toast.remove(), 220);
    }, 4200);
  }

  function setView(view) {
    dom.uploadView.hidden = view !== 'upload';
    dom.processingView.hidden = view !== 'processing';
    dom.editorView.hidden = view !== 'editor';
    const activeStep = view === 'upload' ? 1 : view === 'processing' ? 2 : 3;
    document.querySelectorAll('.stepper [data-step]').forEach((step) => {
      const number = Number(step.dataset.step);
      step.classList.toggle('current', number === activeStep);
      step.classList.toggle('complete', number < activeStep);
    });
  }

  function validateFile(file) {
    if (!file) return 'Choose a file to continue.';
    if (!/\.(fxap|zip)$/i.test(file.name)) return 'Only .fxap and .zip files are accepted.';
    if (file.size === 0) return 'The selected file is empty.';
    if (file.size > MAX_UPLOAD_BYTES) return 'The selected file exceeds the 25 MiB upload limit.';
    return null;
  }

  function selectFile(file) {
    const error = validateFile(file);
    if (error) {
      showAlert(dom.uploadError, error);
      return;
    }
    hideAlert(dom.uploadError);
    state.file = file;
    dom.selectedFileName.textContent = file.name;
    dom.selectedFileName.title = file.name;
    dom.selectedFileSize.textContent = `${formatBytes(file.size)} · Ready to upload`;
    dom.dropZone.hidden = true;
    dom.selectedFile.hidden = false;
    dom.decodeButton.disabled = false;
  }

  function resetFileSelection() {
    state.file = null;
    dom.fileInput.value = '';
    dom.selectedFile.hidden = true;
    dom.dropZone.hidden = false;
    dom.decodeButton.disabled = true;
    dom.selectedFileName.textContent = '';
  }

  function setStage(stage, percent = null) {
    const stages = [dom.stageUpload, dom.stageDecode, dom.stageReady];
    stages.forEach((element) => element.classList.remove('current', 'complete'));
    if (stage === 'upload') {
      dom.stageUpload.classList.add('current');
      dom.processingTitle.textContent = 'Uploading your file…';
      dom.progressStatus.textContent = 'Uploading securely';
      dom.uploadProgress.value = percent || 0;
      dom.progressValue.textContent = `${Math.round(percent || 0)}%`;
    } else if (stage === 'decode') {
      dom.stageUpload.classList.add('complete');
      dom.stageDecode.classList.add('current');
      dom.processingTitle.textContent = 'Decoding and inspecting…';
      dom.progressStatus.textContent = 'Server is decoding the payload';
      dom.uploadProgress.removeAttribute('value');
      dom.progressValue.textContent = 'Processing';
    } else {
      stages.forEach((element) => element.classList.add('complete'));
      dom.processingTitle.textContent = 'Your workspace is ready.';
      dom.progressStatus.textContent = 'Decode and inspection complete';
      dom.uploadProgress.value = 100;
      dom.progressValue.textContent = '100%';
    }
  }

  function uploadErrorFromXhr(xhr) {
    let payload = xhr.response;
    if (!payload && xhr.responseText) {
      try { payload = JSON.parse(xhr.responseText); } catch { /* Non-JSON proxy error. */ }
    }
    if (payload && payload.error && payload.error.message) return payload.error.message;
    if (xhr.status === 413) return 'The uploaded file exceeds the server’s 25 MiB limit.';
    if (xhr.status === 0) return 'Could not reach the backend. Check that the Node.js server is running.';
    return `The server could not process this file (HTTP ${xhr.status || 'unknown'}).`;
  }

  function uploadFile() {
    const error = validateFile(state.file);
    if (error || state.uploading) {
      if (error) showAlert(dom.uploadError, error);
      return;
    }

    state.uploading = true;
    hideAlert(dom.uploadError);
    setView('processing');
    setStage('upload', 0);
    dom.processingFile.textContent = `${state.file.name} · ${formatBytes(state.file.size)}`;

    const form = new FormData();
    form.append('file', state.file, state.file.name);
    if (dom.contentKey.value.trim()) form.append('contentKey', dom.contentKey.value.trim());

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/jobs');
    xhr.responseType = 'json';
    xhr.timeout = 120_000;

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      setStage('upload', Math.min(100, (event.loaded / event.total) * 100));
    });
    xhr.upload.addEventListener('load', () => setStage('decode'));

    xhr.addEventListener('load', () => {
      state.uploading = false;
      if (xhr.status < 200 || xhr.status >= 300 || !xhr.response || !xhr.response.job) {
        setView('upload');
        showAlert(dom.uploadError, uploadErrorFromXhr(xhr));
        return;
      }

      setStage('ready');
      state.job = xhr.response.job;
      state.selected.clear();
      state.query = '';
      state.sort = 'name-asc';
      state.page = 1;
      dom.fileSearch.value = '';
      dom.fileSort.value = 'name-asc';
      dom.contentKey.value = '';
      resetFileSelection();
      hideAlert(dom.editorError);
      renderJob();
      setView('editor');
      showToast(state.job.kind === 'archive' ? 'Archive decoded and ready to edit.' : 'Payload decoded. No ZIP archive was detected.');
    });

    xhr.addEventListener('error', () => {
      state.uploading = false;
      setView('upload');
      showAlert(dom.uploadError, 'Network error while uploading. Check the Node.js server and try again.');
    });
    xhr.addEventListener('timeout', () => {
      state.uploading = false;
      setView('upload');
      showAlert(dom.uploadError, 'Processing timed out. Try a smaller archive or check the server.');
    });
    xhr.addEventListener('abort', () => { state.uploading = false; });
    xhr.send(form);
  }

  function layerLabel(layer) {
    if (layer === 'fxap-outer') return 'FXAP outer decoded';
    if (layer === 'fxap-inner') return 'Content layer decoded';
    if (layer === 'zip') return 'ZIP signature detected';
    return layer;
  }

  function renderSummary(job) {
    const isArchive = job.kind === 'archive';
    dom.resultBanner.classList.toggle('binary', !isArchive);
    dom.resultIcon.querySelector('use').setAttribute('href', isArchive ? '#icon-check-circle' : '#icon-info');
    dom.resultTitle.textContent = isArchive ? 'Archive ready for cleanup' : 'Decoded payload ready';
    dom.resultDescription.textContent = isArchive
      ? 'Your original upload is unchanged. Remove files below, then download a fresh ZIP.'
      : 'Decoding completed, but the payload has no ZIP signature. Download the exact decoded bytes below.';

    dom.resultTags.textContent = '';
    for (const layer of job.layers) {
      const tag = document.createElement('span');
      tag.textContent = layerLabel(layer);
      dom.resultTags.appendChild(tag);
    }
    if (job.resourceId) {
      const tag = document.createElement('span');
      tag.textContent = `Resource ID ${job.resourceId}`;
      dom.resultTags.appendChild(tag);
    }

    dom.summaryOneLabel.textContent = 'Source file';
    dom.summaryOneValue.textContent = job.originalName;
    dom.summaryOneValue.title = job.originalName;
    dom.summaryTwoLabel.textContent = 'Decoded size';
    dom.summaryTwoValue.textContent = formatBytes(job.decodedSize);
    dom.summaryThreeLabel.textContent = isArchive ? 'Files remaining' : 'Detected payload';
    dom.summaryThreeValue.textContent = isArchive ? String(job.stats.remainingFiles) : job.payloadType;
    dom.summaryFourLabel.textContent = isArchive ? 'Files removed' : 'Archive editing';
    dom.summaryFourValue.textContent = isArchive ? String(job.stats.removedFiles) : 'Not available';

    dom.archiveEditor.hidden = !isArchive;
    dom.binaryResult.hidden = isArchive;
    dom.downloadButton.href = job.downloadUrl;
    dom.downloadButton.setAttribute('download', job.downloadName);
    dom.downloadLabel.textContent = isArchive ? 'Download processed ZIP' : 'Download decoded data';
    dom.sessionExpiry.textContent = `Session expires at ${formatTime(job.expiresAt)}`;
    dom.sessionExpiry.parentElement.title = `This workspace is deleted at ${new Date(job.expiresAt).toLocaleString()}`;
  }

  function fileParts(name) {
    const index = name.lastIndexOf('/');
    const base = index === -1 ? name : name.slice(index + 1);
    const folder = index === -1 ? 'Root directory' : name.slice(0, index);
    const dot = base.lastIndexOf('.');
    const extension = dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : '';
    return { base, folder, extension };
  }

  function visibleFiles() {
    if (!state.job || state.job.kind !== 'archive') return [];
    const query = state.query.trim().toLocaleLowerCase();
    const files = state.job.entries.filter((entry) => !query || entry.name.toLocaleLowerCase().includes(query));
    files.sort((left, right) => {
      if (state.sort === 'size-desc') return right.size - left.size || left.name.localeCompare(right.name);
      if (state.sort === 'size-asc') return left.size - right.size || left.name.localeCompare(right.name);
      const comparison = left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
      return state.sort === 'name-desc' ? -comparison : comparison;
    });
    return files;
  }

  function makeFileRow(entry) {
    const parts = fileParts(entry.name);
    const row = document.createElement('tr');
    row.dataset.entryId = entry.id;
    row.classList.toggle('selected', state.selected.has(entry.id));

    const checkCell = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selected.has(entry.id);
    checkbox.dataset.entryId = entry.id;
    checkbox.setAttribute('aria-label', `Select ${entry.name}`);
    checkbox.disabled = state.mutating;
    checkCell.appendChild(checkbox);

    const nameCell = document.createElement('td');
    const nameWrap = document.createElement('div');
    nameWrap.className = 'file-name-cell';
    const iconWrap = document.createElement('span');
    iconWrap.className = 'file-type-icon';
    if (['lua', 'zip', 'md'].includes(parts.extension)) iconWrap.classList.add(parts.extension);
    iconWrap.appendChild(createIcon(parts.extension === 'zip' ? '#icon-archive' : '#icon-file'));
    const meta = document.createElement('div');
    meta.className = 'file-meta';
    const base = document.createElement('strong');
    base.textContent = parts.base;
    base.title = entry.name;
    const folder = document.createElement('span');
    folder.textContent = parts.folder;
    folder.title = parts.folder;
    meta.append(base, folder);
    nameWrap.append(iconWrap, meta);
    nameCell.appendChild(nameWrap);

    const typeCell = document.createElement('td');
    const type = document.createElement('span');
    type.className = 'file-kind';
    type.textContent = parts.extension ? parts.extension.slice(0, 8) : 'File';
    typeCell.appendChild(type);

    const sizeCell = document.createElement('td');
    sizeCell.textContent = formatBytes(entry.size);
    const modifiedCell = document.createElement('td');
    modifiedCell.textContent = formatDate(entry.lastModified);

    const actionCell = document.createElement('td');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-button row-remove';
    remove.dataset.removeId = entry.id;
    remove.setAttribute('aria-label', `Remove ${entry.name}`);
    remove.title = `Remove ${parts.base}`;
    remove.disabled = state.mutating;
    remove.appendChild(createIcon('#icon-trash'));
    actionCell.appendChild(remove);

    row.append(checkCell, nameCell, typeCell, sizeCell, modifiedCell, actionCell);
    return row;
  }

  function renderFiles() {
    if (!state.job || state.job.kind !== 'archive') return;
    const validIds = new Set(state.job.entries.map((entry) => entry.id));
    for (const id of state.selected) if (!validIds.has(id)) state.selected.delete(id);

    const files = visibleFiles();
    const totalPages = Math.max(1, Math.ceil(files.length / PAGE_SIZE));
    state.page = Math.min(Math.max(1, state.page), totalPages);
    const start = (state.page - 1) * PAGE_SIZE;
    const pageFiles = files.slice(start, start + PAGE_SIZE);

    dom.fileList.textContent = '';
    const fragment = document.createDocumentFragment();
    for (const entry of pageFiles) fragment.appendChild(makeFileRow(entry));
    dom.fileList.appendChild(fragment);

    const allOnPageSelected = pageFiles.length > 0 && pageFiles.every((entry) => state.selected.has(entry.id));
    const someOnPageSelected = pageFiles.some((entry) => state.selected.has(entry.id));
    dom.selectPage.checked = allOnPageSelected;
    dom.selectPage.indeterminate = !allOnPageSelected && someOnPageSelected;
    dom.selectPage.disabled = pageFiles.length === 0 || state.mutating;
    dom.selectPage.setAttribute('aria-label', `Select all ${pageFiles.length} files on this page`);

    dom.fileCountBadge.textContent = String(state.job.stats.remainingFiles);
    dom.selectedCount.hidden = state.selected.size === 0;
    dom.selectedCount.textContent = String(state.selected.size);
    dom.removeSelected.disabled = state.selected.size === 0 || state.mutating;
    dom.resetArchive.disabled = state.job.stats.removedEntries === 0 || state.mutating;
    dom.clearArchive.disabled = state.job.stats.remainingEntries === 0 || state.mutating;
    dom.fileSearch.disabled = state.job.stats.remainingFiles === 0 || state.mutating;
    dom.fileSort.disabled = state.job.stats.remainingFiles === 0 || state.mutating;

    dom.tableContainer.hidden = pageFiles.length === 0;
    dom.emptyState.hidden = pageFiles.length > 0;
    if (pageFiles.length === 0) {
      const hasQuery = Boolean(state.query.trim()) && state.job.entries.length > 0;
      dom.emptyTitle.textContent = hasQuery ? 'No matching files' : 'Archive is empty';
      dom.emptyDescription.textContent = hasQuery
        ? 'Try a different filename or clear your search.'
        : 'You can download a valid empty ZIP or use Reset to restore the original files.';
    }

    if (files.length === 0) {
      dom.paginationSummary.textContent = state.query && state.job.entries.length ? 'No matching files' : 'Showing 0 files';
    } else {
      dom.paginationSummary.textContent = `Showing ${start + 1}–${start + pageFiles.length} of ${files.length}${state.query ? ' matching' : ''} files`;
    }
    dom.pageIndicator.textContent = `${state.page} / ${totalPages}`;
    dom.previousPage.disabled = state.page <= 1 || state.mutating;
    dom.nextPage.disabled = state.page >= totalPages || state.mutating;
  }

  function renderJob() {
    if (!state.job) return;
    renderSummary(state.job);
    renderFiles();
  }

  async function requestJob(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: options.body ? { 'content-type': 'application/json', ...(options.headers || {}) } : options.headers,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload && payload.error ? payload.error.message : `Request failed with HTTP ${response.status}.`);
    }
    return payload.job;
  }

  function setMutating(value) {
    state.mutating = value;
    dom.archiveEditor.setAttribute('aria-busy', String(value));
    dom.archiveEditor.classList.toggle('is-busy', value);
  }

  async function runMutation(operation) {
    if (state.mutating || !state.job) return;
    hideAlert(dom.editorError);
    setMutating(true);
    try {
      await operation();
    } catch (error) {
      showAlert(dom.editorError, error.message);
      showToast(error.message, 'error');
    } finally {
      setMutating(false);
      renderJob();
    }
  }

  async function removeEntries(ids) {
    if (!ids.length || !state.job) return;
    await runMutation(async () => {
      state.job = await requestJob(`/api/jobs/${state.job.id}/entries`, {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
      });
      for (const id of ids) state.selected.delete(id);
      showToast(`${ids.length} ${ids.length === 1 ? 'file' : 'files'} removed from the processed archive.`);
    });
  }

  function resetArchive() {
    if (!state.job || state.job.stats.removedEntries === 0) return;
    runMutation(async () => {
      state.job = await requestJob(`/api/jobs/${state.job.id}/reset`, { method: 'POST' });
      state.selected.clear();
      showToast('Original archive contents restored.');
    });
  }

  function clearArchive() {
    if (!state.job || state.job.stats.remainingEntries === 0) return;
    runMutation(async () => {
      state.job = await requestJob(`/api/jobs/${state.job.id}/clear`, { method: 'POST' });
      state.selected.clear();
      state.page = 1;
      showToast('Archive cleared. Reset is available if you change your mind.');
    });
  }

  function newWorkspace() {
    const oldId = state.job && state.job.id;
    state.job = null;
    state.selected.clear();
    state.query = '';
    state.page = 1;
    state.mutating = false;
    dom.fileSearch.value = '';
    dom.contentKey.value = '';
    resetFileSelection();
    hideAlert(dom.uploadError);
    hideAlert(dom.editorError);
    setView('upload');
    if (oldId) fetch(`/api/jobs/${oldId}`, { method: 'DELETE' }).catch(() => {});
    dom.workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function checkBackend() {
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      if (!response.ok) throw new Error('Offline');
      dom.backendStatus.classList.remove('offline');
      dom.backendStatus.lastChild.textContent = 'Backend online';
    } catch {
      dom.backendStatus.classList.add('offline');
      dom.backendStatus.lastChild.textContent = 'Backend offline';
    }
  }

  // Upload selection and drag/drop behavior.
  dom.dropZone.addEventListener('click', () => dom.fileInput.click());
  dom.dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      dom.fileInput.click();
    }
  });
  dom.fileInput.addEventListener('change', () => selectFile(dom.fileInput.files[0]));
  dom.clearFile.addEventListener('click', () => { resetFileSelection(); hideAlert(dom.uploadError); });
  dom.uploadForm.addEventListener('submit', (event) => { event.preventDefault(); uploadFile(); });
  for (const eventName of ['dragenter', 'dragover']) {
    dom.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      dom.dropZone.classList.add('drag-over');
    });
  }
  dom.dropZone.addEventListener('dragleave', (event) => {
    if (!dom.dropZone.contains(event.relatedTarget)) dom.dropZone.classList.remove('drag-over');
  });
  dom.dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dom.dropZone.classList.remove('drag-over');
    if (event.dataTransfer.files.length > 1) {
      showAlert(dom.uploadError, 'Choose one file at a time.');
      return;
    }
    selectFile(event.dataTransfer.files[0]);
  });
  document.addEventListener('dragover', (event) => event.preventDefault());
  document.addEventListener('drop', (event) => event.preventDefault());

  // Archive filtering, selection, pagination, and row actions.
  dom.fileSearch.addEventListener('input', () => {
    state.query = dom.fileSearch.value;
    state.page = 1;
    renderFiles();
  });
  dom.fileSort.addEventListener('change', () => {
    state.sort = dom.fileSort.value;
    state.page = 1;
    renderFiles();
  });
  dom.selectPage.addEventListener('change', () => {
    const files = visibleFiles();
    const start = (state.page - 1) * PAGE_SIZE;
    const pageFiles = files.slice(start, start + PAGE_SIZE);
    for (const entry of pageFiles) {
      if (dom.selectPage.checked) state.selected.add(entry.id);
      else state.selected.delete(entry.id);
    }
    renderFiles();
  });
  dom.fileList.addEventListener('change', (event) => {
    const id = event.target.dataset.entryId;
    if (!id) return;
    if (event.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderFiles();
  });
  dom.fileList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-id]');
    if (button) removeEntries([button.dataset.removeId]);
  });
  dom.removeSelected.addEventListener('click', () => removeEntries([...state.selected]));
  dom.previousPage.addEventListener('click', () => { state.page -= 1; renderFiles(); });
  dom.nextPage.addEventListener('click', () => { state.page += 1; renderFiles(); });
  dom.resetArchive.addEventListener('click', resetArchive);
  dom.clearArchive.addEventListener('click', () => dom.clearDialog.showModal());
  dom.confirmClear.addEventListener('click', (event) => {
    event.preventDefault();
    dom.clearDialog.close();
    clearArchive();
  });
  dom.clearDialog.addEventListener('click', (event) => {
    if (event.target === dom.clearDialog) dom.clearDialog.close('cancel');
  });

  dom.newUpload.addEventListener('click', newWorkspace);
  dom.downloadButton.addEventListener('click', (event) => {
    if (!state.job) {
      event.preventDefault();
      return;
    }
    showToast('Download started. Your source file remains unchanged.');
  });

  checkBackend();
})();
