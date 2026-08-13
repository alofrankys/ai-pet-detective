import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here=path.dirname(fileURLToPath(import.meta.url))
const root=path.resolve(here,'..')
const publicDir=path.join(here,'public')
const port=Number(process.env.PORT||8803)
let visionpsyEndpoint=process.env.VISIONPSY_ENDPOINT||'http://127.0.0.1:8788/v1/chat/completions'
const visionpsyDebug=process.env.DEBUG_VISIONPSY==='1'
let visionpsyReady=false
let visionpsyStartPromise=null

const types={
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8'
}

function json(res,status,value){
  res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'})
  res.end(JSON.stringify(value))
}

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

function visionpsyBaseUrl(){
  try{return new URL(visionpsyEndpoint).origin}catch{return 'http://127.0.0.1:8788'}
}

async function visionpsyHealth(){
  try{
    const response=await fetch(`${visionpsyBaseUrl()}/health`,{signal:AbortSignal.timeout(1500)})
    visionpsyReady=response.ok
  }catch{visionpsyReady=false}
  return visionpsyReady
}

async function ensureVisionPsy(){
  if(await visionpsyHealth())return true
  if(visionpsyStartPromise)return visionpsyStartPromise
  visionpsyStartPromise=(async()=>{
    const loader=path.resolve(root,'../visionpsy-twinpaws/shared/load-vlm.mjs')
    if(!fs.existsSync(loader))return false
    try{
      const {loadTwinPawsVlm}=await import(loader)
      const runtime=await loadTwinPawsVlm()
      visionpsyEndpoint=`${runtime.baseUrl}/v1/chat/completions`
      return await visionpsyHealth()
    }catch(error){
      if(visionpsyDebug)console.error('[VisionPsy startup]',error)
      return false
    }
  })().finally(()=>{visionpsyStartPromise=null})
  return visionpsyStartPromise
}

export class VisionPsyHttpError extends Error{
  constructor({status,body='',visual_mode='single_image',image_count=1}={}){
    const details={status:Number(status)||0,body:String(body||'').slice(0,4000),visual_mode,image_count:Number(image_count)||0}
    super(`VisionPsy HTTP ${details.status}: ${details.body||'empty response body'}`)
    this.name='VisionPsyHttpError'
    Object.assign(this,details)
    this.details=details
  }
}

async function callVisionPsy(messages,max_tokens=80,requestContext={}){
  if(!visionpsyReady&&!(await ensureVisionPsy()))throw new Error('VisionPsy local endpoint unavailable')
  const imageCount=messages.flatMap(message=>Array.isArray(message.content)?message.content:[]).filter(item=>item?.type==='image_url').length
  if(imageCount!==1)throw new Error('Moment Lens requires exactly one image')
  const response=await fetch(visionpsyEndpoint,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({model:'visionpsy',max_tokens,temperature:.05,top_p:.25,messages}),
    signal:AbortSignal.timeout(45_000)
  })
  const responseBody=await response.text()
  if(!response.ok)throw new VisionPsyHttpError({status:response.status,body:responseBody,visual_mode:'single_image',image_count:imageCount})
  const payload=JSON.parse(responseBody)
  const content=String(payload?.choices?.[0]?.message?.content||'')
  return requestContext.preserve_raw?content:content.replace(/\s+/g,' ').trim()
}

export const MOMENT_LENS_MODEL='VisionPsy-Nano-460M-Flash'
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
  return {
    preset:normalizedPreset,
    prompt,
    messages:[{role:'user',content:[
      {type:'image_url',image_url:{url:`data:image/jpeg;base64,${bytes.toString('base64')}`}},
      {type:'text',text:prompt}
    ]}],
    max_tokens:80,
    request_context:{visual_mode:'single_image',image_count:1,preserve_raw:true}
  }
}

