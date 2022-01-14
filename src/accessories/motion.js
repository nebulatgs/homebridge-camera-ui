'use-strict';

const { Logger } = require('../../services/logger/logger.service');

class MotionService {
  constructor(api, accessory, handler) {
    this.api = api;
    this.log = Logger.log;
    this.accessory = accessory;
    this.handler = handler;

    this.getService();
  }

  //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~//
  // Services
  //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~//

  getService() {
    let service = this.accessory.getServiceById(this.api.hap.Service.MotionSensor, 'motion');
    let switchService = this.accessory.getServiceById(this.api.hap.Service.Switch, 'MotionTrigger');

    if (this.accessory.context.config.motion) {
      if (!service) {
        this.log.debug('Adding motion sensor service', this.accessory.displayName);
        service = this.accessory.addService(
          this.api.hap.Service.MotionSensor,
          this.accessory.displayName + ' Motion',
          'motion'
        );
      }

      if (!service.testCharacteristic(this.api.hap.Characteristic.StatusActive)) {
        service.addCharacteristic(this.api.hap.Characteristic.StatusActive);
      }

      service.getCharacteristic(this.api.hap.Characteristic.MotionDetected).updateValue(false);
    } else {
      if (service) {
        this.log.debug('Removing motion sensor service', this.accessory.displayName);
        this.accessory.removeService(service);
      }
    }

    if (this.accessory.context.config.switches) {
      if (!switchService) {
        this.log.debug('Adding switch service (motion)', this.accessory.displayName);
        switchService = this.accessory.addService(
          this.api.hap.Service.Switch,
          this.accessory.displayName + ' Motion Trigger',
          'MotionTrigger'
        );
      }

      switchService.getCharacteristic(this.api.hap.Characteristic.On).onSet(async (state) => {
        //this.log.info(`Motion Switch ${state ? 'activated!' : 'deactivated!'}`, this.accessory.displayName);
        await this.handler.motionHandler(this.accessory, state, true);
      });
    } else {
      if (switchService) {
        this.log.debug('Removing switch service (motion)', this.accessory.displayName);
        this.accessory.removeService(switchService);
      }
    }
  }
}

module.exports = MotionService;
