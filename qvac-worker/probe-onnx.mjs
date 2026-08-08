import onnx from '@qvac/onnx'

const model = Bare.argv?.[2]
if (!model) throw new Error('Usage: bare probe-onnx.mjs /absolute/model.onnx')

onnx.configureEnvironment({ loggingLevel: 'error' })
const started = Date.now()
const session = onnx.createSession(model, { provider: 'auto_gpu' })
const inputs = onnx.getInputInfo(session)
const outputs = onnx.getOutputInfo(session)
const loadMs = Date.now() - started

const tensors = inputs.map((input) => {
  const shape = input.shape.map((value) => Number(value) > 0 ? Number(value) : 1)
  const length = shape.reduce((total, value) => total * value, 1)
  return { name: input.name, shape, type: 'float32', data: new Float32Array(length) }
})

const inferenceStarted = Date.now()
const result = onnx.run(session, tensors)
console.log(JSON.stringify({ model, loadMs, inferenceMs: Date.now() - inferenceStarted, inputs, outputs, result: result.map((item) => ({ name: item.name, shape: item.shape, type: item.type, length: item.data.length })) }, null, 2))
