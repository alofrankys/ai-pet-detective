import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'

const [sourceArg,outputArg,endpointArg]=process.argv.slice(2)
if(!sourceArg||!outputArg){
  console.error('Usage: node benchmark-moment-lens.mjs <jpeg-directory> <report.json> [endpoint]')
  process.exit(2)
}

const sourceDir=path.resolve(sourceArg)
const outputFile=path.resolve(outputArg)
const endpoint=endpointArg||'http://127.0.0.1:8803/api/moment-lens'
const statusEndpoint=new URL('/api/status',endpoint).href
const diagnosticThresholds=[128,256,512]
const requestTimeoutMs=Number(process.env.MOMENT_BENCHMARK_TIMEOUT_MS||240_000)
const files=fs.readdirSync(sourceDir)
  .filter(file=>/\.jpe?g$/i.test(file))
  .sort((left,right)=>left.localeCompare(right,'en',{numeric:true}))

function percentile(values,ratio){
  if(!values.length)return null
  const ordered=[...values].sort((a,b)=>a-b)
  return ordered[Math.min(ordered.length-1,Math.ceil(ratio*ordered.length)-1)]
}

function metrics(values){
  if(!values.length)return {count:0,mean:null,p50:null,p95:null,max:null}
  return {
    count:values.length,
    mean:Number((values.reduce((sum,value)=>sum+value,0)/values.length).toFixed(1)),
    p50:percentile(values,0.5),
    p95:percentile(values,0.95),
    max:Math.max(...values)
  }
}

function summarize(items){
  const summary={images:files.length,completed_images:items.filter(item=>item.results?.length===2).length,models:{}}
  for(const variant of ['flash','quality']){
    const results=items.flatMap(item=>item.results||[]).filter(result=>result.variant===variant)
    const valid=results.filter(result=>result.status!=='error')
    const lengthStops=valid.filter(result=>result.finish_reason==='length')
    const unclear=valid.filter(result=>result.status==='unclear')
    summary.models[variant]={
      results:results.length,
      errors:results.length-valid.length,
      clear:valid.filter(result=>result.status==='clear').length,
      unclear:unclear.length,
      unclear_rate:valid.length?Number((unclear.length/valid.length).toFixed(4)):null,
      length_stops:lengthStops.length,
      length_stop_rate:valid.length?Number((lengthStops.length/valid.length).toFixed(4)):null,
      output_tokens:metrics(valid.map(result=>result.output_tokens).filter(Number.isFinite)),
      inference_ms:metrics(valid.map(result=>result.inference_ms).filter(Number.isFinite)),
      simulated_thresholds:Object.fromEntries(diagnosticThresholds.map(threshold=>{
        const diagnostics=valid.map(result=>result.threshold_diagnostics?.[threshold]).filter(Boolean)
        const reached=diagnostics.filter(value=>value.would_reach_limit)
        return [threshold,{
          evaluated:diagnostics.length,
          would_reach_limit:reached.length,
          would_reach_limit_rate:diagnostics.length?Number((reached.length/diagnostics.length).toFixed(4)):null,
          prefixes_ending_mid_sentence:reached.filter(value=>!value.ends_on_sentence_boundary).length
        }]
      }))
    }
  }
  return summary
}

function save(report){
  fs.mkdirSync(path.dirname(outputFile),{recursive:true})
  const temporary=`${outputFile}.tmp`
  fs.writeFileSync(temporary,`${JSON.stringify(report,null,2)}\n`)
  fs.renameSync(temporary,outputFile)
}

function existingReport(){
  try{
    const value=JSON.parse(fs.readFileSync(outputFile,'utf8'))
    return value?.version===1&&Array.isArray(value.items)?value:null
  }catch{return null}
}

async function analyse(jpeg){
  const response=await fetch(endpoint,{
    method:'POST',
    headers:{'content-type':'image/jpeg','x-moment-preset':'describe'},
    body:jpeg,
    signal:AbortSignal.timeout(Number.isFinite(requestTimeoutMs)&&requestTimeoutMs>0?requestTimeoutMs:240_000)
  })
  const body=await response.text()
  if(!response.ok)throw new Error(`HTTP ${response.status}: ${body.slice(0,300)}`)
  const events=body.split('\n').filter(Boolean).map(line=>JSON.parse(line))
  return {
    results:events.filter(event=>event.type==='model-result').map(event=>event.result),
    total_ms:events.find(event=>event.type==='comparison-complete')?.total_ms??null
  }
}

