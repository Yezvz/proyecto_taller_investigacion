/**
 * ============================================================================
 * CREDENCIAL INTELIGENTE ITTLA - BASE DE DATOS LOCAL (IndexedDB)
 * Archivo: js/database.js
 * Propósito: Almacenamiento local persistente sin servidor, sin API ni MySQL.
 *            Gestiona alumnos, credenciales NFC (UIDs) y bitácora de asistencias
 *            directamente en el navegador del dispositivo Android (PWA).
 * ============================================================================
 */

(function (root, factory) {
  'use strict';
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.IttlaDatabase = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DB_NAME = 'IttlaCredencialDB';
  const DB_VERSION = 1;

  let dbInstance = null;

  /**
   * Abre o crea la base de datos IndexedDB con los almacenes requeridos.
   * @returns {Promise<IDBDatabase>}
   */
  function openDB() {
    return new Promise((resolve, reject) => {
      if (dbInstance) {
        return resolve(dbInstance);
      }

      if (!window.indexedDB) {
        return reject(new Error('IndexedDB no es compatible con este navegador.'));
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. Almacén: ALUMNOS
        if (!db.objectStoreNames.contains('alumnos')) {
          const alumnosStore = db.createObjectStore('alumnos', { keyPath: 'id_alumno' });
          alumnosStore.createIndex('matricula', 'matricula', { unique: true });
          alumnosStore.createIndex('estado', 'estado', { unique: false });
        }

        // 2. Almacén: CREDENCIALES NFC (UID hexadecimal en mayúsculas como clave primaria)
        if (!db.objectStoreNames.contains('credenciales')) {
          const credStore = db.createObjectStore('credenciales', { keyPath: 'uid' });
          credStore.createIndex('id_alumno', 'id_alumno', { unique: false });
          credStore.createIndex('estado', 'estado', { unique: false });
        }

        // 3. Almacén: ASISTENCIAS
        if (!db.objectStoreNames.contains('asistencias')) {
          const asistStore = db.createObjectStore('asistencias', { keyPath: 'id_asistencia', autoIncrement: true });
          asistStore.createIndex('id_alumno', 'id_alumno', { unique: false });
          asistStore.createIndex('matricula', 'matricula', { unique: false });
          asistStore.createIndex('uid_credencial', 'uid_credencial', { unique: false });
          asistStore.createIndex('fecha', 'fecha', { unique: false });
          asistStore.createIndex('fecha_hora', 'fecha_hora', { unique: false });
        }
      };

      request.onsuccess = async (event) => {
        dbInstance = event.target.result;
        try {
          await seedInitialData(dbInstance);
          resolve(dbInstance);
        } catch (err) {
          console.warn('Aviso al sembrar datos iniciales:', err);
          resolve(dbInstance);
        }
      };

      request.onerror = (event) => {
        console.error('Error al abrir IndexedDB:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Carga datos iniciales de demostración si la base de datos está vacía.
   */
  async function seedInitialData(db) {
    const studentCount = await countRecords(db, 'alumnos');
    if (studentCount > 0) {
      return; // Ya existen datos
    }

    console.info('[IndexedDB] Inicializando datos escolares base para modo offline...');

    // 1. Alumno principal
    const defaultStudent = {
      id_alumno: 101,
      matricula: '22251022',
      nombre_completo: 'Jesus Martinez Mar',
      carrera: 'Ing. en Sistemas Computacionales',
      plan_estudios: 'ISIC-2010-224',
      semestre: '5º Semestre',
      grupo: 'ISC-501',
      turno: 'Matutino (Entrada 07:00 AM)',
      tutor: 'Mtro. Alejandro Ramos Pérez',
      estado: 'ACTIVO',
      email: '22251022@tlalnepantla.tecnm.mx',
      avatar_iniciales: 'JM'
    };

    // 2. Credencial NFC asociada (UID leída por PN532 en ESP32)
    const defaultCredential = {
      uid: '884D216B',
      id_alumno: 101,
      estado: 'ACTIVA',
      fecha_emision: '2026-01-15T09:00:00Z',
      vigencia: 'Dic 2026'
    };

    // 3. Credenciales adicionales de prueba
    const secondaryCredential = {
      uid: 'A1B2C3D4',
      id_alumno: 101,
      estado: 'ACTIVA',
      fecha_emision: '2026-02-10T10:00:00Z',
      vigencia: 'Dic 2026'
    };

    // 4. Credencial de ejemplo específico (especificada en el contrato de integración)
    const exampleCredential = {
      uid: '04A1B2C3D4',
      id_alumno: 101,
      estado: 'ACTIVA',
      fecha_emision: '2026-03-01T08:00:00Z',
      vigencia: 'Dic 2026'
    };

    // 5. Credencial inactiva de prueba (para verificar respuesta "Credencial deshabilitada")
    const disabledCredential = {
      uid: 'B2C3D4E5',
      id_alumno: 101,
      estado: 'INACTIVA',
      fecha_emision: '2025-08-15T12:00:00Z',
      vigencia: 'Vencida'
    };

    // 4. Historial inicial de asistencias representativo
    const initialAttendances = [
      {
        id_alumno: 101,
        matricula: '22251022',
        uid_credencial: '884D216B',
        fecha: '2026-10-21',
        hora: '07:05',
        fecha_hora: '2026-10-21T07:05:00',
        tipo_movimiento: 'Entrada',
        estado: 'Puntual',
        terminal: 'Torniquete 01 - ESP32 PN532'
      },
      {
        id_alumno: 101,
        matricula: '22251022',
        uid_credencial: '884D216B',
        fecha: '2026-10-21',
        hora: '14:05',
        fecha_hora: '2026-10-21T14:05:00',
        tipo_movimiento: 'Salida',
        estado: 'Salida Normal',
        terminal: 'Torniquete 02 - ESP32 PN532'
      },
      {
        id_alumno: 101,
        matricula: '22251022',
        uid_credencial: '884D216B',
        fecha: '2026-10-20',
        hora: '07:08',
        fecha_hora: '2026-10-20T07:08:00',
        tipo_movimiento: 'Entrada',
        estado: 'Puntual',
        terminal: 'Torniquete 01 - ESP32 PN532'
      },
      {
        id_alumno: 101,
        matricula: '22251022',
        uid_credencial: '884D216B',
        fecha: '2026-10-20',
        hora: '14:15',
        fecha_hora: '2026-10-20T14:15:00',
        tipo_movimiento: 'Salida',
        estado: 'Salida Normal',
        terminal: 'Torniquete 01 - ESP32 PN532'
      },
      {
        id_alumno: 101,
        matricula: '22251022',
        uid_credencial: '884D216B',
        fecha: '2026-10-19',
        hora: '07:22',
        fecha_hora: '2026-10-19T07:22:00',
        tipo_movimiento: 'Entrada',
        estado: 'Retardo',
        terminal: 'Torniquete 03 - ESP32 PN532'
      },
      {
        id_alumno: 101,
        matricula: '22251022',
        uid_credencial: '884D216B',
        fecha: '2026-10-19',
        hora: '14:02',
        fecha_hora: '2026-10-19T14:02:00',
        tipo_movimiento: 'Salida',
        estado: 'Salida Normal',
        terminal: 'Torniquete 01 - ESP32 PN532'
      },
      {
        id_alumno: 101,
        matricula: '22251022',
        uid_credencial: '884D216B',
        fecha: '2026-10-16',
        hora: '07:04',
        fecha_hora: '2026-10-16T07:04:00',
        tipo_movimiento: 'Entrada',
        estado: 'Puntual',
        terminal: 'Torniquete 01 - ESP32 PN532'
      },
      {
        id_alumno: 101,
        matricula: '22251022',
        uid_credencial: '884D216B',
        fecha: '2026-10-16',
        hora: '14:00',
        fecha_hora: '2026-10-16T14:00:00',
        tipo_movimiento: 'Salida',
        estado: 'Salida Normal',
        terminal: 'Torniquete 02 - ESP32 PN532'
      },
      {
        id_alumno: 101,
        matricula: '22251022',
        uid_credencial: '884D216B',
        fecha: '2026-10-15',
        hora: '07:07',
        fecha_hora: '2026-10-15T07:07:00',
        tipo_movimiento: 'Entrada',
        estado: 'Puntual',
        terminal: 'Torniquete 02 - ESP32 PN532'
      },
      {
        id_alumno: 101,
        matricula: '22251022',
        uid_credencial: '884D216B',
        fecha: '2026-10-15',
        hora: '14:10',
        fecha_hora: '2026-10-15T14:10:00',
        tipo_movimiento: 'Salida',
        estado: 'Salida Normal',
        terminal: 'Torniquete 01 - ESP32 PN532'
      }
    ];

    const tx = db.transaction(['alumnos', 'credenciales', 'asistencias'], 'readwrite');
    const aluStore = tx.objectStore('alumnos');
    const crdStore = tx.objectStore('credenciales');
    const astStore = tx.objectStore('asistencias');

    aluStore.put(defaultStudent);
    crdStore.put(defaultCredential);
    crdStore.put(secondaryCredential);
    crdStore.put(exampleCredential);
    crdStore.put(disabledCredential);

    for (const item of initialAttendances) {
      astStore.add(item);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        console.info('[IndexedDB] Datos iniciales sembrados con éxito.');
        resolve();
      };
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  function countRecords(db, storeName) {
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    });
  }

  // ==========================================================================
  // OPERACIONES: ALUMNOS
  // ==========================================================================

  async function getStudentByMatricula(matricula) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('alumnos', 'readonly');
      const store = tx.objectStore('alumnos');
      const index = store.index('matricula');
      const req = index.get(String(matricula).trim());

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function getStudentById(idAlumno) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('alumnos', 'readonly');
      const store = tx.objectStore('alumnos');
      const req = store.get(Number(idAlumno));

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function saveStudent(studentData) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('alumnos', 'readwrite');
      const store = tx.objectStore('alumnos');
      const req = store.put(studentData);

      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // ==========================================================================
  // OPERACIONES: CREDENCIALES
  // ==========================================================================

  /**
   * Busca una credencial por su UID (formateado en mayúsculas sin separadores)
   */
  async function getCredentialByUid(rawUid) {
    if (!rawUid) return null;
    const cleanUid = String(rawUid).replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction('credenciales', 'readonly');
      const store = tx.objectStore('credenciales');
      const req = store.get(cleanUid);

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function saveCredential(credData) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('credenciales', 'readwrite');
      const store = tx.objectStore('credenciales');
      credData.uid = String(credData.uid).replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
      const req = store.put(credData);

      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // ==========================================================================
  // OPERACIONES: ASISTENCIAS
  // ==========================================================================

  /**
   * Guarda un nuevo registro de asistencia
   */
  async function saveAttendance(attendance) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('asistencias', 'readwrite');
      const store = tx.objectStore('asistencias');
      const req = store.add(attendance);

      req.onsuccess = () => {
        resolve({
          ...attendance,
          id_asistencia: req.result
        });
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Obtiene la última asistencia registrada para un alumno en una fecha específica (YYYY-MM-DD)
   */
  async function getLastAttendanceToday(idAlumno, fechaIso) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('asistencias', 'readonly');
      const store = tx.objectStore('asistencias');
      const index = store.index('fecha');
      const req = index.getAll(fechaIso);

      req.onsuccess = () => {
        const list = req.result || [];
        const studentList = list
          .filter(a => Number(a.id_alumno) === Number(idAlumno))
          .sort((a, b) => (a.fecha_hora > b.fecha_hora ? 1 : -1));

        resolve(studentList.length > 0 ? studentList[studentList.length - 1] : null);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Obtiene el historial completo de asistencias de un alumno agrupado por fecha (para calendario)
   * Formato de retorno compatible con el renderizador del calendario:
   * { 'YYYY-MM-DD': { entrada: { ... }, salida: { ... } } }
   */
  async function getAttendanceHistoryGrouped(idAlumno) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('asistencias', 'readonly');
      const store = tx.objectStore('asistencias');
      const index = store.index('id_alumno');
      const req = index.getAll(Number(idAlumno));

      req.onsuccess = () => {
        const records = req.result || [];
        const grouped = {};

        records.forEach(item => {
          const dateKey = item.fecha;
          if (!grouped[dateKey]) {
            grouped[dateKey] = {};
          }

          const movKey = item.tipo_movimiento.toLowerCase().includes('entrada') ? 'entrada' : 'salida';
          grouped[dateKey][movKey] = {
            id_asistencia: item.id_asistencia,
            hora: item.hora,
            movimiento: item.tipo_movimiento + (movKey === 'entrada' ? ' .' : ''),
            estado: item.estado,
            terminal: item.terminal || 'Torniquete ESP32 - PN532',
            uid_credencial: item.uid_credencial
          };
        });

        resolve(grouped);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Obtiene la lista de asistencias más recientes (para la tabla principal)
   */
  async function getRecentAttendances(idAlumno, limit = 10) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('asistencias', 'readonly');
      const store = tx.objectStore('asistencias');
      const index = store.index('id_alumno');
      const req = index.getAll(Number(idAlumno));

      req.onsuccess = () => {
        const list = (req.result || []).sort((a, b) => (a.fecha_hora < b.fecha_hora ? 1 : -1));
        resolve(list.slice(0, limit));
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  return {
    openDB,
    getStudentByMatricula,
    getStudentById,
    saveStudent,
    getCredentialByUid,
    saveCredential,
    saveAttendance,
    getLastAttendanceToday,
    getAttendanceHistoryGrouped,
    getRecentAttendances
  };
}));
