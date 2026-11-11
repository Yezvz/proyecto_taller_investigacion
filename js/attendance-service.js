/**
 * ============================================================================
 * CREDENCIAL INTELIGENTE ITTLA - SERVICIO DE ASISTENCIA
 * Archivo: js/attendance-service.js
 * Propósito: Lógica de negocio para validar credenciales NFC leídas por el PN532,
 *            determinar entradas/salidas, registrar la asistencia en IndexedDB
 *            y actualizar la interfaz visual (calendario, historial y notificaciones).
 * ============================================================================
 */

(function (root, factory) {
  'use strict';
  if (typeof define === 'function' && define.amd) {
    define(['./database'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./database'));
  } else {
    root.IttlaAttendanceService = factory(root.IttlaDatabase);
  }
}(typeof self !== 'undefined' ? self : this, function (database) {
  'use strict';

  // Reglas de horario escolar ITTLA (Turno Matutino)
  const ENTRY_LIMIT_HOUR = 7;
  const ENTRY_TOLERANCE_MINUTE = 15; // Hasta las 07:15 es Puntual, posterior es Retardo

  // Intervalo de seguridad en JavaScript para evitar lecturas duplicadas consecutivas
  const SCAN_COOLDOWN_MS = 4000; // 4 segundos
  let lastScanUid = null;
  let lastScanTimestamp = 0;

  /**
   * Obtiene la fecha actual en formato local ISO YYYY-MM-DD
   */
  function getLocalDateString(dateObj = new Date()) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Obtiene la hora actual en formato HH:mm (24 horas)
   */
  function getLocalTimeString(dateObj = new Date()) {
    return dateObj.toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  /**
   * Evalúa la puntualidad de un movimiento de entrada o salida
   */
  function calculatePunctuality(dateObj, movementType) {
    const isEntrada = movementType.toUpperCase().includes('ENTRADA');
    if (!isEntrada) {
      return 'Salida Normal';
    }

    const hours = dateObj.getHours();
    const minutes = dateObj.getMinutes();

    if (hours < ENTRY_LIMIT_HOUR) {
      return 'Puntual';
    }
    if (hours === ENTRY_LIMIT_HOUR && minutes <= ENTRY_TOLERANCE_MINUTE) {
      return 'Puntual';
    }
    return 'Retardo';
  }

  /**
   * Función central de procesamiento de credencial NFC recibida por Bluetooth BLE
   * Responsabilidades:
   *  1. Recibir el UID.
   *  2. Consultar IndexedDB.
   *  3. Comprobar si la credencial existe.
   *  4. Comprobar si está activa.
   *  5. Obtener los datos del alumno.
   *  6. Determinar si corresponde entrada o salida.
   *  7. Guardar el registro en IndexedDB.
   *  8. Actualizar el calendario y el historial.
   *  9. Mostrar la notificación visual adecuada.
   * 
   * @param {string} rawUid - UID hexadecimal recibido desde el ESP32
   * @param {Object} [options] - Opciones opcionales (ej: terminal, overrideMovement)
   * @returns {Promise<Object>}
   */
  async function processNFCReading(rawUid, options = {}) {
    if (!rawUid) {
      return { success: false, message: 'UID no recibido' };
    }

    const cleanUid = String(rawUid).replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
    const now = new Date();
    const nowTime = now.getTime();

    // Protección anti-repetición en JS para evitar registros duplicados por una misma aproximación
    if (cleanUid === lastScanUid && (nowTime - lastScanTimestamp) < SCAN_COOLDOWN_MS) {
      console.warn(`[Asistencia] Lectura duplicada descartada por intervalo de seguridad: ${cleanUid}`);
      return {
        success: false,
        code: 'SCAN_DUPLICATE_COOLDOWN',
        message: 'Lectura repetida omitida',
        uid: cleanUid
      };
    }

    const db = database || (typeof window !== 'undefined' ? window.IttlaDatabase : null);
    if (!db) {
      console.error('[Asistencia] Base de datos local IndexedDB no disponible.');
      return {
        success: false,
        code: 'DB_UNAVAILABLE',
        message: 'Almacenamiento local no disponible'
      };
    }

    // 1 & 2. Consultar IndexedDB y comprobar si la credencial existe
    const credential = await db.getCredentialByUid(cleanUid);
    if (!credential) {
      lastScanUid = cleanUid;
      lastScanTimestamp = nowTime;
      console.warn(`[Asistencia] Credencial no registrada: ${cleanUid}`);

      if (typeof window !== 'undefined') {
        if (typeof window.showToast === 'function') {
          window.showToast("Credencial no registrada", "error");
        }
        if (typeof window.playBeepSound === 'function') {
          window.playBeepSound(400, 0.3);
        }
        if (typeof window.updateLastScanModalUI === 'function') {
          window.updateLastScanModalUI({
            success: false,
            uid: cleanUid,
            code: 'Credencial no registrada'
          });
        }
      }

      return {
        success: false,
        code: 'CREDENTIAL_NOT_FOUND',
        message: "Credencial no registrada",
        uid: cleanUid
      };
    }

    // 3. Comprobar si la credencial está activa
    if (credential.estado !== 'ACTIVA') {
      lastScanUid = cleanUid;
      lastScanTimestamp = nowTime;
      console.warn(`[Asistencia] Credencial deshabilitada: ${cleanUid} (estado=${credential.estado})`);

      if (typeof window !== 'undefined') {
        if (typeof window.showToast === 'function') {
          window.showToast("Credencial deshabilitada", "warning");
        }
        if (typeof window.playBeepSound === 'function') {
          window.playBeepSound(400, 0.3);
        }
        if (typeof window.updateLastScanModalUI === 'function') {
          window.updateLastScanModalUI({
            success: false,
            uid: cleanUid,
            code: 'Credencial deshabilitada'
          });
        }
      }

      return {
        success: false,
        code: 'CREDENTIAL_INACTIVE',
        message: "Credencial deshabilitada",
        uid: cleanUid
      };
    }

    // 4. Obtener los datos del alumno asociado a la credencial
    const student = await db.getStudentById(credential.id_alumno);
    if (!student || student.estado !== 'ACTIVO') {
      lastScanUid = cleanUid;
      lastScanTimestamp = nowTime;
      console.warn(`[Asistencia] Alumno inactivo o no encontrado para credencial: ${cleanUid}`);

      if (typeof window !== 'undefined') {
        if (typeof window.showToast === 'function') {
          window.showToast("Credencial deshabilitada", "warning");
        }
        if (typeof window.playBeepSound === 'function') {
          window.playBeepSound(400, 0.3);
        }
      }

      return {
        success: false,
        code: 'STUDENT_INACTIVE',
        message: "Credencial deshabilitada",
        uid: cleanUid
      };
    }

    // 5. Determinar si corresponde entrada o salida según el último registro de hoy
    const fechaIso = getLocalDateString(now);
    const horaStr = getLocalTimeString(now);

    let movement = options.movement;
    if (!movement) {
      const lastRecordToday = await db.getLastAttendanceToday(student.id_alumno, fechaIso);
      if (!lastRecordToday || lastRecordToday.tipo_movimiento.toLowerCase().includes('salida')) {
        movement = 'Entrada';
      } else {
        movement = 'Salida';
      }
    }

    // Evaluar puntualidad
    const punctuality = options.forcedStatus || calculatePunctuality(now, movement);

    // 6. Guardar el registro en la base de datos local IndexedDB
    const attendancePayload = {
      id_alumno: student.id_alumno,
      matricula: student.matricula,
      uid_credencial: cleanUid,
      fecha: fechaIso,
      hora: horaStr,
      fecha_hora: now.toISOString(),
      tipo_movimiento: movement,
      estado: punctuality,
      terminal: options.terminal || (options.isDemo ? 'Simulador Local' : 'Torniquete ESP32 - PN532')
    };

    const savedRecord = await db.saveAttendance(attendancePayload);

    // Actualizar control de cooldown
    lastScanUid = cleanUid;
    lastScanTimestamp = nowTime;

    console.info(`[Asistencia] ¡Acceso registrado con éxito! ${student.nombre_completo} · ${movement} (${punctuality})`);

    // 7. Actualizar el calendario, el historial y las vistas de la interfaz
    if (typeof window !== 'undefined') {
      if (typeof window.onAttendanceRecorded === 'function') {
        try {
          await window.onAttendanceRecorded(student, savedRecord);
        } catch (_) {}
      } else if (typeof window.refreshStudentPortal === 'function') {
        try {
          await window.refreshStudentPortal();
        } catch (_) {}
      }

      if (typeof window.updateLastScanModalUI === 'function') {
        try {
          window.updateLastScanModalUI({
            success: true,
            uid: cleanUid,
            student,
            credential,
            record: savedRecord
          });
        } catch (_) {}
      }

      // 8 & 9. Notificación visual institucional y sonido de confirmación
      if (typeof window.showToast === 'function') {
        window.showToast("Acceso registrado correctamente", "success");
      }
      if (typeof window.playBeepSound === 'function') {
        window.playBeepSound(1400, 0.18);
      }
    }

    return {
      success: true,
      code: 'ATTENDANCE_RECORDED',
      message: "Acceso registrado correctamente",
      uid: cleanUid,
      student,
      credential,
      record: savedRecord
    };
  }

  /**
   * Resetea el cooldown manualmente (útil para pruebas inmediatas en laboratorio)
   */
  function resetCooldown() {
    lastScanUid = null;
    lastScanTimestamp = 0;
  }

  // Exponer a nivel global para compatibilidad directa
  if (typeof window !== 'undefined') {
    window.processNFCReading = processNFCReading;
  }

  return {
    processNFCReading,
    processAttendanceScan: processNFCReading,
    resetCooldown,
    calculatePunctuality,
    getLocalDateString,
    getLocalTimeString
  };
}));
