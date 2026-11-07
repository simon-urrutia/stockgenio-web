document.addEventListener('DOMContentLoaded', () => {
    // Elementos de Autenticación y Guardado
    const authOverlay = document.getElementById('authOverlay');
    const usernameInput = document.getElementById('usernameInput');
    const passwordInput = document.getElementById('passwordInput');
    const loginBtn = document.getElementById('loginBtn');
    const registerBtn = document.getElementById('registerBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const authMessage = document.getElementById('authMessage');
    const currentUserBadge = document.getElementById('currentUserBadge');
    const saveStatusBadge = document.getElementById('saveStatusBadge');

    // Elementos de la Tabla, Virtual Scroll y Herramientas
    const tableContainer = document.getElementById('tableContainer');
    const tableBody = document.getElementById('tableBody');
    const undoBtn = document.getElementById('undoBtn');
    const addRowBtn = document.getElementById('addRowBtn');
    const insertCountInput = document.getElementById('insertCountInput');
    const insertPosInput = document.getElementById('insertPosInput');
    const deleteRowBtn = document.getElementById('deleteRowBtn');
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');
    const boldBtn = document.getElementById('boldBtn');
    const colFilters = document.querySelectorAll('.col-filter');
    const cellColorPicker = document.getElementById('cellColorPicker');
    const notepad = document.getElementById('notepad');
    const totalQuantitySpan = document.getElementById('totalQuantity');
    const visibleRowsCountSpan = document.getElementById('visibleRowsCount');
    const clipboardStatus = document.getElementById('clipboardStatus');

    // Elementos de Ajustes (Tuerca)
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const cashPercentInput = document.getElementById('cashPercentInput');
    const efectivoHeader = document.getElementById('efectivoHeader');

    const editableCols = ['temporada', 'marca', 'codigo', 'desc', 'talle', 'comprada', 'vendida', 'pLista'];
    const textCols = ['temporada', 'marca', 'codigo', 'desc', 'talle'];
    const numericFormulaCols = ['comprada', 'vendida', 'pLista'];
    const colIndexToField = ['temporada', 'marca', 'codigo', 'desc', 'talle', 'comprada', 'vendida', 'stock', 'pLista', 'efectivo'];

    // Configuración del Virtual Scrolling
    const ROW_HEIGHT = 38;
    const BUFFER_ROWS = 12;
    const MAX_UNDO_STEPS = 35;

    let currentUser = localStorage.getItem('betania_active_user') || null;
    let savedData = [];
    let filteredData = [];
    let cashPercentage = 80;

    // Pila de historial para el botón Deshacer (Undo)
    let undoStack = [];
    let cellEditSnapshot = null;
    let cellEditDirty = false;
    let colorPickerSnapshotSaved = false;

    // Estado de selección y portapapeles
    let selectedCoords = new Set();
    let checkedOriginalIndices = new Set();
    let isDragging = false;
    let dragStartCoords = null;
    let copiedBlock = null;
    let lastCopiedPlainText = '';
    let saveTimeout = null;
    let filterTimeout = null;

    // Sanitizador estricto: elimina cualquier tabla/celda HTML de Excel y solo permite letras, números y caracteres estándar
    function sanitizePlainText(inputStr) {
        if (inputStr === null || inputStr === undefined) return '';
        return String(inputStr)
            .replace(/<[^>]*>/g, ' ')
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/[^\p{L}\p{N}\s.,;:$%+\-*/=()_"#@!?&°']/gu, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    // Permite únicamente la etiqueta <b> para la función de negrita, bloqueando cualquier otro HTML (como <table> o <td> de Excel)
    function sanitizeTextWithBold(htmlStr) {
        if (htmlStr === null || htmlStr === undefined) return '';
        const OPEN_TOKEN = '__BOLD_OPEN__';
        const CLOSE_TOKEN = '__BOLD_CLOSE__';

        let temp = String(htmlStr)
            .replace(/<(b|strong)\b[^>]*>/gi, OPEN_TOKEN)
            .replace(/<\/(b|strong)>/gi, CLOSE_TOKEN)
            .replace(/<[^>]*>/g, ' ');

        temp = temp
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/[^\p{L}\p{N}\s.,;:$%+\-*/=()_"#@!?&°']/gu, '')
            .replace(/\s{2,}/g, ' ')
            .trim();

        return temp
            .replaceAll(OPEN_TOKEN, '<b>')
            .replaceAll(CLOSE_TOKEN, '</b>');
    }

    function stripHtml(htmlStr) {
        return sanitizePlainText(htmlStr);
    }

    // Sistema de Deshacer (Undo) rápido y liviano en memoria
    function cloneTableData(dataArray) {
        return dataArray.map(item => ({
            temporada: item.temporada,
            marca: item.marca,
            codigo: item.codigo,
            desc: item.desc,
            talle: item.talle,
            comprada: item.comprada,
            vendida: item.vendida,
            pLista: item.pLista,
            colors: item.colors ? { ...item.colors } : {}
        }));
    }

    function updateUndoButtonUI() {
        if (!undoBtn) return;
        undoBtn.disabled = undoStack.length === 0;
        undoBtn.innerText = undoStack.length > 0 ? `↩️ Deshacer (${undoStack.length})` : '↩️ Deshacer';
    }

    function pushUndoState(customSnapshot = null) {
        const snapshot = customSnapshot || cloneTableData(savedData);
        undoStack.push(snapshot);
        if (undoStack.length > MAX_UNDO_STEPS) {
            undoStack.shift();
        }
        updateUndoButtonUI();
    }

    function performUndo() {
        if (undoStack.length === 0) {
            clipboardStatus.innerText = '⚠️ No hay cambios recientes para deshacer';
            return;
        }
        savedData = undoStack.pop();
        cellEditSnapshot = null;
        cellEditDirty = false;
        updateUndoButtonUI();
        clearSelection();
        scheduleSaveState();
        recomputeFilteredData();
        clipboardStatus.innerText = '↩️ Último cambio deshecho correctamente';
    }

    undoBtn.addEventListener('click', () => {
        performUndo();
    });

    function formatNumericDisplay(field, numValue) {
        if (field === 'pLista') {
            return `$${numValue.toLocaleString('es-AR')}`;
        }
        return numValue.toLocaleString('es-AR');
    }

    // Evaluador de fórmulas ("10 mas 10", "10 + 10", "20 menos 5", "10 por 2", "100 dividido 4")
    function evaluateFormula(rawInput) {
        if (rawInput === null || rawInput === undefined) {
            return { value: 0, isFormula: false, raw: '0' };
        }
        const rawStr = sanitizePlainText(rawInput);
        if (!rawStr) {
            return { value: 0, isFormula: false, raw: '0' };
        }

        let expr = rawStr.toLowerCase()
            .replace(/^=/, '')
            .replace(/\$/g, '')
            .replace(/\.(?=\d{3}(\D|$))/g, '')
            .replace(/,/g, '.')
            .replace(/\bm[aá]s\b/g, '+')
            .replace(/\bmenos\b/g, '-')
            .replace(/\b(por|x)\b/g, '*')
            .replace(/\b(dividido|entre)\b/g, '/')
            .trim();

        const hasOperator = /[+\-*/]/.test(expr.replace(/^[+-]/, '')) || rawStr.startsWith('=');

        if (/^[0-9+\-*/.()\s]+$/.test(expr) && /[0-9]/.test(expr)) {
            try {
                const computed = Function('"use strict"; return (' + expr + ')')();
                if (typeof computed === 'number' && isFinite(computed)) {
                    const rounded = Math.round(computed * 100) / 100;
                    return { value: rounded, isFormula: hasOperator, raw: rawStr };
                }
            } catch (e) {
                const numbersFound = expr.match(/[+-]?\s*\d+(\.\d+)?/g);
                if (numbersFound) {
                    const partialSum = numbersFound.reduce((acc, n) => acc + parseFloat(n.replace(/\s+/g, '')), 0);
                    return { value: Math.round(partialSum * 100) / 100, isFormula: true, raw: rawStr };
                }
            }
        }

        const fallback = parseFloat(expr);
        return {
            value: isNaN(fallback) ? 0 : fallback,
            isFormula: false,
            raw: rawStr
        };
    }

    function getSampleData() {
        return [
            { temporada: 'Otoño/Invierno', marca: 'Línea <b>Clásica</b>', codigo: 'ART-001', desc: 'Producto <b>Destacado</b> A', talle: 'Único', comprada: '10 mas 5', vendida: '5', pLista: '4500', colors: {} },
            { temporada: 'Todo el año', marca: 'Broer', codigo: 'ART-022', desc: 'Producto Línea Premium', talle: 'M', comprada: '10', vendida: '4', pLista: '12000', colors: {} },
            { temporada: 'Primavera/Verano', marca: 'Línea Clásica', codigo: 'ART-005', desc: 'Edición Especial', talle: 'L', comprada: '8', vendida: '8', pLista: '7800', colors: {} }
        ];
    }

    function getUsersDB() {
        return JSON.parse(localStorage.getItem('betania_users_db')) || {};
    }

    function saveUsersDB(db) {
        localStorage.setItem('betania_users_db', JSON.stringify(db));
    }

    function scheduleSaveState() {
        if (!currentUser) return;
        if (saveStatusBadge) {
            saveStatusBadge.innerText = '💾 Guardando...';
        }
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            saveCurrentUserStateImmediate();
            if (saveStatusBadge) {
                saveStatusBadge.innerText = '✅ Todos los cambios guardados';
            }
        }, 250);
    }

    function saveCurrentUserStateImmediate() {
        if (!currentUser) return;
        const db = getUsersDB();
        if (!db[currentUser]) return;

        db[currentUser].data = savedData;
        db[currentUser].notepad = notepad.value;
        db[currentUser].cashPercent = cashPercentage;
        saveUsersDB(db);
    }

    function loadUserSession(username) {
        const db = getUsersDB();
        const userRecord = db[username];
        if (!userRecord) return;

        currentUser = username;
        localStorage.setItem('betania_active_user', username);

        savedData = userRecord.data || getSampleData();
        notepad.value = userRecord.notepad || '';
        cashPercentage = userRecord.cashPercent || 80;

        cashPercentInput.value = cashPercentage;
        efectivoHeader.innerText = `Precio Efectivo (${cashPercentage}%)`;
        currentUserBadge.innerText = `👤 Usuario: ${username}`;
        authOverlay.classList.add('hidden');
        authMessage.innerText = '';

        undoStack = [];
        updateUndoButtonUI();
        selectedCoords.clear();
        checkedOriginalIndices.clear();
        recomputeFilteredData();
    }

    // Registro e Inicio de Sesión
    registerBtn.addEventListener('click', () => {
        const user = usernameInput.value.trim();
        const pass = passwordInput.value.trim();

        if (!user || !pass) {
            authMessage.style.color = '#a83232';
            authMessage.innerText = '⚠️ Completá usuario y contraseña.';
            return;
        }

        const db = getUsersDB();
        if (db[user]) {
            authMessage.style.color = '#a83232';
            authMessage.innerText = '⚠️ Ese nombre de usuario ya existe.';
            return;
        }

        db[user] = {
            password: pass,
            data: getSampleData(),
            notepad: '',
            cashPercent: 80
        };
        saveUsersDB(db);
        loadUserSession(user);
    });

    loginBtn.addEventListener('click', () => {
        const user = usernameInput.value.trim();
        const pass = passwordInput.value.trim();
        const db = getUsersDB();

        if (!db[user] || db[user].password !== pass) {
            authMessage.style.color = '#a83232';
            authMessage.innerText = '❌ Usuario o contraseña incorrectos.';
            return;
        }

        loadUserSession(user);
    });

    logoutBtn.addEventListener('click', () => {
        saveCurrentUserStateImmediate();
        currentUser = null;
        localStorage.removeItem('betania_active_user');
        passwordInput.value = '';
        authOverlay.classList.remove('hidden');
    });

    notepad.addEventListener('input', () => {
        scheduleSaveState();
    });

    function calculateStock(item) {
        const comp = evaluateFormula(item.comprada).value;
        const vend = evaluateFormula(item.vendida).value;
        return Math.round((comp - vend) * 100) / 100;
    }

    function calculateCashPrice(item) {
        const lista = evaluateFormula(item.pLista).value;
        return Math.round((lista * (cashPercentage / 100)) * 100) / 100;
    }

    function recomputeFilteredData() {
        const activeFilters = {};
        colFilters.forEach(input => {
            const col = input.dataset.col;
            const val = input.value.toLowerCase().trim();
            if (val) activeFilters[col] = val;
        });

        const filterKeys = Object.keys(activeFilters);
        filteredData = [];
        let totalStock = 0;

        for (let i = 0; i < savedData.length; i++) {
            const item = savedData[i];
            item._origIdx = i;

            let matches = true;
            for (let k = 0; k < filterKeys.length; k++) {
                const col = filterKeys[k];
                const plainText = stripHtml(item[col]).toLowerCase();
                if (!plainText.includes(activeFilters[col])) {
                    matches = false;
                    break;
                }
            }

            if (matches) {
                filteredData.push(item);
                totalStock += calculateStock(item);
            }
        }

        totalQuantitySpan.innerText = totalStock.toLocaleString('es-AR');
        visibleRowsCountSpan.innerText = filteredData.length.toLocaleString('es-AR');
        renderVirtualRows();
    }

    function updateTotalQuantityOnly() {
        let totalStock = 0;
        for (let i = 0; i < filteredData.length; i++) {
            totalStock += calculateStock(filteredData[i]);
        }
        totalQuantitySpan.innerText = totalStock.toLocaleString('es-AR');
    }

    // Motor de Virtual Scrolling
    function renderVirtualRows() {
        const scrollTop = tableContainer.scrollTop;
        const viewportHeight = tableContainer.clientHeight || 550;
        const totalRows = filteredData.length;

        const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
        const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + BUFFER_ROWS * 2;
        const endIdx = Math.min(totalRows, startIdx + visibleCount);

        const topPadding = startIdx * ROW_HEIGHT;
        const bottomPadding = Math.max(0, (totalRows - endIdx) * ROW_HEIGHT);

        let html = '';

        if (topPadding > 0) {
            html += `<tr class="spacer-row" style="height:${topPadding}px"><td colspan="12"></td></tr>`;
        }

        for (let vRow = startIdx; vRow < endIdx; vRow++) {
            const item = filteredData[vRow];
            const origIdx = item._origIdx;

            const compEval = evaluateFormula(item.comprada);
            const vendEval = evaluateFormula(item.vendida);
            const listaEval = evaluateFormula(item.pLista);

            const stock = Math.round((compEval.value - vendEval.value) * 100) / 100;
            const pEfectivo = Math.round((listaEval.value * (cashPercentage / 100)) * 100) / 100;
            const cellColors = item.colors || {};
            const isChecked = checkedOriginalIndices.has(origIdx) ? 'checked' : '';
            const outOfStockClass = stock <= 0 ? 'out-of-stock' : '';

            html += `<tr data-index="${origIdx}" data-vrow="${vRow}" class="${outOfStockClass}">`;
            html += `<td class="select-col"><input type="checkbox" class="row-checkbox" ${isChecked}></td>`;
            html += `<td class="num-col">${vRow + 1}</td>`;

            // Columnas de texto (0 a 4)
            for (let c = 0; c < 5; c++) {
                const field = colIndexToField[c];
                const selClass = selectedCoords.has(`${vRow}:${c}`) ? 'cell-selected' : '';
                const bg = cellColors[field] ? `background-color:${cellColors[field]};` : '';
                const cleanHtml = sanitizeTextWithBold(item[field] || '');
                html += `<td contenteditable="true" data-field="${field}" data-vcol="${c}" class="${selClass}" style="${bg}">${cleanHtml}</td>`;
            }

            // Cantidad Comprada (vcol 5)
            const c5Sel = selectedCoords.has(`${vRow}:5`) ? 'cell-selected' : '';
            const c5Form = compEval.isFormula ? 'has-custom-formula' : '';
            const c5Title = compEval.isFormula ? `Fórmula: ${compEval.raw}` : '';
            const c5Bg = cellColors.comprada ? `background-color:${cellColors.comprada};` : '';
            html += `<td contenteditable="true" data-field="comprada" data-vcol="5" class="num ${c5Form} ${c5Sel}" title="${c5Title}" style="${c5Bg}">${formatNumericDisplay('comprada', compEval.value)}</td>`;

            // Cantidad Vendida (vcol 6)
            const c6Sel = selectedCoords.has(`${vRow}:6`) ? 'cell-selected' : '';
            const c6Form = vendEval.isFormula ? 'has-custom-formula' : '';
            const c6Title = vendEval.isFormula ? `Fórmula: ${vendEval.raw}` : '';
            const c6Bg = cellColors.vendida ? `background-color:${cellColors.vendida};` : '';
            html += `<td contenteditable="true" data-field="vendida" data-vcol="6" class="num ${c6Form} ${c6Sel}" title="${c6Title}" style="${c6Bg}">${formatNumericDisplay('vendida', vendEval.value)}</td>`;

            // Cantidad en Stock (vcol 7)
            const c7Sel = selectedCoords.has(`${vRow}:7`) ? 'cell-selected' : '';
            html += `<td data-field="stock" data-vcol="7" class="num formula-cell stock-cell ${c7Sel}">${stock.toLocaleString('es-AR')}</td>`;

            // Precio Lista (vcol 8)
            const c8Sel = selectedCoords.has(`${vRow}:8`) ? 'cell-selected' : '';
            const c8Form = listaEval.isFormula ? 'has-custom-formula' : '';
            const c8Title = listaEval.isFormula ? `Fórmula: ${listaEval.raw}` : '';
            const c8Bg = cellColors.pLista ? `background-color:${cellColors.pLista};` : '';
            html += `<td contenteditable="true" data-field="pLista" data-vcol="8" class="num ${c8Form} ${c8Sel}" title="${c8Title}" style="${c8Bg}">${formatNumericDisplay('pLista', listaEval.value)}</td>`;

            // Precio Efectivo (vcol 9)
            const c9Sel = selectedCoords.has(`${vRow}:9`) ? 'cell-selected' : '';
            html += `<td data-field="efectivo" data-vcol="9" class="num formula-cell efectivo-cell ${c9Sel}">$${pEfectivo.toLocaleString('es-AR')}</td>`;

            html += `</tr>`;
        }

        if (bottomPadding > 0) {
            html += `<tr class="spacer-row" style="height:${bottomPadding}px"><td colspan="12"></td></tr>`;
        }

        tableBody.innerHTML = html;
    }

    tableContainer.addEventListener('scroll', () => {
        window.requestAnimationFrame(renderVirtualRows);
    });

    function syncSelectionClassesInDOM() {
        const visibleCells = tableBody.querySelectorAll('td[data-vcol]');
        visibleCells.forEach(cell => {
            const vrow = cell.closest('tr').dataset.vrow;
            const vcol = cell.dataset.vcol;
            const key = `${vrow}:${vcol}`;
            if (selectedCoords.has(key)) {
                cell.classList.add('cell-selected');
            } else {
                cell.classList.remove('cell-selected');
            }
        });
    }

    function clearSelection() {
        selectedCoords.clear();
        syncSelectionClassesInDOM();
    }

    function selectRange(startCoords, endCoords) {
        selectedCoords.clear();
        const minRow = Math.min(startCoords.row, endCoords.row);
        const maxRow = Math.max(startCoords.row, endCoords.row);
        const minCol = Math.min(startCoords.col, endCoords.col);
        const maxCol = Math.max(startCoords.col, endCoords.col);

        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                selectedCoords.add(`${r}:${c}`);
            }
        }
        syncSelectionClassesInDOM();
    }

    function updateCellData(cell) {
        const row = cell.closest('tr');
        if (!row) return;
        const originalIndex = parseInt(row.dataset.index);
        const field = cell.dataset.field;

        // Si es el primer cambio en esta celda, guardamos el estado anterior en la pila de Deshacer
        if (!cellEditDirty && cellEditSnapshot) {
            pushUndoState(cellEditSnapshot);
            cellEditDirty = true;
        }

        if (textCols.includes(field)) {
            savedData[originalIndex][field] = sanitizeTextWithBold(cell.innerHTML);
        } else {
            savedData[originalIndex][field] = sanitizePlainText(cell.innerText);
        }

        scheduleSaveState();

        const item = savedData[originalIndex];

        if (field === 'comprada' || field === 'vendida') {
            const stock = calculateStock(item);
            const stockCell = row.querySelector('.stock-cell');
            if (stockCell) stockCell.innerText = stock.toLocaleString('es-AR');

            if (stock <= 0) {
                row.classList.add('out-of-stock');
            } else {
                row.classList.remove('out-of-stock');
            }
            updateTotalQuantityOnly();
        }

        if (field === 'pLista') {
            const pEfectivo = calculateCashPrice(item);
            const efCell = row.querySelector('.efectivo-cell');
            if (efCell) efCell.innerText = `$${pEfectivo.toLocaleString('es-AR')}`;
        }
    }

    // Poner en negrita una palabra seleccionada o celdas completas
    function toggleBoldOnSelection() {
        const selection = window.getSelection();

        if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
            const anchorEl = selection.anchorNode ? selection.anchorNode.parentElement : null;
            const activeCell = anchorEl ? anchorEl.closest('td[contenteditable="true"]') : null;

            if (activeCell && textCols.includes(activeCell.dataset.field)) {
                pushUndoState();
                cellEditDirty = true;
                document.execCommand('bold', false, null);
                updateCellData(activeCell);
                clipboardStatus.innerText = '✨ Palabra seleccionada puesta en negrita';
                return;
            }
        }

        if (selectedCoords.size > 0) {
            pushUndoState();
            selectedCoords.forEach(coordKey => {
                const [vRowStr, vColStr] = coordKey.split(':');
                const vRow = parseInt(vRowStr);
                const vCol = parseInt(vColStr);
                const field = colIndexToField[vCol];

                if (textCols.includes(field) && filteredData[vRow]) {
                    const item = filteredData[vRow];
                    const currentVal = sanitizeTextWithBold(item[field] || '');
                    if (currentVal.startsWith('<b>') && currentVal.endsWith('</b>')) {
                        item[field] = currentVal.slice(3, -4);
                    } else {
                        item[field] = `<b>${currentVal}</b>`;
                    }
                }
            });
            scheduleSaveState();
            renderVirtualRows();
            clipboardStatus.innerText = '✨ Negrita aplicada a las celdas seleccionadas';
        }
    }

    boldBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        toggleBoldOnSelection();
    });

    // Delegación de eventos en tableBody
    tableBody.addEventListener('mousedown', (e) => {
        const checkbox = e.target.closest('.row-checkbox');
        if (checkbox) return;

        const cell = e.target.closest('td[data-vcol]');
        if (!cell) return;

        const vrow = parseInt(cell.closest('tr').dataset.vrow);
        const vcol = parseInt(cell.dataset.vcol);
        const key = `${vrow}:${vcol}`;

        if (e.ctrlKey || e.metaKey) {
            if (selectedCoords.has(key)) {
                selectedCoords.delete(key);
            } else {
                selectedCoords.add(key);
            }
            syncSelectionClassesInDOM();
        } else if (e.shiftKey && dragStartCoords) {
            selectRange(dragStartCoords, { row: vrow, col: vcol });
        } else {
            isDragging = true;
            dragStartCoords = { row: vrow, col: vcol };
            selectedCoords.clear();
            selectedCoords.add(key);
            syncSelectionClassesInDOM();
        }
    });

    tableBody.addEventListener('mouseover', (e) => {
        if (!isDragging || !dragStartCoords) return;
        const cell = e.target.closest('td[data-vcol]');
        if (!cell) return;
        const vrow = parseInt(cell.closest('tr').dataset.vrow);
        const vcol = parseInt(cell.dataset.vcol);
        selectRange(dragStartCoords, { row: vrow, col: vcol });
    });

    tableBody.addEventListener('change', (e) => {
        if (e.target.classList.contains('row-checkbox')) {
            const origIdx = parseInt(e.target.closest('tr').dataset.index);
            if (e.target.checked) {
                checkedOriginalIndices.add(origIdx);
            } else {
                checkedOriginalIndices.delete(origIdx);
            }
        }
    });

    tableBody.addEventListener('focusin', (e) => {
        const cell = e.target.closest('td[contenteditable="true"]');
        if (!cell) return;

        // Guardamos captura previa por si el usuario escribe y luego quiere Deshacer
        cellEditSnapshot = cloneTableData(savedData);
        cellEditDirty = false;

        const field = cell.dataset.field;
        if (numericFormulaCols.includes(field)) {
            const originalIndex = parseInt(cell.closest('tr').dataset.index);
            const rawVal = savedData[originalIndex][field];
            if (rawVal !== undefined && rawVal !== null) {
                cell.innerText = rawVal;
            }
        }
    });

    tableBody.addEventListener('focusout', (e) => {
        const cell = e.target.closest('td[contenteditable="true"]');
        if (!cell) return;

        const field = cell.dataset.field;
        const originalIndex = parseInt(cell.closest('tr').dataset.index);

        if (numericFormulaCols.includes(field)) {
            const rawVal = savedData[originalIndex][field];
            const evaluated = evaluateFormula(rawVal);
            cell.innerText = formatNumericDisplay(field, evaluated.value);
            if (evaluated.isFormula) {
                cell.classList.add('has-custom-formula');
                cell.title = `Fórmula: ${evaluated.raw}`;
            } else {
                cell.classList.remove('has-custom-formula');
                cell.title = '';
            }
        } else if (textCols.includes(field)) {
            // Garantiza que nunca queden etiquetas de tabla o caracteres inválidos al salir de la celda
            const clean = sanitizeTextWithBold(savedData[originalIndex][field]);
            savedData[originalIndex][field] = clean;
            cell.innerHTML = clean;
        }

        cellEditSnapshot = null;
        cellEditDirty = false;
    });

    tableBody.addEventListener('input', (e) => {
        const cell = e.target.closest('td[contenteditable="true"]');
        if (!cell) return;

        // Si el navegador intentó meter una tabla o div, lo limpia en el acto
        if (cell.querySelector('table, tr, td, div, span, p')) {
            const cleanText = sanitizePlainText(cell.innerText);
            cell.innerText = cleanText;
        }
        updateCellData(cell);
    });

    // Bloquear arrastrar y soltar HTML externo dentro de las celdas
    tableBody.addEventListener('drop', (e) => {
        e.preventDefault();
    });

    tableBody.addEventListener('keydown', (e) => {
        const cell = e.target.closest('td[contenteditable="true"]');
        if (cell && e.key === 'Enter') {
            e.preventDefault();
            cell.blur();
            clearSelection();
        }
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });

    // Función central para copiar las celdas seleccionadas y DESMARCARLAS inmediatamente
    function copySelectedCellsAndClear() {
        if (selectedCoords.size === 0) return false;

        const coordsArray = Array.from(selectedCoords).map(key => {
            const [r, c] = key.split(':').map(Number);
            const item = filteredData[r];
            const field = colIndexToField[c];
            let rawVal = '';

            if (item) {
                if (field === 'stock') {
                    rawVal = String(calculateStock(item));
                } else if (field === 'efectivo') {
                    rawVal = String(calculateCashPrice(item));
                } else {
                    rawVal = sanitizeTextWithBold(item[field] ?? '');
                }
            }
            return { row: r, col: c, val: rawVal, plain: stripHtml(rawVal) };
        });

        const minRow = Math.min(...coordsArray.map(c => c.row));
        const maxRow = Math.max(...coordsArray.map(c => c.row));
        const minCol = Math.min(...coordsArray.map(c => c.col));
        const maxCol = Math.max(...coordsArray.map(c => c.col));

        copiedBlock = coordsArray.map(c => ({
            dRow: c.row - minRow,
            dCol: c.col - minCol,
            val: c.val
        }));

        // Armar texto plano separado por tabulaciones por si copia hacia afuera
        const gridMap = new Map();
        coordsArray.forEach(c => gridMap.set(`${c.row}:${c.col}`, c.plain));
        const rowsText = [];
        for (let r = minRow; r <= maxRow; r++) {
            const colsText = [];
            for (let c = minCol; c <= maxCol; c++) {
                colsText.push(gridMap.get(`${r}:${c}`) ?? '');
            }
            rowsText.push(colsText.join('\t'));
        }
        lastCopiedPlainText = rowsText.join('\n');

        navigator.clipboard?.writeText(lastCopiedPlainText).catch(() => {});

        const count = copiedBlock.length;

        // Requisito: Al copiar las celdas, dejan de marcarse inmediatamente
        clearSelection();
        window.getSelection()?.removeAllRanges();
        if (document.activeElement && document.activeElement.closest('#tableBody')) {
            document.activeElement.blur();
        }

        clipboardStatus.innerText = `📋 ${count} casilla(s) copiada(s) (selección desmarcada). Hacé clic donde pegar y tocá Ctrl+V`;
        return true;
    }

    // Función central para pegar bloques internos o texto plano venido desde Excel (sin celdas anidadas)
    function pasteDataIntoSelection(externalClipboardText = null) {
        if (selectedCoords.size === 0) return;

        const targetCoords = Array.from(selectedCoords).map(k => {
            const [r, c] = k.split(':').map(Number);
            return { row: r, col: c };
        });

        const anchorRow = Math.min(...targetCoords.map(c => c.row));
        const anchorCol = Math.min(...targetCoords.map(c => c.col));

        const normalizedExternal = externalClipboardText ? externalClipboardText.replace(/\r\n/g, '\n').trim() : '';
        const normalizedInternal = lastCopiedPlainText.replace(/\r\n/g, '\n').trim();

        // Si el portapapeles viene de Excel u otra app externa, lo convertimos a texto puro sin tablas HTML
        let blockToPaste = copiedBlock;
        if (normalizedExternal && normalizedExternal !== normalizedInternal) {
            const lines = externalClipboardText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
            if (lines.length > 1 && lines[lines.length - 1] === '') {
                lines.pop();
            }
            blockToPaste = [];
            lines.forEach((line, rIdx) => {
                const cells = line.split('\t');
                cells.forEach((cellText, cIdx) => {
                    blockToPaste.push({
                        dRow: rIdx,
                        dCol: cIdx,
                        val: sanitizePlainText(cellText)
                    });
                });
            });
        }

        if (!blockToPaste || blockToPaste.length === 0) return;

        pushUndoState();

        // Si se copió 1 sola celda y hay varias seleccionadas como destino, rellena todas
        if (blockToPaste.length === 1 && targetCoords.length > 1) {
            const singleVal = sanitizeTextWithBold(blockToPaste[0].val);
            targetCoords.forEach(({ row, col }) => {
                const field = colIndexToField[col];
                if (editableCols.includes(field) && filteredData[row]) {
                    filteredData[row][field] = numericFormulaCols.includes(field) ? sanitizePlainText(singleVal) : singleVal;
                }
            });
            clearSelection();
            scheduleSaveState();
            updateTotalQuantityOnly();
            renderVirtualRows();
            clipboardStatus.innerText = `✅ Texto limpio pegado en ${targetCoords.length} casillas`;
            return;
        }

        let pastedCount = 0;
        blockToPaste.forEach(item => {
            const destRow = anchorRow + item.dRow;
            const destCol = anchorCol + item.dCol;
            const field = colIndexToField[destCol];

            if (editableCols.includes(field) && filteredData[destRow]) {
                const cleanVal = numericFormulaCols.includes(field)
                    ? sanitizePlainText(item.val)
                    : sanitizeTextWithBold(item.val);
                filteredData[destRow][field] = cleanVal;
                pastedCount++;
            }
        });

        clearSelection();
        if (document.activeElement && document.activeElement.closest('#tableBody')) {
            document.activeElement.blur();
        }
        scheduleSaveState();
        updateTotalQuantityOnly();
        renderVirtualRows();
        clipboardStatus.innerText = `✅ Se pegaron ${pastedCount} casilla(s) limpias sin formato de tabla externo`;
    }

    // Interceptamos el evento nativo "paste" en toda la tabla para prohibir que Excel inserte <table><td> adentro de una celda
    document.addEventListener('paste', (e) => {
        if (!currentUser || !authOverlay.classList.contains('hidden')) return;
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;

        if (selectedCoords.size > 0 || (activeEl && activeEl.closest('#tableBody'))) {
            e.preventDefault();
            const plainText = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
            pasteDataIntoSelection(plainText);
        }
    });

    // Interceptamos también el evento nativo "copy"
    document.addEventListener('copy', (e) => {
        if (!currentUser || !authOverlay.classList.contains('hidden')) return;
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;

        if (selectedCoords.size > 0) {
            e.preventDefault();
            copySelectedCellsAndClear();
            if (e.clipboardData && lastCopiedPlainText) {
                e.clipboardData.setData('text/plain', lastCopiedPlainText);
            }
        }
    });

    // Atajos de teclado: Ctrl+Z (Deshacer), Ctrl+B (Negrita), Ctrl+C (Copiar y desmarcar)
    document.addEventListener('keydown', (e) => {
        if (!currentUser || !authOverlay.classList.contains('hidden')) return;
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;

        const isCtrl = e.ctrlKey || e.metaKey;
        if (!isCtrl) return;

        const keyLower = e.key.toLowerCase();

        // CTRL + Z: Deshacer
        if (keyLower === 'z') {
            e.preventDefault();
            if (activeEl && activeEl.closest('#tableBody')) {
                activeEl.blur();
            }
            performUndo();
            return;
        }

        // CTRL + B: Negrita
        if (keyLower === 'b') {
            e.preventDefault();
            toggleBoldOnSelection();
            return;
        }

        // CTRL + C: Copiar y desmarcar inmediatamente
        if (keyLower === 'c' && selectedCoords.size > 0) {
            e.preventDefault();
            copySelectedCellsAndClear();
        }
    });

    // Cambiar color de fondo de las celdas seleccionadas (con soporte para Deshacer)
    cellColorPicker.addEventListener('mousedown', () => {
        colorPickerSnapshotSaved = false;
    });

    cellColorPicker.addEventListener('input', (e) => {
        if (selectedCoords.size === 0) return;
        if (!colorPickerSnapshotSaved) {
            pushUndoState();
            colorPickerSnapshotSaved = true;
        }

        const color = e.target.value;
        selectedCoords.forEach(key => {
            const [r, c] = key.split(':').map(Number);
            const field = colIndexToField[c];
            if (!editableCols.includes(field) || !filteredData[r]) return;

            if (!filteredData[r].colors) {
                filteredData[r].colors = {};
            }
            filteredData[r].colors[field] = color;
        });
        scheduleSaveState();
        renderVirtualRows();
    });

    // Insertar filas (con soporte para Deshacer)
    addRowBtn.addEventListener('click', () => {
        pushUndoState();

        const count = Math.max(1, parseInt(insertCountInput.value) || 1);
        const desiredPos = parseInt(insertPosInput.value);

        const newRows = [];
        for (let i = 0; i < count; i++) {
            newRows.push({
                temporada: '',
                marca: '',
                codigo: '',
                desc: '',
                talle: '',
                comprada: '1',
                vendida: '0',
                pLista: '0',
                colors: {}
            });
        }

        if (!isNaN(desiredPos) && desiredPos >= 1) {
            const targetIndex = Math.min(desiredPos - 1, savedData.length);
            savedData.splice(targetIndex, 0, ...newRows);
        } else {
            savedData.push(...newRows);
        }

        insertPosInput.value = '';
        scheduleSaveState();
        recomputeFilteredData();
        clipboardStatus.innerText = `➕ Se agregaron ${count} fila(s)`;
    });

    // Eliminar filas marcadas (con soporte para Deshacer)
    deleteRowBtn.addEventListener('click', () => {
        if (checkedOriginalIndices.size > 0) {
            pushUndoState();
            const removedCount = checkedOriginalIndices.size;
            savedData = savedData.filter((_, idx) => !checkedOriginalIndices.has(idx));
            checkedOriginalIndices.clear();
            selectedCoords.clear();
            scheduleSaveState();
            recomputeFilteredData();
            clipboardStatus.innerText = `🗑️ Se eliminaron ${removedCount} fila(s)`;
        } else {
            alert('Seleccioná al menos una fila con la casilla de la primera columna para eliminar.');
        }
    });

    // Modal de Ajustes (Tuerca)
    settingsBtn.addEventListener('click', () => {
        cashPercentInput.value = cashPercentage;
        settingsModal.classList.remove('hidden');
    });

    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });

    saveSettingsBtn.addEventListener('click', () => {
        const newPercent = parseFloat(cashPercentInput.value);
        if (!isNaN(newPercent) && newPercent > 0) {
            cashPercentage = newPercent;
            efectivoHeader.innerText = `Precio Efectivo (${cashPercentage}%)`;
            settingsModal.classList.add('hidden');
            scheduleSaveState();
            renderVirtualRows();
        }
    });

    clearFiltersBtn.addEventListener('click', () => {
        colFilters.forEach(input => input.value = '');
        tableContainer.scrollTop = 0;
        recomputeFilteredData();
    });

    colFilters.forEach(input => {
        input.addEventListener('input', () => {
            clearTimeout(filterTimeout);
            filterTimeout = setTimeout(() => {
                tableContainer.scrollTop = 0;
                recomputeFilteredData();
            }, 120);
        });
    });

    if (currentUser) {
        loadUserSession(currentUser);
    }
});