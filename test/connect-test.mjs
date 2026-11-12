// Test end-to-end de video-watermark con ffmpeg.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
const home = path.join(tmpDir, 'dsh-home');
const mediaDir = path.join(tmpDir, 'media');
mkdirSync(path.join(home, 'video-watermark'), { recursive: true });
mkdirSync(mediaDir, { recursive: true });
writeFileSync(path.join(home, 'video-watermark', 'config.json'), JSON.stringify({ allowedPaths: [tmpDir] }), 'utf8');
if (spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status !== 0) { console.log('ffmpeg no disponible; test omitido (OK)'); process.exit(0); }
const make = (args, label) => { const result = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args], { encoding: 'utf8' }); if (result.status !== 0) throw new Error(`${label}: ${result.stderr}`); };
const video = path.join(mediaDir, 'video.mp4');
make(['-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=10', '-pix_fmt', 'yuv420p', video], 'video');
const watermark = path.join(mediaDir, 'marca.png');
make(['-f', 'lavfi', '-i', 'color=c=red:s=32x32', '-frames:v', '1', watermark], 'marca');

function makeClient(extraEnv = {}) {
  const entry = process.env.WATERMARK_SERVER ? path.resolve(process.env.WATERMARK_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: home, ...extraEnv }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'watermark-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
const status = textOf(await client.callTool({ name: 'status', arguments: {} }));
console.log('--- status ---'); console.log(status);
console.log('ffmpeg detectado:', status.includes('ffmpeg') && !status.includes('NO encontrado'));
const noConfirm = await client.callTool({ name: 'apply', arguments: { video, watermark, output: path.join(tmpDir, 'wm.mp4') } });
console.log('apply sin confirm isError:', noConfirm.isError === true);
const applied = await client.callTool({ name: 'apply', arguments: { video, watermark, output: path.join(tmpDir, 'wm.mp4'), position: 'tr', opacity: 0.5, confirm: true } });
const appliedText = textOf(applied);
console.log('--- apply ---'); console.log(appliedText);
const outFile = appliedText.replace('Listo: ', '').split('\n')[0];
console.log('archivo creado:', existsSync(outFile));
const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', outFile], { encoding: 'utf8' });
console.log('mantiene 160x120:', probe.stdout.trim().replace(/\s/g, '') === '160,120');
const duration = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outFile], { encoding: 'utf8' }).stdout.trim();
console.log('duración ~1s:', Math.abs(Number(duration) - 1) < 0.3);
const outside = await client.callTool({ name: 'apply', arguments: { video: 'C:\\Windows\\no.mp4', watermark, confirm: true } });
console.log('video fuera isError:', outside.isError === true);
await client.close(); try { await transport.close?.(); } catch {}
const { client: roClient, transport: roTransport } = await makeClient({ DSH_WATERMARK_MODE: 'read-only' });
const roApply = await roClient.callTool({ name: 'apply', arguments: { video, watermark, confirm: true } });
console.log('read-only apply isError:', roApply.isError === true);
await roClient.close(); try { await roTransport.close?.(); } catch {}
console.log('OK');
