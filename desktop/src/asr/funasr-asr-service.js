import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { app } from 'electron';
import * as logger from '../utils/logger.js';

const PCM_SAMPLE_RATE = 16000;

function float32ToInt16Buffer(floatArray) {
  const int16Array = new Int16Array(floatArray.length);
  for (let i = 0; i < floatArray.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, floatArray[i]));
    int16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
  }
  return Buffer.from(int16Array.buffer);
}

/**
 * 单个 FunASR Worker 的封装
 * 每个 Worker 处理一个音频源，避免内部状态冲突
 */
class FunASRWorker {
  constructor(workerId, pythonPath, workerScriptPath, options = {}) {
    this.workerId = workerId;
    this.pythonPath = pythonPath;
    this.workerScriptPath = workerScriptPath;
    this.modelName = options.modelName || 'funasr-paraformer';
    this.process = null;
    this.isReady = false;
    this.readyPromise = null;
    this.readyResolver = null;
    this.readyRejecter = null;
    this.onSentenceComplete = options.onSentenceComplete || null;
    this.onPartialResult = options.onPartialResult || null;
    this.onCrash = options.onCrash || null;
  }

  async start() {
    if (this.process) return;

    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolver = resolve;
      this.readyRejecter = reject;
    });

    const env = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      ASR_MODEL: this.modelName,
      PYTHONIOENCODING: 'utf-8',
      FUNASR_WORKER_ID: this.workerId, // 传递 worker ID 用于日志区分
    };

    logger.log(`[FunASR][${this.workerId}] Starting worker: ${this.pythonPath} ${this.workerScriptPath}`);

    this.process = spawn(this.pythonPath, [this.workerScriptPath], { env });

    this.process.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          this.handleMessage(msg);
        } catch (e) {
          // 忽略非 JSON 输出
        }
      }
    });

    this.process.stderr.on('data', (data) => {
      logger.log(`[FunASR][${this.workerId}] ${data.toString().trim()}`);
    });

    this.process.on('close', (code) => {
      logger.warn(`[FunASR][${this.workerId}] Worker exited with code ${code}`);
      this.process = null;
      this.isReady = false;
      if (this.onCrash) {
        this.onCrash(code, this.workerId);
      }
      if (this.readyRejecter) {
        this.readyRejecter(new Error(`Worker ${this.workerId} exited before ready (code ${code})`));
        this.readyRejecter = null;
        this.readyResolver = null;
        this.readyPromise = null;
      }
    });

    if (this.readyPromise) {
      await this.readyPromise;
    }
  }

  handleMessage(msg) {
    if (msg.status === 'ready') {
      logger.log(`[FunASR][${this.workerId}] Worker is ready`);
      this.isReady = true;
      if (this.readyResolver) {
        this.readyResolver();
        this.readyResolver = null;
        this.readyRejecter = null;
        this.readyPromise = null;
      }
    } else if (msg.type === 'partial') {
      if (this.onPartialResult) {
        this.onPartialResult({
          sessionId: msg.session_id,
          partialText: msg.text,
          fullText: msg.full_text,
          timestamp: msg.timestamp,
          isSpeaking: true,
          workerId: this.workerId,
        });
      }
    } else if (msg.type === 'sentence_complete') {
      if (this.onSentenceComplete) {
        this.onSentenceComplete({
          sessionId: msg.session_id,
          text: msg.text,
          timestamp: msg.timestamp,
          trigger: msg.trigger || 'worker',
          audioDuration: msg.audio_duration,
          language: msg.language,
          workerId: this.workerId,
        });
      }
    } else if (msg.error) {
      logger.error(`[FunASR][${this.workerId}] Worker error: ${msg.error}`);
    }
  }

  send(msg) {
    if (this.process && this.process.stdin.writable) {
      this.process.stdin.write(JSON.stringify(msg) + '\n');
    }
  }

  addAudioChunk(audioData, timestamp, sourceId) {
    if (!this.process || !this.isReady) return;
    if (!audioData || audioData.length === 0) return;

    // 简单的静音检测
    let sum = 0;
    for (let i = 0; i < audioData.length; i += 1) {
      sum += Math.abs(audioData[i]);
    }
    const average = sum / audioData.length;
    if (average < 0.0015) return;

    const buffer = float32ToInt16Buffer(audioData);
    const base64Audio = buffer.toString('base64');

    this.send({
      type: 'streaming_chunk',
      session_id: sourceId,
      audio_data: base64Audio,
      timestamp: timestamp,
    });
  }

  forceCommit(sourceId) {
    this.send({
      type: 'force_commit',
      session_id: sourceId,
    });
  }

  resetSession(sourceId) {
    this.send({
      type: 'reset_session',
      session_id: sourceId,
    });
  }

  stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.isReady = false;
  }
}

