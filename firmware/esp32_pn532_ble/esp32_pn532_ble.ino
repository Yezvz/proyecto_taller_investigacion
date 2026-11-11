/**
 * ============================================================================
 * PROYECTO: CREDENCIAL INTELIGENTE ITTLA
 * FIRMWARE: ESP32 + MÓDULO NFC PN532 (I2C) + BLUETOOTH LOW ENERGY (BLE)
 * Archivo: firmware/esp32_pn532_ble/esp32_pn532_ble.ino
 * 
 * DESCRIPCIÓN:
 * Lee el UID de tarjetas NFC (Mifare Classic, Ultralight, NTAG213, etc.)
 * utilizando el chip PN532 conectado por bus I2C (SDA=GPIO 21, SCL=GPIO 22).
 * Al detectar una credencial, transmite el UID formateado en hexadecimal
 * mayúsculas sin separadores (ej: "884D216B") hacia la PWA mediante BLE.
 * 
 * CARACTERÍSTICAS:
 * - Comunicación 100% offline (sin Wi-Fi, sin API, sin servidor).
 * - Notificaciones BLE automáticas a la PWA Android.
 * - Filtro anti-rebote (anti-repeat): evita enviar ráfagas repetidas mientras
 *   la tarjeta permanece sobre el lector.
 * ============================================================================
 */

#include <Wire.h>
#include <Adafruit_PN532.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ----------------------------------------------------------------------------
// CONFIGURACIÓN DE PINES I2C PARA PN532 EN ESP32
// ----------------------------------------------------------------------------
#define I2C_SDA_PIN 21
#define I2C_SCL_PIN 22

// Pines de interrupción y reset opcionales del PN532 (usando bus estándar I2C)
#define PN532_IRQ   (2)
#define PN532_RESET (3)

// Instancia del PN532 en bus I2C
Adafruit_PN532 nfc(I2C_SDA_PIN, I2C_SCL_PIN);

// ----------------------------------------------------------------------------
// UUIDs PERSONALIZADOS (DEBEN COINCIDIR EXACTAMENTE CON bluetooth-service.js)
// ----------------------------------------------------------------------------
#define SERVICE_UUID        "19b10000-e8f2-537e-4f6c-d104768a1214"
#define CHARACTERISTIC_UUID "19b10001-e8f2-537e-4f6c-d104768a1214"

#define BLE_DEVICE_NAME     "ITTLA-NFC-ESP32"

// Variables de estado BLE
BLEServer* pServer = NULL;
BLECharacteristic* pCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;

// Variables para control anti-rebote / anti-repetición de tarjeta
String lastSentUID = "";
unsigned long lastReadTime = 0;
const unsigned long REPEAT_COOLDOWN_MS = 4000; // 4 segundos antes de volver a leer la misma tarjeta

