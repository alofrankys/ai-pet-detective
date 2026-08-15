import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const here=path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot=path.resolve(here,'..')
const siblingRoot=path.resolve(repositoryRoot,'../visionpsy-twinpaws')

export const VISIONPSY_WEIGHT_QUANTIZATION='Q4_K_M-imat'
export const VISIONPSY_MODELS=Object.freeze([
  Object.freeze({
    variant:'flash',
    displayName:'VisionPsy-Nano-460M-Flash',
    shortName:'Flash',
    alias:'visionpsy-flash-q4',
    port:Number(process.env.VISIONPSY_FLASH_PORT||8788),
    modelFile:'visionpsy-nano-460m-flash-q4_k_m-imat.gguf',
    projectorFile:'mmproj-visionpsy-nano-460m-flash-q8.gguf',
    expectedModelBytes:303_143_488,
    expectedProjectorBytes:108_782_144,
    expectedModelSha256:'90b0abe16180f1fe5918bc5d89c3b6eeaf40520a50f906d6303a59a32b699fbc',
    expectedProjectorSha256:'bbb0691873a4e638f6928898b3c3be9a4730bd4ced301197726a4fcb549695d0',
    modelUrl:'https://huggingface.co/qvac/VisionPsy-Nano-460M-Flash-GGUFs/resolve/main/visionpsy-nano-460m-flash-q4_k_m-imat.gguf',
    projectorUrl:'https://huggingface.co/qvac/VisionPsy-Nano-460M-Flash-GGUFs/resolve/main/mmproj-visionpsy-nano-460m-flash-q8.gguf'
  }),
  Object.freeze({
    variant:'quality',
    displayName:'VisionPsy-Nano-460M',
    shortName:'Full',
    alias:'visionpsy-quality-q4',
    port:Number(process.env.VISIONPSY_QUALITY_PORT||8789),
    modelFile:'visionpsy-nano-460m-q4_k_m-imat.gguf',
    projectorFile:'mmproj-visionpsy-nano-460m-q8.gguf',
    expectedModelBytes:303_143_488,
    expectedProjectorBytes:108_782_144,
    expectedModelSha256:'41794b9f501e30f44f19c8be4b87b965db77fbd3e4c7625291999cff7966db8a',
    expectedProjectorSha256:'92f1bb80acaba3e7b59b6534f47447b830330bc9051018d6d8b5d768e58503c2',
    modelUrl:'https://huggingface.co/qvac/VisionPsy-Nano-460M-GGUFs/resolve/main/visionpsy-nano-460m-q4_k_m-imat.gguf',
    projectorUrl:'https://huggingface.co/qvac/VisionPsy-Nano-460M-GGUFs/resolve/main/mmproj-visionpsy-nano-460m-q8.gguf'
  })
])

export function modelByVariant(value){
  return VISIONPSY_MODELS.find(model=>model.variant===value)||null
}

const integrityCache=new Map()

function sha256File(file){
  const hash=createHash('sha256')
  const buffer=Buffer.allocUnsafe(1024*1024)
  const fd=fs.openSync(file,'r')
  try{
    let bytesRead=0
    do{
      bytesRead=fs.readSync(fd,buffer,0,buffer.length,null)
      if(bytesRead)hash.update(buffer.subarray(0,bytesRead))
    }while(bytesRead)
    return hash.digest('hex')
  }finally{fs.closeSync(fd)}
}

function validFile(file,expectedBytes,expectedSha256){
  try{
    const state=fs.statSync(file)
    if(state.size!==expectedBytes)return false
    const cacheKey=`${state.dev}:${state.ino}:${state.size}:${state.mtimeMs}`
    const cached=integrityCache.get(file)
    if(cached?.key===cacheKey)return cached.sha256===expectedSha256
    const sha256=sha256File(file)
    integrityCache.set(file,{key:cacheKey,sha256})
    return sha256===expectedSha256
  }catch{return false}
}

export function resolveVisionPsyArtifacts(spec,{modelRoots}={}){
  const roots=modelRoots||[
    path.join(repositoryRoot,'models'),
    path.join(siblingRoot,'models')
  ]
  for(const root of roots){
    const modelPath=path.resolve(root,spec.modelFile)
    const projectorPath=path.resolve(root,spec.projectorFile)
    if(
      validFile(modelPath,spec.expectedModelBytes,spec.expectedModelSha256)
      &&validFile(projectorPath,spec.expectedProjectorBytes,spec.expectedProjectorSha256)
    ){
      return {modelPath,projectorPath,root:path.resolve(root)}
    }
  }
  return null
}

function endpointFor(spec){
  const baseUrl=`http://127.0.0.1:${spec.port}`
  return {baseUrl,completionUrl:`${baseUrl}/v1/chat/completions`}
}

