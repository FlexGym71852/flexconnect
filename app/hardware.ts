"use client";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
export type Transport = "wifi" | "bluetooth";

export type DoorWifiConfig = { endpoint: string; token: string };
export type DoorBluetoothConfig = { serviceUuid: string; writeCharacteristicUuid: string; openCommand: string; closeCommand: string };
export type ReaderWifiConfig = { socketUrl: string; token: string; writeUrl: string };
export type ReaderBluetoothConfig = { serviceUuid: string; notifyCharacteristicUuid: string; writeCharacteristicUuid: string };

export type DeviceConnection = {
  status: ConnectionStatus;
  transport: Transport | null;
  name: string;
  message: string;
};

export type HardwareState = {
  door: DeviceConnection;
  reader: DeviceConnection;
};

type GattCharacteristic = {
  value?: DataView | null;
  startNotifications(): Promise<GattCharacteristic>;
  writeValueWithResponse?(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
  writeValue?(value: BufferSource): Promise<void>;
  addEventListener(type: "characteristicvaluechanged", listener: (event: Event) => void): void;
};

type GattServer = {
  connected: boolean;
  getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<GattCharacteristic> }>;
};

type BluetoothDeviceLike = {
  name?: string;
  gatt?: { connect(): Promise<GattServer>; disconnect(): void; connected: boolean };
  addEventListener(type: "gattserverdisconnected", listener: () => void): void;
};

const emptyConnection = (): DeviceConnection => ({ status: "disconnected", transport: null, name: "", message: "Not connected" });

const storageKeys = {
  doorWifi: "flex-connect-door-wifi",
  doorBluetooth: "flex-connect-door-bluetooth",
  readerWifi: "flex-connect-reader-wifi",
  readerBluetooth: "flex-connect-reader-bluetooth",
};

function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { return { ...fallback, ...JSON.parse(window.localStorage.getItem(key) || "{}") } as T; }
  catch { return fallback; }
}

function save(key: string, value: unknown) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "The device connection failed.";
}

async function writeCharacteristic(characteristic: GattCharacteristic, text: string) {
  const bytes = new TextEncoder().encode(text);
  if (characteristic.writeValueWithResponse) return characteristic.writeValueWithResponse(bytes);
  if (characteristic.writeValueWithoutResponse) return characteristic.writeValueWithoutResponse(bytes);
  if (characteristic.writeValue) return characteristic.writeValue(bytes);
  throw new Error("This Bluetooth characteristic is not writable.");
}

class HardwareManager {
  private state: HardwareState = { door: emptyConnection(), reader: emptyConnection() };
  private listeners = new Set<(state: HardwareState) => void>();
  private tagListeners = new Set<(token: string) => void>();
  private doorDevice: BluetoothDeviceLike | null = null;
  private doorCharacteristic: GattCharacteristic | null = null;
  private readerDevice: BluetoothDeviceLike | null = null;
  private readerWriteCharacteristic: GattCharacteristic | null = null;
  private readerSocket: WebSocket | null = null;
  private doorWifi: DoorWifiConfig | null = null;
  private readerWifi: ReaderWifiConfig | null = null;
  private doorBluetooth: DoorBluetoothConfig | null = null;

