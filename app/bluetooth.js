import { apiRequest } from './api.js';
import { qs } from './dom.js';
import { state } from './state.js';
import { applyVitals, showNotification } from './ui.js';

function parseBlePayload(rawValue) {
    try {
        return JSON.parse(rawValue);
    } catch (error) {
        const [heartRate, bloodPressure, spo2, temperature] = rawValue.split(',');
        return { heartRate, bloodPressure, spo2, temperature, raw: rawValue };
    }
}

export async function connectBluetoothDevice() {
    if (!navigator.bluetooth) {
        throw new Error('Web Bluetooth is not supported in this browser.');
    }

    const serviceUuid = qs('bleServiceUuid')?.value.trim() || state.publicConfig.bleServiceUuid;
    const characteristicUuid = qs('bleCharacteristicUuid')?.value.trim() || state.publicConfig.bleCharacteristicUuid;
    qs('deviceStatus').textContent = 'Searching for BLE devices...';

    state.currentBleDevice = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [serviceUuid]
    });
    state.currentBleServer = await state.currentBleDevice.gatt.connect();
    const service = await state.currentBleServer.getPrimaryService(serviceUuid);
    state.currentBleCharacteristic = await service.getCharacteristic(characteristicUuid);
    await state.currentBleCharacteristic.startNotifications();
    state.currentBleCharacteristic.addEventListener('characteristicvaluechanged', handleBleNotification);
    qs('deviceStatus').textContent = `Connected to ${state.currentBleDevice.name || 'ESP32 device'}`;
    showNotification('ESP32 connected successfully.', 'success');
}

export function disconnectBluetoothDevice() {
    if (state.currentBleCharacteristic) {
        state.currentBleCharacteristic.removeEventListener('characteristicvaluechanged', handleBleNotification);
    }
    if (state.currentBleDevice?.gatt?.connected) {
        state.currentBleDevice.gatt.disconnect();
    }
    state.currentBleDevice = null;
    state.currentBleServer = null;
    state.currentBleCharacteristic = null;
    qs('deviceStatus').textContent = 'Device disconnected.';
}

async function handleBleNotification(event) {
    const raw = new TextDecoder().decode(event.target.value);
    const reading = parseBlePayload(raw);
    applyVitals(reading);
    qs('deviceStatus').textContent = `Live reading received at ${new Date().toLocaleTimeString()}`;

    if (state.sessionToken) {
        try {
            await apiRequest('/api/device/readings', {
                method: 'POST',
                auth: 'user',
                body: { ...reading, raw, source: 'esp32-bluetooth' }
            });
        } catch (error) {
            console.error(error);
        }
    }
}
