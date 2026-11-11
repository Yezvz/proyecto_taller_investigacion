/**
 * ============================================================================
 * CREDENCIAL INTELIGENTE ITTLA — CONTROLADOR PRINCIPAL DE INTERFAZ (PWA)
 * Archivo: js/app.js
 * Propósito: Orquestar las vistas, el acceso del alumno, la conexión Bluetooth
 *            BLE con el ESP32, el registro offline en IndexedDB y el calendario.
 * ============================================================================
 */

(function () {
  'use strict';

  // Módulos locales de la nueva arquitectura PWA
  const database = window.IttlaDatabase;
  const bluetoothService = window.IttlaBluetoothService;
  const attendanceService = window.IttlaAttendanceService;

  // Estado del alumno activo y del calendario
  let activeStudent = null;
  const initialToday = new Date();
  let todayYear = initialToday.getFullYear();
  let todayMonth = initialToday.getMonth(); // 0-indexed (0=Enero ... 9=Octubre)
  let todayDay = initialToday.getDate();

  let currentYear = todayYear;
  let currentMonth = todayMonth;
  let selectedDay = todayDay;

  // Nombres de meses en español
  const MONTHS_ES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  // ==========================================
  // INICIALIZACIÓN DE LA APLICACIÓN (PWA)
  // ==========================================
  document.addEventListener('DOMContentLoaded', async () => {
    // 1. Iniciar reloj institucional en tiempo real
    initClock();

    // 2. Iniciar observador dinámico de avance de día
    initDateWatcher();

    // 3. Registrar Service Worker para soporte PWA Offline
    registerServiceWorker();

    // 4. Inicializar base de datos local IndexedDB
    try {
      await database.openDB();
      // Cargar alumno por defecto (Jesus Martinez Mar - 22251022)
      activeStudent = await database.getStudentByMatricula('22251022');
    } catch (err) {
      console.error('[App] Error al inicializar IndexedDB:', err);
      showToast('Error al acceder al almacenamiento local del dispositivo.', 'danger');
    }

    // 5. Configurar escuchas de eventos Bluetooth BLE
    setupBluetoothListeners();

    // 6. Cargar datos en las vistas del portal
    if (activeStudent) {
      await refreshStudentPortal();
    }
  });

  // Registro del Service Worker para capacidades PWA Offline
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
          .then(reg => {
            console.info('[PWA] Service Worker activo y registrado:', reg.scope);
          })
          .catch(err => {
            console.warn('[PWA] Service Worker no se pudo registrar:', err);
          });
      });
    }
  }

  // Reloj institucional en tiempo real
  function initClock() {
    const clockEl = document.getElementById('liveClockDisplay');
    const update = () => {
      const now = new Date();
      if (clockEl) {
        clockEl.textContent = now.toLocaleTimeString('es-MX', { hour12: true });
      }
    };
    update();
    setInterval(update, 1000);
  }

  // ==========================================
  // AUTENTICACIÓN / ACCESO DEL ALUMNO (LOCAL)
  // ==========================================
  window.handleLoginSubmit = async function (event) {
    event.preventDefault();
    const matriculaInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');

    const matricula = (matriculaInput ? matriculaInput.value : '').trim();
    const password = (passwordInput ? passwordInput.value : '').trim();

    if (!matricula || !password) {
      showToast('Por favor introduce tu matrícula y contraseña institucional.', 'warning');
      return;
    }

    // Validar alumno directamente en la base de datos local IndexedDB
    const student = await database.getStudentByMatricula(matricula);

    if (!student) {
      showToast(`Matrícula [${matricula}] no encontrada en el almacenamiento local.`, 'danger');
      return;
    }

    activeStudent = student;
    await refreshStudentPortal();

    // Transición visual al dashboard
    const loginScreen = document.getElementById('screen-login');
    const dashScreen = document.getElementById('screen-dashboard');
    if (loginScreen) loginScreen.classList.remove('active');
    if (dashScreen) dashScreen.classList.add('active');

    navigateDashboard('view-student-portal');
    showToast(`¡Bienvenido al portal ITTLA, ${activeStudent.nombre_completo}!`, 'success');
    playBeepSound(650, 0.12);
  };

  window.togglePasswordVisibility = function (inputId, btnId) {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(btnId);
    if (!input) return;

    if (input.type === 'password') {
      input.type = 'text';
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      `;
    } else {
      input.type = 'password';
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>
          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>
          <line x1="2" x2="22" y1="2" y2="22"/>
        </svg>
      `;
    }
  };

  window.handleLogout = function () {
    const loginScreen = document.getElementById('screen-login');
    const dashScreen = document.getElementById('screen-dashboard');
    if (dashScreen) dashScreen.classList.remove('active');
    if (loginScreen) loginScreen.classList.add('active');
    showToast('Has cerrado la sesión de forma segura.', 'info');
  };

  // ==========================================
  // NAVEGACIÓN DE VISTAS INTERNAS Y MENÚ LATERAL
  // ==========================================
  window.navigateDashboard = function (targetViewId) {
    document.querySelectorAll('.subview').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.sidebar-menu .nav-item').forEach(btn => btn.classList.remove('active'));

    const target = document.getElementById(targetViewId);
    if (target) target.classList.add('active');

    const activeNavBtn = document.querySelector(`.sidebar-menu .nav-item[data-view="${targetViewId}"]`);
    if (activeNavBtn) activeNavBtn.classList.add('active');

    const titleMap = {
      'view-student-portal': 'Asistencia y Calendario',
      'view-student-perfil': 'Mi Perfil y Credencial'
    };
    const titleEl = document.getElementById('currentViewTitle');
    if (titleEl) titleEl.textContent = titleMap[targetViewId] || 'Portal Alumno';

    // Cierra el menú lateral al seleccionar una opción
    window.toggleSidebar(false);
  };

  window.toggleSidebar = function (forceState) {
    const sidebar = document.getElementById('dashboardSidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (!sidebar) return;

    const isOpen = sidebar.classList.contains('sidebar-open') || sidebar.classList.contains('mobile-open');
    const shouldOpen = typeof forceState === 'boolean' ? forceState : !isOpen;

    if (shouldOpen) {
      sidebar.classList.add('sidebar-open');
      sidebar.classList.add('mobile-open');
      if (backdrop) backdrop.classList.add('active');
    } else {
      sidebar.classList.remove('sidebar-open');
      sidebar.classList.remove('mobile-open');
      if (backdrop) backdrop.classList.remove('active');
    }
  };

  window.toggleMobileSidebar = window.toggleSidebar;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      window.toggleSidebar(false);
      closeBleModal();
      closeAboutModal();
    }
  });

  // ==========================================
  // ACTUALIZACIÓN DE DATOS DEL ALUMNO EN UI
  // ==========================================
  async function refreshStudentPortal() {
    if (!activeStudent) return;

    // Topbar
    setElementText('topbarUserName', activeStudent.nombre_completo);
    setElementText('topbarAvatar', activeStudent.avatar_iniciales);

    // Credencial digital
    setElementText('studentCredName', activeStudent.nombre_completo);
    setElementText('studentCredMatricula', activeStudent.matricula);
    setElementText('studentCredGroup', activeStudent.grupo);
    setElementText('studentCredCareer', activeStudent.carrera);
    setElementText('studentCredAvatar', activeStudent.avatar_iniciales);

    // Expediente y perfil
    setElementText('profileMatriculaVal', activeStudent.matricula);
    setElementText('profileNameVal', activeStudent.nombre_completo);
    setElementText('profileCareerVal', `${activeStudent.carrera} (${activeStudent.plan_estudios || 'ISIC-2010-224'})`);
    setElementText('profileGroupVal', `${activeStudent.semestre} · Grupo ${activeStudent.grupo}`);
    setElementText('profileEmailVal', activeStudent.email || `${activeStudent.matricula}@tlalnepantla.tecnm.mx`);
    setElementText('profileCardAvatar', activeStudent.avatar_iniciales);

    // Renderizar registros y calendario desde IndexedDB
    await renderRecentAttendance();
    await renderCalendar(currentYear, currentMonth);
    await selectCalendarDay(currentYear, currentMonth, selectedDay);
  }

  function setElementText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text || '';
  }

  // ==========================================
  // TABLA DE ASISTENCIAS RECIENTES (IndexedDB)
  // ==========================================
  async function renderRecentAttendance() {
    const tbody = document.getElementById('tbodyStudentRecentAttendance');
    if (!tbody || !activeStudent) return;

    const list = await database.getRecentAttendances(activeStudent.id_alumno, 8);

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; padding:24px; color:var(--text-muted);">
            No hay registros de asistencia guardados en este dispositivo.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = list.map(r => {
      let badgeClass = 'status-active';
      if (r.estado === 'Retardo') badgeClass = 'status-warning';
      if (r.estado.includes('Anticipada')) badgeClass = 'status-danger';
      if (r.estado.includes('Normal')) badgeClass = 'status-info';

      const folio = `REG-${String(r.id_asistencia).padStart(4, '0')}`;

      return `
        <tr>
          <td><strong>${formatDateMx(r.fecha)}</strong></td>
          <td><code>${r.hora}</code></td>
          <td><strong>${r.tipo_movimiento}</strong></td>
          <td><span class="badge-status ${badgeClass}">${r.estado}</span></td>
          <td><small>${r.terminal || 'ESP32 PN532'}</small></td>
          <td><code>${folio}</code></td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================
  // CALENDARIO MENSUAL INTERACTIVO (IndexedDB)
  // ==========================================
  async function renderCalendar(year, month) {
    const titleEl = document.getElementById('calendarMonthTitle');
    const gridEl = document.getElementById('calendarDaysGrid');
    if (!gridEl || !titleEl || !activeStudent) return;

    titleEl.textContent = `${MONTHS_ES[month]} ${year}`;
    gridEl.innerHTML = '';

    const firstDay = new Date(year, month, 1).getDay();
    const startOffset = (firstDay === 0) ? 6 : firstDay - 1; // Lunes = primer día
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Fecha actual del sistema (Hoy)
    const now = new Date();
    const isTodayMonth = (year === now.getFullYear() && month === now.getMonth());
    const realToday = now.getDate();

    // Obtener historial agrupado desde IndexedDB
    const history = await database.getAttendanceHistoryGrouped(activeStudent.id_alumno);

    // Celdas vacías del inicio de semana
    for (let i = 0; i < startOffset; i++) {
      const empty = document.createElement('div');
      empty.className = 'calendar-day empty-day';
      gridEl.appendChild(empty);
    }

    // Días del mes
    for (let d = 1; d <= daysInMonth; d++) {
      const isoDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(year, month, d).getDay();
      const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
      const isToday = isTodayMonth && (d === realToday);
      const isSelected = (d === selectedDay && month === currentMonth && year === currentYear);

      const cell = document.createElement('div');
      cell.className = 'calendar-day';
      cell.dataset.day = d;
      cell.dataset.date = isoDate;

      if (isWeekend) cell.classList.add('weekend');
      if (isToday) cell.classList.add('today', 'is-today');
      if (isSelected) cell.classList.add('selected');

      const record = history[isoDate];
      let dotHtml = '';

      if (record) {
        if (record.entrada) {
          if (record.entrada.estado === 'Retardo') {
            cell.classList.add('has-late');
            dotHtml = '<span class="day-status-dot dot-late" title="Retardo"></span>';
          } else {
            cell.classList.add('has-present');
            dotHtml = '<span class="day-status-dot dot-present" title="Puntual"></span>';
          }
        }
      } else if (isWeekend) {
        dotHtml = '<span class="day-status-dot dot-empty" title="Fin de semana"></span>';
      }

      cell.innerHTML = `
        <span class="day-number">${d}</span>
        ${isToday ? '<span class="today-tag">HOY</span>' : ''}
        ${dotHtml}
      `;
      cell.addEventListener('click', () => selectCalendarDay(year, month, d));
      gridEl.appendChild(cell);
    }
  }

  // Navegación de mes en el calendario
  window.changeStudentCalendarMonth = async function (direction) {
    currentMonth += direction;
    if (currentMonth > 11) {
      currentMonth = 0;
      currentYear++;
    } else if (currentMonth < 0) {
      currentMonth = 11;
      currentYear--;
    }

    const now = new Date();
    selectedDay = (currentYear === now.getFullYear() && currentMonth === now.getMonth())
      ? now.getDate()
      : 1;

    await renderCalendar(currentYear, currentMonth);
    await selectCalendarDay(currentYear, currentMonth, selectedDay);
  };

  // Botón directo para volver a la fecha de hoy
  window.goToToday = async function () {
    const now = new Date();
    currentYear = now.getFullYear();
    currentMonth = now.getMonth();
    selectedDay = now.getDate();

    await renderCalendar(currentYear, currentMonth);
    await selectCalendarDay(currentYear, currentMonth, selectedDay);
    showToast(`Mostrando el día de hoy: ${selectedDay} de ${MONTHS_ES[currentMonth]}`, 'info');
  };

  // Selección de día en el calendario
  window.selectCalendarDay = async function (year, month, day) {
    selectedDay = day;

    document.querySelectorAll('.calendar-day').forEach(c => {
      c.classList.remove('selected');
      if (parseInt(c.dataset.day, 10) === day) c.classList.add('selected');
    });

    const isoDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const formattedDate = `${String(day).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${year}`;

    const now = new Date();
    const isSelectedToday = (year === now.getFullYear() && month === now.getMonth() && day === now.getDate());

    setElementText('dayDetailDateLabel', isSelectedToday ? `${formattedDate} · Hoy` : formattedDate);
    setElementText('specStudentMatricula', activeStudent ? activeStudent.matricula : '22251022');
    setElementText('specStudentName', activeStudent ? activeStudent.nombre_completo : 'Jesus Martinez Mar');
    setElementText('specDate', formattedDate);

    if (!activeStudent) return;

    const history = await database.getAttendanceHistoryGrouped(activeStudent.id_alumno);
    const record = history[isoDate];

    const specTime = document.getElementById('specTime');
    const specMov = document.getElementById('specMovement');
    const specStatus = document.getElementById('specStatus');
    const specTerm = document.getElementById('specTerminal');
    const secBox = document.getElementById('secondaryRecordBox');
    const secText = document.getElementById('secondaryRecordText');

    if (record && record.entrada) {
      if (specTime) specTime.textContent = record.entrada.hora;
      if (specMov) specMov.textContent = record.entrada.movimiento;
      if (specTerm) specTerm.textContent = record.entrada.terminal;

      const isLate = (record.entrada.estado === 'Retardo');
      if (specStatus) {
        specStatus.innerHTML = `<span class="badge-status ${isLate ? 'status-warning' : 'status-active'}">${record.entrada.estado}</span>`;
      }

      if (record.salida && secBox && secText) {
        secBox.style.display = 'block';
        secText.textContent = `Salida: ${record.salida.hora} · ${record.salida.estado}`;
      } else if (secBox) {
        secBox.style.display = 'none';
      }
    } else {
      const dayOfWeek = new Date(year, month, day).getDay();
      const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);

      if (specTime) specTime.textContent = '--:--';
      if (specMov) specMov.textContent = isWeekend ? 'Fin de semana (Inhábil)' : 'Sin pase registrado';
      if (specTerm) specTerm.textContent = isWeekend ? 'Plantel Cerrado' : 'Sin actividad en torniquete';
      if (specStatus) {
        specStatus.innerHTML = `<span class="badge-status status-info">${isWeekend ? 'Inhábil' : 'Sin Registro'}</span>`;
      }
      if (secBox) secBox.style.display = 'none';
    }
  };

  /**
   * Monitor dinámico que detecta el cambio de día a medianoche
   */
  function initDateWatcher() {
    let lastTrackedDay = new Date().getDate();

    setInterval(async () => {
      const now = new Date();
      const currentDay = now.getDate();

      if (currentDay !== lastTrackedDay) {
        lastTrackedDay = currentDay;
        todayYear = now.getFullYear();
        todayMonth = now.getMonth();
        todayDay = now.getDate();

        currentYear = todayYear;
        currentMonth = todayMonth;
        selectedDay = todayDay;

        await renderCalendar(currentYear, currentMonth);
        await selectCalendarDay(currentYear, currentMonth, selectedDay);
        await renderRecentAttendance();

        const dateStr = now.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
        showToast(`El calendario escolar ha avanzado al día de hoy: ${dateStr}`, 'info');
      }
    }, 5000);
  }

  function formatDateMx(isoStr) {
    if (!isoStr) return '--/--/----';
    const parts = isoStr.split('-');
    if (parts.length < 3) return isoStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  window.printStudentAttendance = function () {
    window.print();
  };

  // ==========================================
  // COMUNICACIÓN BLUETOOTH BLE CON ESP32 & PN532
  // ==========================================

  function setupBluetoothListeners() {
    // 1. Escuchar cambios de estado BLE (Desconectado, Buscando, Conectado, Error)
    bluetoothService.onStateChange((statePayload) => {
      updateBleUI(statePayload);
    });

    // Reflejar estado inicial al arrancar en el control de Login y barra lateral
    updateBleUI({
      state: bluetoothService.getState(),
      detail: '',
      deviceName: bluetoothService.getDeviceName(),
      isConnected: bluetoothService.isConnected()
    });

    // 2. Escuchar recepción de credencial NFC transmitida por el ESP32
    bluetoothService.onUidReceived(async (receivedUid) => {
      console.info(`[App] Recibido UID desde ESP32: ${receivedUid}`);
      playBeepSound(1200, 0.15);

      // Procesar validación y guardado en IndexedDB
      const result = await attendanceService.processAttendanceScan(receivedUid, {
        terminal: 'Torniquete ESP32 - PN532'
      });

      if (result.success) {
        playBeepSound(1500, 0.2);
        showToast(`¡Pase registrado! ${result.student.nombre_completo} · ${result.record.tipo_movimiento} (${result.record.estado})`, 'success');

        // Actualizar datos de la tarjeta de escaneo en el modal
        updateLastScanModalUI(result);

        // Refrescar vistas inmediatamente
        await refreshStudentPortal();
      } else {
        playBeepSound(400, 0.3); // Tono de advertencia
        showToast(result.message, 'warning');
        updateLastScanModalUI(result);
      }
    });

    bluetoothService.onError((err) => {
      console.error('[App] Error en servicio Bluetooth:', err);
    });
  }

  /**
   * Actualiza los indicadores visuales de Bluetooth en Login, Sidebar y Modal
   */
  function updateBleUI({ state, detail, deviceName, isConnected }) {
    // A. Control Centralizado en Pantalla de Login
    const loginBleDot = document.getElementById('loginBleDot');
    const loginBleLabel = document.getElementById('loginBleLabel');
    const btnLoginBle = document.getElementById('btnLoginBle');
    const btnLoginBleText = document.getElementById('btnLoginBleText');

    if (loginBleDot) {
      loginBleDot.className = 'ble-status-dot';
      switch (state) {
        case bluetoothService.STATES.CONNECTED:
          loginBleDot.classList.add('dot-connected');
          break;
        case bluetoothService.STATES.SEARCHING:
          loginBleDot.classList.add('dot-searching');
          break;
        case bluetoothService.STATES.ERROR:
          loginBleDot.classList.add('dot-error');
          break;
        default:
          loginBleDot.classList.add('dot-disconnected');
      }
    }

    if (loginBleLabel) {
      if (isConnected) {
        const cleanName = deviceName ? deviceName.replace('ITTLA-', '') : 'ESP32';
        loginBleLabel.textContent = `Lector BLE: ${cleanName}`;
      } else if (state === bluetoothService.STATES.SEARCHING) {
        loginBleLabel.textContent = 'Buscando ESP32...';
      } else if (state === bluetoothService.STATES.ERROR) {
        loginBleLabel.textContent = 'Lector BLE: Error';
      } else {
        loginBleLabel.textContent = 'Lector BLE: Desconectado';
      }
    }

    if (btnLoginBle) {
      if (isConnected) {
        if (btnLoginBleText) btnLoginBleText.textContent = 'Gestionar';
        btnLoginBle.classList.add('btn-ble-connected');
        btnLoginBle.disabled = false;
        btnLoginBle.title = 'ESP32 conectado. Clic para ver opciones o desconectar';
      } else if (state === bluetoothService.STATES.SEARCHING) {
        if (btnLoginBleText) btnLoginBleText.textContent = 'Buscando...';
        btnLoginBle.classList.remove('btn-ble-connected');
        btnLoginBle.disabled = true;
      } else {
        if (btnLoginBleText) btnLoginBleText.textContent = 'Conectar ESP32';
        btnLoginBle.classList.remove('btn-ble-connected');
        btnLoginBle.disabled = false;
        btnLoginBle.title = 'Conectar ESP32 con lector PN532';
      }
    }

    // B. Indicador discreto de estado en la Barra Lateral del Panel Alumno
    const sidebarDot = document.getElementById('sidebarBleDot');
    const sidebarLabel = document.getElementById('sidebarBleLabel');

    if (sidebarDot) {
      sidebarDot.className = 'pulse-dot';
      switch (state) {
        case bluetoothService.STATES.CONNECTED:
          sidebarDot.classList.add('dot-connected');
          break;
        case bluetoothService.STATES.SEARCHING:
          sidebarDot.classList.add('dot-searching');
          break;
        case bluetoothService.STATES.ERROR:
          sidebarDot.classList.add('dot-error');
          break;
        default:
          sidebarDot.classList.add('dot-disconnected');
      }
    }

    if (sidebarLabel) {
      sidebarLabel.textContent = isConnected
        ? `Lector Activo · ${deviceName ? deviceName.replace('ITTLA-', '') : 'ESP32'}`
        : (state === bluetoothService.STATES.SEARCHING ? 'Buscando ESP32...' : 'Lector Desconectado');
    }

    // C. Modal Controls & Badges
    const modalBadge = document.getElementById('bleModalStateBadge');
    const modalStatusMsg = document.getElementById('bleModalStatusMessage');
    const modalDeviceNameLabel = document.getElementById('bleDeviceNameLabel');
    const btnConnect = document.getElementById('btnBleModalConnect');
    const btnReconnect = document.getElementById('btnBleModalReconnect');

    if (modalBadge) {
      modalBadge.className = 'badge-status';
      switch (state) {
        case bluetoothService.STATES.CONNECTED:
          modalBadge.classList.add('status-active');
          modalBadge.textContent = 'Conectado';
          break;
        case bluetoothService.STATES.SEARCHING:
          modalBadge.classList.add('status-warning');
          modalBadge.textContent = 'Buscando...';
          break;
        case bluetoothService.STATES.ERROR:
          modalBadge.classList.add('status-danger');
          modalBadge.textContent = 'Error';
          break;
        default:
          modalBadge.classList.add('status-demo');
          modalBadge.textContent = 'Desconectado';
      }
    }

    if (modalDeviceNameLabel) {
      modalDeviceNameLabel.textContent = deviceName || 'Ninguno';
    }

    if (modalStatusMsg) {
      if (isConnected) {
        modalStatusMsg.textContent = `Enlace activo con ${deviceName || 'ESP32'}. Acerca tu credencial NFC al lector PN532.`;
      } else if (state === bluetoothService.STATES.SEARCHING) {
        modalStatusMsg.textContent = 'Buscando dispositivo Bluetooth con prefijo ITTLA...';
      } else if (state === bluetoothService.STATES.ERROR) {
        modalStatusMsg.textContent = detail || 'Error en comunicación Bluetooth.';
      } else {
        modalStatusMsg.textContent = 'Presiona "Conectar ESP32" para enlazar el torniquete por Bluetooth BLE.';
      }
    }

    if (btnConnect) {
      if (isConnected) {
        btnConnect.className = 'btn-ref-danger btn-block';
        btnConnect.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          <span>Desconectar ESP32</span>
        `;
      } else {
        btnConnect.className = 'btn-ref-submit btn-block';
        btnConnect.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          <span>Conectar ESP32 (Bluetooth)</span>
        `;
      }
    }

    if (btnReconnect) {
      btnReconnect.style.display = (!isConnected && deviceName) ? 'block' : 'none';
    }
  }

  /**
   * Actualiza la visualización de la última tarjeta leída en el modal
   */
  function updateLastScanModalUI(result) {
    const scanBox = document.getElementById('bleLastScanBox');
    const scanUidText = document.getElementById('bleLastScanUid');
    const scanStudentText = document.getElementById('bleLastScanStudent');
    const scanResultText = document.getElementById('bleLastScanResult');
    const scanTimeText = document.getElementById('bleLastScanTime');

    if (!scanBox) return;

    scanBox.style.display = 'block';

    if (scanUidText) scanUidText.textContent = result.uid || '--';

    if (result.success) {
      if (scanStudentText) scanStudentText.textContent = `${result.student.nombre_completo} (${result.student.matricula})`;
      if (scanResultText) {
        scanResultText.className = 'badge-status status-active';
        scanResultText.textContent = `${result.record.tipo_movimiento} · ${result.record.estado}`;
      }
      if (scanTimeText) scanTimeText.textContent = `${result.record.hora} hrs`;
    } else {
      if (scanStudentText) scanStudentText.textContent = 'Credencial no asignada o inactiva';
      if (scanResultText) {
        scanResultText.className = 'badge-status status-danger';
        scanResultText.textContent = result.code || 'No Autorizado';
      }
      if (scanTimeText) scanTimeText.textContent = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    }
  }

  // ==========================================
  // MANEJADORES DE INTERACCIÓN MODAL BLE
  // ==========================================

  window.openBleModal = function () {
    const modal = document.getElementById('modalNfcSim');
    if (modal) modal.classList.add('active');
  };

  window.closeBleModal = function () {
    const modal = document.getElementById('modalNfcSim');
    if (modal) modal.classList.remove('active');
  };

  /**
   * Manejador de clic en el control centralizado Bluetooth de la pantalla de login
   */
  window.handleLoginBleClick = async function () {
    if (bluetoothService.isConnected()) {
      // Si ya está conectado, abre el modal para revisar métricas o desconectar
      openBleModal();
      return;
    }

    try {
      const ok = await bluetoothService.connect();
      if (ok) {
        showToast(`¡Conectado exitosamente con ${bluetoothService.getDeviceName()}!`, 'success');
      }
    } catch (err) {
      if (err.name !== 'NotFoundError' && err.message !== 'User cancelled the requestDevice() chooser.') {
        showToast(err.message || 'Error al conectar con ESP32.', 'warning');
      }
    }
  };

  window.handleBleConnectToggle = async function () {
    if (bluetoothService.isConnected()) {
      bluetoothService.disconnect();
      showToast('Lector ESP32 desconectado.', 'info');
    } else {
      try {
        const ok = await bluetoothService.connect();
        if (ok) {
          showToast(`¡Conectado exitosamente con ${bluetoothService.getDeviceName()}!`, 'success');
        }
      } catch (err) {
        showToast(err.message, 'warning');
      }
    }
  };

  window.handleBleReconnect = async function () {
    const ok = await bluetoothService.reconnect();
    if (ok) {
      showToast(`¡Reconectado con ${bluetoothService.getDeviceName()}!`, 'success');
    } else {
      showToast('No se pudo reconectar. Prueba el botón "Conectar ESP32".', 'warning');
    }
  };

  /**
   * Simulación interactiva de prueba (Funciona en PC para comprobación local sin ESP32 físico)
   */
  window.executeLocalScanSimulation = async function () {
    const uidInput = document.getElementById('nfcSimUidInput');
    const movSelect = document.getElementById('nfcSimMovement');
    const stSelect = document.getElementById('nfcSimStatus');

    const uid = (uidInput ? uidInput.value : '884D216B').trim();
    const movement = movSelect ? movSelect.value : 'Entrada';
    const status = stSelect ? stSelect.value : 'Puntual';

    playBeepSound(1200, 0.12);

    // Reiniciar cooldown temporal para permitir pruebas inmediatas
    attendanceService.resetCooldown();

    const result = await attendanceService.processAttendanceScan(uid, {
      movement,
      forcedStatus: status,
      isDemo: true
    });

    if (result.success) {
      await refreshStudentPortal();
      updateLastScanModalUI(result);
      showToast(`[Prueba Local] ¡Pase registrado en IndexedDB! ${result.student.nombre_completo} · ${movement} (${status})`, 'success');
    } else {
      updateLastScanModalUI(result);
      showToast(result.message, 'warning');
    }
  };

  // Alias para mantener compatibilidad con cualquier llamada existente en index.html
  window.openNfcSimulatorModal = window.openBleModal;
  window.closeNfcSimulatorModal = window.closeBleModal;
  window.executeNfcScanSimulation = window.executeLocalScanSimulation;

  // Audio sintético (Web Audio API)
  function playBeepSound(freq = 880, duration = 0.15) {
    const audioEnabled = document.getElementById('settingAudio')?.checked ?? true;
    if (!audioEnabled) return;

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (_) {}
  }

  // Toasts de notificación con estilo Glassmorphism
  window.showToast = function (message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    let normalizedType = type;
    if (type === 'danger') normalizedType = 'error';

    const toast = document.createElement('div');
    toast.className = `toast-item toast-${normalizedType} toast-${type}`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
      <div class="toast-content">
        <span class="toast-dot dot-${normalizedType}"></span>
        <span class="toast-msg">${message}</span>
      </div>
      <button class="toast-close" type="button" aria-label="Cerrar notificación">&times;</button>
    `;

    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('visible');
    });

    const remove = () => {
      toast.classList.remove('visible');
      setTimeout(() => {
        if (toast.parentNode) toast.remove();
      }, 300);
    };

    const closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) closeBtn.addEventListener('click', remove);
    setTimeout(remove, 4500);
  };

  window.showDemoAlert = function (msg) {
    showToast(msg, 'info');
  };

  window.toggleGlassEffect = function (enable) {
    const scenery = document.querySelector('.scenery-background');
    if (!scenery) return;
    scenery.style.display = enable ? 'block' : 'none';
  };

  window.openAboutModal = function () {
    const modal = document.getElementById('modalAbout');
    if (modal) modal.classList.add('active');
  };

  window.closeAboutModal = function () {
    const modal = document.getElementById('modalAbout');
    if (modal) modal.classList.remove('active');
  };

})();
