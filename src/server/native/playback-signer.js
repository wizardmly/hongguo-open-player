// SPDX-License-Identifier: GPL-3.0-only
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const axios = require('axios');
const { PlayerSigner } = require('./argus');

const signatureNames = ['x-argus', 'x-gorgon', 'x-helios', 'x-khronos', 'x-ladon', 'x-medusa'];

function signerError(code = 'PLAYBACK_SIGNER_FAILED') {
    return Object.assign(new Error(code === 'PLAYBACK_SIGNER_MISSING'
        ? '本地播放签名组件缺失，请使用包含签名组件的完整便携包'
        : '本地播放签名组件暂时不可用，请重试本集'), { code });
}

function abortable(promise, signal) {
    if (!signal) return promise;
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

function createPlaybackSigner({ runtimeDir, dataDir, spawnProcess = spawn, post = axios.post } = {}) {
    let current;
    let queue = Promise.resolve();
    let closed = false;

    async function stop(state) {
        if (!state) return;
        if (current === state) current = undefined;
        state.child.kill();
        await state.exited;
    }

    function start(deviceKey) {
        const java = path.join(runtimeDir, 'jre/bin/java.exe');
        const jars = ['domestic-sign.jar', 'unidbg-sign.jar'].map(name => path.join(runtimeDir, 'sign', name));
        const native = path.join(runtimeDir, 'capture/domestic');
        if (![java, ...jars, ...['libmetasec_ml.so', 'libc++_shared.so', 'sdk-metadata.bin'].map(name => path.join(native, name))].every(file => fs.existsSync(file))) {
            throw signerError('PLAYBACK_SIGNER_MISSING');
        }
        fs.mkdirSync(dataDir, { recursive: true });
        const stateDir = fs.mkdtempSync(path.join(dataDir, 'playback-signer-'));
        const temp = path.join(stateDir, 'tmp');
        fs.mkdirSync(temp);
        const child = spawnProcess(java, [
            `-Djava.io.tmpdir=${temp}`, '-cp', jars.join(path.delimiter),
            'com.hongguo.sign.DomesticSigner', native, stateDir,
        ], { cwd: stateDir, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        const state = { child, deviceKey };
        state.exited = new Promise(resolve => {
            child.once('close', () => {
                if (current === state) current = undefined;
                try { fs.rmSync(stateDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch (_) {}
                resolve();
            });
        });
        state.ready = new Promise((resolve, reject) => {
            const timer = setTimeout(() => { child.kill(); reject(signerError()); }, 30000);
            const fail = () => { clearTimeout(timer); reject(signerError()); };
            child.once('error', fail);
            child.once('close', fail);
            let output = '';
            child.stdout.on('data', chunk => {
                output = (output + chunk.toString('utf8')).slice(-1000);
                const match = output.match(/SIGNER_READY 127\.0\.0\.1:(\d+)/);
                if (!match) return;
                clearTimeout(timer);
                resolve(`http://127.0.0.1:${match[1]}/sign`);
            });
        });
        current = state;
        return state;
    }

    async function sign(url, body, signal) {
        signal?.throwIfAborted();
        if (closed) throw signerError();
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password
            || !/(^|\.)(fqnovel\.com|snssdk\.com)$/.test(parsed.hostname)) throw signerError();
        const deviceKey = ['device_id', 'iid'].map(key => parsed.searchParams.get(key));
        if (!deviceKey.every(value => /^\d{1,30}$/.test(value || ''))) throw signerError();
        const key = deviceKey.join(':');
        if (current && current.deviceKey !== key) await stop(current);
        const state = current || start(key);
        try {
            const endpoint = await abortable(state.ready, signal);
            const response = await post(endpoint, { url, body_base64: body.toString('base64') }, {
                proxy: false, timeout: 15000, signal, maxRedirects: 0, maxContentLength: 32768,
            });
            const headers = Object.fromEntries(Object.entries(response.data).map(([name, value]) => [name.toLowerCase(), value]));
            if (!signatureNames.every(name => typeof headers[name] === 'string' && headers[name].length > 0
                && headers[name].length < 16384 && !/[\r\n]/.test(headers[name]))) throw signerError();
            return Object.fromEntries(signatureNames.map(name => [name, headers[name]]));
        } catch (error) {
            if (signal?.aborted) throw signal.reason;
            await stop(state);
            throw signerError();
        }
    }

    return {
        sign(url, body, signal) {
            if (signal?.aborted) return Promise.reject(signal.reason);
            const task = queue.catch(() => {}).then(() => sign(url, body, signal));
            queue = task;
            return abortable(task, signal);
        },
        async shutdown() {
            closed = true;
            await stop(current);
        },
        kill() { closed = true; current?.child.kill(); },
    };
}

let nativeSigner;
function getNativeSigner() {
    if (!nativeSigner) {
        const bundled = process.resourcesPath && path.join(process.resourcesPath, 'playback-signer');
        nativeSigner = createPlaybackSigner({
            runtimeDir: bundled && fs.existsSync(bundled) ? bundled : path.resolve(__dirname, '../../../build/playback-signer/win32-x64'),
            dataDir: process.env.HONGGUO_DATA_DIR || path.resolve(__dirname, '../../../data'),
        });
        process.once('exit', () => nativeSigner.kill());
    }
    return nativeSigner;
}

async function signPlaybackRequest(url, body, signal) {
    if (process.platform === 'win32' && process.arch === 'x64') return getNativeSigner().sign(url, body, signal);
    return PlayerSigner.headers(new URL(url).search.slice(1), body);
}

async function shutdownPlaybackSigner() {
    await nativeSigner?.shutdown();
}

module.exports = { signPlaybackRequest, shutdownPlaybackSigner, createPlaybackSigner };
