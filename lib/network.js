const { EventEmitter } = require('events');
const find = require('local-devices');
const Accessory = require('./accessory');

// [FIX #3] Define a constant for the "Anyone" sensor's serial to avoid magic strings.
const ANYONE_SENSOR_SERIAL = '12:34:56:78:9a:bc';

const init = function() {
    removeCachedDevices.bind(this)();

    this.log(`Initiating Network Scanner...`);
    const net = new NetworkObserver(this.interval, this.range, this.log);

    net.on('err', (err) => {
        this.log('ERROR OCCURRED during network scan!!');
        this.log(err);
    });

    this.devicesConfig.forEach(device => this.devices.push(new Accessory(net, device, this)));
    if (this.anyoneSensor) {
        // [FIX #3] Use the constant here.
        new Accessory(net, { anyone: true, mac: ANYONE_SENSOR_SERIAL, name: 'Anyone' }, this);
    }
};

class NetworkObserver extends EventEmitter {
    constructor(interval, range, log) {
        super();
        this.log = log; // Pass in the logger for better debugging
        this.interval = interval;
        this.range = range;
        this.cachedDevices = [];
        this.tick();
    }

    get pollInterval() {
        return this.interval;
    }

    get devices() {
        // find() returns a promise
        return find(this.range);
    }

    _parseMacAddress(devices) {
        return devices.map(device => {
            if (device.mac) { // Ensure mac exists before processing
                device.mac = device.mac.toLowerCase().split(':').map(block => ('0' + block).slice(-2)).join(':');
            }
            return device;
        });
    }

	tick() {
		return this.update()
			.finally(() => setTimeout(() => this.tick(), this.pollInterval));
	}

    async update() {
        try {
            let currentDevices = await this.devices;

            // [FIX #1] CRITICAL: Normalize MAC addresses from the network scan.
                            currentDevices = this._parseMacAddress(currentDevices);
            
                            // Create a set of IPs currently on the network for efficient lookup.
                            const currentIpSet = new Set(currentDevices.map(device => device.ip));
            // [FIX #2] Use a more efficient lookup strategy.
            const cacheMap = this.cachedDevices.reduce((hash, device) => {
                if (device.mac) {
                    hash[device.mac] = device;
                }
                return hash;
            }, {});

            const newDevices = [];

            // Check for new or existing devices
            currentDevices.forEach(device => {
                if (!device.mac) return; // Skip devices without a MAC address

                if (cacheMap[device.mac]) {
                    // Device was already present, remove it from map to signify it's still here.
                    delete cacheMap[device.mac];
                } else {
                    // This is a new device.
                    newDevices.push(device);
                }

                // [FIX #4] Removed the noisy 'net-device' emits as they are not used.
            });

            // Any devices remaining in cacheMap are disconnected.
            const removedDevices = Object.values(cacheMap);

            // Emit events for state changes
            newDevices.forEach(device => {
                this.emit(`net-connected:mac:${device.mac}`, device);
                this.emit(`net-connected:ip:${device.ip}`, device);
                this.emit(`net-connected:hostname:${device.name}`, device);
            });

                            removedDevices.forEach(device => {
                                // Always emit disconnect for the specific MAC address that is gone.
                                this.emit(`net-disconnected:mac:${device.mac}`, device);
            
                                // *** THE FIX IS HERE ***
                                // Only emit disconnect for the IP and hostname if that IP is truly gone from the network.
                                // This prevents false disconnects when a device changes MAC address but keeps the same IP.
                                if (!currentIpSet.has(device.ip)) {
                                    this.emit(`net-disconnected:ip:${device.ip}`, device);
                                    this.emit(`net-disconnected:hostname:${device.name}`, device);
                                }
                            });
            // Save the current state for the next update
            this.cachedDevices = currentDevices;

        } catch (err) {
            this.emit('err', err);
        }
    }
}

module.exports = {
    NetworkObserver,
    init
};

const removeCachedDevices = function() {
	this.accessories.forEach(accessory => {
        // [FIX #3] Use the constant here for comparison.
        if (accessory.context.serial === ANYONE_SENSOR_SERIAL && this.anyoneSensor) {
            return;
        }

        const deviceInConfig = this.devicesConfig.find(device => 
            (device.mac && device.mac.toLowerCase() === accessory.context.serial) ||
            device.ip === accessory.context.serial ||
            (device.hostname && device.hostname.toLowerCase() === accessory.context.serial)
        );

		if (!deviceInConfig) {
			// unregistering accessory
			this.log(`Unregistering disconnected device: "${accessory.displayName}" (${accessory.context.serial})`);
			this.api.unregisterPlatformAccessories(this.PLUGIN_NAME, this.PLATFORM_NAME, [accessory]);
		}
	});
};

