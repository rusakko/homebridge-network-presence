// No longer need global variables here. They will be instance properties.

class OccupancySensor {
	constructor(network, config, platform) {
		// Store Homebridge API objects as instance properties
		this.Service = platform.api.hap.Service
		this.Characteristic = platform.api.hap.Characteristic

		this.network = network
		this.log = platform.log
		this.api = platform.api
		this.platformDevices = platform.devices
		this.interval = platform.interval
		this.threshold = !config.threshold && config.threshold !== 0 ? platform.threshold : config.threshold
		this.mac = config.mac ? config.mac.toLowerCase() : null
		this.ip = config.ip
		this.hostname = config.hostname ? config.hostname.toLowerCase() : null
		this.name = config.name
		this.model = 'ARP-network-scanner'
		this.serial = this.mac || this.ip || this.hostname
		this.manufacturer = '@nitaybz'
		this.displayName = this.name

		this.thresholdTimer = null

		if (!this.serial) {
			this.log(`Can't initiate ${this.name} device without mac address, ip address or hostname`)
			this.log(`Please change your config`)
			return
		}

		if (typeof this.serial !== 'string') {
			this.log(`Wrong mac/ip address/hostname format`)
			this.log(`Please adjust your config to include proper ip address (10.0.0.x), mac address (3e:34:ae:87:f1:cc) or hostname (joes-iphone.local)`)
			return
		}

		this.UUID = this.api.hap.uuid.generate(this.serial)
		this.accessory = platform.accessories.find(accessory => accessory.UUID === this.UUID)

		if (!this.accessory) {
			this.log(`Creating New ${platform.PLATFORM_NAME} Accessory for ${this.name}`)
			this.accessory = new this.api.platformAccessory(this.name, this.UUID)
			this.accessory.context.serial = this.serial

			platform.accessories.push(this.accessory)
			// register the accessory
			this.api.registerPlatformAccessories(platform.PLUGIN_NAME, platform.PLATFORM_NAME, [this.accessory])
		}


		this.isDetected = 0

		let informationService = this.accessory.getService(this.Service.AccessoryInformation)

		if (!informationService)
			informationService = this.accessory.addService(this.Service.AccessoryInformation)

		informationService
			.setCharacteristic(this.Characteristic.Manufacturer, this.manufacturer)
			.setCharacteristic(this.Characteristic.Model, this.model)
			.setCharacteristic(this.Characteristic.SerialNumber, this.serial)

		if (config.anyone)
			this.addAnyoneSensor()
		else
			this.addOccupancySensor()

	}

	addOccupancySensor() {
		this.log.easyDebug(`Adding "${this.name}" Occupancy Sensor Service`)
		this.OccupancySensorService = this.accessory.getService(this.Service.OccupancySensor)
		if (!this.OccupancySensorService)
			this.OccupancySensorService = this.accessory.addService(this.Service.OccupancySensor, this.name, 'netSensor')

		this.OccupancySensorService.getCharacteristic(this.Characteristic.OccupancyDetected)
			.on('get', (callback) => callback(null, this.isDetected))
			.updateValue(this.isDetected)

		const listenTo = this.mac ? `mac:${this.mac}` : this.ip ? `ip:${this.ip}` : `hostname:${this.hostname}`
		this.log.easyDebug(`[${this.name}] - Listening to ${listenTo}`)

		this.network.on(`net-connected:${listenTo}`, (device) =>
			this.setDetected(true, device)
		);
		this.network.on(`net-disconnected:${listenTo}`, (device) =>
			this.setDetected(false, device)
		);
	}

	/**
	 * [FIXED] This method contains the rewritten logic to handle state correctly.
	 * @param {boolean} isDetected - True if the device connected, false if it disconnected.
	 * @param {object} device - The device object from the network scanner.
	 */
	setDetected(isDetected, device) {
		// Always clear any pending disconnection timer when a new event arrives.
		clearTimeout(this.thresholdTimer)

		if (isDetected) {
			// Device is connecting.
			if (!this.isDetected) {
				// Only update if the state is changing from 'disconnected' to 'connected'.
				this.log(`[${this.name}] - connected to the network (mac: ${device.mac} | ip:${device.ip} | hostname:${device.name})`)
				this.isDetected = 1
				this.OccupancySensorService
					.getCharacteristic(this.Characteristic.OccupancyDetected)
					.updateValue(1)
			}
			// If this.isDetected was already 1, we do nothing.
		} else {
			// Device is disconnecting.
			if (this.isDetected) {
				// Only schedule a disconnection if the state was 'connected'.
				// We don't change the state immediately, we wait for the threshold.
				this.thresholdTimer = setTimeout(() => {
					this.log(`[${this.name}] - disconnected from the network (mac: ${device.mac} | ip:${device.ip} | hostname:${device.name})`)
					this.isDetected = 0
					this.OccupancySensorService
						.getCharacteristic(this.Characteristic.OccupancyDetected)
						.updateValue(0)

				}, this.threshold * 60 * 1000)
			}
			// If this.isDetected was already 0, we do nothing.
		}
	}


	addAnyoneSensor() {
		this.log.easyDebug(`Adding "${this.name}" Occupancy Sensor Service`)
		this.OccupancySensorService = this.accessory.getService(this.Service.OccupancySensor)
		if (!this.OccupancySensorService)
			this.OccupancySensorService = this.accessory.addService(this.Service.OccupancySensor, this.name, 'anyoneSensor')

		this.updateAnyone()

		this.OccupancySensorService.getCharacteristic(this.Characteristic.OccupancyDetected)
			.on('get', (callback) => callback(null, this.isDetected))
			.updateValue(this.isDetected)

		setInterval(() => {
			this.updateAnyone()
		}, this.interval)
	}
	
	updateAnyone() {
		// [FIXED] Check if any *other* accessory is detected.
		// `pDevice !== this` prevents the "Anyone" sensor from counting itself.
		const isDetected = this.platformDevices.find(pDevice => pDevice !== this && pDevice.isDetected)
		
		if (isDetected && !this.isDetected) {
			this.log(`[${this.name}] - Someone connected to the network`)
			this.isDetected = 1
			this.OccupancySensorService
				.getCharacteristic(this.Characteristic.OccupancyDetected)
				.updateValue(1)
		} else if (!isDetected && this.isDetected) {
			this.log(`[${this.name}] - No one is connected to the network`)
			this.isDetected = 0
			this.OccupancySensorService
				.getCharacteristic(this.Characteristic.OccupancyDetected)
				.updateValue(0)
		}
	}
}

module.exports = OccupancySensor

