# Firmware ESP32 + Módulo PN532 NFC (I2C) + Bluetooth BLE

Este firmware implementa la arquitectura de hardware para el proyecto **Credencial Inteligente ITTLA**:

```
[Tarjeta NFC / NTAG213] 
       │ (13.56 MHz RFID)
       ▼
 [Módulo PN532]
       │ (Bus I2C: SDA=21, SCL=22)
       ▼
    [ESP32]
       │ (Bluetooth Low Energy - Notificaciones)
       ▼
[PWA Android / Chrome]
       │
       ▼
 [IndexedDB Local]
```

---

## 1. Conexiones Físicas (Pinout)

### Conexión entre Módulo PN532 y ESP32 (Modo I2C):

| Pin PN532 | Pin ESP32 | Descripción |
|---|---|---|
| **VCC** | **5V** o **3.3V** | Alimentación (revisar especificación de la placa PN532) |
| **GND** | **GND** | Tierra común |
| **SDA** | **GPIO 21** | Línea de datos del bus I2C |
| **SCL** | **GPIO 22** | Línea de reloj del bus I2C |

> **IMPORTANTE: Configuración de selectores en la placa PN532**  
> La mayoría de placas PN532 rojas o azules cuentan con dos microinterruptores (DIP switches o puentes) para seleccionar el protocolo de comunicación. Para operar en **I2C**, configúralos en:  
> - **CH 1:** `0` (OFF / LOW)  
> - **CH 2:** `1` (ON / HIGH)

---

## 2. Bibliotecas Requeridas en Arduino IDE

Para compilar el código en Arduino IDE o PlatformIO, asegúrate de tener instaladas las siguientes dependencias:

1. **Paquete de Placas ESP32** de Espressif:
   - URL gestor de placas: `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   - Instalar `esp32` por Espressif Systems (versión 2.0.x o superior).
2. **Adafruit PN532**:
   - En Arduino IDE: *Programa* -> *Incluir Librería* -> *Gestionar Librerías...* -> Buscar `Adafruit PN532` e instalar.
   - Instalar también sus dependencias sugeridas (`Adafruit BusIO`).

---

## 3. Configuración del Proyecto y UUIDs BLE

El firmware y el código JavaScript de la PWA comparten exactamente los mismos identificadores UUID:

- **Nombre del Dispositivo:** `ITTLA-NFC-ESP32`
- **Service UUID:** `19b10000-e8f2-537e-4f6c-d104768a1214`
- **Characteristic UUID:** `19b10001-e8f2-537e-4f6c-d104768a1214`
- **Propiedades de la característica:** `READ | NOTIFY` (con descriptor `2902`).

---

## 4. Formato de Transmisión

Cuando una credencial física se acerca a la antena del PN532:
1. El módulo lee el UID (4 bytes para Mifare Classic / NTAG213 de 7 bytes).
2. El firmware lo formatea a una cadena hexadecimal en mayúsculas sin espacios ni dos puntos (ejemplo: `884D216B`).
3. El ESP32 emite una notificación BLE hacia la PWA.
4. Un temporizador anti-rebote (`REPEAT_COOLDOWN_MS = 4000`) previene enviar lecturas repetidas mientras la credencial continúe sobre la antena.

---

## 5. Instrucciones de Carga (Flashing)

1. Abre el archivo `esp32_pn532_ble.ino` en **Arduino IDE**.
2. Selecciona la placa: **ESP32 Dev Module** (o tu modelo específico de ESP32).
3. Selecciona el puerto COM correspondiente a tu placa.
4. Velocidad del Monitor Serie: `115200 baudios`.
5. Presiona **Subir (Upload)**.
6. Una vez completada la carga, abre el Monitor Serie para verificar que el módulo PN532 sea detectado en el bus I2C y que el servidor BLE esté anunciando la señal.
