#!/usr/bin/env node
// dsh-plugin-video-watermark — marca de agua sobre video con ffmpeg.
// Tools: status, apply.

import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const CONFIG_FILE = path.join(DSH_HOME, 'video-watermark', 'config.json');
const CACHE_DIR = path.join(DSH_HOME, 'cache', 'video-watermark');
const READ_ONLY = String(process.env.DSH_WATERMARK_MODE || '').toLowerCase() === 'read-only';
const log = (m) => process.stderr.write(`[watermark] ${m}\n`);

function loadConfig() { try { if (existsSync(CONFIG_FILE)) return { allowedPaths: [], ffmpegPath: '', ffprobePath: '', ...(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {}) }; } catch { /* defaults */ } return { allowedPaths: [], ffmpegPath: '', ffprobePath: '' }; }
function allowedRoots() { const configured = loadConfig().allowedPaths; return (Array.isArray(configured) && configured.length ? configured : [process.env.USERPROFILE || process.env.HOME || os.homedir()]).map((item) => path.resolve(item)); }
function isAllowed(target) { const resolved = path.resolve(target); return resolved === CACHE_DIR || resolved.startsWith(CACHE_DIR + path.sep) || allowedRoots().some((root) => resolved === root || resolved.startsWith(root + path.sep)); }
function findBin(key, name) {
  const configured = loadConfig()[key];
  if (configured && existsSync(configured)) return configured;
  for (const candidate of [name, `${name}.exe`]) { const result = spawnSync(candidate, ['-version'], { encoding: 'utf8', timeout: 8000, windowsHide: true }); if (result.status === 0) return candidate; }
  return null;
}
function probeDuration(ffprobe, file) {
  const result = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  return result.status === 0 ? Number(String(result.stdout).trim()) || null : null;
}
function textResult(text) { return { content: [{ type: 'text', text }] }; }

function buildInstructions() {
  return [
    'Video Watermark: superpone una imagen como marca de agua sobre un video.',
    '',
    `Salida: ${CACHE_DIR}`,
    '',
    'Herramientas: status, apply.',
    '',
    'Reglas:',
    '- apply requiere confirm:true y reencodea el video (puede tardar).',
    '- Posiciones: tl, tr, bl, br, center; opacidad 0-1.',
    '- Respeta allowedPaths y no sobrescribe (sufijo único).',
    '- Reporta ruta, duración y tamaño reales del resultado.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-video-watermark', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });
  server.registerTool('status', { title: 'Estado', description: 'ffmpeg/ffprobe, rutas y modo.', inputSchema: z.object({}) }, async () => textResult([`ffmpeg: ${findBin('ffmpegPath', 'ffmpeg') || 'NO encontrado'}`, `ffprobe: ${findBin('ffprobePath', 'ffprobe') || 'NO encontrado'}`, `Rutas permitidas: ${allowedRoots().join(', ')}`, `Salida: ${CACHE_DIR}`, `Modo: ${READ_ONLY ? 'read-only' : 'normal'}`].join('\n')));
  server.registerTool('apply', { title: 'Aplicar marca de agua', description: 'Superpone imagen sobre video. Requiere confirm:true.', inputSchema: z.object({ video: z.string().min(2), watermark: z.string().min(2), output: z.string().optional(), position: z.enum(['tl', 'tr', 'bl', 'br', 'center']).optional(), opacity: z.number().min(0.05).max(1).optional(), margin: z.number().int().min(0).max(500).optional(), confirm: z.boolean().optional() }) }, async (args) => {
    if (READ_ONLY) throw new Error('modo read-only: apply deshabilitado');
    if (args.confirm !== true) throw new Error('apply requiere confirm:true y pedido explícito');
    const ffmpeg = findBin('ffmpegPath', 'ffmpeg');
    const ffprobe = findBin('ffprobePath', 'ffprobe');
    if (!ffmpeg) throw new Error('ffmpeg no encontrado');
    for (const [file, label] of [[args.video, 'video'], [args.watermark, 'watermark']]) {
      const resolved = path.resolve(file);
      if (!existsSync(resolved)) throw new Error(`${label} no existe: ${resolved}`);
      if (!isAllowed(resolved)) throw new Error(`${label} fuera de allowedPaths: ${resolved}`);
    }
    const margin = args.margin ?? 16;
    const position = args.position || 'br';
    const positions = { tl: `${margin}:${margin}`, tr: `main_w-overlay_w-${margin}:${margin}`, bl: `${margin}:main_h-overlay_h-${margin}`, br: `main_w-overlay_w-${margin}:main_h-overlay_h-${margin}`, center: `(main_w-overlay_w)/2:(main_h-overlay_h)/2` };
    const opacity = args.opacity ?? 0.7;
    const filter = `[1:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[wm];[0:v][wm]overlay=${positions[position]}:format=auto`;
    const target = args.output ? path.resolve(args.output) : path.join(CACHE_DIR, `${path.basename(args.video, path.extname(args.video))}-wm.mp4`);
    if (!isAllowed(target)) throw new Error(`ruta de salida no permitida: ${target}`);
    mkdirSync(path.dirname(target), { recursive: true });
    let file = target;
    for (let index = 1; existsSync(file) && index < 1000; index++) file = path.join(path.dirname(target), `${path.basename(target, path.extname(target))}-${index}.mp4`);
    const started = Date.now();
    const result = spawnSync(ffmpeg, ['-y', '-v', 'error', '-i', args.video, '-i', args.watermark, '-filter_complex', filter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', file], { encoding: 'utf8', timeout: 600000, windowsHide: true });
    if (result.status !== 0 || !existsSync(file)) throw new Error(`ffmpeg falló: ${(result.stderr || '').trim().slice(0, 300)}`);
    const size = statSync(file).size;
    const duration = ffprobe ? probeDuration(ffprobe, file) : null;
    return textResult([`Listo: ${file}`, `Posición: ${position} · opacidad ${opacity} · ${(size / 1024 / 1024).toFixed(2)} MB${duration ? ` · ${duration.toFixed(2)} s` : ''}`, `Tiempo: ${((Date.now() - started) / 1000).toFixed(1)} s`].join('\n'));
  });
  return server;
}

try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignora */ }
log(`modo: ${READ_ONLY ? 'read-only' : 'normal'}`);
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
