/**
 * ============================================================================
 * PROYECTO: CREDENCIAL INTELIGENTE ITTLA
 * ARCHIVO: firmware/esp32-ittla/esp32-ittla.ino
 * HARDWARE: ESP32 DevKit V1 + Lector NFC PN532 (Bus I2C)
 * COMUNICACIÓN: Bluetooth Low Energy (BLE) hacia PWA Android
 * ============================================================================
 * 
 * CONEXIONES DE HARDWARE PREVISTAS:
 *   PN532          ESP32 DevKit V1
 *   -----          ---------------
 *   SDA     --->   GPIO 21
 *   SCL     --->   GPIO 22
 *   IRQ     --->   GPIO 4
 *   RST     --->   GPIO 5
 *   GND     --->   GND
 *   VCC     --->   3.3V / 5V (según especificaciones del módulo)
 * 
 * CONFIGURACIÓN DE SWITCHES DIP EN EL MÓDULO PN532 (Modo I2C):
 *   CH1 = 0 (OFF / LOW)
 *   CH2 = 1 (ON / HIGH)
 * 
 * CONTRATO DE COMUNICACIÓN BLE (Sincronizado con bluetooth-service.js):
 *   Nombre del dispositivo: ITTLA-ESP32
 *   UUID del Servicio:      7c3a0001-8e8f-4d5a-9b3c-1a2b3c4d5e6f
 *   UUID de Característica: 7c3a0002-8e8f-4d5a-9b3c-1a2b3c4d5e6f
 * 
 * FORMATO DE TRANSMISIÓN:
 *   Cadena hexadecimal en mayúsculas sin separadores (Ej: "884D216B", "04A1B2C3D4").
 * ============================================================================
 */

#include <Wire.h>
#include <Adafruit_PN532.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ----------------------------------------------------------------------------
// DEFINICIÓN DE PINES I2C, INTERRUPCIÓN Y RESET
// ----------------------------------------------------------------------------
#define I2C_SDA_PIN         21
#define I2C_SCL_PIN         22
#define PN532_IRQ_PIN       4
#define PN532_RESET_PIN     5

// Instancia del controlador Adafruit PN532 en modo I2C con pines de control
Adafruit_PN532 nfc(PN532_IRQ_PIN, PN532_RESET_PIN);

// ----------------------------------------------------------------------------
// CONTRATO BLUETOOTH LOW ENERGY (BLE)
// ----------------------------------------------------------------------------
#define DEVICE_NAME         "ITTLA-ESP32"
#define SERVICE_UUID        "7c3a0001-8e8f-4d5a-9b3c-1a2b3c4d5e6f"
#define CHARACTERISTIC_UUID "7c3a0002-8e8f-4d5a-9b3c-1a2b3c4d5e6f"

// Punteros del servidor y característica BLE
BLEServer* pServer = NULL;
BLECharacteristic* pCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;

// ----------------------------------------------------------------------------
// CONTROL ANTI-REBOTE / LECTURAS REPETIDAS
// ----------------------------------------------------------------------------
// Evita enviar ráfagas repetidas mientras la tarjeta permanezca sobre el lector.
// Permite una nueva lectura en cuanto la tarjeta es retirada y vuelta a acercar.
String lastDetectedUID = "";
bool cardCurrentlyPresent = false;
unsigned long lastAbsenceCheckTime = 0;
const unsigned long ABSENCE_DEBOUNCE_MS = 300; // Tiempo para confirmar que la tarjeta fue retirada

// ----------------------------------------------------------------------------
// CALLBACKS DEL SERVIDOR BLE (CONEXIÓN / DESCONEXIÓN)
// ----------------------------------------------------------------------------
class MyServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println("\n[BLE] >>> Celular/PWA conectado exitosamente.");
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    Serial.println("\n[BLE] <<< Celular/PWA desconectado.");
  }
};

