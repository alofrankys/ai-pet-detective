const VARIANTS=Object.freeze(['flash','quality'])

function finiteNumber(value){
  const number=Number(value)
  return Number.isFinite(number)?number:null
}

function boundedText(value,maximum=2000){
  return String(value??'').replace(/\r\n?/g,'\n').trim().slice(0,maximum)
}

function mean(values){
  return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null
}

function rounded(value){
  return value===null?null:Math.round(value*10)/10
}

function modelSummary(items,variant){
  const results=items.flatMap(item=>item.results||[]).filter(result=>result?.variant===variant)
  const timings=results.map(result=>finiteNumber(result.inference_ms)).filter(value=>value!==null)
  const ttfts=results.map(result=>finiteNumber(result.ttft_ms)).filter(value=>value!==null)
  const throughputs=results.map(result=>finiteNumber(result.tokens_per_second??result.timings?.predicted_per_second)).filter(value=>value!==null)
  const tokens=results.map(result=>finiteNumber(result.output_tokens)).filter(value=>value!==null)
  return {
    results:results.length,
    clear:results.filter(result=>result.status==='clear').length,
    max_reached:results.filter(result=>result.finish_reason==='length').length,
    unclear:results.filter(result=>result.status==='unclear').length,
    errors:results.filter(result=>result.status==='error').length,
    average_inference_ms:rounded(mean(timings)),
    average_ttft_ms:rounded(mean(ttfts)),
    average_tokens_per_second:rounded(mean(throughputs)),
    average_output_tokens:rounded(mean(tokens))
  }
}

export function createBatchSession(photoItems,{preset='describe',maxTokens=256,now=()=>new Date().toISOString()}={}){
  const items=Array.from(photoItems||[]).map((item,index)=>({
    index,
    filename:boundedText(item?.name||item?.file?.name||`Photo ${index+1}`,512),
    source_type:boundedText(item?.type||item?.file?.type,100),
    source_bytes:Math.max(0,Number(item?.size||item?.file?.size)||0),
    status:'pending',
    source_sha256:null,
    jpeg_sha256:null,
    started_at:null,
    completed_at:null,
    total_ms:null,
    results:[]
  }))
  return {
    version:1,
    mode:'moment_lens_batch',
    execution:'local',
    judge_mode:'precomputed_import_only',
    preset,
    sampling:{max_tokens:Number(maxTokens)||256,temperature:0},
    created_at:now(),
    started_at:null,
    completed_at:null,
    stopped:false,
    items
  }
}

export function nextPendingBatchIndex(session){
  return session?.items?.findIndex(item=>item.status==='pending'||item.status==='running')??-1
}

export function markBatchStarted(session,now=()=>new Date().toISOString()){
  if(!session.started_at)session.started_at=now()
  session.stopped=false
  return session
}

export function markBatchItemRunning(session,index,now=()=>new Date().toISOString()){
  const item=session.items[index]
  if(!item)throw new RangeError('Unknown batch item')
  item.status='running'
  item.started_at=now()
  item.completed_at=null
  return item
}

export function requeueBatchItem(session,index){
  const item=session.items[index]
  if(!item)throw new RangeError('Unknown batch item')
  item.status='pending'
  item.started_at=null
  item.completed_at=null
  item.total_ms=null
  item.source_sha256=null
  item.jpeg_sha256=null
  item.results=[]
  return item
}

export function recordBatchItem(session,index,{results=[],totalMs=null,jpegSha256=null,sourceSha256=null,status='complete'}={},now=()=>new Date().toISOString()){
  const item=session.items[index]
  if(!item)throw new RangeError('Unknown batch item')
  item.results=Array.isArray(results)?results:[]
  item.total_ms=finiteNumber(totalMs)
  item.source_sha256=boundedText(sourceSha256,128)||null
  item.jpeg_sha256=boundedText(jpegSha256,128)||null
  item.status=['complete','error','skipped'].includes(status)?status:'error'
  item.completed_at=now()
  return item
}

