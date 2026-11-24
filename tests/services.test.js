const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { isSafeHttpUrl, isSafeCliArg, sanitizeQuality } = require('../src/main/constants');
const { checkEnvironment } = require('../src/main/services/binaryResolver');
const { createStreamService } = require('../src/main/services/streamService');
const { openInVlc } = require('../src/main/services/vlcService');

function createMockChild(pid = 1000) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.unrefCalled = false;
  child.kill = () => {
    child.killed = true;
  };
  child.unref = () => {
    child.unrefCalled = true;
  };
  return child;
}

test('security validators block unsafe protocols and CLI option injection', () => {
  assert.equal(isSafeHttpUrl('https://www.twitch.tv/test'), true);
  assert.equal(isSafeHttpUrl('http://127.0.0.1:8080/'), true);
  assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
  assert.equal(isSafeHttpUrl('file:///C:/Windows/System32/calc.exe'), false);
  assert.equal(isSafeHttpUrl('ms-msdt:/id PCWDiagnostic'), false);

  assert.equal(isSafeCliArg('https://kick.com/test'), true);
  assert.equal(isSafeCliArg('--player=calc.exe'), false);
  assert.equal(isSafeCliArg(' -o out.mp4'), false);
  assert.equal(sanitizeQuality('--bad', '720p'), '720p');
  assert.equal(sanitizeQuality('1080p60', 'best'), '1080p60');
});

test('binaryResolver accurately reports missing binaries instead of false positives', async () => {
  const missingEnv = await checkEnvironment({
    resourcesPath: null,
    projectRoot: 'C:\\nonexistent',
    env: {},
    existsSync: () => false,
    execFileFn: (_cmd, _args, _opts, cb) => cb(new Error('not found'), '')
  });

  assert.equal(missingEnv.streamlink.installed, false);
  assert.equal(missingEnv.vlc.installed, false);

  const pathEnv = await checkEnvironment({
    resourcesPath: null,
    projectRoot: 'C:\\nonexistent',
    env: {},
    existsSync: () => false,
    execFileFn: (_cmd, args, _opts, cb) => {
      if (args[0] === 'streamlink') {
        cb(null, 'C:\\Custom\\streamlink.exe\r\n');
      } else {
        cb(new Error('missing'), '');
      }
    }
  });

  assert.equal(pathEnv.streamlink.installed, true);
  assert.equal(pathEnv.streamlink.path, 'C:\\Custom\\streamlink.exe');
  assert.equal(pathEnv.vlc.installed, false);
});

test('streamService protects active server from stale child close events and cancels superseded resolves', async () => {
  const closedNotifications = [];
  const spawnedChildren = [];
  const execCalls = [];

  const service = createStreamService({
    onServerClosed: ({ slotId }) => closedNotifications.push(slotId),
    binaryResolver: {
      getStreamlinkPath: () => 'streamlink',
      getStreamlinkPluginArgs: () => ['--plugin-dir', 'plugins']
    },
    execFileFn: (bin, args, _opts, cb) => {
      if (bin === 'taskkill') {
        if (cb) cb(null, '', '');
        return createMockChild(9999);
      }
      const child = createMockChild(2000 + execCalls.length);
      execCalls.push({ child, args, cb });
      return child;
    },
    spawnFn: () => {
      const child = createMockChild(3000 + spawnedChildren.length);
      spawnedChildren.push(child);
      return child;
    }
  });

  // 1. Start Server A on Slot 1, then immediately replace with Server B BEFORE Server A emits 'close'
  const pServerA = service.startSlotServer(1, 'https://example.com/a', 'best');
  const childA = spawnedChildren[0];
  childA.stdout.emit('data', Buffer.from('Starting server: http://127.0.0.1:41111/\n'));
  const resA = await pServerA;
  assert.equal(resA.success, true);
  assert.equal(resA.serverUrl, 'http://127.0.0.1:41111/');

  const pServerB = service.startSlotServer(1, 'https://example.com/b', '720p');
  const childB = spawnedChildren[1];
  // Simulate split stdout chunks for Server B
  childB.stdout.emit('data', Buffer.from('http://127.0.0.1:42'));
  childB.stdout.emit('data', Buffer.from('222/\n'));
  const resB = await pServerB;
  assert.equal(resB.success, true);
  assert.equal(resB.serverUrl, 'http://127.0.0.1:42222/');

  // Delayed close event from killed childA must NOT delete childB or trigger onServerClosed!
  childA.emit('close', 0);
  assert.equal(service.activeServers.has(1), true);
  assert.equal(service.activeServers.get(1).serverUrl, 'http://127.0.0.1:42222/');
  assert.deepEqual(closedNotifications, []);

  // Unexpected close of current childB SHOULD trigger onServerClosed
  childB.emit('close', 1);
  assert.equal(service.activeServers.has(1), false);
  assert.deepEqual(closedNotifications, [1]);

  // 2. Rapid resolveStream calls on Slot 2: first request must be aborted when second starts
  const r1Promise = service.resolveStream({ url: 'https://twitch.tv/slow', slotId: 2 });
  const r2Promise = service.resolveStream({ url: 'https://twitch.tv/fast', slotId: 2 });

  assert.equal(execCalls.length, 2);
  execCalls[0].cb(null, JSON.stringify({ streams: { best: { url: 'https://cdn/slow.m3u8' } } }), '');
  execCalls[1].cb(null, JSON.stringify({ streams: { best: { url: 'https://cdn/fast.m3u8' } } }), '');

  const [r1, r2] = await Promise.all([r1Promise, r2Promise]);
  assert.equal(r1.success, false);
  assert.equal(r1.aborted, true);
  assert.equal(r2.success, true);
  assert.equal(r2.directUrl, 'https://cdn/fast.m3u8');
});

test('vlcService catches asynchronous ENOENT spawn errors cleanly without uncaught exception', async () => {
  const res = await openInVlc(
    { url: 'http://127.0.0.1:50000/', originalUrl: 'https://twitch.tv/test', quality: 'best' },
    {
      binaryResolver: {
        getVlcPath: () => 'missing-vlc',
        getStreamlinkPath: () => 'streamlink',
        getStreamlinkPluginArgs: () => []
      },
      spawnFn: () => {
        const child = createMockChild(4000);
        process.nextTick(() => {
          const err = new Error('spawn missing-vlc ENOENT');
          err.code = 'ENOENT';
          child.emit('error', err);
        });
        return child;
      }
    }
  );

  assert.equal(res.success, false);
  assert.match(res.error, /VLC/);
});