async function responseJson(fetchImpl,url,timeoutMs=1800){
  const response=await fetchImpl(url,{signal:AbortSignal.timeout(timeoutMs)})
  if(!response.ok)throw new Error(`${url} returned ${response.status}`)
  return response.json()
}

export async function inspectVisionPsyRuntime(spec,{fetchImpl=fetch}={}){
  const endpoint=endpointFor(spec)
  try{
    const health=await fetchImpl(`${endpoint.baseUrl}/health`,{signal:AbortSignal.timeout(1500)})
    if(!health.ok)return {...endpoint,ready:false,reason:'unhealthy'}
  }catch{return {...endpoint,ready:false,reason:'not_listening'}}
  try{
    const [models,props]=await Promise.all([
      responseJson(fetchImpl,`${endpoint.baseUrl}/v1/models`),
      responseJson(fetchImpl,`${endpoint.baseUrl}/props`)
    ])
    const modelPath=String(props?.model_path||'')
    const loadedFile=path.basename(modelPath)
    const ids=[
      ...(Array.isArray(models?.data)?models.data.map(item=>item?.id):[]),
      ...(Array.isArray(models?.models)?models.models.flatMap(item=>[item?.name,item?.model]):[]),
      props?.model_alias
    ].filter(Boolean).map(String)
    const correctFile=loadedFile===spec.modelFile
    const vision=props?.modalities?.vision===true
    const correctIdentity=correctFile&&vision&&ids.some(id=>id===spec.alias||id===spec.modelFile)
    return {
      ...endpoint,
      ready:correctIdentity,
      reason:correctIdentity?null:'wrong_model',
      loadedFile:loadedFile||ids[0]||null,
      alias:String(props?.model_alias||ids[0]||''),
      modelPath:modelPath||null,
      build:String(props?.build_info||''),
      vision
    }
  }catch(error){
    return {...endpoint,ready:false,reason:'identity_unavailable',error:String(error?.message||error)}
  }
}

export async function parseVisionPsyEventStream(body,{onDelta=()=>{}}={}){
  if(!body?.getReader)throw new Error('VisionPsy streaming response unavailable')
  const reader=body.getReader()
  const decoder=new TextDecoder()
  let buffer=''
  let content=''
  let finishReason=null
  let usage=null
  let timings=null
  let streamedTokens=0
  const consume=line=>{
    const trimmed=line.trim()
    if(!trimmed.startsWith('data:'))return false
    const data=trimmed.slice(5).trim()
    if(!data||data==='[DONE]')return data==='[DONE]'
    const payload=JSON.parse(data)
    const delta=String(payload?.choices?.[0]?.delta?.content??'')
    if(delta){
      content+=delta
      streamedTokens++
      onDelta({content:delta,output_tokens:streamedTokens})
    }
    const reason=payload?.choices?.[0]?.finish_reason
    if(reason)finishReason=String(reason)
    if(payload?.usage)usage=payload.usage
    if(payload?.timings)timings=payload.timings
    return false
  }
  let doneEvent=false
  while(!doneEvent){
    const {done,value}=await reader.read()
    buffer+=decoder.decode(value||new Uint8Array(),{stream:!done})
    const lines=buffer.split(/\r?\n/)
    buffer=lines.pop()||''
    for(const line of lines){
      if(consume(line)){doneEvent=true;break}
    }
    if(done)break
  }
  if(buffer.trim()&&!doneEvent)consume(buffer)
  return {content,finish_reason:finishReason,usage,timings,streamed_tokens:streamedTokens}
}

