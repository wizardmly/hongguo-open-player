const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createPlaybackSigner } = require('../../src/server/native/playback-signer');

const signatures = Object.fromEntries(['Argus', 'Gorgon', 'Helios', 'Khronos', 'Ladon', 'Medusa'].map(name => ['X-' + name, 'signed-' + name]));
const url = device => `https://reading.snssdk.com/novel/player/multi_video_model/player/v1?device_id=${device}&iid=888`;

function fixture(t, post) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-signer-test-'));
    for (const file of ['jre/bin/java.exe', 'sign/domestic-sign.jar', 'sign/unidbg-sign.jar',
        'capture/domestic/libmetasec_ml.so', 'capture/domestic/libc++_shared.so', 'capture/domestic/sdk-metadata.bin']) {
        const target = path.join(root, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, 'fixture');
    }
    const children = [];
    const signer = createPlaybackSigner({
        runtimeDir: root, dataDir: root, post,
        spawnProcess(_command, _args, options) {
            assert.equal(options.windowsHide, true);
            assert.equal(children.filter(child => !child.killed).length, 0, 'old device worker must close before replacement');
            const child = new EventEmitter();
            child.stdout = new EventEmitter();
            child.kill = () => {
                if (child.killed) return;
                child.killed = true;
                queueMicrotask(() => child.emit('close', 0));
            };
            children.push(child);
            queueMicrotask(() => child.stdout.emit('data', Buffer.from('SIGNER_READY 127.0.0.1:12345\n')));
            return child;
        },
    });
    t.after(async () => { await signer.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
    return { signer, children };
}

test('signs the exact compressed bytes and binds each worker to its registered device', async t => {
    const calls = [];
    const { signer, children } = fixture(t, async (endpoint, payload, options) => {
        assert.equal(endpoint, 'http://127.0.0.1:12345/sign');
        assert.equal(options.proxy, false);
        calls.push(payload);
        return { data: signatures };
    });
    const body = Buffer.from([31, 139, 8, 0, 255]);
    const headers = await signer.sign(url('999'), body);
    await signer.sign(url('999'), body);
    assert.equal(children.length, 1);
    await signer.sign(url('777'), body);
    assert.equal(children.length, 2);
    assert.equal(children[0].killed, true);
    assert.equal(headers['x-medusa'], 'signed-Medusa');
    assert.deepEqual(Buffer.from(calls[0].body_base64, 'base64'), body);
    assert.equal(calls[2].url, url('777'));
});

test('serializes signing and discards a cancelled queued request without replacing the worker', async t => {
    let release;
    const started = new Promise(resolve => { release = resolve; });
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    let calls = 0;
    const { signer, children } = fixture(t, async () => {
        calls++;
        release();
        await pending;
        return { data: signatures };
    });
    const first = signer.sign(url('999'), Buffer.from('first'));
    await started;
    const controller = new AbortController();
    const second = signer.sign(url('777'), Buffer.from('second'), controller.signal);
    controller.abort();
    await assert.rejects(second, { name: 'AbortError' });
    finish();
    await first;
    await signer.sign(url('999'), Buffer.from('third'));
    assert.equal(calls, 2);
    assert.equal(children.length, 1);
});

test('restarts after invalid native signatures and rejects requests after shutdown', async t => {
    let calls = 0;
    const { signer, children } = fixture(t, async () => ({ data: ++calls === 1 ? { 'X-Argus': 'incomplete' } : signatures }));
    await assert.rejects(signer.sign(url('999'), Buffer.alloc(0)), { code: 'PLAYBACK_SIGNER_FAILED' });
    assert.equal(children[0].killed, true);
    await signer.sign(url('999'), Buffer.alloc(0));
    assert.equal(children.length, 2);
    await signer.shutdown();
    await assert.rejects(signer.sign(url('999'), Buffer.alloc(0)), { code: 'PLAYBACK_SIGNER_FAILED' });
});
