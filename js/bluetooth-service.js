/**
 * ============================================================================
 * CREDENCIAL INTELIGENTE ITTLA - SERVICIO BLUETOOTH BLE
 * Archivo: js/bluetooth-service.js
 * Propósito: Comunicación directa por Bluetooth Low Energy (Web Bluetooth API)
 *            entre el celular Android (PWA) y el microcontrolador ESP32
 *            conectado al lector NFC PN532 mediante bus I2C.
 * ============================================================================
 */

(function (root, factory) {
  'use strict';
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.IttlaBluetoothService = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Configuración BLE acordada con el firmware del ESP32
  const BLE_CONFIG = {
    deviceName: "ITTLA-ESP32",
    serviceUUID: "7c3a0001-8e8f-4d5a-9b3c-1a2b3c4d5e6f",
    characteristicUUID: "7c3a0002-8e8f-4d5a-9b3c-1a2b3c4d5e6f"
  };

  // Estados posibles del servicio BLE
  const STATES = {
    DISCONNECTED: 'DESCONECTADO',
    SEARCHING: 'BUSCANDO',
    CONNECTED: 'CONECTADO',
    ERROR: 'ERROR'
  };

  let currentState = STATES.DISCONNECTED;
  let bleDevice = null;
  let bleCharacteristic = null;
  let lastErrorMessage = '';

  // Suscriptores de eventos
  const stateListeners = [];
  const uidListeners = [];
  const errorListeners = [];

  /**
   * Verifica compatibilidad de Web Bluetooth API
   */
  function isSupported() {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  /**
   * Diagnóstico legible del entorno Web Bluetooth
   */
  function getCompatibilityDiagnostic() {
    if (!isSupported()) {
      return 'Web Bluetooth no está disponible en este navegador. Utiliza Google Chrome en Android bajo HTTPS.';
    }
    if (typeof window !== 'undefined' && window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return 'Web Bluetooth requiere una conexión segura (HTTPS) para comunicarse con el ESP32.';
    }
    return 'Web Bluetooth disponible y listo para enlazar.';
  }

  /**
   * Notifica el cambio de estado a todos los escuchadores suscritos
   */
  function notifyState(state, detail = '') {
    currentState = state;
    const name = bleDevice ? (bleDevice.name || BLE_CONFIG.deviceName) : '';
    const payload = {
      state,
      detail,
      deviceName: name,
      isConnected: state === STATES.CONNECTED
    };

    console.info(`[BLE ESP32] Estado: ${state} ${detail ? '(' + detail + ')' : ''}`);

    stateListeners.forEach(listener => {
      try {
        listener(payload);
      } catch (err) {
        console.error('Error en suscriptor de estado BLE:', err);
      }
    });

    // Sincronizar con updateBluetoothStatus si está disponible
    if (typeof window !== 'undefined' && typeof window.updateBluetoothStatus === 'function') {
      try {
        window.updateBluetoothStatus(state === STATES.CONNECTED, name);
      } catch (_) {}
    }
  }

  /**
   * Manejador de datos entrantes (notificaciones BLE del ESP32 con el UID de la credencial)
   */
  function handleBLEData(event) {
    const rawVal = event?.target?.value;
    if (!rawVal || rawVal.byteLength === 0) return;

    const decoder = new TextDecoder();
    const uid = decoder.decode(rawVal).trim().toUpperCase();

    console.log("UID recibido:", uid);

    // Validar formato hexadecimal válido (longitud típica de UIDs: 4 a 10 bytes -> 8 a 20 caracteres hex)
    if (!/^[0-9A-F]{4,20}$/i.test(uid)) {
      console.warn("[BLE ESP32] UID recibido con formato hexadecimal inválido descartado:", uid);
      return;
    }

    // 1. Notificar a los escuchadores suscritos a través de onUidReceived
    uidListeners.forEach(listener => {
      try {
        listener(uid);
      } catch (err) {
        console.error('Error en suscriptor de UID:', err);
      }
    });

    // 2. Invocar la función central de registro de asistencia (attendance-service.js)
    if (typeof processNFCReading === "function") {
      processNFCReading(uid);
    } else if (typeof window !== 'undefined' && typeof window.processNFCReading === 'function') {
      window.processNFCReading(uid);
    }
  }

  /**
   * Manejador de desconexión imprevista o manual del GATT Server
   */
  function handleBLEDisconnect(event) {
    const devName = event?.target?.name || (bleDevice ? bleDevice.name : BLE_CONFIG.deviceName);
    console.warn('[BLE ESP32] Desconexión detectada en dispositivo:', devName);
    bleCharacteristic = null;
    notifyState(STATES.DISCONNECTED, 'El dispositivo ESP32 se ha desconectado.');

    if (typeof window !== 'undefined' && typeof window.updateBluetoothStatus === 'function') {
      try {
        window.updateBluetoothStatus(false, '');
      } catch (_) {}
    }
  }

  /**
   * Conexión BLE principal con el ESP32
   * IMPORTANTE: La solicitud a requestDevice se ejecuta inmediatamente en respuesta
   * al gesto de usuario (sin retardos asíncronos previos).
   * @returns {Promise<string>} Nombre del dispositivo conectado
   */
  async function connectESP32() {
    if (!navigator.bluetooth) {
      const msg = "El navegador no admite Web Bluetooth";
      notifyState(STATES.ERROR, msg);
      throw new Error(msg);
    }

    notifyState(STATES.SEARCHING, 'Buscando ESP32...');

    // Selector nativo de dispositivos Bluetooth de Android/Chrome
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [
        { name: BLE_CONFIG.deviceName }
      ],
      optionalServices: [
        BLE_CONFIG.serviceUUID
      ]
    });

    bleDevice.addEventListener(
      "gattserverdisconnected",
      handleBLEDisconnect
    );

    const server = await bleDevice.gatt.connect();

    const service = await server.getPrimaryService(
      BLE_CONFIG.serviceUUID
    );

    bleCharacteristic = await service.getCharacteristic(
      BLE_CONFIG.characteristicUUID
    );

    await bleCharacteristic.startNotifications();

    bleCharacteristic.addEventListener(
      "characteristicvaluechanged",
      handleBLEData
    );

    notifyState(STATES.CONNECTED, `Conectado a ${bleDevice.name || BLE_CONFIG.deviceName}`);
    return bleDevice.name || BLE_CONFIG.deviceName;
  }

  /**
   * Desconecta deliberadamente el ESP32
   */
  function disconnect() {
    if (bleCharacteristic) {
      try {
        bleCharacteristic.removeEventListener("characteristicvaluechanged", handleBLEData);
        bleCharacteristic.stopNotifications().catch(() => {});
      } catch (_) {}
      bleCharacteristic = null;
    }

    if (bleDevice && bleDevice.gatt && bleDevice.gatt.connected) {
      try {
        bleDevice.gatt.disconnect();
      } catch (_) {}
    }

    notifyState(STATES.DISCONNECTED, 'Desconectado manualmente.');

    if (typeof window !== 'undefined' && typeof window.updateBluetoothStatus === 'function') {
      try {
        window.updateBluetoothStatus(false, '');
      } catch (_) {}
    }
  }

  /**
   * Intenta reconectar con el dispositivo previamente seleccionado
   */
  async function reconnect() {
    if (!bleDevice) {
      return connectESP32();
    }

    try {
      notifyState(STATES.SEARCHING, `Reconectando con ${bleDevice.name || BLE_CONFIG.deviceName}...`);
      const server = await bleDevice.gatt.connect();
      const service = await server.getPrimaryService(BLE_CONFIG.serviceUUID);
      bleCharacteristic = await service.getCharacteristic(BLE_CONFIG.characteristicUUID);

      await bleCharacteristic.startNotifications();
      bleCharacteristic.addEventListener("characteristicvaluechanged", handleBLEData);

      notifyState(STATES.CONNECTED, `Reconectado a ${bleDevice.name || BLE_CONFIG.deviceName}`);
      return bleDevice.name || BLE_CONFIG.deviceName;
    } catch (err) {
      console.warn('[BLE ESP32] No fue posible reconectar automáticamente:', err);
      notifyState(STATES.DISCONNECTED, 'Reconexión fallida. Toca "Conectar ESP32".');
      throw err;
    }
  }

  /**
   * Suscribe una función a los cambios de estado
   */
  function onStateChange(callback) {
    if (typeof callback === 'function') {
      stateListeners.push(callback);
      callback({
        state: currentState,
        detail: '',
        deviceName: bleDevice ? (bleDevice.name || BLE_CONFIG.deviceName) : '',
        isConnected: currentState === STATES.CONNECTED
      });
    }
  }

  /**
   * Suscribe una función para recibir el UID de la credencial detectada
   */
  function onUidReceived(callback) {
    if (typeof callback === 'function') {
      uidListeners.push(callback);
    }
  }

  /**
   * Suscribe una función para capturar errores
   */
  function onError(callback) {
    if (typeof callback === 'function') {
      errorListeners.push(callback);
    }
  }

  function getState() {
    return currentState;
  }

  function getDeviceName() {
    return bleDevice ? (bleDevice.name || BLE_CONFIG.deviceName) : '';
  }

  function isConnected() {
    return currentState === STATES.CONNECTED && !!bleDevice && !!bleDevice.gatt && bleDevice.gatt.connected;
  }

  // Exponer a nivel global para llamadas directas
  if (typeof window !== 'undefined') {
    window.connectESP32 = connectESP32;
    window.BLE_CONFIG = BLE_CONFIG;
  }

  return {
    BLE_CONFIG,
    STATES,
    isSupported,
    getCompatibilityDiagnostic,
    connectESP32,
    connect: connectESP32,
    disconnect,
    reconnect,
    getState,
    getDeviceName,
    isConnected,
    onStateChange,
    onUidReceived,
    onError
  };
}));
