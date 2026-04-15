#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>

#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

BLECharacteristic *vitalsCharacteristic;

void setup() {
  Serial.begin(115200);
  BLEDevice::init("MediSync-ESP32");
  BLEServer *server = BLEDevice::createServer();
  BLEService *service = server->createService(SERVICE_UUID);

  vitalsCharacteristic = service->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_NOTIFY
  );

  service->start();

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->start();
}

void loop() {
  int heartRate = random(68, 92);
  int systolic = random(112, 126);
  int diastolic = random(72, 84);
  int spo2 = random(96, 100);
  float temperature = 36.4 + (random(0, 9) / 10.0);

  String payload = "{\"heartRate\":" + String(heartRate) +
                   ",\"bloodPressure\":\"" + String(systolic) + "/" + String(diastolic) +
                   "\",\"spo2\":" + String(spo2) +
                   ",\"temperature\":" + String(temperature, 1) + "}";

  vitalsCharacteristic->setValue(payload.c_str());
  vitalsCharacteristic->notify();
  delay(2000);
}