  getState() { return this.state; }
  subscribe(listener: (state: HardwareState) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  subscribeTags(listener: (token: string) => void) { this.tagListeners.add(listener); return () => this.tagListeners.delete(listener); }

  configs() {
    return {
      doorWifi: load<DoorWifiConfig>(storageKeys.doorWifi, { endpoint: "", token: "" }),
      doorBluetooth: load<DoorBluetoothConfig>(storageKeys.doorBluetooth, { serviceUuid: "", writeCharacteristicUuid: "", openCommand: "OPEN", closeCommand: "CLOSE" }),
      readerWifi: load<ReaderWifiConfig>(storageKeys.readerWifi, { socketUrl: "", token: "", writeUrl: "" }),
      readerBluetooth: load<ReaderBluetoothConfig>(storageKeys.readerBluetooth, { serviceUuid: "", notifyCharacteristicUuid: "", writeCharacteristicUuid: "" }),
    };
  }

  private update(device: "door" | "reader", change: Partial<DeviceConnection>) {
    this.state = { ...this.state, [device]: { ...this.state[device], ...change } };
    this.listeners.forEach((listener) => listener(this.state));
  }

  private emitTag(value: string) {
    const token = value.trim().replace(/\0/g, "");
    if (token) this.tagListeners.forEach((listener) => listener(token));
  }

  async connectDoorWifi(config: DoorWifiConfig) {
    if (!config.endpoint.trim()) throw new Error("Enter the door controller URL.");
    this.disconnectDoor();
    this.update("door", { status: "connecting", transport: "wifi", name: "Wi-Fi door controller", message: "Checking local controller…" });
    try {
      const response = await fetch(config.endpoint.trim(), {
        method: "POST",
        headers: { "content-type": "application/json", ...(config.token ? { authorization: `Bearer ${config.token}` } : {}) },
        body: JSON.stringify({ action: "status", source: "flex-connect" }),
      });
      if (!response.ok) throw new Error(`Controller returned HTTP ${response.status}.`);
      this.doorWifi = { ...config, endpoint: config.endpoint.trim() };
      save(storageKeys.doorWifi, this.doorWifi);
      this.update("door", { status: "connected", transport: "wifi", name: "Wi-Fi door controller", message: "Local API connected" });
    } catch (error) {
      this.update("door", { status: "error", transport: "wifi", name: "Wi-Fi door controller", message: messageFrom(error) });
      throw error;
    }
  }

  async connectDoorBluetooth(config: DoorBluetoothConfig) {
    if (!config.serviceUuid.trim() || !config.writeCharacteristicUuid.trim()) throw new Error("Enter the BLE service and write characteristic UUIDs.");
    const bluetooth = (navigator as unknown as { bluetooth?: { requestDevice(options: { acceptAllDevices: boolean; optionalServices: string[] }): Promise<BluetoothDeviceLike> } }).bluetooth;
    if (!bluetooth) throw new Error("Web Bluetooth is unavailable in this browser.");
    this.disconnectDoor();
    this.update("door", { status: "connecting", transport: "bluetooth", name: "Bluetooth door", message: "Choose the controller…" });
    try {
      const device = await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [config.serviceUuid.trim()] });
      const server = await device.gatt?.connect();
      if (!server) throw new Error("The selected device does not expose a GATT server.");
      const service = await server.getPrimaryService(config.serviceUuid.trim());
      this.doorCharacteristic = await service.getCharacteristic(config.writeCharacteristicUuid.trim());
      this.doorDevice = device;
      this.doorBluetooth = config;
      save(storageKeys.doorBluetooth, config);
      device.addEventListener("gattserverdisconnected", () => {
        this.doorCharacteristic = null;
        this.update("door", { status: "disconnected", message: "Bluetooth connection lost" });
      });
      this.update("door", { status: "connected", transport: "bluetooth", name: device.name || "Bluetooth door", message: "BLE GATT connected" });
    } catch (error) {
      this.update("door", { status: "error", transport: "bluetooth", name: "Bluetooth door", message: messageFrom(error) });
      throw error;
    }
  }

  disconnectDoor() {
    if (this.doorDevice?.gatt?.connected) this.doorDevice.gatt.disconnect();
    this.doorDevice = null;
    this.doorCharacteristic = null;
    this.doorWifi = null;
    this.doorBluetooth = null;
    this.update("door", emptyConnection());
  }

  async operateDoor(action: "open" | "close", pulseSeconds = 5) {
    if (this.state.door.status !== "connected") throw new Error("Connect a door controller in Settings first.");
    if (this.state.door.transport === "wifi" && this.doorWifi) {
      const response = await fetch(this.doorWifi.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.doorWifi.token ? { authorization: `Bearer ${this.doorWifi.token}` } : {}) },
        body: JSON.stringify({ action, pulseSeconds: action === "open" ? pulseSeconds : 0, source: "flex-connect" }),
      });
      if (!response.ok) throw new Error(`Controller returned HTTP ${response.status}.`);
      return;
    }
    if (this.state.door.transport === "bluetooth" && this.doorCharacteristic && this.doorBluetooth) {
      await writeCharacteristic(this.doorCharacteristic, action === "open" ? this.doorBluetooth.openCommand : this.doorBluetooth.closeCommand);
      return;
    }
    throw new Error("The door connection was lost.");
  }

  async connectReaderWifi(config: ReaderWifiConfig) {
    if (!config.socketUrl.trim()) throw new Error("Enter the NFC reader WebSocket URL.");
    this.disconnectReader();
    this.update("reader", { status: "connecting", transport: "wifi", name: "Wi-Fi NFC reader", message: "Opening reader stream…" });
    try {
      const socket = new WebSocket(config.socketUrl.trim());
      this.readerSocket = socket;
      this.readerWifi = { ...config, socketUrl: config.socketUrl.trim() };
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("The NFC reader connection timed out.")), 8000);
        socket.onopen = () => { window.clearTimeout(timeout); resolve(); };
        socket.onerror = () => { window.clearTimeout(timeout); reject(new Error("The NFC reader WebSocket could not connect.")); };
      });
      if (config.token) socket.send(JSON.stringify({ type: "auth", token: config.token }));
      socket.onmessage = (event) => {
        const raw = String(event.data || "");
        try { const parsed = JSON.parse(raw) as { token?: string; record?: string }; this.emitTag(parsed.token || parsed.record || ""); }
        catch { this.emitTag(raw); }
      };
      socket.onclose = () => this.update("reader", { status: "disconnected", message: "Wi-Fi reader disconnected" });
      save(storageKeys.readerWifi, this.readerWifi);
      this.update("reader", { status: "connected", transport: "wifi", name: "Wi-Fi NFC reader", message: "Tag stream connected" });
    } catch (error) {
      this.readerSocket?.close();
      this.readerSocket = null;
      this.update("reader", { status: "error", transport: "wifi", name: "Wi-Fi NFC reader", message: messageFrom(error) });
      throw error;
    }
  }

  async connectReaderBluetooth(config: ReaderBluetoothConfig) {
    if (!config.serviceUuid.trim() || !config.notifyCharacteristicUuid.trim()) throw new Error("Enter the BLE service and notify characteristic UUIDs.");
    const bluetooth = (navigator as unknown as { bluetooth?: { requestDevice(options: { acceptAllDevices: boolean; optionalServices: string[] }): Promise<BluetoothDeviceLike> } }).bluetooth;
    if (!bluetooth) throw new Error("Web Bluetooth is unavailable in this browser.");
    this.disconnectReader();
    this.update("reader", { status: "connecting", transport: "bluetooth", name: "Bluetooth NFC reader", message: "Choose the reader…" });
    try {
      const device = await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [config.serviceUuid.trim()] });
      const server = await device.gatt?.connect();
      if (!server) throw new Error("The selected device does not expose a GATT server.");
      const service = await server.getPrimaryService(config.serviceUuid.trim());
      const notifyCharacteristic = await service.getCharacteristic(config.notifyCharacteristicUuid.trim());
      if (config.writeCharacteristicUuid.trim()) this.readerWriteCharacteristic = await service.getCharacteristic(config.writeCharacteristicUuid.trim());
      await notifyCharacteristic.startNotifications();
      notifyCharacteristic.addEventListener("characteristicvaluechanged", (event) => {
        const value = (event.target as GattCharacteristic).value;
        if (value) this.emitTag(new TextDecoder().decode(value));
      });
      this.readerDevice = device;
      save(storageKeys.readerBluetooth, config);
      device.addEventListener("gattserverdisconnected", () => {
        this.readerWriteCharacteristic = null;
        this.update("reader", { status: "disconnected", message: "Bluetooth reader disconnected" });
      });
      this.update("reader", { status: "connected", transport: "bluetooth", name: device.name || "Bluetooth NFC reader", message: "BLE tag notifications active" });
    } catch (error) {
      this.update("reader", { status: "error", transport: "bluetooth", name: "Bluetooth NFC reader", message: messageFrom(error) });
      throw error;
    }
  }

  disconnectReader() {
    this.readerSocket?.close();
    if (this.readerDevice?.gatt?.connected) this.readerDevice.gatt.disconnect();
    this.readerSocket = null;
    this.readerDevice = null;
    this.readerWriteCharacteristic = null;
    this.readerWifi = null;
    this.update("reader", emptyConnection());
  }

  async writeNfcRecord(record: string) {
    if (this.state.reader.status !== "connected") throw new Error("Connect an NFC writer in Settings first.");
    if (this.state.reader.transport === "bluetooth" && this.readerWriteCharacteristic) {
      await writeCharacteristic(this.readerWriteCharacteristic, record);
      return;
    }
    if (this.state.reader.transport === "wifi" && this.readerWifi?.writeUrl) {
      const response = await fetch(this.readerWifi.writeUrl, {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.readerWifi.token ? { authorization: `Bearer ${this.readerWifi.token}` } : {}) },
        body: JSON.stringify({ record, source: "flex-connect" }),
      });
      if (!response.ok) throw new Error(`NFC writer returned HTTP ${response.status}.`);
      return;
    }
    throw new Error("This reader is connected for scanning but has no write endpoint or characteristic.");
  }
}

export const hardware = new HardwareManager();