class FunASRService {
  constructor() {
    this.modelName = 'funasr-paraformer';
    this.pythonPath = this.detectPythonPath();
    // 【并发修复】使用多个 Worker，每个音频源一个独立进程
    this.workers = new Map(); // sourceId -> FunASRWorker
    this.workerProcess = null; // 保留兼容性（单 worker 场景）
    this.isInitialized = false;
    this.onSentenceComplete = null;
    this.onPartialResult = null;
    this.onServerCrash = null;
    this.retainAudioFiles = false;
    this.workerReadyPromise = null;
    this.workerReadyResolver = null;
    this.workerReadyRejecter = null;

    this.tempDir = path.join(app.getPath('temp'), 'asr');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    // Worker 脚本在 backend/asr/ 目录下
    const projectRoot = path.resolve(__dirname, '../..');
    this.workerScriptPath = this.resolveAsarUnpacked(
      path.join(projectRoot, 'backend', 'asr', 'asr_funasr_worker.py')
    );

    logger.log(`[FunASR] Python path: ${this.pythonPath}`);
    logger.log(`[FunASR] Worker script: ${this.workerScriptPath}`);
  }

  /**
   * asar 场景下，Python 进程无法直接读取 asar 内部文件，需要使用解包路径
   */
  resolveAsarUnpacked(targetPath) {
    if (!targetPath) return targetPath;
    return targetPath.includes('app.asar')
      ? targetPath.replace('app.asar', 'app.asar.unpacked')
      : targetPath;
  }

  setServerCrashCallback(callback) {
    this.onServerCrash = callback;
  }