export function createVisionPsyRuntimePool({
  fetchImpl=fetch,
  spawnImpl=spawn,
  modelRoots,
  runtimeBin=process.env.VISIONPSY_RUNTIME_BIN||path.join(siblingRoot,'vendor/llama-mtmd-metal/bin/llama-server'),
  startupTimeoutMs=120_000,
  completionTimeoutMs=Number(process.env.VISIONPSY_COMPLETION_TIMEOUT_MS||90_000),
  logDir=path.join(os.tmpdir(),'visionpsy-moment-lens')
}={}){
  const children=new Map()
  const starts=new Map()

  function artifactState(spec){
    const artifacts=resolveVisionPsyArtifacts(spec,{modelRoots})
    if(!artifacts)return {ready:false,reason:'models_missing',artifacts:null}
    try{
      if(!fs.statSync(runtimeBin).isFile())return {ready:false,reason:'runtime_missing',artifacts}
    }catch{return {ready:false,reason:'runtime_missing',artifacts}}
    return {ready:true,reason:null,artifacts}
  }

  async function inspect(spec){
    const local=artifactState(spec)
    if(!local.ready)return {...local,spec}
    return {...await inspectVisionPsyRuntime(spec,{fetchImpl}),artifacts:local.artifacts,spec}
  }

  async function start(spec){
    const existing=await inspect(spec)
    if(existing.ready)return existing
    if(existing.reason==='wrong_model'){
      throw new Error(`${spec.shortName} port ${spec.port} is occupied by ${existing.loadedFile||'another model'}`)
    }
    if(existing.reason==='models_missing')throw new Error(`${spec.shortName} Q4 model files are missing`)
    if(existing.reason==='runtime_missing')throw new Error('VisionPsy llama-server runtime is missing')
    fs.mkdirSync(logDir,{recursive:true})
    const endpoint=endpointFor(spec)
    let logFd=null
    let child=null
    try{
      logFd=fs.openSync(path.join(logDir,`${spec.variant}.log`),'a')
      child=spawnImpl(runtimeBin,[
        '-m',existing.artifacts.modelPath,
        '--mmproj',existing.artifacts.projectorPath,
        '--host','127.0.0.1',
        '--port',String(spec.port),
        '-c','2048',
        '-ngl','99',
        '--parallel','1',
        '--alias',spec.alias,
        '--no-ui'
      ],{
        stdio:['ignore',logFd,logFd],
        env:{...process.env,DYLD_LIBRARY_PATH:[path.dirname(runtimeBin),process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':')}
      })
      let spawnError=null
      child.once('error',error=>{spawnError=error})
      children.set(spec.variant,{child,logFd})
      child.once('exit',()=>{
        const current=children.get(spec.variant)
        if(current?.child===child){
          children.delete(spec.variant)
          try{fs.closeSync(logFd)}catch{}
        }
      })
      const started=Date.now()
      while(Date.now()-started<startupTimeoutMs){
        if(spawnError)throw spawnError
        if(child.exitCode!==null)throw new Error(`${spec.shortName} runtime exited with code ${child.exitCode}`)
        const state=await inspectVisionPsyRuntime(spec,{fetchImpl})
        if(state.ready)return {...state,artifacts:existing.artifacts,spec}
        if(state.reason==='wrong_model')throw new Error(`${spec.shortName} runtime loaded ${state.loadedFile||'the wrong model'}`)
        await new Promise(resolve=>setTimeout(resolve,250))
      }
      throw new Error(`${spec.shortName} runtime did not become ready at ${endpoint.baseUrl}`)
    }catch(error){
      children.delete(spec.variant)
      if(child?.exitCode===null)child.kill('SIGTERM')
      if(logFd!==null){try{fs.closeSync(logFd)}catch{}}
      throw error
    }
  }

  async function ensure(spec){
    if(starts.has(spec.variant))return starts.get(spec.variant)
    const promise=start(spec).finally(()=>starts.delete(spec.variant))
    starts.set(spec.variant,promise)
    return promise
  }

  async function ensureAll(){
    const states=[]
    for(const spec of VISIONPSY_MODELS){
      try{states.push(await ensure(spec))}
      catch(error){states.push({...await inspect(spec),error:String(error?.message||error)})}
    }
    return states
  }

  async function status(){
    return Promise.all(VISIONPSY_MODELS.map(async spec=>{
      const state=await inspect(spec)
      return {
        variant:spec.variant,
        name:spec.displayName,
        short_name:spec.shortName,
        quantization:VISIONPSY_WEIGHT_QUANTIZATION,
        ready:state.ready,
        reason:state.reason,
        loaded_file:state.loadedFile||null,
        endpoint:endpointFor(spec).baseUrl
      }
    }))
  }

  async function completion(spec,request,{onDelta}={}){
    const state=await ensure(spec)
    const streaming=typeof onDelta==='function'
    const response=await fetchImpl(state.completionUrl,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(streaming?{...request,stream:true,stream_options:{include_usage:true}}:request),
      signal:AbortSignal.timeout(Number.isFinite(completionTimeoutMs)&&completionTimeoutMs>0?completionTimeoutMs:90_000)
    })
    if(streaming){
      if(!response.ok){
        const body=await response.text()
        throw new Error(`${spec.shortName} VisionPsy HTTP ${response.status}: ${body.slice(0,500)}`)
      }
      return parseVisionPsyEventStream(response.body,{onDelta})
    }
    const body=await response.text()
    if(!response.ok)throw new Error(`${spec.shortName} VisionPsy HTTP ${response.status}: ${body.slice(0,500)}`)
    const payload=JSON.parse(body)
    return {
      content:String(payload?.choices?.[0]?.message?.content||''),
      finish_reason:String(payload?.choices?.[0]?.finish_reason||'')||null,
      usage:payload?.usage||null,
      timings:payload?.timings||null
    }
  }

  async function close(){
    const waits=[]
    for(const {child,logFd} of children.values()){
      if(child.exitCode===null){
        waits.push(new Promise(resolve=>{
          const timer=setTimeout(resolve,1500)
          child.once('exit',()=>{clearTimeout(timer);resolve()})
          child.kill('SIGTERM')
        }))
      }
      try{fs.closeSync(logFd)}catch{}
    }
    await Promise.all(waits)
    children.clear()
  }

  return {ensure,ensureAll,status,completion,close,inspect}
}
