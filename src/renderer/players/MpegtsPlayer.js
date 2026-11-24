export class MpegtsPlayer {
  constructor({ video, slotNumber, onReady, onFatalError }) {
    this.video = video;
    this.slotNumber = slotNumber;
    this.onReady = onReady;
    this.onFatalError = onFatalError;
    this.player = null;
  }

  play(streamUrl) {
    this.destroy();

    if (!window.mpegts || !window.mpegts.isSupported()) {
      this.onFatalError?.('系統不支援 MPEG-TS 串流播放');
      return;
    }

    this.player = window.mpegts.createPlayer(
      {
        type: 'mpegts',
        isLive: true,
        url: streamUrl
      },
      {
        enableWorker: true,
        lazyLoad: false,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 5.0,
        liveBufferLatencyMinRemain: 1.5,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 20,
        autoCleanupMinBackwardDuration: 10
      }
    );

    this.player.attachMediaElement(this.video);
    this.player.load();

    this.player
      .play()
      .then(() => {
        this.onReady?.();
      })
      .catch(() => {
        this.onReady?.();
      });

    this.player.on(window.mpegts.Events.ERROR, (errType, errDetail) => {
      console.warn(`[Slot ${this.slotNumber}] MPEG-TS 狀態:`, errType, errDetail);
    });
  }

  destroy() {
    if (!this.player) return;
    try {
      this.player.pause();
      this.player.unload();
      this.player.detachMediaElement();
      this.player.destroy();
    } catch {
      // ignore teardown errors
    }
    this.player = null;
  }
}
