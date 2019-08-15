var noble = require('noble')

let Service, Characteristic

module.exports = function (homebridge) {
  Service = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  homebridge.registerAccessory('homebridge-waterlevel', 'WaterLevel', WaterLevel)
}

class WaterLevel {
  constructor (log, config) {
    if (config.name === undefined) { return log('Name missing from configuration.') }
    if (config.deviceName === undefined) { return log('Device name missing from configuration.') }

    this.name = config.name
    this.deviceName = config.deviceName
    this.batteryVoltageMin = config.batteryVoltageMin === undefined ? 1800 : config.batteryVoltageMin
    this.batteryVoltageMax = config.batteryVoltageMax === undefined ? 3200 : config.batteryVoltageMax
    this.batteryVoltageLow = config.batteryVoltageLow === undefined ? 2000 : config.batteryVoltageLow
    this.distanceThreshold = config.distanceThreshold === undefined ? 15 : config.distanceThreshold
    this.distanceDebounce = config.distanceDebounce === undefined ? 1 : config.distanceDebounce
    this.maxUpdateInterval = config.maxUpdateInterval === undefined ? 30 * 60 * 1000 : config.maxUpdateInterval

    this.informationService = new Service.AccessoryInformation()
    this.informationService
      .setCharacteristic(Characteristic.Name, 'waterlevel')
      .setCharacteristic(Characteristic.Manufacturer, 'moritzmhmk')
      .setCharacteristic(Characteristic.Model, 'v0.0.1')
      .setCharacteristic(Characteristic.SerialNumber, '0000000001')

    this.leakSensorService = new Service.LeakSensor(this.name)

    let setupGetListener = (characteristic) => {
      characteristic.on('get', (callback) => {
        if (Date.now() - this.lastUpdate < this.maxUpdateInterval) {
          callback(null, characteristic.value)
        } else {
          log('cached value is too old')
          callback(new Error('cached value is too old'))
        }
      })
    }

    setupGetListener(this.leakSensorService.getCharacteristic(Characteristic.LeakDetected))
    setupGetListener(this.leakSensorService.getCharacteristic(Characteristic.WaterLevel))
    this.leakSensorService.getCharacteristic(Characteristic.StatusActive).on('get', (callback) => {
      callback(null, Date.now() - this.lastUpdate < this.maxUpdateInterval)
    })
    this.leakSensorService.getCharacteristic(Characteristic.StatusFault).on('get', (callback) => {
      callback(null, Date.now() - this.lastUpdate >= this.maxUpdateInterval)
    })

    this.batteryService = new Service.BatteryService(this.name)
    setupGetListener(this.batteryService.getCharacteristic(Characteristic.BatteryLevel))
    setupGetListener(this.batteryService.getCharacteristic(Characteristic.StatusLowBattery))

    noble.on('stateChange', (state) => {
      log('Bluetooth state changed to: ' + state)
      if (state === 'poweredOn') {
        noble.startScanning([], true)
      } else {
        noble.stopScanning()
      }
    })

    noble.on('discover', (peripheral) => {
      if (peripheral.advertisement.localName === this.deviceName) {
        var manufacturerData = peripheral.advertisement.manufacturerData
        let batteryVoltage = manufacturerData.readUInt16LE(2)
        let distance = manufacturerData.readUInt8(4)
        this.lastUpdate = Date.now()

        let detected = this.leakSensorService.getCharacteristic(Characteristic.LeakDetected).value
        if (detected && distance > this.distanceThreshold + this.distanceDebounce) { detected = false }
        if (!detected && distance < this.distanceThreshold) { detected = true }

        let level = percent(distance, 25, this.distanceThreshold)

        let batteryLevel = percent(batteryVoltage, this.batteryVoltageMin, this.batteryVoltageMax)
        let batteryLow = batteryVoltage < this.batteryVoltageLow

        log(`received: ${batteryVoltage}mV (${batteryLevel.toFixed(2)}%, low:${batteryLow}) ${distance}cm (leak:${detected})`)

        this.leakSensorService.setCharacteristic(Characteristic.LeakDetected, detected)
        this.leakSensorService.setCharacteristic(Characteristic.WaterLevel, level)
        this.batteryService.setCharacteristic(Characteristic.BatteryLevel, batteryLevel)
        this.batteryService.setCharacteristic(Characteristic.StatusLowBattery, batteryLow)
      }
    })
  }
  getServices () {
    return [this.informationService, this.leakSensorService, this.batteryService]
  }
}

let percent = (v, min, max) => Math.min(100, Math.max(0, (v - min) / (max - min) * 100))