// ----------------------------------------------------------------------------
// INICIALIZACIÓN (SETUP)
// ----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(800);

  Serial.println("\n=======================================================");
  Serial.println("   CREDENCIAL INTELIGENTE ITTLA - FIRMWARE ESP32");
  Serial.println("   Lector PN532 (I2C) + Bluetooth Low Energy (BLE)");
  Serial.println("=======================================================");

  // 1. Inicializar bus de datos I2C (SDA=21, SCL=22)
  Serial.print("[I2C] Iniciando bus I2C en SDA=");
  Serial.print(I2C_SDA_PIN);
  Serial.print(", SCL=");
  Serial.println(I2C_SCL_PIN);
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  // 2. Inicializar y verificar módulo PN532
  Serial.println("[PN532] Inicializando modulo PN532...");
  nfc.begin();

  uint32_t versiondata = nfc.getFirmwareVersion();
  if (!versiondata) {
    Serial.println("[PN532] ERROR: No se encontro el chip PN532.");
    Serial.println("  -> Revisa que los switches DIP esten en modo I2C (CH1=0, CH2=1).");
    Serial.println("  -> Verifica las conexiones VCC, GND, SDA (21) y SCL (22).");
  } else {
    Serial.print("[PN532] Modulo encontrado con exito. Chip PN5");
    Serial.println((versiondata >> 24) & 0xFF, HEX);
    Serial.print("[PN532] Version de firmware: ");
    Serial.print((versiondata >> 16) & 0xFF, DEC);
    Serial.print('.');
    Serial.println((versiondata >> 8) & 0xFF, DEC);

    // Configurar reintentos pasivos y modo SAM (Security Access Module) para lectura RF
    nfc.setPassiveActivationRetries(0xFF);
    nfc.SAMConfig();
    Serial.println("[PN532] Configurado y listo para detectar credenciales NFC.");
  }

  // 3. Inicializar Servidor Bluetooth Low Energy (BLE)
  Serial.print("[BLE] Iniciando periférico BLE con nombre: ");
  Serial.println(DEVICE_NAME);

  BLEDevice::init(DEVICE_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  // Crear servicio principal con el UUID del contrato
  BLEService *pService = pServer->createService(SERVICE_UUID);

  // Crear característica con soporte de LECTURA y NOTIFICACIÓN
  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ   |
                      BLECharacteristic::PROPERTY_NOTIFY
                    );

  // Descriptor BLE2902 requerido para habilitar notificaciones push a Android/Chrome
  pCharacteristic->addDescriptor(new BLE2902());

  // Iniciar servicio
  pService->start();

  // Configurar publicidad BLE (Advertising)
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06); // Optimización para recepción móvil
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] Anunciando dispositivo: ITTLA-ESP32");
  Serial.println("[BLE] Esperando conexión desde la PWA en el celular...");
  Serial.println("=======================================================\n");
}

// ----------------------------------------------------------------------------
// BUCLE PRINCIPAL (LOOP)
// ----------------------------------------------------------------------------
void loop() {
  // 1. Manejo de desconexión y reinicio de publicidad BLE
  if (!deviceConnected && oldDeviceConnected) {
    delay(500); // Pequeña pausa para estabilizar la pila Bluetooth
    pServer->startAdvertising();
    Serial.println("[BLE] Reiniciando publicidad. Listo para reconectar...");
    oldDeviceConnected = deviceConnected;
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
  }

  // 2. Intentar lectura pasiva de credencial ISO14443A (Mifare, NTAG213, etc.)
  uint8_t success;
  uint8_t uidBuffer[8] = { 0, 0, 0, 0, 0, 0, 0, 0 };
  uint8_t uidLength = 0;

  // Timeout corto (60ms) para mantener el bucle ágil
  success = nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uidBuffer, &uidLength, 60);

  if (success && uidLength > 0) {
    // Convertir UID a cadena hexadecimal en mayúsculas sin separadores
    String currentUID = "";
    for (uint8_t i = 0; i < uidLength; i++) {
      if (uidBuffer[i] < 0x10) currentUID += "0";
      currentUID += String(uidBuffer[i], HEX);
    }
    currentUID.toUpperCase();

    // FILTRO ANTI-REPETICIÓN:
    // Si es la misma tarjeta que sigue posada sobre el lector, NO reenviamos
    if (currentUID != lastDetectedUID) {
      lastDetectedUID = currentUID;
      cardCurrentlyPresent = true;

      Serial.println("\n------------------------------------------------");
      Serial.print("[NFC] Credencial detectada! UID: ");
      Serial.println(currentUID);
      Serial.print("[NFC] Longitud de UID: ");
      Serial.print(uidLength, DEC);
      Serial.println(" bytes");

      // Transmitir UID mediante notificación BLE si el celular está conectado
      if (deviceConnected && pCharacteristic != NULL) {
        pCharacteristic->setValue(currentUID.c_str());
        pCharacteristic->notify();
        Serial.println("[BLE] >>> Notificacion transmitida a la PWA con exito.");
      } else {
        Serial.println("[BLE] AVISO: Tarjeta detectada pero la PWA no esta enlazada.");
      }
      Serial.println("------------------------------------------------");
    } else {
      // La tarjeta sigue sobre el lector; marcamos presencia continua
      cardCurrentlyPresent = true;
    }

    lastAbsenceCheckTime = millis();
    delay(80); // Pequeña pausa entre sondeos activos
  } else {
    // Si el lector no detecta tarjeta durante el intervalo de debounce,
    // se confirma que la tarjeta fue retirada y se autoriza una nueva lectura.
    if (cardCurrentlyPresent && (millis() - lastAbsenceCheckTime > ABSENCE_DEBOUNCE_MS)) {
      cardCurrentlyPresent = false;
      lastDetectedUID = "";
      Serial.println("[NFC] Tarjeta retirada del lector. Listo para nueva lectura.");
    }
  }

  delay(40);
}
