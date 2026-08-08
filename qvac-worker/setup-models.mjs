import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const models = path.resolve(here, '..', 'models')
const downloads = [
  {
    name: 'YOLOv10m detector',
    file: 'yolov10m.onnx',
    url: 'https://github.com/THU-MIG/yolov10/releases/download/v1.1/yolov10m.onnx'
  },
  {
    name: 'MediaPipe Face Landmarker',
    file: 'face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task'
  }
]

async function exists(file) {
  try { await fs.access(file); return true } catch { return false }
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`download failed (${response.status}): ${url}`)
  await pipeline(response.body, createWriteStream(destination))
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)))
  })
}

await fs.mkdir(models, { recursive: true })
for (const item of downloads) {
  const destination = path.join(models, item.file)
  if (await exists(destination)) { console.log(`✓ ${item.name}`); continue }
  const partial = `${destination}.partial`
  console.log(`↓ ${item.name}`)
  try { await download(item.url, partial); await fs.rename(partial, destination) }
  catch (error) { await fs.rm(partial, { force: true }); throw error }
}

const poseDestination = path.join(models, 'rtmpose-ap10k.onnx')
if (await exists(poseDestination)) console.log('✓ RTMPose AP-10K animal pose')
else {
  const temporary = await fs.mkdtemp(path.join(models, '.pose-'))
  const archive = path.join(temporary, 'pose.zip')
  try {
    console.log('↓ RTMPose AP-10K animal pose')
    await download('https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-m_simcc-ap10k_pt-aic-coco_210e-256x256-7a041aa1_20230206.zip', archive)
    await run('unzip', ['-jo', archive, '*.onnx', '-d', temporary])
    const extracted = (await fs.readdir(temporary)).find(file => file.endsWith('.onnx'))
    if (!extracted) throw new Error('RTMPose archive did not contain an ONNX model')
    await fs.rename(path.join(temporary, extracted), poseDestination)
  } finally { await fs.rm(temporary, { recursive: true, force: true }) }
}

console.log(`Models ready in ${models}`)