  detectPythonPath() {
    const envPython = process.env.ASR_PYTHON_PATH;
    if (envPython && fs.existsSync(envPython)) {
      return envPython;
    }

    // 优先使用打包内置的 Python（extraResources/python-env）
    const resourcesPath = process.resourcesPath;
    if (resourcesPath) {
      const bundledPython = process.platform === 'win32'
        ? path.join(resourcesPath, 'python-env', 'Scripts', 'python.exe')
        : path.join(resourcesPath, 'python-env', 'bin', 'python3');
      if (fs.existsSync(bundledPython)) {
        return bundledPython;
      }
    }

    // 开发环境或回退：项目根下的 python-env/.venv
    const projectRoot = path.resolve(app.getAppPath(), app.isPackaged ? '..' : '.');
    const venvPython = path.join(projectRoot, 'python-env', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python3');
    if (fs.existsSync(venvPython)) {
      return venvPython;
    }
    const legacyVenv = path.join(projectRoot, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python3');
    if (fs.existsSync(legacyVenv)) {
      return legacyVenv;
    }
    return process.platform === 'win32' ? 'python' : 'python3';
  }

  async initialize(modelName = 'funasr-paraformer', options = {}) {
    if (this.isInitialized) return true;

    this.modelName = modelName || this.modelName;
    this.retainAudioFiles = options.retainAudioFiles || false;
    this.audioStoragePath = options.audioStoragePath || this.tempDir;

    // 检查 Python 环境
    await this.ensureFunASRInstalled();

    // 【并发修复】预先启动两个 Worker（speaker1 和 speaker2）
    // 这样每个音频源有独立的 FunASR 模型实例，避免状态冲突
    await this.startWorkerForSource('speaker1');
    await this.startWorkerForSource('speaker2');

    this.isInitialized = true;
    logger.log('[FunASR] Service initialized with multi-worker architecture');
    return true;
  }

  async ensureFunASRInstalled() {
    try {
      await this.runPythonCommand(['-m', 'pip', 'show', 'funasr']);
      return;
    } catch {
      logger.log('[FunASR] Installing funasr via pip...');
      await this.runPythonCommand(['-m', 'pip', 'install', '--upgrade', 'funasr']);
    }
  }

  /**
   * 为指定的音频源启动一个独立的 Worker
   * @param {string} sourceId - 音频源 ID (speaker1/speaker2)
   */
  async startWorkerForSource(sourceId) {
    if (this.workers.has(sourceId)) {
      const existing = this.workers.get(sourceId);
      if (existing.isReady) {
        return existing;
      }
      // 如果 worker 存在但未就绪，先停止它
      existing.stop();
    }

    logger.log(`[FunASR] Starting dedicated worker for ${sourceId}`);

    const worker = new FunASRWorker(sourceId, this.pythonPath, this.workerScriptPath, {
      modelName: this.modelName,
      onSentenceComplete: (result) => {
        if (this.onSentenceComplete) {
          this.onSentenceComplete(result);
        }
      },
      onPartialResult: (result) => {
        if (this.onPartialResult) {
          this.onPartialResult(result);
        }
      },
      onCrash: (code, workerId) => {
        logger.error(`[FunASR] Worker ${workerId} crashed with code ${code}`);
        this.workers.delete(workerId);
        if (this.onServerCrash) {
          this.onServerCrash(code);
        }
      },
    });

    await worker.start();
    this.workers.set(sourceId, worker);

    // 保持兼容性：将第一个 worker 的进程设置为 workerProcess
    if (!this.workerProcess) {
      this.workerProcess = worker.process;
    }

    return worker;
  }

  /**
   * 获取指定音频源的 Worker（如果不存在则创建）
   * @param {string} sourceId - 音频源 ID
   */
  async getOrCreateWorker(sourceId) {
    if (this.workers.has(sourceId)) {
      const worker = this.workers.get(sourceId);
      if (worker.isReady) {
        return worker;
      }
    }
    return await this.startWorkerForSource(sourceId);
  }

  async addAudioChunk(audioData, timestamp, sourceId = 'default') {
    if (!audioData || audioData.length === 0) return;

    // 简单的静音检测
    if (this.detectSilence(audioData)) return;

    // 【并发修复】获取该音频源专属的 Worker
    let worker = this.workers.get(sourceId);
    if (!worker || !worker.isReady) {
      // 动态创建 Worker（兼容非预定义的 sourceId）
      worker = await this.getOrCreateWorker(sourceId);
    }

    if (worker && worker.isReady) {
      worker.addAudioChunk(audioData, timestamp, sourceId);
    }
  }

  sendToWorker(msg) {
    // 兼容旧代码：根据 session_id 路由到对应的 Worker
    const sourceId = msg.session_id || 'default';
    const worker = this.workers.get(sourceId);
    if (worker) {
      worker.send(msg);
    } else if (this.workerProcess && this.workerProcess.stdin.writable) {
      // 回退到旧的单 worker 模式
      this.workerProcess.stdin.write(JSON.stringify(msg) + '\n');
    }
  }

  detectSilence(audioData) {
    let sum = 0;
    for (let i = 0; i < audioData.length; i += 1) {
      sum += Math.abs(audioData[i]);
    }
    const average = sum / audioData.length;
    return average < 0.0015;
  }

  async forceCommitSentence(sourceId = 'default') {
    const worker = this.workers.get(sourceId);
    if (worker && worker.isReady) {
      worker.forceCommit(sourceId);
    } else {
      // 回退到旧的单 worker 模式
      this.sendToWorker({
        type: 'force_commit',
        session_id: sourceId,
      });
    }
  }

  async commitSentence() {
    return null;
  }

  setSentenceCompleteCallback(callback) {
    this.onSentenceComplete = callback;
  }

  setPartialResultCallback(callback) {
    this.onPartialResult = callback;
  }

  async stop() {
    // 【并发修复】停止所有 Worker
    for (const [sourceId, worker] of this.workers) {
      logger.log(`[FunASR] Stopping worker for ${sourceId}`);
      worker.stop();
    }
    this.workers.clear();
    this.workerProcess = null;
    this.isInitialized = false;
  }

  async destroy() {
    await this.stop();
  }

  async saveAudioFile(audioData, recordId, conversationId, sourceId) {
    if (!this.retainAudioFiles) return null;

    const filename = `${recordId}_${sourceId}.wav`;
    const conversationDir = path.join(this.audioStoragePath, conversationId);
    if (!fs.existsSync(conversationDir)) {
      fs.mkdirSync(conversationDir, { recursive: true });
    }

    const filepath = path.join(conversationDir, filename);
    const float32Array = audioData instanceof Float32Array ? audioData : new Float32Array(audioData);
    const wavBuffer = this.createWavBuffer(float32Array);
    fs.writeFileSync(filepath, wavBuffer);
    return filepath;
  }

  createWavBuffer(audioData) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataLength = audioData.length * bytesPerSample;
    const buffer = Buffer.alloc(44 + dataLength);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataLength, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(PCM_SAMPLE_RATE, 24);
    buffer.writeUInt32LE(PCM_SAMPLE_RATE * blockAlign, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataLength, 40);

    for (let i = 0; i < audioData.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, audioData[i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      buffer.writeInt16LE(int16, 44 + i * 2);
    }

    return buffer;
  }

  clearContext(sourceId) {
    const worker = this.workers.get(sourceId);
    if (worker && worker.isReady) {
      worker.resetSession(sourceId);
    } else {
      // 回退到旧的单 worker 模式
      this.sendToWorker({
        type: 'reset_session',
        session_id: sourceId,
      });
    }
  }

  runPythonCommand(args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.pythonPath, args, {
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
        },
      });

      let stderr = '';

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        reject(error);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr || `Python command failed with exit code ${code}`));
        }
      });
    });
  }
}

export default FunASRService;