const pipeSeparatedTokens=/\b[a-z][a-z_]{2,}\s*\|\s*[a-z][a-z_]{2,}\b/i
const structuredOutput=/```|[{}\[\]]|"(?:events?|actor_ref|target_ref|action|confidence|evidence|context)"\s*:|^\s*(?:json|schema|template|output)\s*:/i
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
  if(/\b(?:unclear|not clear|cannot determine|can't determine|unable to determine)\b/i.test(compact))return {status:'unclear',answer:null,raw_answer,reason:'model_unclear'}
  if(/\b(?:no (?:clearly )?(?:visible )?(?:dog|person|object|furniture)|(?:dog|person|object) (?:is|are) not visible|does not (?:show|contain) (?:a |any )?(?:dog|person|object))\b/i.test(compact))return {status:'unclear',answer:null,raw_answer,reason:'no_relevant_visible_fact'}
  if(structuredOutput.test(compact)||templateLanguage.test(compact)||pipeSeparatedTokens.test(compact)||momentPromptEcho.test(compact)||/^(?:[-*]\s+|(?:answer|response|description)\s*:)/i.test(compact))return {status:'unclear',answer:null,raw_answer,reason:'echo_or_template'}
  if(momentUnsupportedInference.test(compact))return {status:'unclear',answer:null,raw_answer,reason:'unsupported_inference'}
  const answer=cleanFactualSentence(compact)
  if(!answer||momentUnsupportedInference.test(answer))return {status:'unclear',answer:null,raw_answer,reason:'not_clean_natural_language'}
  return {status:'clear',answer,raw_answer,reason:null}
}

export async function analyseMomentLens({jpeg,preset='describe'}={},visionCall=callVisionPsy,clock=()=>performance.now()){
  const request=buildMomentLensRequest({jpeg,preset})
  const started=Number(clock())
  const raw=await visionCall(request.messages,request.max_tokens,request.request_context)
  const inference_ms=Number(Math.max(0,Number(clock())-started).toFixed(1))
  return {
    version:1,
    mode:'moment_lens',
    preset:request.preset,
    model:MOMENT_LENS_MODEL,
    execution:'local',
    privacy:'offline',
    inference_ms,
    ...sanitizeMomentLensAnswer(raw,request.preset)
  }
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/',`http://127.0.0.1:${port}`)
  try{
    if(req.method==='GET'&&url.pathname==='/api/status'){
      await ensureVisionPsy()
      return json(res,200,{
        studio:{build:'moment-lens-v1',mode:'single-image'},
        visionpsy:{enabled:visionpsyReady,model:MOMENT_LENS_MODEL,engine:visionpsyReady?'VisionPsy local':'starting or not connected'},
        privacy:'local'
      })
    }
    if(req.method==='POST'&&url.pathname==='/api/moment-lens'){
      const contentType=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase()
      if(contentType!=='image/jpeg')return json(res,415,{error:'Moment Lens accepts one JPEG image'})
      const preset=normalizeMomentLensPreset(req.headers['x-moment-preset'])
      if(!preset)return json(res,400,{error:'Unknown Moment Lens preset'})
      if(!visionpsyReady&&!(await ensureVisionPsy()))return json(res,503,{error:'VisionPsy local endpoint not ready'})
      const jpeg=await readBody(req)
      if(jpeg.length<4||jpeg[0]!==0xff||jpeg[1]!==0xd8||jpeg.at(-2)!==0xff||jpeg.at(-1)!==0xd9)return json(res,415,{error:'Invalid JPEG image'})
      return json(res,200,await analyseMomentLens({jpeg,preset}))
    }
    if(req.method==='GET'){
      const requested=url.pathname==='/'?'index.html':url.pathname.slice(1)
      if(!['index.html','styles.css','app.js'].includes(requested))return json(res,404,{error:'not found'})
      const file=path.join(publicDir,requested)
      res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','x-studio-build':'moment-lens-v1','cache-control':'no-store'})
      return fs.createReadStream(file).pipe(res)
    }
    return json(res,404,{error:'not found'})
  }catch(error){
    const status=String(error?.message||error)==='frame too large'?413:500
    return json(res,status,{error:String(error?.message||error),...(error?.details?{details:error.details}:{})})
  }
})

function close(){server.close(()=>process.exit(0))}
const isMain=path.resolve(process.argv[1]||'')===fileURLToPath(import.meta.url)
if(isMain){
  ensureVisionPsy().catch(()=>{})
  server.listen(port,'127.0.0.1',()=>console.log(`VisionPsy Moment Lens ready at http://127.0.0.1:${port}`))
  process.on('SIGINT',close)
  process.on('SIGTERM',close)
}
