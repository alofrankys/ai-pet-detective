import fs from 'node:fs'
import path from 'node:path'

const [judgeArg,keyArg,inputArg,jsonArg,markdownArg]=process.argv.slice(2)
if(!judgeArg||!keyArg||!inputArg||!jsonArg||!markdownArg){
  console.error('Usage: node finalize-judge-report.mjs <blind-judge.json> <blind-key.json> <blind-input.json> <output.json> <output.md>')
  process.exit(2)
}

const readJson=file=>JSON.parse(fs.readFileSync(path.resolve(file),'utf8'))
const blindJudge=readJson(judgeArg)
const blindKey=readJson(keyArg)
const blindInput=readJson(inputArg)
const keyByCase=Object.fromEntries(blindKey.key.map(item=>[item.case_id,item]))
const inputByCase=Object.fromEntries(blindInput.cases.map(item=>[item.case_id,item]))
const scores={flash:[],quality:[]}
const wins={flash:0,quality:0,tie:0}

const cases=blindJudge.cases.map(item=>{
  const key=keyByCase[item.case_id]
  const input=inputByCase[item.case_id]
  if(!key||!input)throw new Error(`Missing blind mapping for ${item.case_id}`)
  const sideForVariant=variant=>key.a===variant?'A':'B'
  const flashSide=sideForVariant('flash')
  const qualitySide=sideForVariant('quality')
  const flash=item.scores[flashSide]
  const quality=item.scores[qualitySide]
  scores.flash.push(flash.total)
  scores.quality.push(quality.total)
  const winner=item.winner==='tie'?'tie':key[item.winner.toLowerCase()]
  wins[winner]+=1
  return {
    case_id:item.case_id,
    filename:path.basename(input.image_path),
    reference_observation:item.reference_observation,
    flash,
    quality,
    winner,
    judge_confidence:item.judge_confidence,
    rationale:item.rationale
  }
})

const mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length
const median=values=>{
  const sorted=[...values].sort((a,b)=>a-b)
  const midpoint=Math.floor(sorted.length/2)
  return sorted.length%2?sorted[midpoint]:(sorted[midpoint-1]+sorted[midpoint])/2
}
const averageAbsoluteMargin=mean(cases.map(item=>Math.abs(item.flash.total-item.quality.total)))
const round=value=>Math.round(value*10)/10
const result={
  version:1,
  title:'Moment Lens — directional 10-image judge',
  generated_at:new Date().toISOString(),
  judge:{
    model:'gpt-5.6-sol',
    reasoning_effort:'medium',
    execution:'Post-hoc in Codex; no judge API is integrated in Studio.',
    evaluation_mode:blindJudge.evaluation_mode
  },
  comparison:{
    flash:'VisionPsy-Nano-460M-Flash · Q4_K_M-imat',
    quality:'VisionPsy-Nano-460M · Q4_K_M-imat',
    same_quantization:true,
    same_prompt:true,
    same_selected_image:true,
    max_output_tokens:256,
    temperature:0
  },
  rubric:blindJudge.rubric,
  summary:{
    sample_size:cases.length,
    flash_mean:round(mean(scores.flash)),
    quality_mean:round(mean(scores.quality)),
    flash_median:round(median(scores.flash)),
    quality_median:round(median(scores.quality)),
    flash_wins:wins.flash,
    quality_wins:wins.quality,
    ties:wins.tie,
    average_absolute_margin:round(averageAbsoluteMargin)
  },
  cases,
  limitation:'Selected sample of 10 images, one visual judge and one run per model. Directional demo evidence only; not an official or statistically representative benchmark.'
}

const table=cases.map(item=>`| ${item.case_id} | ${item.filename} | ${item.flash.total} | ${item.quality.total} | ${item.winner} |`).join('\n')
const markdown=`# Moment Lens — directional 10-image judge

Flash and Full were judged blind against the actual image. The judge rewarded grounded, logically coherent coverage rather than wording overlap.

| Metric | Flash Q4 | Full Q4 |
| --- | ---: | ---: |
| Mean score | ${result.summary.flash_mean} | ${result.summary.quality_mean} |
| Median score | ${result.summary.flash_median} | ${result.summary.quality_median} |
| Wins | ${result.summary.flash_wins} | ${result.summary.quality_wins} |

Ties: ${result.summary.ties}. Average absolute case margin: ${result.summary.average_absolute_margin} points.

## Per-image scores

| Case | Image | Flash | Full | Winner |
| --- | --- | ---: | ---: | --- |
${table}

## Method

- VisionPsy-Nano-460M-Flash Q4_K_M-imat versus VisionPsy-Nano-460M Q4_K_M-imat.
- Same selected image, prompt, quantization, greedy decode and 256-token ceiling.
- Judge: GPT-5.6 Sol, medium reasoning, post-hoc in Codex; no judge API is integrated in Studio.
- Score: groundedness 45, useful coverage 25, spatial logic 15, clarity 15, minus unsupported-claim penalties.

> ${result.limitation}
`

for(const [file,content] of [[jsonArg,`${JSON.stringify(result,null,2)}\n`],[markdownArg,markdown]]){
  const output=path.resolve(file)
  fs.mkdirSync(path.dirname(output),{recursive:true})
  fs.writeFileSync(output,content)
}

console.log(`Finalized ${cases.length} judged cases: Full ${result.summary.quality_wins} wins, Flash ${result.summary.flash_wins}, ties ${result.summary.ties}`)
