export class HlsPlayer {
  constructor({ video, slotNumber, onReady, onFatalError }) {
    this.video = video;
    this.slotNumber = slotNumber;
    this.onReady = onReady;
    this.onFatalError = onFatalError;
    this.hls = null;
    this.nativeLoadedListener = null;
  }

  play(streamUrl) {
    this.destroy();

    if (window.Hls && window.Hls.isSupported()) {
      this.hls = new window.Hls({
        liveSyncDurationCount: 4,
        maxLiveSyncPlaybackRate: 1.05,
        maxBufferLength: 15,
        maxMaxBufferLength: 30,
        enableWorker: true,
        lowLatencyMode: false
      });

      this.hls.loadSource(streamUrl);
      this.hls.attachMedia(this.video);

      this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        this.video.play().catch(() => {});
        this.onReady?.();
      });

      this.hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || !this.hls) return;
        switch (data.type) {
          case window.Hls.ErrorTypes.NETWORK_ERROR:
            console.warn(`[Slot ${this.slotNumber}] HLS 網路錯誤，嘗試恢復...`);
            this.hls.startLoad();
            break;
          case window.Hls.ErrorTypes.MEDIA_ERROR:
            console.warn(`[Slot ${this.slotNumber}] HLS 媒體解碼錯誤，嘗試恢復...`);
            this.hls.recoverMediaError();
            break;
          default:
            console.error(`[Slot ${this.slotNumber}] HLS 無法恢復的錯誤:`, data);
            this.destroy();
            this.onFatalError?.('串流播放中斷或訊號遺失');
            break;
        }
      });
      return;
    }

    if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      this.nativeLoadedListener = () => {
        this.video.play().catch(() => {});
        this.onReady?.();
      };
      this.video.addEventListener('loadedmetadata', this.nativeLoadedListener, { once: true });
      this.video.src = streamUrl;
      return;
    }

    this.onFatalError?.('此系統環境不支援 HLS 播放');
  }

  destroy() {
    if (this.nativeLoadedListener) {
      this.video.removeEventListener('loadedmetadata', this.nativeLoadedListener);
      this.nativeLoadedListener = null;
    }
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }
}