// ----------------------------------------------------------------------------
// CALLBACKS DEL SERVIDOR BLE
// ----------------------------------------------------------------------------
class MyServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println("\n[BLE] >>> Celular/PWA conectado exitosamente.");
  };

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
  delay(1000);

  Serial.println("\n=======================================================");
  Serial.println("  CREDENCIAL INTELIGENTE ITTLA - LECTOR ESP32 + PN532");
  Serial.println("=======================================================");

  // 1. Inicializar bus I2C
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  // 2. Inicializar módulo PN532
  Serial.println("[PN532] Buscando modulo PN532 en bus I2C (SDA=21, SCL=22)...");
  nfc.begin();

  uint32_t versiondata = nfc.getFirmwareVersion();
  if (!versiondata) {
    Serial.println("[PN532] ERROR: No se encontro placa PN532.");
    Serial.println("  -> Revisa que los interruptores DIP esten en modo I2C (CH1=0, CH2=1).");
    Serial.println("  -> Verifica conexiones VCC, GND, SDA (GPIO 21), SCL (GPIO 22).");
    // No detenemos completamente para permitir depuración BLE
  } else {
    Serial.print("[PN532] Modulo encontrado con exito. Chip PN5");
    Serial.println((versiondata >> 24) & 0xFF, HEX);
    Serial.print("[PN532] Version de Firmware: ");
    Serial.print((versiondata >> 16) & 0xFF, DEC);
    Serial.print('.');
    Serial.println((versiondata >> 8) & 0xFF, DEC);

    // Configurar reintentos de lectura no bloqueantes
    nfc.setPassiveActivationRetries(0xFF);
    // Configurar lector para lectura de tarjetas RF
    nfc.SAMConfig();
    Serial.println("[PN532] Lector configurado y listo para leer credenciales.");
  }

  // 3. Inicializar Servidor BLE
  Serial.print("[BLE] Inicializando servidor BLE con nombre: ");
  Serial.println(BLE_DEVICE_NAME);

  BLEDevice::init(BLE_DEVICE_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  // Crear servicio
  BLEService *pService = pServer->createService(SERVICE_UUID);

  // Crear característica con propiedad de notificación
  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ   |
                      BLECharacteristic::PROPERTY_NOTIFY
                    );

  // Añadir descriptor 2902 requerido para notificaciones BLE hacia Android
  pCharacteristic->addDescriptor(new BLE2902());

  // Iniciar servicio
  pService->start();

  // Configurar publicidad BLE (Advertising)
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06); // Funciones para asistencia en iOS/Android
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] Publicidad activa. Esperando conexion desde PWA...");
  Serial.println("=======================================================\n");
}

// ----------------------------------------------------------------------------
// BUCLE PRINCIPAL (LOOP)
// ----------------------------------------------------------------------------
void loop() {
  // 1. Manejo de reconexión de publicidad BLE
  if (!deviceConnected && oldDeviceConnected) {
    delay(500); // Dar tiempo al stack bluetooth
    pServer->startAdvertising();
    Serial.println("[BLE] Reiniciando publicidad para nueva conexion...");
    oldDeviceConnected = deviceConnected;
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
  }

  // 2. Comprobar presencia de tarjeta en el lector PN532
  uint8_t success;
  uint8_t uid[] = { 0, 0, 0, 0, 0, 0, 0 }; // Buffer para UID (hasta 7 bytes)
  uint8_t uidLength;                       // Longitud del UID (4 o 7 bytes)

  // Intentar leer tarjeta pasiva tipo ISO14443A (Mifare / NTAG)
  success = nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 50);

  if (success) {
    // Formatear UID a cadena hexadecimal mayúscula sin separadores
    String currentUID = "";
    for (uint8_t i = 0; i < uidLength; i++) {
      if (uid[i] < 0x10) currentUID += "0";
      currentUID += String(uid[i], HEX);
    }
    currentUID.toUpperCase();

    unsigned long now = millis();

    // Filtro anti-rebote: evitar enviar si es la misma tarjeta dentro del tiempo de espera
    if (currentUID != lastSentUID || (now - lastReadTime) > REPEAT_COOLDOWN_MS) {
      lastSentUID = currentUID;
      lastReadTime = now;

      Serial.println("\n------------------------------------------------");
      Serial.print("[NFC] Credencial detectada. UID: ");
      Serial.println(currentUID);
      Serial.print("[NFC] Longitud de UID: ");
      Serial.print(uidLength, DEC);
      Serial.println(" bytes");

      // Si la PWA está conectada por BLE, transmitir notificación
      if (deviceConnected && pCharacteristic != NULL) {
        pCharacteristic->setValue(currentUID.c_str());
        pCharacteristic->notify();
        Serial.println("[BLE] >>> Notificacion enviada exitosamente a la PWA.");
      } else {
        Serial.println("[BLE] AVISO: Tarjeta leida pero celular no conectado por BLE.");
      }
      Serial.println("------------------------------------------------");
    }
    
    // Pequeño retardo entre lecturas para no saturar el bus I2C
    delay(100);
  } else {
    // Si no hay tarjeta presente durante un tiempo, limpiar UID recordado
    if (millis() - lastReadTime > 2000) {
      lastSentUID = "";
    }
  }

  delay(50);
}
