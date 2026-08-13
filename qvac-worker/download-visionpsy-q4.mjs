import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {createHash} from 'node:crypto'
import {pipeline} from 'node:stream/promises'
import {Transform,Writable} from 'node:stream'
import {fileURLToPath} from 'node:url'

const here=path.dirname(fileURLToPath(import.meta.url))

const artifacts=Object.freeze([
  Object.freeze({
    label:'Flash Q4_K_M-imat weights',
    file:'visionpsy-nano-460m-flash-q4_k_m-imat.gguf',
    bytes:303_143_488,
    sha256:'90b0abe16180f1fe5918bc5d89c3b6eeaf40520a50f906d6303a59a32b699fbc',
    url:'https://huggingface.co/qvac/VisionPsy-Nano-460M-Flash-GGUFs/resolve/main/visionpsy-nano-460m-flash-q4_k_m-imat.gguf'
  }),
  Object.freeze({
    label:'Flash official multimodal projector',
    file:'mmproj-visionpsy-nano-460m-flash-q8.gguf',
    bytes:108_782_144,
    sha256:'bbb0691873a4e638f6928898b3c3be9a4730bd4ced301197726a4fcb549695d0',
    url:'https://huggingface.co/qvac/VisionPsy-Nano-460M-Flash-GGUFs/resolve/main/mmproj-visionpsy-nano-460m-flash-q8.gguf'
  }),
  Object.freeze({
    label:'Full Q4_K_M-imat weights',
    file:'visionpsy-nano-460m-q4_k_m-imat.gguf',
    bytes:303_143_488,
    sha256:'41794b9f501e30f44f19c8be4b87b965db77fbd3e4c7625291999cff7966db8a',
    url:'https://huggingface.co/qvac/VisionPsy-Nano-460M-GGUFs/resolve/main/visionpsy-nano-460m-q4_k_m-imat.gguf'
  }),
  Object.freeze({
    label:'Full official multimodal projector',
    file:'mmproj-visionpsy-nano-460m-q8.gguf',
    bytes:108_782_144,
    sha256:'92f1bb80acaba3e7b59b6534f47447b830330bc9051018d6d8b5d768e58503c2',
    url:'https://huggingface.co/qvac/VisionPsy-Nano-460M-GGUFs/resolve/main/mmproj-visionpsy-nano-460m-q8.gguf'
  })
])

function usage(){
  console.log('Usage: node download-visionpsy-q4.mjs [--verify-only] [--dir PATH]')
}

function parseArguments(args){
  let verifyOnly=false
  let destination=path.resolve(here,'..','models')
  for(let index=0;index<args.length;index+=1){
    const argument=args[index]
    if(argument==='--verify-only')verifyOnly=true
    else if(argument==='--dir'){
      const value=args[index+1]
      if(!value)throw new Error('--dir requires a path')
      destination=path.resolve(value)
      index+=1
    }else if(argument==='--help'||argument==='-h'){
      usage()
      return null
    }else throw new Error(`Unknown argument: ${argument}`)
  }
  return {verifyOnly,destination}
}

async function digest(file){
  const hash=createHash('sha256')
  let bytes=0
  await pipeline(
    fs.createReadStream(file),
    new Writable({write(chunk,_encoding,callback){
      bytes+=chunk.length
      hash.update(chunk)
      callback()
    }})
  )
  return {bytes,sha256:hash.digest('hex')}
}

async function verify(file,artifact){
  try{
    const state=await digest(file)
    return {...state,valid:state.bytes===artifact.bytes&&state.sha256===artifact.sha256}
  }catch(error){
    if(error?.code==='ENOENT')return {bytes:0,sha256:null,valid:false,missing:true}
    throw error
  }
}

async function download(artifact,target){
  const partial=`${target}.partial-${process.pid}`
  const response=await fetch(artifact.url,{
    redirect:'follow',
    headers:{'accept-encoding':'identity'}
  })
  if(!response.ok||!response.body)throw new Error(`${artifact.file}: download returned HTTP ${response.status}`)

  const hash=createHash('sha256')
  let bytes=0
  const counter=new Transform({transform(chunk,_encoding,callback){
    bytes+=chunk.length
    hash.update(chunk)
    callback(null,chunk)
  }})

  try{
    await pipeline(response.body,counter,fs.createWriteStream(partial,{flags:'wx'}))
    const sha256=hash.digest('hex')
    if(bytes!==artifact.bytes||sha256!==artifact.sha256){
      throw new Error(`${artifact.file}: integrity check failed (received ${bytes} bytes, SHA-256 ${sha256})`)
    }
    // A hard link publishes the verified file atomically without overwriting a
    // target another process may have created while this download was running.
    await fs.promises.link(partial,target)
    await fs.promises.unlink(partial)
  }catch(error){
    await fs.promises.unlink(partial).catch(()=>{})
    throw error
  }
}

async function main(){
  const options=parseArguments(process.argv.slice(2))
  if(!options)return
  if(!options.verifyOnly)await fs.promises.mkdir(options.destination,{recursive:true})
  console.log(`${options.verifyOnly?'Verifying':'Preparing'} official VisionPsy Q4 comparison assets in ${options.destination}`)

  let invalid=0
  for(const artifact of artifacts){
    const target=path.join(options.destination,artifact.file)
    const state=await verify(target,artifact)
    if(state.valid){
      console.log(`OK  ${artifact.file}`)
      continue
    }
    if(options.verifyOnly){
      console.error(`${state.missing?'MISSING':'INVALID'}  ${artifact.file}`)
      invalid+=1
      continue
    }
    if(!state.missing){
      throw new Error(`${target} exists but does not match the official size and SHA-256; move it aside before downloading`)
    }
    console.log(`GET ${artifact.label} (${(artifact.bytes/1024/1024).toFixed(1)} MiB)`)
    await download(artifact,target)
    console.log(`OK  ${artifact.file}`)
  }

  if(invalid>0)throw new Error(`${invalid} required artifact${invalid===1?' is':'s are'} missing or invalid`)
  console.log('All four official artifacts match their expected sizes and SHA-256 hashes.')
}

main().catch(error=>{
  console.error(error?.message||error)
  process.exitCode=1
})
