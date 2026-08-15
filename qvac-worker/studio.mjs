import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  VISIONPSY_MODELS,
  VISIONPSY_WEIGHT_QUANTIZATION,
  createVisionPsyRuntimePool
} from './visionpsy-runtimes.mjs'

const here=path.dirname(fileURLToPath(import.meta.url))
const publicDir=path.join(here,'public')
const port=Number(process.env.PORT||8803)
const runtimePool=createVisionPsyRuntimePool()
const execFileAsync=promisify(execFile)
let startupPromise=null

const types={
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8'
}

function json(res,status,value){
  res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'})
  res.end(JSON.stringify(value))
}

function ndjson(res,value){res.write(`${JSON.stringify(value)}\n`)}

function readBody(req,limit=5_000_000){
  return new Promise((resolve,reject)=>{
    const chunks=[]
    let size=0
    let settled=false
    const fail=error=>{if(!settled){settled=true;reject(error)}}
    req.on('data',chunk=>{
      if(settled)return
      size+=chunk.length
      if(size>limit)fail(new Error('frame too large'))
      else chunks.push(chunk)
    })
    req.on('end',()=>{if(!settled){settled=true;resolve(Buffer.concat(chunks))}})
    req.on('error',fail)
  })
}

export async function convertHeicToPng(bytes,{run=execFileAsync}={}){
  const input=Buffer.isBuffer(bytes)?bytes:bytes instanceof Uint8Array?Buffer.from(bytes):null
  if(!input?.length)throw new Error('HEIC conversion requires image bytes')
  const temporaryDirectory=await fs.promises.mkdtemp(path.join(os.tmpdir(),'moment-lens-heic-'))
  const sourceFile=path.join(temporaryDirectory,'source.heic')
  const outputFile=`${sourceFile}.png`
  try{
    await fs.promises.writeFile(sourceFile,input)
    await run('qlmanage',['-t','-s','1600','-o',temporaryDirectory,sourceFile],{timeout:30_000})
    const png=await fs.promises.readFile(outputFile)
    if(png.length<8||png[0]!==0x89||png.subarray(1,4).toString()!=='PNG')throw new Error('HEIC conversion produced an invalid image')
    return png
  }finally{
    await fs.promises.rm(temporaryDirectory,{recursive:true,force:true})
  }
}

function ensureAllRuntimes(){
  if(!startupPromise)startupPromise=runtimePool.ensureAll().finally(()=>{startupPromise=null})
  return startupPromise
}

export const MOMENT_LENS_MODEL='VisionPsy-Nano-460M-Flash'
export const MOMENT_LENS_MODELS=Object.freeze(VISIONPSY_MODELS.map(model=>Object.freeze({
  variant:model.variant,
  model:model.displayName,
  short_name:model.shortName,
  quantization:VISIONPSY_WEIGHT_QUANTIZATION,
  model_file:model.modelFile,
  projector_file:model.projectorFile
})))
// Keep deterministic greedy generation for a fair A/B comparison. The initial
// 128-token reference ceiling truncated 67/71 Flash and 38/71 Full responses on
// the real-image set, so Moment Lens uses a shared 256-token safety ceiling.
const configuredMaxTokens=Number.parseInt(process.env.MOMENT_LENS_MAX_TOKENS||'256',10)
export const MOMENT_LENS_SAMPLING=Object.freeze({
  max_tokens:Number.isInteger(configuredMaxTokens)&&configuredMaxTokens>=32&&configuredMaxTokens<=1024?configuredMaxTokens:256,
  temperature:0
})
export const MOMENT_LENS_PROMPTS=Object.freeze({
  describe:`What is visible in this image? Give a detailed natural-language description of the main subject, setting, posture, visible objects, colors, contact, and spatial relationships, including only details that can be seen directly. If the image is too unclear to describe reliably, answer UNCLEAR.`,
  objects:`What objects are visible in this image, and how do they relate to the main subject and to one another? Give a detailed natural-language description of their visible attributes, positions, and contact. Include only details that can be seen directly. If no reliable object relationship is visible, answer UNCLEAR.`,
  spatial:`How are the visible people, animals, objects, furniture, and surroundings arranged in this image? Give a detailed natural-language description of relative positions, distance, overlap, and contact, including only details that can be seen directly. If the spatial arrangement is too unclear to describe reliably, answer UNCLEAR.`
})

// Preserved for integrations that use the original Moment Lens error type.
export class VisionPsyHttpError extends Error{
  constructor({status,body='',visual_mode='single_image',image_count=1}={}){
    const details={status:Number(status)||0,body:String(body||'').slice(0,4000),visual_mode,image_count:Number(image_count)||0}
    super(`VisionPsy HTTP ${details.status}: ${details.body||'empty response body'}`)
    this.name='VisionPsyHttpError'
    Object.assign(this,details)
    this.details=details
  }
}

