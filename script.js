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

    // Elementos de Ajustes y Calendario (Tuerca)
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const cashPercentInput = document.getElementById('cashPercentInput');
    const efectivoHeader = document.getElementById('efectivoHeader');

    const prevMonthBtn = document.getElementById('prevMonthBtn');
    const nextMonthBtn = document.getElementById('nextMonthBtn');
    const calendarMonthLabel = document.getElementById('calendarMonthLabel');
    const calendarDaysGrid = document.getElementById('calendarDaysGrid');
    const selectedDayTitle = document.getElementById('selectedDayTitle');
    const selectedDayTotalBadge = document.getElementById('selectedDayTotalBadge');
    const selectedDaySalesList = document.getElementById('selectedDaySalesList');

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
    let salesHistory = {};

    // Estado del Calendario (0 = mes actual, -1 = mes anterior)
    let calendarMonthOffset = 0;
    let selectedCalendarDateKey = getTodayDateKey();

    // Pila de historial para el botón Deshacer (Undo)
    let undoStack = [];
    let cellEditSnapshot = null;
    let cellEditDirty = false;
    let focusedVendidaBaselineMap = new Map();
    let colorPickerSnapshotSaved = false;

    // Estado de selección, cursor activo (flechitas) y portapapeles
    let selectedCoords = new Set();
    let activeCursorCoords = null; // { row: vrow, col: vcol }
    let checkedOriginalIndices = new Set();
    let isDragging = false;
    let dragStartCoords = null;
    let hasMovedMouseDuringDrag = false;
    let copiedBlock = null;
    let lastCopiedPlainText = '';
    let saveTimeout = null;
    let filterTimeout = null;

    // Utilidades de Fechas y Autolimpieza de Meses Antiguos
    function getTodayDateKey() {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function getAllowedYearMonths() {
        const now = new Date();
        const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const prevYM = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
        return new Set([currentYM, prevYM]);
    }

    function pruneOldSalesHistory() {
        const allowedMonths = getAllowedYearMonths();
        Object.keys(salesHistory).forEach(dateKey => {
            const ym = dateKey.slice(0, 7);
            if (!allowedMonths.has(ym)) {
                delete salesHistory[dateKey];
            }
        });
    }

    function recordSaleInCalendar(item, deltaQty) {
        const cleanDelta = Math.round(deltaQty * 100) / 100;
        if (cleanDelta <= 0) return;

        pruneOldSalesHistory();
        const todayKey = getTodayDateKey();
        if (!salesHistory[todayKey]) {
            salesHistory[todayKey] = [];
        }

        const prodDesc = stripHtml(item.desc) || 'Producto sin descripción';
        const prodCode = stripHtml(item.codigo) || 'S/C';
        const prodBrand = stripHtml(item.marca) || 'Sin marca';
        const nowTime = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

        const existingEntry = salesHistory[todayKey].find(
            entry => entry.codigo === prodCode && entry.desc === prodDesc
        );

        if (existingEntry) {
            existingEntry.qty = Math.round((existingEntry.qty + cleanDelta) * 100) / 100;
            existingEntry.time = nowTime;
        } else {
            salesHistory[todayKey].unshift({
                codigo: prodCode,
                desc: prodDesc,
                marca: prodBrand,
                qty: cleanDelta,
                time: nowTime
            });
        }
    }

    function sanitizePlainText(inputStr) {
        if (inputStr === null || inputStr === undefined) return '';
        return String(inputStr)
            .replace(/<[^>]*>/g, ' ')
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/[^\p{L}\p{N}\s.,;:$%+\-*/=()_"#@!?&°']/gu, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

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

    function createFullSnapshot() {
        return {
            table: savedData.map(item => ({
                temporada: item.temporada,
                marca: item.marca,
                codigo: item.codigo,
                desc: item.desc,
                talle: item.talle,
                comprada: item.comprada,
                vendida: item.vendida,
                pLista: item.pLista,
                colors: item.colors ? { ...item.colors } : {}
            })),
            sales: JSON.parse(JSON.stringify(salesHistory))
        };
    }

    function updateUndoButtonUI() {
        if (!undoBtn) return;
        undoBtn.disabled = undoStack.length === 0;
        undoBtn.innerText = undoStack.length > 0 ? `↩️ Deshacer (${undoStack.length})` : '↩️ Deshacer';
    }

    function pushUndoState(customSnapshot = null) {
        const snapshot = customSnapshot || createFullSnapshot();
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
        const restored = undoStack.pop();
        savedData = restored.table;
        salesHistory = restored.sales || {};
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

        pruneOldSalesHistory();
        db[currentUser].data = savedData;
        db[currentUser].notepad = notepad.value;
        db[currentUser].cashPercent = cashPercentage;
        db[currentUser].salesHistory = salesHistory;
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
        salesHistory = userRecord.salesHistory || {};
        pruneOldSalesHistory();

        cashPercentInput.value = cashPercentage;
        efectivoHeader.innerText = `Precio Efectivo (${cashPercentage}%)`;
        currentUserBadge.innerText = `👤 Usuario: ${username}`;
        authOverlay.classList.add('hidden');
        authMessage.innerText = '';

        undoStack = [];
        updateUndoButtonUI();
        selectedCoords.clear();
        activeCursorCoords = null;
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

        const todayKey = getTodayDateKey();
        db[user] = {
            password: pass,
            data: getSampleData(),
            notepad: '',
            cashPercent: 80,
            salesHistory: {
                [todayKey]: [
                    { codigo: 'ART-001', desc: 'Producto Destacado A', marca: 'Línea Clásica', qty: 5, time: '10:30' },
                    { codigo: 'ART-022', desc: 'Producto Línea Premium', marca: 'Broer', qty: 4, time: '11:15' }
                ]
            }
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

    // Renderizado del Calendario de Ventas
    function renderSalesCalendar() {
        pruneOldSalesHistory();

        const now = new Date();
        const targetDate = new Date(now.getFullYear(), now.getMonth() + calendarMonthOffset, 1);
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth();

        const monthName = targetDate.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
        calendarMonthLabel.innerText = monthName;

        prevMonthBtn.disabled = calendarMonthOffset <= -1;
        nextMonthBtn.disabled = calendarMonthOffset >= 0;

        calendarDaysGrid.innerHTML = '';

        const firstDayRaw = new Date(year, month, 1).getDay();
        const startOffset = (firstDayRaw + 6) % 7;
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let i = 0; i < startOffset; i++) {
            const emptyCell = document.createElement('div');
            emptyCell.className = 'cal-day empty';
            calendarDaysGrid.appendChild(emptyCell);
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayLogs = salesHistory[dateKey] || [];
            const totalUnitsDay = dayLogs.reduce((acc, item) => acc + (parseFloat(item.qty) || 0), 0);

            const dayEl = document.createElement('div');
            dayEl.className = 'cal-day';
            if (totalUnitsDay > 0) dayEl.classList.add('has-sales');
            if (dateKey === selectedCalendarDateKey) dayEl.classList.add('active');

            dayEl.innerHTML = `
                <span class="cal-day-num">${day}</span>
                ${totalUnitsDay > 0 ? `<span class="cal-day-badge">${totalUnitsDay} u.</span>` : ''}
            `;

            dayEl.addEventListener('click', () => {
                selectedCalendarDateKey = dateKey;
                renderSalesCalendar();
            });

            calendarDaysGrid.appendChild(dayEl);
        }

        renderSelectedDaySalesDetails();
    }

    function renderSelectedDaySalesDetails() {
        const [y, m, d] = selectedCalendarDateKey.split('-');
        selectedDayTitle.innerText = `Ventas del ${d}/${m}/${y}`;

        const logs = salesHistory[selectedCalendarDateKey] || [];
        const totalDay = logs.reduce((acc, item) => acc + (parseFloat(item.qty) || 0), 0);
        selectedDayTotalBadge.innerText = `${totalDay.toLocaleString('es-AR')} u. vendidas`;

        selectedDaySalesList.innerHTML = '';

        if (logs.length === 0) {
            selectedDaySalesList.innerHTML = `<li class="sales-empty-msg">Sin ventas registradas en esta fecha.</li>`;
            return;
        }

        logs.forEach(entry => {
            const li = document.createElement('li');
            li.className = 'sales-log-item';
            li.innerHTML = `
                <div class="sales-item-info">
                    <span class="sales-item-title">${entry.desc}</span>
                    <span class="sales-item-meta">Cód: ${entry.codigo} | Marca: ${entry.marca} | 🕒 ${entry.time || '-'}</span>
                </div>
                <span class="sales-item-qty">+${entry.qty.toLocaleString('es-AR')} u.</span>
            `;
            selectedDaySalesList.appendChild(li);
        });
    }

    prevMonthBtn.addEventListener('click', () => {
        if (calendarMonthOffset > -1) {
            calendarMonthOffset = -1;
            renderSalesCalendar();
        }
    });

    nextMonthBtn.addEventListener('click', () => {
        if (calendarMonthOffset < 0) {
            calendarMonthOffset = 0;
            renderSalesCalendar();
        }
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

            for (let c = 0; c < 5; c++) {
                const field = colIndexToField[c];
                const isSel = selectedCoords.has(`${vRow}:${c}`) ? 'cell-selected' : '';
                const isAct = (activeCursorCoords && activeCursorCoords.row === vRow && activeCursorCoords.col === c) ? 'cell-active-cursor' : '';
                const bg = cellColors[field] ? `background-color:${cellColors[field]};` : '';
                const cleanHtml = sanitizeTextWithBold(item[field] || '');
                html += `<td contenteditable="true" data-field="${field}" data-vcol="${c}" class="${isSel} ${isAct}" style="${bg}">${cleanHtml}</td>`;
            }

            const c5Sel = selectedCoords.has(`${vRow}:5`) ? 'cell-selected' : '';
            const c5Act = (activeCursorCoords && activeCursorCoords.row === vRow && activeCursorCoords.col === 5) ? 'cell-active-cursor' : '';
            const c5Form = compEval.isFormula ? 'has-custom-formula' : '';
            const c5Title = compEval.isFormula ? `Fórmula: ${compEval.raw}` : '';
            const c5Bg = cellColors.comprada ? `background-color:${cellColors.comprada};` : '';
            html += `<td contenteditable="true" data-field="comprada" data-vcol="5" class="num ${c5Form} ${c5Sel} ${c5Act}" title="${c5Title}" style="${c5Bg}">${formatNumericDisplay('comprada', compEval.value)}</td>`;

            const c6Sel = selectedCoords.has(`${vRow}:6`) ? 'cell-selected' : '';
            const c6Act = (activeCursorCoords && activeCursorCoords.row === vRow && activeCursorCoords.col === 6) ? 'cell-active-cursor' : '';
            const c6Form = vendEval.isFormula ? 'has-custom-formula' : '';
            const c6Title = vendEval.isFormula ? `Fórmula: ${vendEval.raw}` : '';
            const c6Bg = cellColors.vendida ? `background-color:${cellColors.vendida};` : '';
            html += `<td contenteditable="true" data-field="vendida" data-vcol="6" class="num ${c6Form} ${c6Sel} ${c6Act}" title="${c6Title}" style="${c6Bg}">${formatNumericDisplay('vendida', vendEval.value)}</td>`;

            const c7Sel = selectedCoords.has(`${vRow}:7`) ? 'cell-selected' : '';
            const c7Act = (activeCursorCoords && activeCursorCoords.row === vRow && activeCursorCoords.col === 7) ? 'cell-active-cursor' : '';
            html += `<td data-field="stock" data-vcol="7" class="num formula-cell stock-cell ${c7Sel} ${c7Act}">${stock.toLocaleString('es-AR')}</td>`;

            const c8Sel = selectedCoords.has(`${vRow}:8`) ? 'cell-selected' : '';
            const c8Act = (activeCursorCoords && activeCursorCoords.row === vRow && activeCursorCoords.col === 8) ? 'cell-active-cursor' : '';
            const c8Form = listaEval.isFormula ? 'has-custom-formula' : '';
            const c8Title = listaEval.isFormula ? `Fórmula: ${listaEval.raw}` : '';
            const c8Bg = cellColors.pLista ? `background-color:${cellColors.pLista};` : '';
            html += `<td contenteditable="true" data-field="pLista" data-vcol="8" class="num ${c8Form} ${c8Sel} ${c8Act}" title="${c8Title}" style="${c8Bg}">${formatNumericDisplay('pLista', listaEval.value)}</td>`;

            const c9Sel = selectedCoords.has(`${vRow}:9`) ? 'cell-selected' : '';
            const c9Act = (activeCursorCoords && activeCursorCoords.row === vRow && activeCursorCoords.col === 9) ? 'cell-active-cursor' : '';
            html += `<td data-field="efectivo" data-vcol="9" class="num formula-cell efectivo-cell ${c9Sel} ${c9Act}">$${pEfectivo.toLocaleString('es-AR')}</td>`;

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
            const vrow = parseInt(cell.closest('tr').dataset.vrow);
            const vcol = parseInt(cell.dataset.vcol);
            const key = `${vrow}:${vcol}`;
            if (selectedCoords.has(key)) {
                cell.classList.add('cell-selected');
            } else {
                cell.classList.remove('cell-selected');
            }
            if (activeCursorCoords && activeCursorCoords.row === vrow && activeCursorCoords.col === vcol) {
                cell.classList.add('cell-active-cursor');
            } else {
                cell.classList.remove('cell-active-cursor');
            }
        });
    }

    function clearSelection() {
        selectedCoords.clear();
        activeCursorCoords = null;
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

    // Posiciona el cursor de escritura al final del texto de la celda sin requerir clic en el centro
    function placeCaretAtEnd(cellEl) {
        if (!cellEl || cellEl.getAttribute('contenteditable') !== 'true') return;
        cellEl.focus();
        const range = document.createRange();
        range.selectNodeContents(cellEl);
        range.collapse(false);
        const sel = window.getSelection();
        if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }

    // Asegura que la fila destino sea visible al navegar con las flechitas del teclado
    function ensureRowVisibleAndFocus(targetRow, targetCol) {
        const headerOffset = 82;
        const rowTop = targetRow * ROW_HEIGHT;
        const rowBottom = rowTop + ROW_HEIGHT;
        const viewTop = tableContainer.scrollTop;
        const viewBottom = viewTop + tableContainer.clientHeight - headerOffset;

        if (rowTop < viewTop) {
            tableContainer.scrollTop = rowTop;
            renderVirtualRows();
        } else if (rowBottom > viewBottom) {
            tableContainer.scrollTop = rowBottom - (tableContainer.clientHeight - headerOffset);
            renderVirtualRows();
        } else {
            syncSelectionClassesInDOM();
        }

        const cellEl = tableBody.querySelector(`tr[data-vrow="${targetRow}"] td[data-vcol="${targetCol}"]`);
        if (cellEl) {
            if (cellEl.getAttribute('contenteditable') === 'true') {
                placeCaretAtEnd(cellEl);
            } else {
                if (document.activeElement && document.activeElement.closest('#tableBody')) {
                    document.activeElement.blur();
                }
            }
        }
    }

    // Actualiza la fila visual (stock, precio efectivo y alerta roja) de cualquier fila visible
    function refreshRowComputedDOM(vRow) {
        const item = filteredData[vRow];
        if (!item) return;
        const rowEl = tableBody.querySelector(`tr[data-vrow="${vRow}"]`);
        if (!rowEl) return;

        const stock = calculateStock(item);
        const pEfectivo = calculateCashPrice(item);

        const stockCell = rowEl.querySelector('.stock-cell');
        if (stockCell) stockCell.innerText = stock.toLocaleString('es-AR');

        const efCell = rowEl.querySelector('.efectivo-cell');
        if (efCell) efCell.innerText = `$${pEfectivo.toLocaleString('es-AR')}`;

        if (stock <= 0) {
            rowEl.classList.add('out-of-stock');
        } else {
            rowEl.classList.remove('out-of-stock');
        }
    }

    // Actualiza la celda editada y REPLICA en tiempo real si hay múltiples celdas seleccionadas
    function updateCellData(cell) {
        const row = cell.closest('tr');
        if (!row) return;
        const activeVRow = parseInt(row.dataset.vrow);
        const activeVCol = parseInt(cell.dataset.vcol);
        const originalIndex = parseInt(row.dataset.index);
        const field = cell.dataset.field;

        if (!cellEditDirty && cellEditSnapshot) {
            pushUndoState(cellEditSnapshot);
            cellEditDirty = true;
        }

        const cleanHtmlVal = sanitizeTextWithBold(cell.innerHTML);
        const cleanPlainVal = sanitizePlainText(cell.innerText);

        if (textCols.includes(field)) {
            savedData[originalIndex][field] = cleanHtmlVal;
        } else {
            savedData[originalIndex][field] = cleanPlainVal;
        }

        refreshRowComputedDOM(activeVRow);

        // Requisito 3: Si hay varias celdas seleccionadas, se escribe exactamente igual en todas a la vez
        if (selectedCoords.size > 1) {
            selectedCoords.forEach(coordKey => {
                const [r, c] = coordKey.split(':').map(Number);
                if (r === activeVRow && c === activeVCol) return;

                const targetField = colIndexToField[c];
                const targetItem = filteredData[r];
                if (!editableCols.includes(targetField) || !targetItem) return;

                // Guardamos el valor original de "vendida" por si están editando varias celdas de ventas a la vez
                if (targetField === 'vendida' && !focusedVendidaBaselineMap.has(targetItem._origIdx)) {
                    focusedVendidaBaselineMap.set(targetItem._origIdx, evaluateFormula(targetItem.vendida).value);
                }

                if (textCols.includes(targetField)) {
                    targetItem[targetField] = cleanHtmlVal;
                } else {
                    targetItem[targetField] = cleanPlainVal;
                }

                // Actualizar visualmente las otras celdas seleccionadas en vivo
                const otherCellEl = tableBody.querySelector(`tr[data-vrow="${r}"] td[data-vcol="${c}"]`);
                if (otherCellEl) {
                    if (textCols.includes(targetField)) {
                        otherCellEl.innerHTML = cleanHtmlVal;
                    } else {
                        otherCellEl.innerText = cleanPlainVal;
                    }
                }
                refreshRowComputedDOM(r);
            });
        }

        updateTotalQuantityOnly();
        scheduleSaveState();
    }

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

        activeCursorCoords = { row: vrow, col: vcol };
        hasMovedMouseDuringDrag = false;

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

        if (vrow !== dragStartCoords.row || vcol !== dragStartCoords.col) {
            hasMovedMouseDuringDrag = true;
            // Si está arrastrando para seleccionar varias celdas, evitamos que quede atrapado el cursor de texto en una sola
            if (document.activeElement && document.activeElement.closest('#tableBody')) {
                document.activeElement.blur();
            }
        }
        selectRange(dragStartCoords, { row: vrow, col: vcol });
    });

    // Al soltar el clic sobre una celda (incluso si tocó el borde de la casilla), habilita la escritura inmediata
    tableBody.addEventListener('mouseup', (e) => {
        const cell = e.target.closest('td[data-vcol]');
        if (!cell) return;

        if (!hasMovedMouseDuringDrag && selectedCoords.size === 1 && cell.getAttribute('contenteditable') === 'true') {
            if (document.activeElement !== cell) {
                placeCaretAtEnd(cell);
            }
        }
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

        cellEditSnapshot = createFullSnapshot();
        cellEditDirty = false;
        focusedVendidaBaselineMap.clear();

        const field = cell.dataset.field;
        const originalIndex = parseInt(cell.closest('tr').dataset.index);

        if (field === 'vendida') {
            focusedVendidaBaselineMap.set(originalIndex, evaluateFormula(savedData[originalIndex].vendida).value);
        }

        if (numericFormulaCols.includes(field)) {
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
        const item = savedData[originalIndex];

        if (numericFormulaCols.includes(field)) {
            const rawVal = item[field];
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
            const clean = sanitizeTextWithBold(item[field]);
            item[field] = clean;
            cell.innerHTML = clean;
        }

        // Si se modificaron una o varias celdas de "Cantidad Vendida", registra las ventas en el calendario y formatea números
        if (focusedVendidaBaselineMap.size > 0) {
            let totalSalesAdded = 0;
            focusedVendidaBaselineMap.forEach((oldVal, origIdx) => {
                const targetItem = savedData[origIdx];
                if (!targetItem) return;
                const newEval = evaluateFormula(targetItem.vendida).value;
                const delta = newEval - oldVal;
                if (delta > 0) {
                    recordSaleInCalendar(targetItem, delta);
                    totalSalesAdded += delta;
                }
            });
            if (totalSalesAdded > 0) {
                scheduleSaveState();
                clipboardStatus.innerText = `📅 Venta registrada hoy en el Calendario (+${totalSalesAdded} u. en total)`;
            }
            focusedVendidaBaselineMap.clear();
        }

        // Si había múltiples celdas numéricas seleccionadas, aseguramos que todas queden con formato $ y miles al salir
        if (selectedCoords.size > 1) {
            renderVirtualRows();
        }

        cellEditSnapshot = null;
        cellEditDirty = false;
    });

    tableBody.addEventListener('input', (e) => {
        const cell = e.target.closest('td[contenteditable="true"]');
        if (!cell) return;

        if (cell.querySelector('table, tr, td, div, span, p')) {
            const cleanText = sanitizePlainText(cell.innerText);
            cell.innerText = cleanText;
        }
        updateCellData(cell);
    });

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

    // Copiar celdas seleccionadas y desmarcarlas inmediatamente
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

        clearSelection();
        window.getSelection()?.removeAllRanges();
        if (document.activeElement && document.activeElement.closest('#tableBody')) {
            document.activeElement.blur();
        }

        clipboardStatus.innerText = `📋 ${count} casilla(s) copiada(s) (selección desmarcada). Hacé clic donde pegar y tocá Ctrl+V`;
        return true;
    }

    // Pegar datos
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

        if (blockToPaste.length === 1 && targetCoords.length > 1) {
            const singleVal = sanitizeTextWithBold(blockToPaste[0].val);
            targetCoords.forEach(({ row, col }) => {
                const field = colIndexToField[col];
                const item = filteredData[row];
                if (editableCols.includes(field) && item) {
                    const oldVendida = field === 'vendida' ? evaluateFormula(item.vendida).value : 0;
                    const cleanVal = numericFormulaCols.includes(field) ? sanitizePlainText(singleVal) : singleVal;
                    item[field] = cleanVal;
                    if (field === 'vendida') {
                        const newVendida = evaluateFormula(cleanVal).value;
                        if (newVendida > oldVendida) {
                            recordSaleInCalendar(item, newVendida - oldVendida);
                        }
                    }
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
        blockToPaste.forEach(entry => {
            const destRow = anchorRow + entry.dRow;
            const destCol = anchorCol + entry.dCol;
            const field = colIndexToField[destCol];
            const item = filteredData[destRow];

            if (editableCols.includes(field) && item) {
                const oldVendida = field === 'vendida' ? evaluateFormula(item.vendida).value : 0;
                const cleanVal = numericFormulaCols.includes(field)
                    ? sanitizePlainText(entry.val)
                    : sanitizeTextWithBold(entry.val);
                item[field] = cleanVal;
                if (field === 'vendida') {
                    const newVendida = evaluateFormula(cleanVal).value;
                    if (newVendida > oldVendida) {
                        recordSaleInCalendar(item, newVendida - oldVendida);
                    }
                }
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
        clipboardStatus.innerText = `✅ Se pegaron ${pastedCount} casilla(s) limpias`;
    }

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

    // Controlador Maestro de Teclado: Flechitas (↑↓←→), Escritura Directa en 1 o Múltiples Celdas, Borrado y Atajos Ctrl
    document.addEventListener('keydown', (e) => {
        if (!currentUser || !authOverlay.classList.contains('hidden')) return;
        if (!settingsModal.classList.contains('hidden')) return;

        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;

        const isCtrl = e.ctrlKey || e.metaKey;

        // 1. Atajos con Ctrl (Ctrl+Z, Ctrl+B, Ctrl+C)
        if (isCtrl) {
            const keyLower = e.key.toLowerCase();
            if (keyLower === 'z') {
                e.preventDefault();
                if (activeEl && activeEl.closest('#tableBody')) activeEl.blur();
                performUndo();
                return;
            }
            if (keyLower === 'b') {
                e.preventDefault();
                toggleBoldOnSelection();
                return;
            }
            if (keyLower === 'c' && selectedCoords.size > 0) {
                e.preventDefault();
                copySelectedCellsAndClear();
                return;
            }
            return;
        }

        // 2. Navegación con las Flechitas del Teclado (Arriba, Abajo, Izquierda, Derecha)
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            if (selectedCoords.size === 0 && !activeCursorCoords) return;

            if (!activeCursorCoords) {
                const firstKey = Array.from(selectedCoords)[0];
                const [r, c] = firstKey.split(':').map(Number);
                activeCursorCoords = { row: r, col: c };
            }

            e.preventDefault();

            let nextRow = activeCursorCoords.row;
            let nextCol = activeCursorCoords.col;

            if (e.key === 'ArrowUp') nextRow = Math.max(0, nextRow - 1);
            if (e.key === 'ArrowDown') nextRow = Math.min(filteredData.length - 1, nextRow + 1);
            if (e.key === 'ArrowLeft') nextCol = Math.max(0, nextCol - 1);
            if (e.key === 'ArrowRight') nextCol = Math.min(colIndexToField.length - 1, nextCol + 1);

            activeCursorCoords = { row: nextRow, col: nextCol };

            if (e.shiftKey && dragStartCoords) {
                selectRange(dragStartCoords, activeCursorCoords);
            } else {
                dragStartCoords = { ...activeCursorCoords };
                selectedCoords.clear();
                selectedCoords.add(`${nextRow}:${nextCol}`);
            }

            ensureRowVisibleAndFocus(nextRow, nextCol);
            return;
        }

        // 3. Borrar contenido de todas las celdas seleccionadas con Delete o Backspace (si no hay foco activo)
        const isEditingInsideCell = activeEl && activeEl.closest('td[contenteditable="true"]');
        if (!isEditingInsideCell && (e.key === 'Backspace' || e.key === 'Delete') && selectedCoords.size > 0) {
            e.preventDefault();
            pushUndoState();
            selectedCoords.forEach(coordKey => {
                const [r, c] = coordKey.split(':').map(Number);
                const field = colIndexToField[c];
                const item = filteredData[r];
                if (editableCols.includes(field) && item) {
                    item[field] = numericFormulaCols.includes(field) ? '0' : '';
                }
            });
            scheduleSaveState();
            updateTotalQuantityOnly();
            renderVirtualRows();
            clipboardStatus.innerText = `🧹 Contenido borrado en ${selectedCoords.size} casilla(s)`;
            return;
        }

        // 4. Empezar a escribir directamente al seleccionar una o varias celdas sin hacer doble clic
        const isPrintableChar = e.key.length === 1 && !e.altKey;
        if (!isEditingInsideCell && isPrintableChar && selectedCoords.size > 0) {
            let targetCoord = activeCursorCoords;
            if (!targetCoord) {
                const [r, c] = Array.from(selectedCoords)[0].split(':').map(Number);
                targetCoord = { row: r, col: c };
                activeCursorCoords = targetCoord;
            }

            const targetField = colIndexToField[targetCoord.col];
            if (!editableCols.includes(targetField)) return;

            e.preventDefault();

            // Asegurar que la celda principal esté visible en el DOM y enfocarla con la letra presionada
            ensureRowVisibleAndFocus(targetCoord.row, targetCoord.col);
            const cellEl = tableBody.querySelector(`tr[data-vrow="${targetCoord.row}"] td[data-vcol="${targetCoord.col}"]`);
            if (cellEl) {
                cellEl.innerText = e.key;
                placeCaretAtEnd(cellEl);
                updateCellData(cellEl);
            }
        }
    });

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

    deleteRowBtn.addEventListener('click', () => {
        if (checkedOriginalIndices.size > 0) {
            pushUndoState();
            const removedCount = checkedOriginalIndices.size;
            savedData = savedData.filter((_, idx) => !checkedOriginalIndices.has(idx));
            checkedOriginalIndices.clear();
            selectedCoords.clear();
            activeCursorCoords = null;
            scheduleSaveState();
            recomputeFilteredData();
            clipboardStatus.innerText = `🗑️ Se eliminaron ${removedCount} fila(s)`;
        } else {
            alert('Seleccioná al menos una fila con la casilla de la primera columna para eliminar.');
        }
    });

    // Abrir Modal de Ajustes y Calendario de Ventas
    settingsBtn.addEventListener('click', () => {
        cashPercentInput.value = cashPercentage;
        calendarMonthOffset = 0;
        selectedCalendarDateKey = getTodayDateKey();
        renderSalesCalendar();
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
            scheduleSaveState();
            renderVirtualRows();
            clipboardStatus.innerText = `⚙️ Porcentaje de Precio Efectivo actualizado a ${cashPercentage}%`;
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