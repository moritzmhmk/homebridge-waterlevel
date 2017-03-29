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

    this.batteryVoltageMin = config.batteryVoltageMin === undefined ? 1800 : config.name
    this.batteryVoltageMax = config.batteryVoltageMax === undefined ? 3200 : config.name
    this.batteryVoltageLow = config.batteryVoltageLow === undefined ? 2000 : config.name
    this.distanceThreshold = config.distanceThreshold === undefined ? 15 : config.name
    this.maxUpdateInterval = config.maxUpdateInterval === undefined ? 30 * 60 * 1000 : config.name

    this.informationService = new Service.AccessoryInformation()
    this.informationService
      .setCharacteristic(Characteristic.Name, 'waterlevel')
      .setCharacteristic(Characteristic.Manufacturer, 'moritzmhmk')
      .setCharacteristic(Characteristic.Model, 'v0.0.1')
      .setCharacteristic(Characteristic.SerialNumber, '0000000001')

    this.leakSensorService = new Service.LeakSensor(config.name)

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
    this.leakSensorService.getCharacteristic(Characteristic.StatusActive).on('get', (callback) => {
      callback(null, Date.now() - this.lastUpdate < this.maxUpdateInterval)
    })
    this.leakSensorService.getCharacteristic(Characteristic.StatusFault).on('get', (callback) => {
      callback(null, Date.now() - this.lastUpdate >= this.maxUpdateInterval)
    })

    this.batteryService = new Service.BatteryService(config.name)
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
      if (peripheral.advertisement.localName !== 'wtrlvl') {
        return
      }
      var manufacturerData = peripheral.advertisement.manufacturerData
      let batteryVoltage = manufacturerData.readUInt16LE(2)
      let distance = manufacturerData.readUInt8(4)
      this.lastUpdate = Date.now()
      log('received:', batteryVoltage + 'mV', distance + 'cm')
      this.leakSensorService.setCharacteristic(Characteristic.LeakDetected, distance < this.distanceThreshold)
      this.batteryService.setCharacteristic(Characteristic.BatteryLevel, batteryLevel(batteryVoltage, this.batteryVoltageMin, this.batteryVoltageMax))
      this.batteryService.setCharacteristic(Characteristic.StatusLowBattery, batteryVoltage < this.batteryVoltageLow)
    })
  }
  getServices () {
    return [this.informationService, this.leakSensorService, this.batteryService]
  }
}

let batteryLevel = (v, min, max) => Math.min(100, Math.max(0, (v - min) / (max - min) * 100))