async function postJson(url,body){
  const response=await fetch(url,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(10_000)
  })
  if(!response.ok)throw new Error(`${url} failed with HTTP ${response.status}`)
  return response.json()
}

async function addThresholdDiagnostics(result,modelEndpoints){
  const base=modelEndpoints[result.variant]
  const answer=result.raw_answer||result.answer
  if(!base||typeof answer!=='string'||!answer)return result
  const tokenized=await postJson(`${base}/tokenize`,{content:answer})
  const tokens=Array.isArray(tokenized.tokens)?tokenized.tokens:[]
  const thresholdDiagnostics={}
  for(const threshold of diagnosticThresholds){
    const wouldReach=tokens.length>=threshold
    let prefix=answer
    if(wouldReach){
      const detokenized=await postJson(`${base}/detokenize`,{tokens:tokens.slice(0,threshold)})
      prefix=String(detokenized.content||'')
    }
    thresholdDiagnostics[threshold]={
      would_reach_limit:wouldReach,
      ends_on_sentence_boundary:/[.!?][\"')\]]?\s*$/.test(prefix),
      prefix_character_length:prefix.length,
      prefix_tail:prefix.slice(-120)
    }
  }
  return {...result,tokenized_output_tokens:tokens.length,threshold_diagnostics:thresholdDiagnostics}
}

const prior=existingReport()
const statusResponse=await fetch(statusEndpoint,{signal:AbortSignal.timeout(5_000)})
if(!statusResponse.ok)throw new Error(`Studio status failed with HTTP ${statusResponse.status}`)
const studioStatus=await statusResponse.json()
const sampling=studioStatus.sampling
if(!sampling||!Number.isInteger(sampling.max_tokens))throw new Error('Studio did not disclose its sampling configuration')
const modelEndpoints=Object.fromEntries((studioStatus.models||[]).map(model=>[model.variant,model.endpoint]))
const items=prior?.items||[]
const completeNames=new Set(items.filter(item=>
  item.results?.length===2&&item.results.every(result=>result.status!=='error')
).map(item=>item.filename))
const report={
  version:1,
  dataset:path.basename(path.dirname(sourceDir)),
  source_directory:sourceDir,
  endpoint,
  preset:'describe',
  sampling,
  preprocessing:{format:'JPEG',max_dimension:1600,quality:85},
  started_at:prior?.started_at||new Date().toISOString(),
  updated_at:new Date().toISOString(),
  completed_at:null,
  items,
  summary:summarize(items)
}

for(let index=0;index<files.length;index++){
  const filename=files[index]
  if(completeNames.has(filename)){
    console.log(`[${index+1}/${files.length}] ${filename} already complete`)
    continue
  }
  const jpeg=fs.readFileSync(path.join(sourceDir,filename))
  const item={
    filename,
    byte_length:jpeg.length,
    sha256:createHash('sha256').update(jpeg).digest('hex'),
    started_at:new Date().toISOString(),
    results:[]
  }
  console.log(`[${index+1}/${files.length}] ${filename} analysing`)
  try{
    const result=await analyse(jpeg)
    result.results=await Promise.all(result.results.map(value=>addThresholdDiagnostics(value,modelEndpoints)))
    Object.assign(item,result,{status:result.results.length===2?'complete':'incomplete'})
    const stops=result.results.map(value=>`${value.variant}:${value.finish_reason||value.status}`).join(' ')
    console.log(`[${index+1}/${files.length}] ${filename} ${stops}`)
  }catch(error){
    item.status='error'
    item.error=String(error?.message||error).slice(0,1000)
    console.error(`[${index+1}/${files.length}] ${filename} ERROR ${item.error}`)
  }
  item.completed_at=new Date().toISOString()
  const previousIndex=items.findIndex(value=>value.filename===filename)
  if(previousIndex>=0)items[previousIndex]=item
  else items.push(item)
  report.updated_at=new Date().toISOString()
  report.summary=summarize(items)
  save(report)
}

report.updated_at=new Date().toISOString()
report.completed_at=new Date().toISOString()
report.summary=summarize(items)
save(report)
console.log(JSON.stringify(report.summary,null,2))