export function normalizeMomentLensPreset(value){
  const preset=String(value||'').trim().toLowerCase()
  return Object.hasOwn(MOMENT_LENS_PROMPTS,preset)?preset:null
}

export function buildMomentLensRequest({jpeg,preset='describe'}={}){
  const normalizedPreset=normalizeMomentLensPreset(preset)
  if(!normalizedPreset)throw new Error('Unknown Moment Lens preset')
  const bytes=Buffer.isBuffer(jpeg)?jpeg:jpeg instanceof Uint8Array?Buffer.from(jpeg):null
  if(!bytes?.length)throw new Error('Moment Lens requires one JPEG image')
  const prompt=MOMENT_LENS_PROMPTS[normalizedPreset]
  const messages=[{role:'user',content:[
    {type:'image_url',image_url:{url:`data:image/jpeg;base64,${bytes.toString('base64')}`}},
    {type:'text',text:prompt}
  ]}]
  return {
    preset:normalizedPreset,
    prompt,
    messages,
    ...MOMENT_LENS_SAMPLING,
    request_context:{visual_mode:'single_image',image_count:1,preserve_raw:true},
    api_body:{model:'visionpsy',...MOMENT_LENS_SAMPLING,messages}
  }
}

const pipeSeparatedTokens=/\b[a-z][a-z_]{2,}\s*\|\s*[a-z][a-z_]{2,}\b/i
const structuredOutput=/```|[{}\[\]]|"?(?:events?|actor_ref|target_ref|action|confidence|evidence|context|model_?output)"?\s*[:=]|^\s*(?:json|schema|template|output)\s*(?::|=|-|—)/i
const templateLanguage=/<[^>]+>|\b(?:schema|template|placeholder|example json|model output)\b/i
const momentPromptEcho=/\b(?:what is visible in this image|give a detailed natural-language description of the main subject|what objects are visible in this image|how do they relate to the main subject and to one another|how are the visible people, animals, objects, furniture|including only details that can be seen directly|if no reliable object relationship is visible|if the spatial arrangement is too unclear|describe what is directly visible in this image|cover the main subject, setting, posture|use natural language and begin directly with the subject|describe the directly visible relationships between the main subject|describe the directly visible spatial arrangement|describe the clearest visible fact involving|describe only the clearly visible relationship between|describe where the dog is relative|use one short factual sentence|describe only what is directly visible|do not infer emotion|if the image is unclear|answer unclear)\b/i

function cleanNaturalLanguageAnswer(value){
  const answer=String(value||'').replace(/\r\n?/g,'\n').trim()
  const compact=answer.replace(/\s+/g,' ').trim()
  if(compact.length<3||structuredOutput.test(compact)||templateLanguage.test(compact)||pipeSeparatedTokens.test(compact))return null
  return answer
}

export function sanitizeMomentLensAnswer(value,preset='describe'){
  const raw_answer=String(value??'')
  if(!normalizeMomentLensPreset(preset))return {status:'unclear',answer:null,raw_answer,reason:'unknown_preset'}
  const compact=raw_answer.replace(/\s+/g,' ').trim()
  if(/^UNCLEAR[.!]?$/i.test(compact))return {status:'unclear',answer:null,raw_answer,reason:'model_unclear'}
  if(!compact)return {status:'unclear',answer:null,raw_answer,reason:'empty_response'}
  if(structuredOutput.test(compact)||templateLanguage.test(compact)||pipeSeparatedTokens.test(compact)||momentPromptEcho.test(compact)||/^(?:[-*]\s+|(?:answer|response|description)\s*:)/i.test(compact))return {status:'unclear',answer:null,raw_answer,reason:'echo_or_template'}
  const answer=cleanNaturalLanguageAnswer(raw_answer)
  if(!answer)return {status:'unclear',answer:null,raw_answer,reason:'not_clean_natural_language'}
  return {status:'clear',answer,raw_answer,reason:null}
}

function modelMetadata(spec){
  return {
    variant:spec.variant,
    model:spec.displayName,
    short_name:spec.shortName,
    quantization:VISIONPSY_WEIGHT_QUANTIZATION,
    execution:'local',
    privacy:'offline'
  }
}

function normalizedCompletion(value){
  return typeof value==='string'?{content:value,finish_reason:null,usage:null,timings:null,streamed_tokens:null}:{
    content:String(value?.content??''),
    finish_reason:String(value?.finish_reason||'')||null,
    usage:value?.usage||null,
    timings:value?.timings||null,
    streamed_tokens:Number.isSafeInteger(value?.streamed_tokens)?value.streamed_tokens:null
  }
}

function normalizedOutputTokens(usage,timings){
  for(const value of [usage?.completion_tokens,timings?.predicted_n]){
    if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return value
  }
  return null
}

function normalizedTokensPerSecond(timings,outputTokens,inferenceMs,ttftMs){
  const native=Number(timings?.predicted_per_second)
  if(Number.isFinite(native)&&native>=0)return Number(native.toFixed(1))
  if(!Number.isFinite(outputTokens)||!Number.isFinite(inferenceMs))return null
  const generationMs=Math.max(0,inferenceMs-(Number.isFinite(ttftMs)?ttftMs:0))
  return generationMs>0?Number((outputTokens/(generationMs/1000)).toFixed(1)):null
}

function safeStreamingPreview(raw,preset){
  const normalized=String(raw||'').replace(/\r\n?/g,'\n')
  // Only release completed natural-language sentences. This keeps token progress
  // real-time without exposing a schema or prompt echo before it is validated.
  const boundary=Math.max(normalized.lastIndexOf('.'),normalized.lastIndexOf('!'),normalized.lastIndexOf('?'))
  if(boundary<0)return null
  const candidate=normalized.slice(0,boundary+1).trim()
  const sanitized=sanitizeMomentLensAnswer(candidate,preset)
  return sanitized.status==='clear'?sanitized.answer:null
}

async function runVariant(spec,request,modelCall,clock,{captureErrors=true,onProgress=()=>{}}={}){
  const started=Number(clock())
  let rawStream=''
  let preview=''
  let ttftMs=null
  let liveTokens=0
  try{
    const completion=normalizedCompletion(await modelCall(request.api_body,request.request_context,spec,{onDelta:update=>{
      const delta=String(update?.content??'')
      if(delta&&ttftMs===null)ttftMs=Number(Math.max(0,Number(clock())-started).toFixed(1))
      rawStream+=delta
      liveTokens=Number.isSafeInteger(update?.output_tokens)?update.output_tokens:liveTokens+(delta?1:0)
      const nextPreview=safeStreamingPreview(rawStream,request.preset)
      if(nextPreview&&nextPreview!==preview)preview=nextPreview
      onProgress({text:preview,output_tokens:liveTokens,ttft_ms:ttftMs})
    }}))
    const inferenceMs=Number(Math.max(0,Number(clock())-started).toFixed(1))
    const outputTokens=normalizedOutputTokens(completion.usage,completion.timings)??completion.streamed_tokens
    return {
      ...modelMetadata(spec),
      inference_ms:inferenceMs,
      ttft_ms:ttftMs,
      usage:completion.usage,
      timings:completion.timings,
      finish_reason:completion.finish_reason,
      output_tokens:outputTokens,
      tokens_per_second:normalizedTokensPerSecond(completion.timings,outputTokens,inferenceMs,ttftMs),
      ...sanitizeMomentLensAnswer(completion.content,request.preset)
    }
  }catch(error){
    if(!captureErrors)throw error
    return {
      ...modelMetadata(spec),
      status:'error',
      answer:null,
      raw_answer:'',
      reason:'model_error',
      inference_ms:Number(Math.max(0,Number(clock())-started).toFixed(1)),
      ttft_ms:ttftMs,
      usage:null,
      timings:null,
      finish_reason:null,
      output_tokens:null,
      tokens_per_second:null,
      error:String(error?.message||error).slice(0,500)
    }
  }
}

export async function analyseMomentLensPair(
  {jpeg,preset='describe'}={},
  modelCalls={},
  clock=()=>performance.now(),
  onUpdate=()=>{}
){
  const request=buildMomentLensRequest({jpeg,preset})
  const calls={
    flash:modelCalls.flash||((body,_context,_spec,stream)=>runtimePool.completion(VISIONPSY_MODELS[0],body,stream)),
    quality:modelCalls.quality||((body,_context,_spec,stream)=>runtimePool.completion(VISIONPSY_MODELS[1],body,stream))
  }
  const comparisonStarted=Number(clock())
  for(const spec of VISIONPSY_MODELS)onUpdate({type:'model-start',variant:spec.variant})
  const results=await Promise.all(VISIONPSY_MODELS.map(async spec=>{
    const result=await runVariant(spec,request,calls[spec.variant],clock,{onProgress:progress=>onUpdate({type:'model-progress',variant:spec.variant,...progress})})
    onUpdate({type:'model-result',result})
    return result
  }))
  return {
    version:2,
    mode:'moment_lens_compare',
    preset:request.preset,
    quantization:VISIONPSY_WEIGHT_QUANTIZATION,
    total_ms:Number(Math.max(0,Number(clock())-comparisonStarted).toFixed(1)),
    results
  }
}

// Kept as a small compatibility helper for callers that explicitly need one model.
export async function analyseMomentLens({jpeg,preset='describe'}={},visionCall,clock=()=>performance.now()){
  const request=buildMomentLensRequest({jpeg,preset})
  const spec=VISIONPSY_MODELS[0]
  const call=visionCall||((messages,maxTokens,context)=>runtimePool.completion(spec,{model:'visionpsy',messages,...MOMENT_LENS_SAMPLING,max_tokens:maxTokens},context))
  const result=await runVariant(spec,request,(body,context)=>call(body.messages,body.max_tokens,context),clock,{captureErrors:false})
  return {version:1,mode:'moment_lens',preset:request.preset,...result}
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/',`http://127.0.0.1:${port}`)
  try{
    if(req.method==='GET'&&url.pathname==='/api/status'){
      const models=await runtimePool.status()
      if(!models.every(model=>model.ready))ensureAllRuntimes().catch(()=>{})
      return json(res,200,{
        studio:{build:'moment-lens-compare-q4',mode:'single-image-comparison'},
        sampling:MOMENT_LENS_SAMPLING,
        comparison_ready:models.every(model=>model.ready),
        models,
        privacy:'local'
      })
    }
    if(req.method==='POST'&&url.pathname==='/api/moment-lens'){
      const contentType=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase()
      if(contentType!=='image/jpeg')return json(res,415,{error:'Moment Lens accepts one JPEG image'})
      const preset=normalizeMomentLensPreset(req.headers['x-moment-preset'])
      if(!preset)return json(res,400,{error:'Unknown Moment Lens preset'})
      const jpeg=await readBody(req)
      if(jpeg.length<4||jpeg[0]!==0xff||jpeg[1]!==0xd8||jpeg.at(-2)!==0xff||jpeg.at(-1)!==0xd9)return json(res,415,{error:'Invalid JPEG image'})
      res.writeHead(200,{
        'content-type':'application/x-ndjson; charset=utf-8',
        'cache-control':'no-store',
        'x-content-type-options':'nosniff'
      })
      ndjson(res,{type:'comparison-start',models:MOMENT_LENS_MODELS,quantization:VISIONPSY_WEIGHT_QUANTIZATION})
      const result=await analyseMomentLensPair({jpeg,preset},{},()=>performance.now(),event=>ndjson(res,event))
      ndjson(res,{type:'comparison-complete',total_ms:result.total_ms})
      return res.end()
    }
    if(req.method==='POST'&&url.pathname==='/api/photo-preview'){
      const contentType=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase()
      if(!['image/heic','image/heif','application/octet-stream'].includes(contentType))return json(res,415,{error:'Photo preview accepts HEIC or HEIF'})
      const source=await readBody(req,20_000_000)
      const png=await convertHeicToPng(source)
      res.writeHead(200,{
        'content-type':'image/png',
        'content-length':png.length,
        'cache-control':'no-store',
        'x-content-type-options':'nosniff'
      })
      return res.end(png)
    }
    if(req.method==='GET'){
      const requested=url.pathname==='/'?'index.html':url.pathname.slice(1)
      if(!['index.html','styles.css','app.js','photo-selection.js','batch-comparison.js','history-store.js'].includes(requested))return json(res,404,{error:'not found'})
      const file=path.join(publicDir,requested)
      res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','x-studio-build':'moment-lens-compare-q4','cache-control':'no-store'})
      return fs.createReadStream(file).pipe(res)
    }
    return json(res,404,{error:'not found'})
  }catch(error){
    if(res.headersSent){
      ndjson(res,{type:'comparison-error',error:'Moment Lens comparison failed'})
      return res.end()
    }
    const status=String(error?.message||error)==='frame too large'?413:500
    return json(res,status,{error:String(error?.message||error)})
  }
})

let closing=false
async function close(){
  if(closing)return
  closing=true
  await runtimePool.close()
  server.close(()=>process.exit(0))
}
const isMain=path.resolve(process.argv[1]||'')===fileURLToPath(import.meta.url)
if(isMain){
  server.on('error',error=>{
    console.error(`Moment Lens Studio failed: ${error?.message||error}`)
    runtimePool.close().finally(()=>process.exit(1))
  })
  server.listen(port,'127.0.0.1',()=>{
    console.log(`VisionPsy Moment Lens Q4 comparison ready at http://127.0.0.1:${port}`)
    ensureAllRuntimes().catch(()=>{})
  })
  process.on('SIGINT',close)
  process.on('SIGTERM',close)
}
