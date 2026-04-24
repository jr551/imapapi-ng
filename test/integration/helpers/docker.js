'use strict';

const { execSync, spawnSync } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const IMAGE = 'imapapi-test-dovecot';
const FIXTURE_DIR = path.resolve(__dirname, '..', 'fixtures', 'dovecot');

function sh(cmd, args, opts = {}) {
    const res = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', ...opts });
    return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function ensureImage() {
    const res = sh('docker', ['image', 'inspect', IMAGE]);
    if (res.status === 0) return;
    const build = sh('docker', ['build', '-t', IMAGE, FIXTURE_DIR], { stdio: 'inherit' });
    if (build.status !== 0) throw new Error(`Failed to build test dovecot image`);
}

async function waitForPort(host, port, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            await new Promise((resolve, reject) => {
                const s = net.createConnection({ host, port });
                s.once('connect', () => { s.end(); resolve(); });
                s.once('error', reject);
                s.setTimeout(500, () => { s.destroy(); reject(new Error('timeout')); });
            });
            return true;
        } catch {
            await new Promise((r) => setTimeout(r, 250));
        }
    }
    throw new Error(`${host}:${port} did not become reachable within ${timeoutMs}ms`);
}

async function startDovecot({ hostPort = 0 } = {}) {
    ensureImage();
    // pick a free port if hostPort is 0
    if (!hostPort) {
        hostPort = await new Promise((resolve, reject) => {
            const srv = net.createServer();
            srv.unref();
            srv.on('error', reject);
            srv.listen(0, '127.0.0.1', () => {
                const p = srv.address().port;
                srv.close(() => resolve(p));
            });
        });
    }
    const run = sh('docker', ['run', '-d', '--rm', '-p', `${hostPort}:143`, IMAGE]);
    if (run.status !== 0) throw new Error(`docker run failed: ${run.stderr}`);
    const containerId = run.stdout.trim();
    try {
        await waitForPort('127.0.0.1', hostPort);
    } catch (err) {
        const logs = sh('docker', ['logs', containerId]).stderr;
        sh('docker', ['rm', '-f', containerId]);
        throw new Error(`Dovecot failed to become ready: ${err.message}\n${logs}`);
    }
    return {
        containerId,
        host: '127.0.0.1',
        port: hostPort,
        stop: () => sh('docker', ['rm', '-f', containerId])
    };
}

module.exports = { startDovecot };