export function finishBatchSession(session,{stopped=false,now=()=>new Date().toISOString()}={}){
  session.stopped=Boolean(stopped)
  if(!stopped&&session.items.every(item=>['complete','error','skipped'].includes(item.status)))session.completed_at=now()
  return session
}

export function summarizeBatchSession(session,judgeReport=null){
  const items=Array.isArray(session?.items)?session.items:[]
  const completed=items.filter(item=>item.status==='complete')
  const failed=items.filter(item=>item.status==='error')
  const summary={
    total:items.length,
    processed:completed.length+failed.length+items.filter(item=>item.status==='skipped').length,
    completed:completed.length,
    failed:failed.length,
    pending:items.filter(item=>item.status==='pending'||item.status==='running').length,
    models:Object.fromEntries(VARIANTS.map(variant=>[variant,modelSummary(items,variant)])),
    judge:{matched:0,flash_mean:null,quality_mean:null,flash_wins:0,quality_wins:0,ties:0}
  }
  const normalized=judgeReport?.cases instanceof Map?judgeReport:null
  if(!normalized)return summary
  const judged=items.filter(item=>item.status==='complete').map(item=>normalized.cases.get(item.filename)).filter(Boolean)
  const flash=judged.map(item=>item.flash_score).filter(value=>value!==null)
  const quality=judged.map(item=>item.quality_score).filter(value=>value!==null)
  summary.judge={
    matched:judged.length,
    flash_mean:rounded(mean(flash)),
    quality_mean:rounded(mean(quality)),
    flash_wins:judged.filter(item=>item.winner==='flash').length,
    quality_wins:judged.filter(item=>item.winner==='quality').length,
    ties:judged.filter(item=>item.winner==='tie').length
  }
  return summary
}

export function normalizePrecomputedJudgeReport(value){
  if(!value||typeof value!=='object'||!Array.isArray(value.cases))throw new Error('Judge report must contain a cases array')
  if(value.cases.length>10_000)throw new Error('Judge report is too large')
  const cases=new Map()
  for(const candidate of value.cases){
    const filename=boundedText(candidate?.filename,512)
    if(!filename||cases.has(filename))continue
    const flashScore=finiteNumber(candidate?.flash?.total??candidate?.flash_score)
    const qualityScore=finiteNumber(candidate?.quality?.total??candidate?.quality_score)
    const winner=['flash','quality','tie'].includes(candidate?.winner)?candidate.winner:null
    if(flashScore===null||qualityScore===null||!winner)continue
    cases.set(filename,{
      filename,
      flash_score:flashScore,
      quality_score:qualityScore,
      winner,
      confidence:boundedText(candidate?.judge_confidence||candidate?.confidence,40)||null,
      rationale:boundedText(candidate?.rationale,2000)||null
    })
  }
  if(!cases.size)throw new Error('Judge report contains no usable cases')
  const evaluationMode=boundedText(value?.judge?.evaluation_mode,200)||null
  return {
    source:'precomputed',
    label:/\bblind\b/i.test(evaluationMode||'')?'Post-hoc blind judge':'Post-hoc judge',
    judge_model:boundedText(value?.judge?.model||value?.judge||'External judge',120),
    evaluation_mode:evaluationMode,
    imported_cases:cases.size,
    cases
  }
}

export function judgeCaseForItem(judgeReport,item){
  return judgeReport?.cases instanceof Map?judgeReport.cases.get(item?.filename)||null:null
}

export function serializableBatchReport(session,judgeReport=null){
  const summary=summarizeBatchSession(session,judgeReport)
  return {
    ...session,
    summary,
    judge:judgeReport?{
      source:'precomputed',
      label:judgeReport.label,
      judge_model:judgeReport.judge_model,
      evaluation_mode:judgeReport.evaluation_mode,
      imported_cases:judgeReport.imported_cases,
      cases:[...judgeReport.cases.values()]
    }:null
  }
}
