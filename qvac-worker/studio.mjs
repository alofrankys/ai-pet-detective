import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  VISIONPSY_MODELS,
  VISIONPSY_WEIGHT_QUANTIZATION,
  createVisionPsyRuntimePool
} from './visionpsy-runtimes.mjs'

const here=path.dirname(fileURLToPath(import.meta.url))
const publicDir=path.join(here,'public')
const port=Number(process.env.PORT||8803)
const runtimePool=createVisionPsyRuntimePool()
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
export const MOMENT_LENS_SAMPLING=Object.freeze({max_tokens:80,temperature:.05,top_p:.25})
export const MOMENT_LENS_PROMPTS=Object.freeze({
  describe:`Describe the clearest visible fact involving the dog, a person, or an object in this image.

Use one short factual sentence.
Describe only what is directly visible.
Do not infer emotion, intention, or what happened before or after.
If the image is unclear, answer UNCLEAR.`,
  objects:`Describe only the clearly visible relationship between the dog and an object in this image.

Use one short factual sentence.
Do not infer an action that requires multiple moments.
If no clear dog-object relationship is visible, answer UNCLEAR.`,
  spatial:`Describe where the dog is relative to the most relevant visible person, object, or furniture.

Use one short factual sentence.
If the spatial relationship is unclear, answer UNCLEAR.`
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
const momentPromptEcho=/\b(?:describe the clearest visible fact involving|describe only the clearly visible relationship between|describe where the dog is relative|use one short factual sentence|describe only what is directly visible|do not infer emotion|do not infer an action that requires multiple moments|if the image is unclear|if no clear dog-object relationship is visible|if the spatial relationship is unclear|answer unclear)\b/i
const momentUnsupportedInference=/\b(?:happy|happily|sad|angry|afraid|scared|excited|anxious|content|playful|curious|feels?|wants?|intends?|trying to|about to|enjoys?|because|previously|earlier|later|before|after|has just|had just|will|soon|seems?|appears to)\b/i

function cleanFactualSentence(value){
  const compact=String(value||'').replace(/\s+/g,' ').trim()
  if(compact.length<12||compact.length>320||structuredOutput.test(compact)||templateLanguage.test(compact)||pipeSeparatedTokens.test(compact))return null
  const sentence=(compact.match(/^.{1,260}?(?:[.!?](?=\s|$)|$)/)?.[0]||'').trim()
  return sentence.length>=12?sentence:null
}

export function sanitizeMomentLensAnswer(value,preset='describe'){
  const raw_answer=String(value??'')
  if(!normalizeMomentLensPreset(preset))return {status:'unclear',answer:null,raw_answer,reason:'unknown_preset'}
  const compact=raw_answer.replace(/\s+/g,' ').trim()
  if(/^UNCLEAR[.!]?$/i.test(compact))return {status:'unclear',answer:null,raw_answer,reason:'model_unclear'}
  if(!compact)return {status:'unclear',answer:null,raw_answer,reason:'empty_response'}
  if(compact.length>320||compact.split(/\s+/).length>45)return {status:'unclear',answer:null,raw_answer,reason:'response_too_long'}
  if(/\b(?:unclear|not clear|cannot determine|can't determine|unable to determine|cannot be described|can't be described|unable to describe|too blurry|image is blurry)\b/i.test(compact))return {status:'unclear',answer:null,raw_answer,reason:'model_unclear'}
  if(/\b(?:no (?:clearly )?(?:visible )?(?:dog|person|object|furniture)|(?:dog|person|object) (?:is|are) not visible|does not (?:show|contain) (?:a |any )?(?:dog|person|object))\b/i.test(compact))return {status:'unclear',answer:null,raw_answer,reason:'no_relevant_visible_fact'}
  if(structuredOutput.test(compact)||templateLanguage.test(compact)||pipeSeparatedTokens.test(compact)||momentPromptEcho.test(compact)||/^(?:[-*]\s+|(?:answer|response|description)\s*:)/i.test(compact))return {status:'unclear',answer:null,raw_answer,reason:'echo_or_template'}
  if(momentUnsupportedInference.test(compact))return {status:'unclear',answer:null,raw_answer,reason:'unsupported_inference'}
  const answer=cleanFactualSentence(compact)
  if(!answer||momentUnsupportedInference.test(answer))return {status:'unclear',answer:null,raw_answer,reason:'not_clean_natural_language'}
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
  return typeof value==='string'?{content:value,usage:null,timings:null}:{
    content:String(value?.content??''),
    usage:value?.usage||null,
    timings:value?.timings||null
  }
}

async function runVariant(spec,request,modelCall,clock,{captureErrors=true}={}){
  const started=Number(clock())
  try{
    const completion=normalizedCompletion(await modelCall(request.api_body,request.request_context,spec))
    return {
      ...modelMetadata(spec),
      inference_ms:Number(Math.max(0,Number(clock())-started).toFixed(1)),
      usage:completion.usage,
      timings:completion.timings,
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
      usage:null,
      timings:null,
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
    flash:modelCalls.flash||((body)=>runtimePool.completion(VISIONPSY_MODELS[0],body)),
    quality:modelCalls.quality||((body)=>runtimePool.completion(VISIONPSY_MODELS[1],body))
  }
  const comparisonStarted=Number(clock())
  const results=[]
  for(const spec of VISIONPSY_MODELS){
    onUpdate({type:'model-start',variant:spec.variant})
    const result=await runVariant(spec,request,calls[spec.variant],clock)
    results.push(result)
    onUpdate({type:'model-result',result})
  }
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
  const call=visionCall||((messages,maxTokens,context)=>runtimePool.completion(spec,{model:'visionpsy',messages,max_tokens:maxTokens,temperature:MOMENT_LENS_SAMPLING.temperature,top_p:MOMENT_LENS_SAMPLING.top_p},context))
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
    if(req.method==='GET'){
      const requested=url.pathname==='/'?'index.html':url.pathname.slice(1)
      if(!['index.html','styles.css','app.js','photo-selection.js'].includes(requested))return json(res,404,{error:'not found'})
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
