'use-strict';

const logger = require('../logger/logger.service');
const cameraUtils = require('./camera.utils');
const Config = require('../../services/config/config.start');

const { EventEmitter } = require('events');
const { createServer, Server } = require('net');
const { spawn } = require('child_process');

const moment = require('moment');

const config = new Config();
const prebuffer = {};

class PreBuffer {
  async start() {
    logger.debug('Starting camera prebuffering', false, '[Prebuffer]');

    for (const camera of config.cameras) {
      prebuffer[camera.name] = {
        ffmpegInput: camera.videoConfig.source,
        cameraName: camera.name,
        ffmpegPath: config.options.videoProcessor,
        videoDuration: config.prebuffering.videoDuration,
        time: Date.now(),
        date: moment().format(),
        prebufferFmp4: [],
        events: new EventEmitter(),
        released: false,
        idrInterval: 0,
        prevIdr: 0,
        ftyp: null,
        moov: null,
        prebufferSession: null,
        debug: camera.videoConfig.debug,
      };

      prebuffer[camera.name].prebufferSession = await this.startPreBufferSessions(camera.name);
    }
  }

  stop(cameraName) {
    if (prebuffer[cameraName]) {
      logger.debug('Stopping prebuffering..', cameraName, '[Prebuffer]');

      if (prebuffer[cameraName].process) {
        prebuffer[cameraName].process.kill();
      }

      if (prebuffer[cameraName].server) {
        prebuffer[cameraName].server.close();
      }
    }
  }

  async startPreBufferSessions(cameraName) {
    const cameraOptions = prebuffer[cameraName];

    if (cameraOptions.prebufferSession) {
      return cameraOptions.prebufferSession;
    }

    logger.debug('Starting Prebuffer server', cameraName, '[Prebuffer]');

    //const acodec = ['-acodec', 'copy'];
    const vcodec = ['-vcodec', 'copy'];

    const fmp4OutputServer = createServer(async (socket) => {
      fmp4OutputServer.close();

      const parser = cameraUtils.parseFragmentedMP4(cameraName, socket);

      for await (const atom of parser) {
        const now = Date.now();

        cameraOptions.time = now;
        cameraOptions.date = moment().format();

        if (!cameraOptions.ftyp) {
          cameraOptions.ftyp = atom;
        } else if (!cameraOptions.moov) {
          cameraOptions.moov = atom;
        } else {
          if (atom.type === 'mdat') {
            if (cameraOptions.prevIdr) {
              cameraOptions.idrInterval = now - cameraOptions.prevIdr;
            }

            cameraOptions.prevIdr = now;
          }

          cameraOptions.prebufferFmp4.push({
            atom,
            time: now,
            date: moment().format(),
          });
        }

        while (
          cameraOptions.prebufferFmp4.length > 0 &&
          cameraOptions.prebufferFmp4[0].time < now - cameraOptions.videoDuration - 100
        ) {
          cameraOptions.prebufferFmp4.shift();
        }

        cameraOptions.events.emit('atom', atom);
      }
    });

    const fmp4Port = await cameraUtils.listenServer(cameraName, fmp4OutputServer);
    const destination = `tcp://127.0.0.1:${fmp4Port}`;

    const ffmpegOutput = [
      '-f',
      'mp4',
      //...acodec,
      ...vcodec,
      '-movflags',
      'frag_keyframe+empty_moov+default_base_moof',
      destination,
    ];

    const arguments_ = [];
    arguments_.push(...cameraOptions.ffmpegInput.split(' '), ...ffmpegOutput);

    logger.debug(cameraOptions.ffmpegPath + ' ' + arguments_.join(' '), cameraName, '[Prebuffer]');

    let stdioValue = cameraOptions.debug ? 'pipe' : 'ignore';
    let cp = spawn(cameraOptions.ffmpegPath, arguments_, { env: process.env, stdio: stdioValue });

    if (cameraOptions.debug) {
      cp.stdout.on('data', (data) => logger.debug(data.toString(), cameraName, '[Prebuffer]'));
      cp.stderr.on('data', (data) => logger.debug(data.toString(), cameraName, '[Prebuffer]'));
    }

    return { server: fmp4OutputServer, process: cp };
  }

  async getVideo(cameraName, requestedPrebuffer) {
    const cameraOptions = prebuffer[cameraName];

    const server = new Server((socket) => {
      server.close();

      const writeAtom = (atom) => {
        socket.write(Buffer.concat([atom.header, atom.data]));
      };

      if (cameraOptions.ftyp) {
        writeAtom(cameraOptions.ftyp);
      }

      if (cameraOptions.moov) {
        writeAtom(cameraOptions.moov);
      }

      const now = Date.now();
      let needMoof = true;

      for (const prebuffer of cameraOptions.prebufferFmp4) {
        if (prebuffer.time < now - requestedPrebuffer) {
          continue;
        }

        if (needMoof && prebuffer.atom.type !== 'moof') {
          continue;
        }

        needMoof = false;

        writeAtom(prebuffer.atom);
      }

      cameraOptions.events.on('atom', writeAtom);

      const cleanup = () => {
        logger.debug('Prebuffer request ended', cameraName, '[Prebuffer]');

        cameraOptions.events.removeListener('atom', writeAtom);
        cameraOptions.events.removeListener('killed', cleanup);

        socket.removeAllListeners();
        socket.destroy();
      };

      cameraOptions.events.once('killed', cleanup);

      socket.once('end', cleanup);
      socket.once('close', cleanup);
      socket.once('error', cleanup);
    });

    setTimeout(() => server.close(), 30000);

    const port = await cameraUtils.listenServer(cameraName, server);
    const ffmpegInput = ['-f', 'mp4', '-i', `tcp://127.0.0.1:${port}`];

    return ffmpegInput;
  }
}

module.exports = new PreBuffer();
